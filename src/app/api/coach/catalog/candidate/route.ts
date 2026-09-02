import { NextResponse } from "next/server";
import { z } from "zod";
import { classifySourcedFood } from "@/ai/food-catalog";
import { candidateDetailRequestSchema } from "@/domain/catalog/api-contracts";
import { foodLookupToolArgumentsSchema } from "@/domain/catalog/runtime";
import type { CatalogFood } from "@/domain/catalog/types";
import {
  getCandidate,
  getLookup,
  replaceCandidate,
  updateLookup,
} from "@/persistence/repository";
import { requestHasAccess } from "@/security/demo-access";
import {
  dynamicFoodId,
  fetchUsdaFood,
  UsdaUnavailableError,
  validateNutritionPlausibility,
} from "@/sources/usda";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!requestHasAccess(request)) {
    return NextResponse.json(
      { ok: false, message: "Demo access is required." },
      { status: 401 },
    );
  }
  let requestedCandidateId: string | null = null;
  try {
    const input = candidateDetailRequestSchema.parse(await request.json());
    requestedCandidateId = input.candidateId;
    const stored = await getCandidate(input.candidateId);
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
    const summary = z
      .object({
        title: z.string().min(1),
        fdcId: z.number().int().positive(),
        dataType: z.enum(["Foundation", "SR Legacy"]),
        toolArguments: foodLookupToolArgumentsSchema,
      })
      .passthrough()
      .parse(stored.data);
    if (stored.sourceIdentifier !== `usda:${summary.fdcId}`) {
      throw new Error("The selected USDA candidate identity is invalid.");
    }
    const sourced = await fetchUsdaFood(summary.fdcId);
    if (sourced.fdcId !== summary.fdcId) {
      throw new Error("USDA returned a different food record.");
    }
    const expectedDataset =
      summary.dataType === "Foundation" ? "Foundation Foods" : "SR Legacy";
    if (sourced.dataset !== expectedDataset) {
      throw new Error("USDA returned a different dataset record.");
    }
    const classification = await classifySourcedFood({
      title: sourced.title || summary.title,
      requestedPreparation: summary.toolArguments.preparation,
    });
    const estimate = validateNutritionPlausibility({
      displayName: sourced.title,
      preparation: summary.toolArguments.preparation,
      category: classification.category,
      mealClassification: classification.mealClassification,
      displayPortionLabel: sourced.displayPortion.label,
      displayPortionGrams: sourced.displayPortion.grams,
      energyKcal: sourced.energyKcal,
      proteinG: sourced.proteinG,
      carbohydrateG: sourced.carbohydrateG,
      fatG: sourced.fatG,
      fiberG: sourced.fiberG,
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
        fdcId: sourced.fdcId,
        dataset: sourced.dataset,
        release: sourced.release,
        retrievedAt: new Date().toISOString(),
        energyNutrient: "Energy",
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
      sourceLabel: "USDA FoodData Central verified" as const,
    };
    await replaceCandidate({ ...stored, status: "detailed", data });
    return NextResponse.json({ ok: true, candidate: data });
  } catch (error) {
    if (error instanceof UsdaUnavailableError && requestedCandidateId) {
      const candidate = await getCandidate(requestedCandidateId).catch(
        () => null,
      );
      if (candidate) {
        await updateLookup(candidate.lookupId, {
          status: "failed",
          failureCode: error.code,
        });
        return NextResponse.json(
          {
            ok: false,
            code: "source_unavailable",
            message:
              "USDA FoodData Central could not return a safe nutrition record. Your catalog and profile were not changed.",
            lookupId: candidate.lookupId,
            offerAiEstimate: true,
          },
          { status: 503 },
        );
      }
    }
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "The selected source result could not be validated.",
      },
      { status: 422 },
    );
  }
}
