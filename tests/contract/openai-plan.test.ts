import { describe, expect, it, vi } from "vitest";
import {
  generateDraft,
  generateDraftModification,
  generateAdjustmentDraft,
} from "@/ai/plan";
import {
  makeReadyProfile,
  makeValidDraft,
  makeValidMaintenanceCandidate,
} from "../fixtures/turn-2";
import {
  createExistingActivePlan,
  existingReadyProfile,
} from "@/data/demo-fixtures";

describe("strict Draft model boundary", () => {
  it("accepts one valid structured candidate and recalculates it", async () => {
    const creator = vi
      .fn()
      .mockResolvedValue(JSON.stringify(makeValidMaintenanceCandidate()));
    const draft = await generateDraft(
      { commandId: "command-valid-1", profile: makeReadyProfile() },
      creator,
    );

    expect(draft.id).toBe("draft-command-valid-1");
    expect(draft.plan.validation.valid).toBe(true);
    expect(draft.plan.validation.totals.energyKcal).toBeGreaterThan(2_800);
    expect(creator).toHaveBeenCalledTimes(1);
    expect(creator.mock.calls[0][0].instructions).toContain("Do not browse");
    expect(creator.mock.calls[0][0].instructions).toContain(
      "Approved foods may be reused",
    );
    expect(creator.mock.calls[0][0].instructions).toContain(
      "Return alternatives: []",
    );
  });

  it("repairs an invented catalog ID once before accepting", async () => {
    const invalid = makeValidMaintenanceCandidate();
    invalid.meals[0].items[0].catalogFoodId = "invented-food";
    const creator = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify(invalid))
      .mockResolvedValueOnce(JSON.stringify(makeValidMaintenanceCandidate()));

    const draft = await generateDraft(
      { commandId: "command-repair-1", profile: makeReadyProfile() },
      creator,
    );
    expect(draft.plan.validation.valid).toBe(true);
    expect(creator).toHaveBeenCalledTimes(2);
    expect(creator.mock.calls[1][0].instructions).toContain(
      "Unknown catalog food",
    );
  });

  it("passes post-decline feedback into a new Draft request", async () => {
    const creator = vi
      .fn()
      .mockResolvedValue(JSON.stringify(makeValidMaintenanceCandidate()));
    await generateDraft(
      {
        commandId: "command-feedback-1",
        message: "I would like a larger lunch portion.",
        profile: makeReadyProfile(),
      },
      creator,
    );

    expect(JSON.parse(creator.mock.calls[0][0].userInput).feedback).toBe(
      "I would like a larger lunch portion.",
    );
    expect(creator.mock.calls[0][0].instructions).toContain(
      "Use this user feedback as a preference",
    );
    expect(creator.mock.calls[0][0].instructions).toContain(
      "Qualitative feedback must never change the daily target",
    );
  });

  it("uses a deterministic validated Draft after two malformed model responses", async () => {
    const creator = vi.fn().mockResolvedValue("not json");
    const draft = await generateDraft(
      { commandId: "command-invalid-1", profile: makeReadyProfile() },
      creator,
    );

    expect(creator).toHaveBeenCalledTimes(2);
    expect(draft.plan.validation.valid).toBe(true);
    expect(draft.summary).toBe(
      "A validated repeatable day built from your approved foods.",
    );
  });

  it("returns unsupported without changing the current Draft", async () => {
    const current = makeValidDraft();
    const creator = vi.fn().mockResolvedValue(
      JSON.stringify({
        type: "unsupported",
        explanation: "Weekly variation is outside this demo.",
      }),
    );
    const result = await generateDraftModification(
      {
        commandId: "command-modify-1",
        message: "Make a different plan for every weekday",
        profile: makeReadyProfile(),
        draft: current,
      },
      creator,
    );
    expect(result).toEqual({
      outcome: "unsupported",
      message: "Weekly variation is outside this demo.",
    });
    expect(current.plan.version).toBe(1);
  });

  it("accepts only a whole-plan-valid supported modification", async () => {
    const current = makeValidDraft();
    const creator = vi.fn().mockResolvedValue(
      JSON.stringify({
        type: "change_portion",
        mealId: "lunch",
        itemId: "lunch-item-2",
        grams: 355,
        explanation: "Raised the lunch rice portion slightly.",
      }),
    );
    const result = await generateDraftModification(
      {
        commandId: "command-modify-2",
        message: "Make the lunch rice a little larger",
        profile: makeReadyProfile(),
        draft: current,
      },
      creator,
    );
    expect(result.outcome).toBe("modified");
    if (result.outcome !== "modified") throw new Error("Expected modification");
    expect(result.draft.plan.version).toBe(2);
    expect(result.draft.plan.validation.valid).toBe(true);
    expect(current.plan.version).toBe(1);
  });

  it("falls back to a deterministic, validated adjustment after invalid model output", async () => {
    const activePlan = createExistingActivePlan();
    const creator = vi.fn().mockResolvedValue("not json");
    const draft = await generateAdjustmentDraft(
      {
        commandId: "command-adjustment-1",
        profile: existingReadyProfile,
        activePlan,
        direction: "decrease",
        adjustmentKcal: 150,
      },
      creator,
    );
    expect(creator).toHaveBeenCalledTimes(2);
    expect(draft.basePlanVersion).toBe(activePlan.version);
    expect(draft.plan.validation.valid).toBe(true);
    expect(draft.plan.targetSnapshot.energyKcal).toBe(2_800);
  });

  it("B-01 passes decline feedback into a bounded adjustment request", async () => {
    const activePlan = createExistingActivePlan();
    const creator = vi.fn().mockResolvedValue("not json");
    await generateAdjustmentDraft(
      {
        commandId: "command-adjustment-feedback",
        feedback: "I prefer more food in the evening.",
        profile: existingReadyProfile,
        activePlan,
        direction: "decrease",
        adjustmentKcal: 150,
      },
      creator,
    );
    expect(creator).toHaveBeenCalledWith(
      expect.objectContaining({
        userInput: expect.stringContaining(
          '"userFeedback":"I prefer more food in the evening."',
        ),
      }),
    );
  });
});
