import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  EstimatedFood,
  FoodLookupToolArguments,
  FoodSearchCandidate,
} from "@/domain/catalog/runtime";

const USDA_API_ORIGIN = "https://api.nal.usda.gov";
const USDA_WEB_ORIGIN = "https://fdc.nal.usda.gov";
const ALLOWED_DATA_TYPES = ["Foundation", "SR Legacy"] as const;

export class UsdaUnavailableError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not_configured"
      | "timeout"
      | "blocked"
      | "no_results"
      | "malformed_source",
  ) {
    super(message);
    this.name = "UsdaUnavailableError";
  }
}

const searchFoodSchema = z
  .object({
    fdcId: z.number().int().positive(),
    description: z.string().trim().min(1).max(300),
    dataType: z.enum(ALLOWED_DATA_TYPES),
    scientificName: z.string().trim().max(200).optional(),
    foodCategory: z.string().trim().max(200).optional(),
  })
  .passthrough();

const searchResponseSchema = z
  .object({ foods: z.array(z.unknown()) })
  .passthrough();

const nutrientSchema = z
  .object({
    nutrient: z
      .object({
        id: z.number().int().positive(),
        name: z.string().optional(),
        unitName: z.string().optional(),
      })
      .passthrough(),
    amount: z.number().nonnegative(),
  })
  .passthrough();

const foodPortionSchema = z
  .object({
    gramWeight: z.number().positive().max(1_000),
    amount: z.number().positive().optional(),
    modifier: z.string().trim().max(100).optional(),
    portionDescription: z.string().trim().max(100).optional(),
  })
  .passthrough();

const detailResponseSchema = z
  .object({
    fdcId: z.number().int().positive(),
    description: z.string().trim().min(1).max(300),
    dataType: z.enum(ALLOWED_DATA_TYPES),
    publicationDate: z.string().trim().max(40).optional(),
    foodNutrients: z.array(z.unknown()),
    foodPortions: z.array(z.unknown()).optional(),
  })
  .passthrough();

async function usdaRequest(path: string, init?: RequestInit) {
  const apiKey = process.env.USDA_FDC_API_KEY;
  if (!apiKey) {
    throw new UsdaUnavailableError(
      "USDA FoodData Central is not configured.",
      "not_configured",
    );
  }
  const endpoint = new URL(path, USDA_API_ORIGIN);
  endpoint.searchParams.set("api_key", apiKey);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(endpoint, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });
    if ([401, 403, 429].includes(response.status)) {
      throw new UsdaUnavailableError(
        "USDA FoodData Central rejected or limited the request.",
        "blocked",
      );
    }
    if (!response.ok) {
      throw new UsdaUnavailableError(
        `USDA FoodData Central returned status ${response.status}.`,
        "malformed_source",
      );
    }
    return await response.json();
  } catch (error) {
    if (error instanceof UsdaUnavailableError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new UsdaUnavailableError(
        "USDA FoodData Central timed out.",
        "timeout",
      );
    }
    throw new UsdaUnavailableError(
      "USDA FoodData Central was unavailable.",
      "malformed_source",
    );
  } finally {
    clearTimeout(timer);
  }
}

export function usdaFoodUrl(fdcId: number) {
  return `${USDA_WEB_ORIGIN}/food-details/${fdcId}/nutrients`;
}

function candidateDescription(food: z.infer<typeof searchFoodSchema>) {
  return [
    food.dataType === "Foundation" ? "Foundation Foods" : "SR Legacy",
    food.foodCategory,
    food.scientificName,
  ]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 300);
}

export function parseUsdaSearchResponse(value: unknown): FoodSearchCandidate[] {
  const response = searchResponseSchema.safeParse(value);
  if (!response.success) {
    throw new UsdaUnavailableError(
      "USDA returned an invalid search response.",
      "malformed_source",
    );
  }
  const results: FoodSearchCandidate[] = [];
  const seen = new Set<number>();
  for (const value of response.data.foods) {
    if (results.length >= 5) break;
    const food = searchFoodSchema.safeParse(value);
    if (!food.success || seen.has(food.data.fdcId)) continue;
    seen.add(food.data.fdcId);
    results.push({
      id: randomUUID(),
      fdcId: food.data.fdcId,
      title: food.data.description,
      description: candidateDescription(food.data),
      dataType: food.data.dataType,
    });
  }
  if (results.length === 0) {
    throw new UsdaUnavailableError(
      "No matching basic USDA foods were found.",
      "no_results",
    );
  }
  return results;
}

