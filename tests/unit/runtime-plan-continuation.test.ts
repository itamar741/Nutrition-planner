import { describe, expect, it, vi } from "vitest";
import { generateDraft, PlanModelContractError } from "@/ai/plan";
import {
  makeReadyProfile,
  makeValidMaintenanceCandidate,
} from "../fixtures/turn-2";

describe("runtime-food plan continuation", () => {
  it("uses the deterministic seed when both model responses fail before producing a candidate", async () => {
    const createResponse = vi.fn(async () => {
      throw new Error("Malformed model response");
    });

    const draft = await generateDraft(
      {
        commandId: "deterministic-seed-fallback",
        profile: makeReadyProfile(),
      },
      createResponse,
    );

    expect(createResponse).toHaveBeenCalledTimes(2);
    expect(draft.plan.validation.valid).toBe(true);
    expect(draft.summary).toBe(
      "A validated repeatable day built from your approved foods.",
    );
  });

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

  it("uses a validated fallback containing the required food after repeated omissions", async () => {
    const withoutOats = makeValidMaintenanceCandidate();
    withoutOats.meals[0].items = withoutOats.meals[0].items.filter(
      (item) => item.catalogFoodId !== "rolled-oats-dry",
    );
    const createResponse = vi.fn(async () => JSON.stringify(withoutOats));

    const draft = await generateDraft(
      {
        commandId: "required-food-omitted",
        message: "Use rolled oats.",
        requiredCatalogFoodId: "rolled-oats-dry",
        profile: makeReadyProfile(),
      },
      createResponse,
    );

    expect(createResponse).toHaveBeenCalledTimes(2);
    expect(draft.plan.validation.valid).toBe(true);
    expect(
      draft.plan.meals.some((meal) =>
        meal.items.some((item) => item.catalogFoodId === "rolled-oats-dry"),
      ),
    ).toBe(true);
  });
});
