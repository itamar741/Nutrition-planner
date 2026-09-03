export type FoodCategory =
  "carbohydrate" | "protein" | "fat" | "vegetable" | "fruit";

export type MealClassification = "neutral" | "meat" | "dairy";

export interface NutrientAmounts {
  energyKcal: number;
  proteinG: number;
  carbohydrateG: number;
  fatG: number;
  fiberG: number;
}

export interface CatalogNutrientAmounts extends Omit<
  NutrientAmounts,
  "fiberG"
> {
  fiberG: number | null;
}

export interface CatalogPortion {
  label: string;
  grams: number;
}

export interface CatalogFood {
  schemaVersion: 1;
  id: string;
  displayName: string;
  preparation: string;
  brand?: string;
  category: FoodCategory;
  mealClassification: MealClassification;
  kosherCatalogApproved: boolean;
  kosherReview?: "reviewed" | "not_checked";
  source:
    | {
        provider: "USDA FoodData Central";
        fdcId: number;
        dataset: "Foundation Foods" | "SR Legacy";
        release: string;
        retrievedAt: string;
        energyNutrient:
          | "Energy"
          | "Energy (Atwater General Factors)"
          | "Energy (Atwater Specific Factors)";
        energyNutrientId?: 1008 | 2047 | 2048;
        verification?: "detail" | "search_summary";
      }
    | {
        provider: "FoodsDictionary";
        url: string;
        retrievedAt: string;
      }
    | {
        provider: "Fuder";
        url: string;
        retrievedAt: string;
        verification: "fuder_verified";
      }
    | {
        provider: "AI estimate";
        retrievedAt: string;
        verification: "ai_estimate";
        sourceUnavailableReason: string;
      };
  nutrientsPer100g: CatalogNutrientAmounts;
  displayPortion: CatalogPortion;
  practicalGrams: {
    min: number;
    max: number;
    step: number;
  };
  runtimeApproval?: {
    approvedAt: string;
    approvedByProfileId: "new" | "existing";
  };
}
