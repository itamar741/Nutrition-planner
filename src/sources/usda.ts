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
const ENERGY_NUTRIENT_IDS = [2048, 2047, 1008] as const;

export type UsdaLookupStage =
  | "search_started"
  | "search_completed"
  | "bulk_started"
  | "bulk_completed"
  | "candidate_filtered"
  | "candidate_cached";

export class UsdaUnavailableError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not_configured"
      | "timeout"
      | "blocked"
      | "no_results"
      | "malformed_source",
    public readonly stage:
      "search" | "bulk" | "normalization" = "normalization",
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
    publishedDate: z.string().trim().max(40).optional(),
    foodNutrients: z.array(z.unknown()).optional(),
  })
  .passthrough();

const searchResponseSchema = z
  .object({ foods: z.array(z.unknown()) })
  .passthrough();

const detailNutrientSchema = z
  .object({
    nutrient: z
      .object({
        id: z.number().int().positive(),
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

type SearchFood = z.infer<typeof searchFoodSchema>;

export type UsdaSearchSummary = {
  fdcId: number;
  title: string;
  description: string;
  dataType: "Foundation" | "SR Legacy";
};

const DISALLOWED_CATEGORY_PATTERN =
  /restaurant|fast foods?|meals?, entrees?|mixed dishes?|soups?, sauces?|prepared meals?/i;
const DISALLOWED_DESCRIPTION_PATTERN =
  /\brestaurant\b|\bfast food\b|\bprepared from recipe\b|\bmeal(?:s)?\b|\bentree(?:s)?\b|\bdinner(?:s)?\b/i;

function isAllowedBasicFood(food: SearchFood) {
  return !(
    DISALLOWED_CATEGORY_PATTERN.test(food.foodCategory ?? "") ||
    DISALLOWED_DESCRIPTION_PATTERN.test(food.description)
  );
}

async function usdaRequest(
  path: string,
  init: RequestInit | undefined,
  stage: "search" | "bulk",
) {
  const apiKey = process.env.USDA_FDC_API_KEY;
  if (!apiKey) {
    throw new UsdaUnavailableError(
      "USDA FoodData Central is not configured.",
      "not_configured",
      stage,
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
        stage,
      );
    }
    if (!response.ok) {
      throw new UsdaUnavailableError(
        `USDA FoodData Central returned status ${response.status}.`,
        "malformed_source",
        stage,
      );
    }
    return await response.json();
  } catch (error) {
    if (error instanceof UsdaUnavailableError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new UsdaUnavailableError(
        "USDA FoodData Central timed out.",
        "timeout",
        stage,
      );
    }
    throw new UsdaUnavailableError(
      "USDA FoodData Central was unavailable.",
      "malformed_source",
      stage,
    );
  } finally {
    clearTimeout(timer);
  }
}

export function usdaFoodUrl(fdcId: number) {
  return `${USDA_WEB_ORIGIN}/food-details/${fdcId}/nutrients`;
}

function candidateDescription(food: SearchFood) {
  return [
    food.dataType === "Foundation" ? "Foundation Foods" : "SR Legacy",
    food.foodCategory,
    food.scientificName,
  ]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 300);
}

export function parseUsdaSearchResponse(value: unknown): SearchFood[] {
  const response = searchResponseSchema.safeParse(value);
  if (!response.success) {
    throw new UsdaUnavailableError(
      "USDA returned an invalid search response.",
      "malformed_source",
      "search",
    );
  }
  const results: SearchFood[] = [];
  const seen = new Set<number>();
  for (const value of response.data.foods) {
    if (results.length >= 50) break;
    const food = searchFoodSchema.safeParse(value);
    if (
      !food.success ||
      seen.has(food.data.fdcId) ||
      !isAllowedBasicFood(food.data)
    )
      continue;
    seen.add(food.data.fdcId);
    results.push(food.data);
  }
  if (results.length === 0) {
    throw new UsdaUnavailableError(
      "No matching basic USDA foods were found.",
      "no_results",
      "search",
    );
  }
  return results;
}

export function buildUsdaSearchQuery(input: FoodLookupToolArguments) {
  const sourceVocabulary = input.normalizedEnglishQuery.replace(
    /\bjasmine rice\b/gi,
    "white long-grain rice",
  );
  if (!input.preparation) return sourceVocabulary;
  const preparationAlreadyPresent = new RegExp(
    `\\b${input.preparation}\\b`,
    "i",
  ).test(sourceVocabulary);
  return preparationAlreadyPresent
    ? sourceVocabulary
    : `${sourceVocabulary} ${input.preparation}`;
}

function toSearchSummary(food: SearchFood): UsdaSearchSummary {
  return {
    fdcId: food.fdcId,
    title: food.description.slice(0, 200),
    description: candidateDescription(food),
    dataType: food.dataType,
  };
}

function nutrientFromDetail(
  values: Array<z.infer<typeof detailNutrientSchema>>,
  ids: readonly number[],
  expectedUnit: "KCAL" | "G",
) {
  const entry = ids
    .map((id) =>
      values.find(
        (candidate) =>
          candidate.nutrient.id === id &&
          candidate.nutrient.unitName?.toUpperCase() === expectedUnit,
      ),
    )
    .find(Boolean);
  return entry ? { id: entry.nutrient.id, amount: entry.amount } : null;
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

function plausibleMacros(input: {
  energyKcal: number;
  proteinG: number;
  carbohydrateG: number;
  fatG: number;
}) {
  const macroEnergy =
    input.proteinG * 4 + input.carbohydrateG * 4 + input.fatG * 9;
  const tolerance = Math.max(35, input.energyKcal * 0.35);
  return Math.abs(input.energyKcal - macroEnergy) <= tolerance;
}

function normalizedRecord(input: {
  fdcId: number;
  title: string;
  dataType: (typeof ALLOWED_DATA_TYPES)[number];
  release?: string;
  nutrients: {
    energy: { id: number; amount: number } | null;
    protein: { amount: number } | null;
    carbohydrate: { amount: number } | null;
    fat: { amount: number } | null;
    fiber: { amount: number } | null;
  };
  portion: { label: string; grams: number };
  verification: "detail" | "search_summary";
}) {
  const { energy, protein, carbohydrate, fat, fiber } = input.nutrients;
  if (!energy || !protein || !carbohydrate || !fat) return null;
  const macros = {
    energyKcal: energy.amount,
    proteinG: protein.amount,
    carbohydrateG: carbohydrate.amount,
    fatG: fat.amount,
    fiberG: fiber?.amount ?? null,
  };
  if (!plausibleMacros(macros)) return null;
  return {
    fdcId: input.fdcId,
    title: input.title,
    dataset:
      input.dataType === "Foundation"
        ? ("Foundation Foods" as const)
        : ("SR Legacy" as const),
    release: input.release || "Current FoodData Central record",
    ...macros,
    energyNutrientId: energy.id as 1008 | 2047 | 2048,
    displayPortion: input.portion,
    verification: input.verification,
  };
}

export function parseUsdaFoodDetail(value: unknown) {
  const parsed = detailResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw new UsdaUnavailableError(
      "USDA returned an invalid food record.",
      "malformed_source",
      "normalization",
    );
  }
  const nutrients = parsed.data.foodNutrients
    .map((candidate) => detailNutrientSchema.safeParse(candidate))
    .filter((candidate) => candidate.success)
    .map((candidate) => candidate.data);
  const record = normalizedRecord({
    fdcId: parsed.data.fdcId,
    title: parsed.data.description,
    dataType: parsed.data.dataType,
    release: parsed.data.publicationDate,
    nutrients: {
      energy: nutrientFromDetail(nutrients, ENERGY_NUTRIENT_IDS, "KCAL"),
      protein: nutrientFromDetail(nutrients, [1003], "G"),
      fat: nutrientFromDetail(nutrients, [1004], "G"),
      carbohydrate: nutrientFromDetail(nutrients, [1005], "G"),
      fiber: nutrientFromDetail(nutrients, [1079], "G"),
    },
    portion: displayPortion(parsed.data.foodPortions),
    verification: "detail",
  });
  if (!record) {
    throw new UsdaUnavailableError(
      "USDA did not provide plausible values for all required per-100-g nutrients.",
      "malformed_source",
      "normalization",
    );
  }
  return record;
}

export async function searchUsdaFoodSummaries(
  input: FoodLookupToolArguments,
  options?: {
    onStage?: (
      stage: UsdaLookupStage,
      details?: Record<string, unknown>,
    ) => void;
  },
): Promise<UsdaSearchSummary[]> {
  options?.onStage?.("search_started");
  const searchJson = await usdaRequest(
    "/fdc/v1/foods/search",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: buildUsdaSearchQuery(input),
        dataType: [...ALLOWED_DATA_TYPES],
        pageSize: 50,
        pageNumber: 1,
      }),
    },
    "search",
  );
  const summaries = parseUsdaSearchResponse(searchJson).map(toSearchSummary);
  options?.onStage?.("search_completed", { count: summaries.length });

  return summaries;
}

