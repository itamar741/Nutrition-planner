import { NextResponse } from "next/server";
import { z } from "zod";
import { prepareFoodCandidate } from "@/application/food-candidates";
import { candidateDetailRequestSchema } from "@/domain/catalog/api-contracts";
import { getCandidate } from "@/persistence/repository";
import { requestHasAccess } from "@/security/demo-access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!requestHasAccess(request)) {
    return NextResponse.json(
      { ok: false, message: "Demo access is required." },
      { status: 401 },
    );
  }
  let candidateId: string | null = null;
  let lookupId: string | null = null;
  try {
    const input = candidateDetailRequestSchema.parse(await request.json());
    candidateId = input.candidateId;
    lookupId = (await getCandidate(candidateId)).lookupId;
    console.info("food_candidate_stage", {
      lookupId,
      candidateId,
      stage: "cached_candidate_loaded",
    });
    const candidate = await prepareFoodCandidate(input);
    console.info("food_candidate_stage", {
      lookupId,
      candidateId,
      stage: "approval_candidate_ready",
      verification:
        candidate.food.source.provider === "USDA FoodData Central"
          ? candidate.food.source.verification
          : undefined,
    });
    return NextResponse.json({ ok: true, candidate });
  } catch (error) {
    const failureCode =
      error instanceof z.ZodError
        ? "invalid_cached_candidate"
        : "candidate_validation_failed";
    console.error("food_candidate_failed", {
      lookupId,
      candidateId,
      stage: "selection",
      failureCode,
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      {
        ok: false,
        message:
          "The selected candidate could not be prepared. No catalog or profile data changed.",
        diagnostics: { stage: "selection", failureCode, lookupId },
      },
      { status: 422 },
    );
  }
}
