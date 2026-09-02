import { describe, expect, it, vi } from "vitest";
import { generateDraft, PlanModelContractError } from "@/ai/plan";
import {
  makeReadyProfile,
  makeValidMaintenanceCandidate,
} from "../fixtures/turn-2";

describe("runtime-food plan continuation", () => {
  it("requires an approved food before asking the model to include it", async () => {
    const createResponse = vi.fn(async () =>
      JSON.stringify(makeValidMaintenanceCandidate()),
    );

    await expect(
      generateDraft(
        {
          commandId: "required-food-not-approved",
          message: "Use the new food.",
          requiredCatalogFoodId: "runtime-not-approved",
          profile: makeReadyProfile(),
        },
        createResponse,
      ),
    ).rejects.toBeInstanceOf(PlanModelContractError);
    expect(createResponse).not.toHaveBeenCalled();
  });

  it("accepts a validated Draft only when it contains the required food", async () => {
    const draft = await generateDraft(
      {
        commandId: "required-food-included",
        message: "Use white rice in the new Draft.",
        requiredCatalogFoodId: "white-rice-cooked",
        profile: makeReadyProfile(),
      },
      async () => JSON.stringify(makeValidMaintenanceCandidate()),
    );

    expect(
      draft.plan.meals.some((meal) =>
        meal.items.some((item) => item.catalogFoodId === "white-rice-cooked"),
      ),
    ).toBe(true);
  });

  it("rejects repeated model results that omit the required food", async () => {
    const withoutOats = makeValidMaintenanceCandidate();
    withoutOats.meals[0].items = withoutOats.meals[0].items.filter(
      (item) => item.catalogFoodId !== "rolled-oats-dry",
    );
    const createResponse = vi.fn(async () => JSON.stringify(withoutOats));

    await expect(
      generateDraft(
        {
          commandId: "required-food-omitted",
          message: "Use rolled oats.",
          requiredCatalogFoodId: "rolled-oats-dry",
          profile: makeReadyProfile(),
        },
        createResponse,
      ),
    ).rejects.toMatchObject({ kind: "validation" });
    expect(createResponse).toHaveBeenCalledTimes(2);
  });
});
