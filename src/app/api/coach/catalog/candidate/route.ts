import { NextResponse } from "next/server";
import { z } from "zod";
import { classifySourcedFood } from "@/ai/food-catalog";
import { candidateDetailRequestSchema } from "@/domain/catalog/api-contracts";
import {
  foodLookupToolArgumentsSchema,
  foodSearchCandidateSchema,
} from "@/domain/catalog/runtime";
import type { CatalogFood } from "@/domain/catalog/types";
import {
  getCandidate,
  getLookup,
  replaceCandidate,
} from "@/persistence/repository";
import { requestHasAccess } from "@/security/demo-access";
import { dynamicFoodId, validateNutritionPlausibility } from "@/sources/usda";

export const runtime = "nodejs";

function energyName(id: 1008 | 2047 | 2048) {
  if (id === 2048) return "Energy (Atwater Specific Factors)" as const;
  if (id === 2047) return "Energy (Atwater General Factors)" as const;
  return "Energy" as const;
}

function safeErrorDetails(error: unknown) {
  if (!(error instanceof Error)) return { name: "UnknownError" };
  const external = error as Error & {
    status?: unknown;
    code?: unknown;
    type?: unknown;
  };
  return {
    name: error.name,
    status: typeof external.status === "number" ? external.status : undefined,
    code: typeof external.code === "string" ? external.code : undefined,
    type: typeof external.type === "string" ? external.type : undefined,
  };
}

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
    const stored = await getCandidate(candidateId);
    lookupId = stored.lookupId;
    const lookup = await getLookup(stored.lookupId);
    if (lookup.profileId !== input.profileId) {
      throw new Error("This candidate belongs to the other demo profile.");
    }
    if (stored.status === "rejected") {
      throw new Error("The selected candidate is unavailable.");
    }
    if (stored.status === "detailed" || stored.status === "approved") {
      return NextResponse.json({ ok: true, candidate: stored.data });
    }

    console.info("food_candidate_stage", {
      lookupId,
      candidateId,
      stage: "cached_candidate_loaded",
    });
    const cached = foodSearchCandidateSchema
      .extend({ toolArguments: foodLookupToolArgumentsSchema })
      .parse(stored.data);
    if (stored.sourceIdentifier !== `usda:${cached.fdcId}`) {
      throw new Error("The selected USDA candidate identity is invalid.");
    }

    console.info("food_candidate_stage", {
      lookupId,
      candidateId,
      stage: "classification_started",
    });
    const classification = await classifySourcedFood({
      title: cached.title,
      requestedPreparation: cached.toolArguments.preparation,
    });
    const estimate = validateNutritionPlausibility({
      displayName: cached.title,
      preparation: cached.toolArguments.preparation,
      category: classification.category,
      mealClassification: classification.mealClassification,
      displayPortionLabel: cached.displayPortion.label,
      displayPortionGrams: cached.displayPortion.grams,
      ...cached.nutrientsPer100g,
    });
    const step = 5;
    const portionGrams = estimate.displayPortionGrams;
    const food: CatalogFood = {
      schemaVersion: 1,
      id: dynamicFoodId(stored.sourceIdentifier),
      displayName: estimate.displayName,
      preparation: estimate.preparation,
      category: estimate.category,
      mealClassification: estimate.mealClassification,
      kosherCatalogApproved: false,
      kosherReview: "not_checked",
      source: {
        provider: "USDA FoodData Central",
        fdcId: cached.fdcId,
        dataset:
          cached.dataType === "Foundation" ? "Foundation Foods" : "SR Legacy",
        release: cached.release,
        retrievedAt: cached.retrievedAt,
        energyNutrient: energyName(cached.energyNutrientId),
        energyNutrientId: cached.energyNutrientId,
        verification: cached.verification,
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
        grams: portionGrams,
      },
      practicalGrams: {
        min: Math.max(step, Math.floor(portionGrams / 2 / step) * step),
        max: Math.max(step * 2, Math.ceil((portionGrams * 5) / step) * step),
        step,
      },
    };
    const data = {
      id: stored.id,
      lookupId: stored.lookupId,
      food,
      sourceLabel:
        cached.verification === "detail"
          ? ("USDA FoodData Central verified" as const)
          : ("USDA FoodData Central search data" as const),
    };
    await replaceCandidate({ ...stored, status: "detailed", data });
    console.info("food_candidate_stage", {
      lookupId,
      candidateId,
      stage: "approval_candidate_ready",
      verification: cached.verification,
    });
    return NextResponse.json({ ok: true, candidate: data });
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
      ...safeErrorDetails(error),
    });
    return NextResponse.json(
      {
        ok: false,
        message:
          "The selected candidate could not be prepared. No catalog or profile data changed.",
        diagnostics: {
          stage: "selection",
          failureCode,
          lookupId,
        },
      },
      { status: 422 },
    );
  }
}
