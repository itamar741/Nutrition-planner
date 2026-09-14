import type { CatalogFood } from "./types";

export function normalizeCatalogText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

export function normalizedCatalogIdentity(
  food: Pick<CatalogFood, "displayName" | "preparation" | "brand">,
) {
  return normalizeCatalogText(
    `${food.displayName} ${food.preparation} ${food.brand ?? ""}`,
  );
}

export function catalogFoodMatchesQuery(
  food: Pick<CatalogFood, "displayName" | "preparation" | "brand">,
  query: string,
) {
  const normalizedQuery = normalizeCatalogText(query);
  if (!normalizedQuery) return false;
  const queryTokens = normalizedQuery.split(" ");
  const searchableTokens = new Set(normalizedCatalogIdentity(food).split(" "));
  return queryTokens.every((token) => searchableTokens.has(token));
}

export function textValuesOverlap(left: string, right: string) {
  const leftTokens = new Set(
    normalizeCatalogText(left).split(" ").filter(Boolean),
  );
  const rightTokens = normalizeCatalogText(right).split(" ").filter(Boolean);
  return rightTokens.some((token) => leftTokens.has(token));
}