export function buildUsdaSearchQuery(input: FoodLookupToolArguments) {
  const sourceVocabulary = input.normalizedEnglishQuery.replace(
    /\bjasmine rice\b/gi,
    "white long-grain rice",
  );
  const preparationAlreadyPresent = new RegExp(
    `\\b${input.preparation}\\b`,
    "i",
  ).test(sourceVocabulary);
  return preparationAlreadyPresent
    ? sourceVocabulary
    : `${sourceVocabulary} ${input.preparation}`;
}

export async function searchUsdaFoods(
  input: FoodLookupToolArguments,
): Promise<FoodSearchCandidate[]> {
  const result = await usdaRequest("/fdc/v1/foods/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: buildUsdaSearchQuery(input),
      dataType: [...ALLOWED_DATA_TYPES],
      pageSize: 5,
      pageNumber: 1,
    }),
  });
  return parseUsdaSearchResponse(result);
}

function nutrientAmount(
  nutrients: Array<z.infer<typeof nutrientSchema>>,
  nutrientId: number,
  expectedUnit: "KCAL" | "G",
) {
  const entry = nutrients.find(
    (candidate) =>
      candidate.nutrient.id === nutrientId &&
      candidate.nutrient.unitName?.toUpperCase() === expectedUnit,
  );
  return entry?.amount ?? null;
}

function displayPortion(value: unknown[] | undefined) {
  const portions = (value ?? [])
    .map((candidate) => foodPortionSchema.safeParse(candidate))
    .filter((candidate) => candidate.success)
    .map((candidate) => candidate.data)
    .filter(
      (candidate) =>
        Boolean(candidate.portionDescription || candidate.modifier) &&
        Number.isFinite(candidate.gramWeight),
    );
  if (portions.length !== 1) return { label: "100 g", grams: 100 };
  const portion = portions[0];
  const name = portion.portionDescription || portion.modifier || "portion";
  const amount =
    portion.amount && portion.amount !== 1 ? `${portion.amount} ` : "";
  return {
    label: `${amount}${name}`.trim().slice(0, 80),
    grams: portion.gramWeight,
  };
}

export function parseUsdaFoodDetail(value: unknown) {
  const parsed = detailResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw new UsdaUnavailableError(
      "USDA returned an invalid food record.",
      "malformed_source",
    );
  }
  const nutrients = parsed.data.foodNutrients
    .map((candidate) => nutrientSchema.safeParse(candidate))
    .filter((candidate) => candidate.success)
    .map((candidate) => candidate.data);
  const energyKcal = nutrientAmount(nutrients, 1008, "KCAL");
  const proteinG = nutrientAmount(nutrients, 1003, "G");
  const carbohydrateG = nutrientAmount(nutrients, 1005, "G");
  const fatG = nutrientAmount(nutrients, 1004, "G");
  const fiberG = nutrientAmount(nutrients, 1079, "G");
  if (
    energyKcal === null ||
    proteinG === null ||
    carbohydrateG === null ||
    fatG === null
  ) {
    throw new UsdaUnavailableError(
      "USDA did not provide all required per-100-g nutrients.",
      "malformed_source",
    );
  }
  return {
    fdcId: parsed.data.fdcId,
    title: parsed.data.description,
    dataset:
      parsed.data.dataType === "Foundation"
        ? ("Foundation Foods" as const)
        : ("SR Legacy" as const),
    release: parsed.data.publicationDate || "Current FoodData Central record",
    energyKcal,
    proteinG,
    carbohydrateG,
    fatG,
    fiberG,
    displayPortion: displayPortion(parsed.data.foodPortions),
  };
}

export async function fetchUsdaFood(fdcId: number) {
  if (!Number.isInteger(fdcId) || fdcId <= 0) {
    throw new UsdaUnavailableError(
      "The selected USDA identifier is invalid.",
      "malformed_source",
    );
  }
  return parseUsdaFoodDetail(await usdaRequest(`/fdc/v1/food/${fdcId}`));
}

export function validateNutritionPlausibility(food: EstimatedFood) {
  const macroEnergy =
    food.proteinG * 4 + food.carbohydrateG * 4 + food.fatG * 9;
  const tolerance = Math.max(35, food.energyKcal * 0.35);
  if (Math.abs(food.energyKcal - macroEnergy) > tolerance) {
    throw new UsdaUnavailableError(
      "The nutrition values were internally inconsistent.",
      "malformed_source",
    );
  }
  return food;
}

export function dynamicFoodId(sourceIdentifier: string) {
  return `runtime-${createHash("sha256").update(sourceIdentifier).digest("hex").slice(0, 16)}`;
}