export async function resolveUsdaFoodCandidates(
  summaries: UsdaSearchSummary[],
  options?: {
    onStage?: (
      stage: UsdaLookupStage,
      details?: Record<string, unknown>,
    ) => void;
  },
): Promise<FoodSearchCandidate[]> {
  if (summaries.length === 0 || summaries.length > 5) {
    throw new UsdaUnavailableError(
      "The selected USDA candidates were invalid.",
      "malformed_source",
      "normalization",
    );
  }

  options?.onStage?.("bulk_started", { count: summaries.length });
  let details: unknown[];
  try {
    const bulkJson = await usdaRequest(
      "/fdc/v1/foods",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fdcIds: summaries.map((food) => food.fdcId) }),
      },
      "bulk",
    );
    if (!Array.isArray(bulkJson)) {
      throw new UsdaUnavailableError(
        "USDA returned an invalid bulk response.",
        "malformed_source",
        "bulk",
      );
    }
    details = bulkJson;
    options?.onStage?.("bulk_completed", { count: details.length });
  } catch (error) {
    options?.onStage?.("bulk_completed", {
      count: 0,
      fallback: "none",
      code: error instanceof UsdaUnavailableError ? error.code : "unknown",
    });
    throw error;
  }

  const detailById = new Map<number, ReturnType<typeof parseUsdaFoodDetail>>();
  for (const value of details) {
    try {
      const detail = parseUsdaFoodDetail(value);
      detailById.set(detail.fdcId, detail);
    } catch {
      // One malformed record must not discard the other safe candidates.
    }
  }

  const retrievedAt = new Date().toISOString();
  const candidates: FoodSearchCandidate[] = [];
  for (const summary of summaries) {
    const record = detailById.get(summary.fdcId);
    if (!record) {
      options?.onStage?.("candidate_filtered", {
        fdcId: summary.fdcId,
        reason: "missing_or_implausible_macros",
      });
      continue;
    }
    const candidate: FoodSearchCandidate = {
      id: randomUUID(),
      fdcId: summary.fdcId,
      title: record.title,
      description: summary.description,
      dataType: summary.dataType,
      verification: record.verification,
      release: record.release,
      retrievedAt,
      energyNutrientId: record.energyNutrientId,
      nutrientsPer100g: {
        energyKcal: record.energyKcal,
        proteinG: record.proteinG,
        carbohydrateG: record.carbohydrateG,
        fatG: record.fatG,
        fiberG: record.fiberG,
      },
      displayPortion: record.displayPortion,
    };
    candidates.push(candidate);
    options?.onStage?.("candidate_cached", {
      fdcId: candidate.fdcId,
      verification: candidate.verification,
    });
    if (candidates.length >= 5) break;
  }
  if (candidates.length === 0) {
    throw new UsdaUnavailableError(
      "No matching USDA food contained all required nutrition values.",
      "no_results",
      "normalization",
    );
  }
  return candidates;
}

export async function searchUsdaFoods(
  input: FoodLookupToolArguments,
  options?: {
    onStage?: (
      stage: UsdaLookupStage,
      details?: Record<string, unknown>,
    ) => void;
  },
): Promise<FoodSearchCandidate[]> {
  const summaries = await searchUsdaFoodSummaries(input, options);
  return resolveUsdaFoodCandidates(summaries.slice(0, 5), options);
}

export function validateNutritionPlausibility(food: EstimatedFood) {
  if (!plausibleMacros(food)) {
    throw new UsdaUnavailableError(
      "The nutrition values were internally inconsistent.",
      "malformed_source",
      "normalization",
    );
  }
  return food;
}

export function dynamicFoodId(sourceIdentifier: string) {
  return `runtime-${createHash("sha256").update(sourceIdentifier).digest("hex").slice(0, 16)}`;
}
