import { classifySourcedFood, estimateFoodWithModel } from "@/ai/food-catalog";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  foodLookupToolArgumentsSchema,
  foodSearchCandidateSchema,
  type FoodApprovalCandidate,
} from "@/domain/catalog/runtime";
import type { CatalogFood } from "@/domain/catalog/types";
import type { DemoProfileId } from "@/domain/profile/types";
import {
  getCandidate,
  getLookup,
  replaceCandidate,
  saveCandidates,
} from "@/persistence/repository";
import { dynamicFoodId, validateNutritionPlausibility } from "@/sources/usda";

function energyName(id: 1008 | 2047 | 2048) {
  if (id === 2048) return "Energy (Atwater Specific Factors)" as const;
  if (id === 2047) return "Energy (Atwater General Factors)" as const;
  return "Energy" as const;
}

export async function prepareAiEstimate(input: {
  profileId: DemoProfileId;
  lookupId: string;
}): Promise<FoodApprovalCandidate> {
  const lookup = await getLookup(input.lookupId);
  if (
    lookup.profileId !== input.profileId ||
    lookup.status !== "failed" ||
    !lookup.failureCode
  ) {
    throw new Error(
      "An AI estimate is available only after a failed source lookup.",
    );
  }
  const context = z
    .object({ preparation: z.enum(["cooked", "raw", "packaged"]).optional() })
    .passthrough()
    .parse(lookup.context);
  const preparation = context.preparation ?? "cooked";
  const estimate = validateNutritionPlausibility(
    await estimateFoodWithModel({
      query: lookup.query,
      preparation,
      unavailableReason: lookup.failureCode,
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
      sourceUnavailableReason: lookup.failureCode,
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
      max: Math.max(25, Math.ceil((estimate.displayPortionGrams * 5) / 5) * 5),
      step: 5,
    },
  };
  const candidateId = randomUUID();
  const candidate: FoodApprovalCandidate = {
    id: candidateId,
    lookupId: lookup.id,
    food,
    sourceLabel: "AI estimate · USDA not verified",
  };
  await saveCandidates([
    {
      id: candidateId,
      lookupId: lookup.id,
      sourceUrl: null,
      sourceIdentifier,
      status: "detailed",
      data: candidate as unknown as Record<string, unknown>,
    },
  ]);
  return candidate;
}

export async function prepareFoodCandidate(input: {
  profileId: DemoProfileId;
  candidateId: string;
}): Promise<FoodApprovalCandidate> {
  const stored = await getCandidate(input.candidateId);
  const lookup = await getLookup(stored.lookupId);
  if (lookup.profileId !== input.profileId) {
    throw new Error("This candidate belongs to the other demo profile.");
  }
  if (stored.status === "rejected") {
    throw new Error("The selected candidate is unavailable.");
  }
  if (stored.status === "detailed" || stored.status === "approved") {
    return stored.data as unknown as FoodApprovalCandidate;
  }

  const cached = foodSearchCandidateSchema
    .extend({ toolArguments: foodLookupToolArgumentsSchema })
    .parse(stored.data);
  if (stored.sourceIdentifier !== `usda:${cached.fdcId}`) {
    throw new Error("The selected USDA candidate identity is invalid.");
  }
  const classification = await classifySourcedFood({
    title: cached.title,
    requestedPreparation: cached.toolArguments.preparation,
  });
  const estimate = validateNutritionPlausibility({
    displayName: cached.title,
    preparation: cached.toolArguments.preparation ?? "as listed by USDA",
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
  const data: FoodApprovalCandidate = {
    id: stored.id,
    lookupId: stored.lookupId,
    food,
    sourceLabel:
      cached.verification === "detail"
        ? "USDA FoodData Central verified"
        : "USDA FoodData Central search data",
  };
  await replaceCandidate({
    ...stored,
    status: "detailed",
    data: data as unknown as Record<string, unknown>,
  });
  return data;
}
