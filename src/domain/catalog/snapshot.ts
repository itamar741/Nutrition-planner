import { foodCatalog } from "@/data/food-catalog";
import type { CatalogFood } from "./types";

export interface CatalogSnapshot {
  foods: readonly CatalogFood[];
  byId: ReadonlyMap<string, CatalogFood>;
}

export function createCatalogSnapshot(
  foods: readonly CatalogFood[],
): CatalogSnapshot {
  return { foods, byId: new Map(foods.map((food) => [food.id, food])) };
}

export const baselineCatalogSnapshot = createCatalogSnapshot(foodCatalog);
