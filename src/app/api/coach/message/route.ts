import { NextResponse } from "next/server";
import { z } from "zod";
import { executeCoachTurn } from "@/application/coach-turn";
import {
  coachMessageRequestSchema,
  type AgentStreamEvent,
} from "@/domain/agent/types";
import {
  ActiveAgentTurnError,
  AgentTurnReplayError,
  appendConversationActivity,
  finishAgentTurn,
  getProfile,
  listConversationActivities,
  recordAndCheckAgentRateLimit,
  reserveAgentTurn,
  StaleProfileError,
  updateAssistantMessage,
} from "@/persistence/repository";
import { requestHasAccess } from "@/security/demo-access";
import { rateIdentity } from "@/security/rate-identity";
import { sanitizeDiagnosticText } from "@/security/safe-diagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(
  message: string,
  status: number,
  extra: Record<string, unknown> = {},
) {
  return NextResponse.json({ ok: false, message, ...extra }, { status });
}

function safeCoachErrorMessage(error: unknown) {
  if (error instanceof z.ZodError) {
    return "The coach proposed an invalid action. Your confirmed state was preserved.";
  }
  const message = error instanceof Error ? error.message : "";
  const safePrefixes = [
    "That ",
    "There is no ",
    "Choose one ",
    "Select one ",
    "No weight is recorded ",
    "Today's weight already exists",
    "Weight history is available ",
    "Draft creation is available ",
    "The deterministic trend ",
    "The adjustment is stale ",
    "The Draft is stale ",
    "The catalog food no longer exists",
    "An AI estimate is available ",
    "The food-search limit has been reached",
  ];
  if (safePrefixes.some((prefix) => message.startsWith(prefix))) return message;
  return "The coach could not complete this turn. Your confirmed state was preserved.";
}

function actionLabel(action: string) {
  const labels: Record<string, string> = {
    review_trend: "Opened Arnold trend review",
    generate_adjustment: "Requested an adjustment Draft",
    select_candidate: "Selected a food candidate",
    approve_food: "Approved the displayed food",
    reject_food: "Rejected the displayed food",
    add_existing_food: "Added the displayed catalog food",
    confirm_draft_food: "Requested a Draft with the new food",
    decline_draft_food: "Declined a Draft with the new food",
    confirm_ai_estimate: "Requested an unverified AI estimate",
    refine_search: "Requested a refined food search",
    approve_draft: "Approved the displayed Draft",
    reject_draft: "Rejected the displayed Draft",
    approve_adjustment: "Approved the displayed adjustment",
    reject_adjustment: "Rejected the displayed adjustment",
  };
  return labels[action] ?? "Used a visible conversation control";
}

const statusActivity = {
  thinking: ["thinking", "Thinking"],
  searching: ["searching_usda", "Searching USDA"],
  validating: ["validating_nutrition", "Validating nutrition"],
  checking_foods: ["checking_foods", "Checking your foods and plans"],
  remembering: ["remembering_preference", "Remembering your preference"],
  creating_draft: ["creating_draft", "Creating Draft"],
  revising_draft: ["revising_draft", "Revising Draft"],
} as const;

