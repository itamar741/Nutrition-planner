import { NextResponse } from "next/server";
import { z } from "zod";
import type { DemoProfileId } from "@/domain/profile/types";
import {
  demoReducer,
  type DemoAction,
  type DemoState,
} from "@/store/demo-reducer";
import { applyFactPatch } from "@/domain/profile/onboarding";
import {
  existingDemoReducer,
  type ExistingDemoAction,
} from "@/store/existing-demo-reducer";
import type { ExistingDemoState } from "@/store/existing-demo-store";
import {
  existingDemoCloudActionSchema,
  newDemoCloudActionSchema,
} from "@/store/cloud-action-schemas";
import {
  ActiveAgentTurnError,
  assertNoActiveAgentTurn,
  getProfile,
  listCatalogFoods,
  mutateProfile,
  resetProfile,
  StaleProfileError,
} from "@/persistence/repository";
import { requestHasAccess } from "@/security/demo-access";
import { createCatalogSnapshot } from "@/domain/catalog/snapshot";

export const runtime = "nodejs";

const mutationEnvelopeSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    commandId: z.string().min(8).max(100),
    action: z.unknown(),
  })
  .strict();

function profileIdFrom(value: string): DemoProfileId | null {
  return value === "new" || value === "existing" ? value : null;
}

function unauthorized() {
  return NextResponse.json(
    { ok: false, message: "Demo access is required." },
    { status: 401 },
  );
}

function staleResponse(error: StaleProfileError) {
  return NextResponse.json(
    {
      ok: false,
      code: "stale_state",
      message:
        "The demo changed in another browser. The latest state was loaded; retry your action.",
      profile: error.current,
    },
    { status: 409 },
  );
}

function activeTurnResponse() {
  return NextResponse.json(
    {
      ok: false,
      code: "coach_turn_active",
      message: "Wait for Arnold to finish before changing this demo.",
    },
    { status: 409 },
  );
}

function resolveClosedAction(
  state: DemoState,
  optionId: string,
  commandId: string,
): DemoAction {
  const turn = state.activeTurn;
  if (turn.type !== "closed_question") {
    throw new Error("No closed question is active.");
  }
  const option = turn.options.find((candidate) => candidate.id === optionId);
  if (!option) throw new Error("The option was not offered.");

  const nextProfile = applyFactPatch(state.profile, option.patch);
  if (JSON.stringify(nextProfile) === JSON.stringify(state.profile)) {
    throw new Error("The option does not change the profile.");
  }

  return {
    type: "apply_closed",
    commandId,
    optionId: option.id,
    label: option.label,
    patch: option.patch,
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ profileId: string }> },
) {
  if (!requestHasAccess(request)) return unauthorized();
  const profileId = profileIdFrom((await context.params).profileId);
  if (!profileId) return NextResponse.json({ ok: false }, { status: 404 });
  const [profile, catalog] = await Promise.all([
    getProfile(profileId),
    listCatalogFoods(),
  ]);
  return NextResponse.json({ ok: true, profile, catalog });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ profileId: string }> },
) {
  if (!requestHasAccess(request)) return unauthorized();
  const profileId = profileIdFrom((await context.params).profileId);
  if (!profileId) return NextResponse.json({ ok: false }, { status: 404 });
  try {
    const envelope = mutationEnvelopeSchema.parse(await request.json());
    await assertNoActiveAgentTurn(profileId);
    if (profileId === "new") {
      const action = newDemoCloudActionSchema.parse(envelope.action);
      const catalog = createCatalogSnapshot(await listCatalogFoods());
      const profile = await mutateProfile<DemoState>({
        profileId,
        expectedVersion: envelope.expectedVersion,
        commandId: envelope.commandId,
        mutation: (state) =>
          demoReducer(
            state,
            action.type === "apply_closed"
              ? resolveClosedAction(state, action.optionId, envelope.commandId)
              : action,
            catalog,
          ),
      });
      return NextResponse.json({ ok: true, profile });
    }
    const action = existingDemoCloudActionSchema.parse(envelope.action);
    if (action.commandId !== envelope.commandId) {
      throw new Error("The command identity does not match the action.");
    }
    const profile = await mutateProfile<ExistingDemoState>({
      profileId,
      expectedVersion: envelope.expectedVersion,
      commandId: envelope.commandId,
      mutation: (state) =>
        existingDemoReducer(state, action as ExistingDemoAction),
    });
    return NextResponse.json({ ok: true, profile });
  } catch (error) {
    if (error instanceof StaleProfileError) return staleResponse(error);
    if (error instanceof ActiveAgentTurnError) return activeTurnResponse();
    return NextResponse.json(
      { ok: false, message: "The requested demo action is invalid." },
      { status: 400 },
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ profileId: string }> },
) {
  if (!requestHasAccess(request)) return unauthorized();
  const profileId = profileIdFrom((await context.params).profileId);
  if (!profileId) return NextResponse.json({ ok: false }, { status: 404 });
  try {
    const envelope = z
      .object({
        expectedVersion: z.number().int().positive(),
        commandId: z.string().min(8).max(100),
        action: z.literal("reset"),
      })
      .strict()
      .parse(await request.json());
    await assertNoActiveAgentTurn(profileId);
    const profile = await resetProfile({
      profileId,
      expectedVersion: envelope.expectedVersion,
      commandId: envelope.commandId,
    });
    return NextResponse.json({ ok: true, profile });
  } catch (error) {
    if (error instanceof StaleProfileError) return staleResponse(error);
    if (error instanceof ActiveAgentTurnError) return activeTurnResponse();
    return NextResponse.json(
      { ok: false, message: "The demo could not be reset." },
      { status: 400 },
    );
  }
}
