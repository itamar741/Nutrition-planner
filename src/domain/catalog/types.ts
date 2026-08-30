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

export interface CatalogPortion {
  label: string;
  grams: number;
}

export interface CatalogFood {
  schemaVersion: 1;
  id: string;
  displayName: string;
  preparation: string;
  category: FoodCategory;
  mealClassification: MealClassification;
  kosherCatalogApproved: true;
  source: {
    provider: "USDA FoodData Central";
    fdcId: number;
    dataset: "Foundation Foods" | "SR Legacy";
    release: string;
    retrievedAt: "2026-08-30";
    energyNutrient: "Energy" | "Energy (Atwater Specific Factors)";
  };
  nutrientsPer100g: NutrientAmounts;
  displayPortion: CatalogPortion;
  practicalGrams: {
    min: number;
    max: number;
    step: number;
  };
}
