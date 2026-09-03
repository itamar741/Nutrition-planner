import { NextResponse } from "next/server";
import { z } from "zod";
import { executeCoachTurn } from "@/application/coach-turn";
import {
  coachMessageRequestSchema,
  type AgentStreamEvent,
} from "@/domain/agent/types";
import {
  ActiveAgentTurnError,
  finishAgentTurn,
  recordAndCheckAgentRateLimit,
  reserveAgentTurn,
  StaleProfileError,
} from "@/persistence/repository";
import { requestHasAccess } from "@/security/demo-access";
import { rateIdentity } from "@/security/rate-identity";

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
  try {
    const reservation = await reserveAgentTurn({
      profileId: input.profileId,
      expectedVersion: input.expectedVersion,
      commandId: input.commandId,
      request: input as unknown as Record<string, unknown>,
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
    throw error;
  }
  if (!(await recordAndCheckAgentRateLimit(identity))) {
    await finishAgentTurn({
      profileId: input.profileId,
      commandId: input.commandId,
      status: "failed",
      failureCode: "rate_limited",
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
        try {
          const result = await executeCoachTurn({
            request: input,
            rateIdentity: identity,
            turnId: input.commandId,
            onStatus: (value) => send({ type: "status", value }),
            onText: (value) => send({ type: "text_delta", value }),
          });
          const persisted = {
            profile: result.profile,
            ...(result.catalogFood ? { catalogFood: result.catalogFood } : {}),
            assistantText: result.assistantText,
          };
          await finishAgentTurn({
            profileId: input.profileId,
            commandId: input.commandId,
            status: "completed",
            result: persisted as unknown as Record<string, unknown>,
          });
          send({
            type: "state",
            profile: result.profile,
            catalogFood: result.catalogFood,
          });
          send({ type: "done", turnId: input.commandId });
        } catch (error) {
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
          });
          send({
            type: "error",
            message: safeCoachErrorMessage(error),
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