export async function POST(request: Request) {
  if (!requestHasAccess(request))
    return jsonError("Demo access is required.", 401);
  let input: z.infer<typeof coachMessageRequestSchema>;
  try {
    input = coachMessageRequestSchema.parse(await request.json());
  } catch {
    return jsonError("The coach message is invalid.", 400, {
      code: "invalid_request",
    });
  }
  const identity = rateIdentity(request);
  let reservation: Awaited<ReturnType<typeof reserveAgentTurn>>;
  try {
    reservation = await reserveAgentTurn({
      profileId: input.profileId,
      expectedVersion: input.expectedVersion,
      commandId: input.commandId,
      request: input as unknown as Record<string, unknown>,
      ...(input.input.type === "text"
        ? {
            userMessage: {
              id: `user-${input.commandId}`,
              content: input.input.text,
            },
          }
        : {
            userAction: {
              id: `action-${input.commandId}`,
              label: actionLabel(input.input.action),
            },
          }),
    });
    if (reservation.outcome === "duplicate") {
      if (reservation.turn.status === "completed" && reservation.turn.result) {
        return NextResponse.json({
          ok: true,
          duplicate: true,
          ...reservation.turn.result,
        });
      }
      if (reservation.turn.status === "pending") {
        return jsonError(
          "This coach turn is still processing. Retry shortly with the same action.",
          409,
          { code: "turn_pending", turnId: input.commandId },
        );
      }
      return jsonError(
        "The previous attempt failed safely. Retry with a new command.",
        409,
        { code: "turn_failed", turnId: input.commandId },
      );
    }
  } catch (error) {
    if (error instanceof StaleProfileError) {
      return jsonError(
        "The demo changed in another browser. The latest state was loaded; retry your message.",
        409,
        { code: "stale_state", profile: error.current },
      );
    }
    if (error instanceof ActiveAgentTurnError) {
      return jsonError(
        "Another coach turn is still processing for this shared profile.",
        409,
        { code: "turn_active", turnId: error.commandId },
      );
    }
    if (error instanceof AgentTurnReplayError) {
      return jsonError(error.message, 409, { code: "command_replay_mismatch" });
    }
    throw error;
  }
  if (!(await recordAndCheckAgentRateLimit(identity))) {
    await finishAgentTurn({
      profileId: input.profileId,
      commandId: input.commandId,
      status: "failed",
      failureCode: "rate_limited",
    });
    await updateAssistantMessage({
      profileId: input.profileId,
      messageId: reservation.assistantMessageId,
      content:
        "The AI conversation limit has been reached. Try again after the limit window resets.",
      status: "failed",
    });
    return jsonError(
      "The AI conversation limit has been reached. Try again after the limit window resets.",
      429,
      { code: "rate_limited" },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const send = (event: AgentStreamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          open = false;
        }
      };
      void (async () => {
        let assistantText = "";
        let persistenceQueue = Promise.resolve();
        let activityIndex = 0;
        const persistPartial = (delta: string) => {
          assistantText = (assistantText + delta).slice(0, 4_000);
          persistenceQueue = persistenceQueue.then(() =>
            updateAssistantMessage({
              profileId: input.profileId,
              messageId: reservation.assistantMessageId,
              content: assistantText,
              status: "partial",
            }),
          );
        };
        const persistStatus = (
          value: AgentStreamEvent & { type: "status" },
        ) => {
          activityIndex += 1;
          const [kind, label] = statusActivity[value.value];
          persistenceQueue = persistenceQueue.then(() =>
            appendConversationActivity({
              profileId: input.profileId,
              id: `activity-${input.commandId}-${activityIndex}`,
              turnId: input.commandId,
              kind,
              label,
            }).then(() => undefined),
          );
        };
        try {
          const result = await executeCoachTurn({
            request: input,
            rateIdentity: identity,
            turnId: input.commandId,
            onStatus: (value) => {
              const event = { type: "status" as const, value };
              persistStatus(event);
              send(event);
            },
            onText: (value) => {
              persistPartial(value);
              send({ type: "text_delta", value });
            },
          });
          await persistenceQueue;
          assistantText = result.assistantText.slice(0, 4_000);
          await updateAssistantMessage({
            profileId: input.profileId,
            messageId: reservation.assistantMessageId,
            content: assistantText,
            status: "final",
          });
          const hydratedProfile = await getProfile(input.profileId);
          const activities = await listConversationActivities(input.profileId);
          const persisted = {
            profile: hydratedProfile,
            ...(result.catalogFood ? { catalogFood: result.catalogFood } : {}),
            assistantText,
          };
          await finishAgentTurn({
            profileId: input.profileId,
            commandId: input.commandId,
            status: "completed",
            result: persisted as unknown as Record<string, unknown>,
          });
          send({
            type: "state",
            profile: hydratedProfile,
            activities,
            catalogFood: result.catalogFood,
          });
          send({ type: "done", turnId: input.commandId });
        } catch (error) {
          await persistenceQueue.catch(() => undefined);
          const external = error as Error & {
            stage?: string;
            failureCode?: string;
            lookupId?: string;
          };
          const failureCode =
            external.failureCode ??
            (error instanceof z.ZodError
              ? "invalid_model_action"
              : "coach_turn_failed");
          const safeMessage = safeCoachErrorMessage(error);
          await updateAssistantMessage({
            profileId: input.profileId,
            messageId: reservation.assistantMessageId,
            content: assistantText || safeMessage,
            status: "failed",
          }).catch(() => undefined);
          await appendConversationActivity({
            profileId: input.profileId,
            id: `activity-${input.commandId}-failure`,
            turnId: input.commandId,
            kind: "failure",
            label: "This turn failed safely; confirmed state was preserved",
            status: "failed",
          }).catch(() => undefined);
          await finishAgentTurn({
            profileId: input.profileId,
            commandId: input.commandId,
            status: "failed",
            failureCode,
          }).catch(() => undefined);
          console.error("coach_turn_failed", {
            turnId: input.commandId,
            stage: external.stage ?? "agent",
            failureCode,
            lookupId: external.lookupId,
            name: error instanceof Error ? error.name : "UnknownError",
            message:
              error instanceof Error
                ? sanitizeDiagnosticText(error.message, 300)
                : "Unknown error",
            stack:
              error instanceof Error
                ? sanitizeDiagnosticText(
                    error.stack?.split("\n").slice(0, 4).join("\n") ?? "",
                    1_000,
                  )
                : undefined,
          });
          send({
            type: "error",
            message: safeMessage,
            diagnostics: {
              stage: external.stage ?? "agent",
              failureCode,
              turnId: input.commandId,
              ...(external.lookupId ? { lookupId: external.lookupId } : {}),
            },
          });
        } finally {
          if (open) controller.close();
        }
      })();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
