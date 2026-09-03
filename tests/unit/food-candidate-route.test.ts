import { afterEach, describe, expect, it, vi } from "vitest";

const replaceCandidate = vi.fn();

vi.mock("@/security/demo-access", () => ({
  requestHasAccess: () => true,
}));

vi.mock("@/ai/food-catalog", () => ({
  classifySourcedFood: () =>
    Promise.resolve({ category: "vegetable", mealClassification: "neutral" }),
}));

vi.mock("@/persistence/repository", () => ({
  getCandidate: () =>
    Promise.resolve({
      id: "11111111-1111-4111-8111-111111111111",
      lookupId: "22222222-2222-4222-8222-222222222222",
      sourceUrl: "https://fdc.nal.usda.gov/food-details/2258588/nutrients",
      sourceIdentifier: "usda:2258588",
      status: "summary",
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        fdcId: 2258588,
        title: "Peppers, bell, green, raw",
        description: "Foundation Foods · Vegetables",
        dataType: "Foundation",
        verification: "detail",
        release: "2022-10-28",
        retrievedAt: "2026-09-03T10:00:00.000Z",
        energyNutrientId: 2048,
        nutrientsPer100g: {
          energyKcal: 19.7,
          proteinG: 0.72,
          carbohydrateG: 4.78,
          fatG: 0.11,
          fiberG: 0.94,
        },
        displayPortion: { label: "100 g", grams: 100 },
        toolArguments: {
          normalizedEnglishQuery: "green bell pepper",
          preparation: "raw",
        },
      },
    }),
  getLookup: () => Promise.resolve({ profileId: "new" }),
  replaceCandidate,
}));

describe("cached USDA candidate selection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    replaceCandidate.mockReset();
  });

  it("builds the approval record without another USDA request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { POST } = await import("@/app/api/coach/catalog/candidate/route");

    const response = await POST(
      new Request("http://localhost/api/coach/catalog/candidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: "new",
          candidateId: "11111111-1111-4111-8111-111111111111",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.candidate).toMatchObject({
      sourceLabel: "USDA FoodData Central verified",
      food: {
        source: {
          fdcId: 2258588,
          energyNutrientId: 2048,
          verification: "detail",
        },
      },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(replaceCandidate).toHaveBeenCalledOnce();
  });
});
