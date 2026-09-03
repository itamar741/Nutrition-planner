import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { estimateFoodWithModel } from "@/ai/food-catalog";
import { estimateRequestSchema } from "@/domain/catalog/api-contracts";
import { foodLookupToolArgumentsSchema } from "@/domain/catalog/runtime";
import type { CatalogFood } from "@/domain/catalog/types";
import { getLookup, saveCandidates } from "@/persistence/repository";
import { requestHasAccess } from "@/security/demo-access";
import { dynamicFoodId, validateNutritionPlausibility } from "@/sources/usda";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!requestHasAccess(request)) {
    return NextResponse.json(
      { ok: false, message: "Demo access is required." },
      { status: 401 },
    );
  }
  try {
    const input = estimateRequestSchema.parse(await request.json());
    const lookup = await getLookup(input.lookupId);
    if (lookup.profileId !== input.profileId) {
      throw new Error("This lookup belongs to the other demo profile.");
    }
    const sourceFailureCodes = new Set([
      "not_configured",
      "timeout",
      "blocked",
      "no_results",
      "malformed_source",
    ]);
    if (
      lookup.status !== "failed" ||
      !lookup.failureCode ||
      !sourceFailureCodes.has(lookup.failureCode)
    ) {
      throw new Error(
        "An AI estimate is offered only after a failed source lookup.",
      );
    }
    const parsedContext = z
      .object({ toolArguments: foodLookupToolArgumentsSchema.optional() })
      .passthrough()
      .parse(lookup.context);
    const preparation = parsedContext.toolArguments?.preparation ?? "cooked";
    const estimate = validateNutritionPlausibility(
      await estimateFoodWithModel({
        query: lookup.query,
        preparation,
        unavailableReason: lookup.failureCode ?? "source_unavailable",
      }),
    );
    const sourceIdentifier = `ai:${lookup.query.toLocaleLowerCase("en-US")}:${preparation}`;
    const food: CatalogFood = {
      schemaVersion: 1,
      id: dynamicFoodId(sourceIdentifier),
      displayName: estimate.displayName,
      preparation: estimate.preparation,
      category: estimate.category,
      mealClassification: estimate.mealClassification,
      kosherCatalogApproved: false,
      kosherReview: "not_checked",
      source: {
        provider: "AI estimate",
        retrievedAt: new Date().toISOString(),
        verification: "ai_estimate",
        sourceUnavailableReason: lookup.failureCode ?? "source_unavailable",
      },
      nutrientsPer100g: {
        energyKcal: estimate.energyKcal,
        proteinG: estimate.proteinG,
        carbohydrateG: estimate.carbohydrateG,
        fatG: estimate.fatG,
        fiberG: estimate.fiberG,
      },
      displayPortion: {
        label: estimate.displayPortionLabel,
        grams: estimate.displayPortionGrams,
      },
      practicalGrams: {
        min: Math.max(5, Math.floor(estimate.displayPortionGrams / 10) * 5),
        max: Math.max(
          25,
          Math.ceil((estimate.displayPortionGrams * 5) / 5) * 5,
        ),
        step: 5,
      },
    };
    const candidateId = randomUUID();
    const data = {
      id: candidateId,
      lookupId: lookup.id,
      food,
      sourceLabel: "AI estimate · USDA not verified" as const,
    };
    await saveCandidates([
      {
        id: candidateId,
        lookupId: lookup.id,
        sourceUrl: null,
        sourceIdentifier,
        status: "detailed",
        data,
      },
    ]);
    return NextResponse.json({ ok: true, candidate: data });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof z.ZodError
            ? "The estimate request is invalid."
            : error instanceof Error
              ? error.message
              : "The AI estimate could not be created.",
      },
      { status: 422 },
    );
  }
}
