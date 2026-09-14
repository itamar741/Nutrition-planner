import { NextResponse } from "next/server";
import { candidateDecisionRequestSchema } from "@/domain/catalog/api-contracts";
import { catalogFoodSchema } from "@/domain/catalog/schemas";
import {
  approveCatalogFood,
  getCandidate,
  getLookup,
  StaleProfileError,
  updateLookup,
} from "@/persistence/repository";
import { requestHasAccess } from "@/security/demo-access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!requestHasAccess(request)) {
    return NextResponse.json(
      { ok: false, message: "Demo access is required." },
      { status: 401 },
    );
  }
  try {
    const input = candidateDecisionRequestSchema.parse(await request.json());
    const candidate = await getCandidate(input.candidateId);
    const lookup = await getLookup(candidate.lookupId);
    if (lookup.profileId !== input.profileId) {
      throw new Error("This candidate belongs to the other demo profile.");
    }
    if (candidate.status !== "detailed" && candidate.status !== "approved") {
      throw new Error("This candidate is not ready for approval.");
    }
    const parsed = catalogFoodSchema.parse(
      (candidate.data as { food?: unknown }).food,
    );
    const food = {
      ...parsed,
      runtimeApproval: {
        approvedAt: new Date().toISOString(),
        approvedByProfileId: input.profileId,
      },
    };
    const result = await approveCatalogFood({
      food,
      sourceIdentifier: candidate.sourceIdentifier,
      profileId: input.profileId,
      expectedVersion: input.expectedVersion,
      commandId: input.commandId,
    });
    await updateLookup(candidate.lookupId, {
      status: "approved",
      failureCode: null,
    });
    return NextResponse.json({
      ok: true,
      food: result.food,
      profile: result.profile,
      message: `${result.food.displayName} is now available in the central catalog and was added to this profile's foods.`,
    });
  } catch (error) {
    if (error instanceof StaleProfileError) {
      return NextResponse.json(
        {
          ok: false,
          code: "stale_state",
          message:
            "The demo changed in another browser. Reloaded the latest state; approve again if it is still correct.",
          profile: error.current,
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        message: "Approval could not be saved.",
      },
      { status: 422 },
    );
  }
}
