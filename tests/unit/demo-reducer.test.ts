import { describe, expect, it } from "vitest";
import { createNewDemoState } from "@/data/demo-fixtures";
import { calculateTargets } from "@/domain/nutrition/calculations";
import { demoReducer } from "@/store/demo-reducer";
import { makeReadyProfile, makeValidDraft } from "../fixtures/turn-2";

describe("demo command reducer", () => {
  it("locks an open turn and records its user message once", () => {
    const initial = createNewDemoState();
    const started = demoReducer(initial, {
      type: "start_open",
      command: { id: "command-1", message: "I am 30." },
    });
    const duplicate = demoReducer(started, {
      type: "start_open",
      command: { id: "command-2", message: "Duplicate." },
    });

    expect(started.status).toBe("processing");
    expect(
      duplicate.messages.filter((message) => message.role === "user"),
    ).toHaveLength(1);
  });

  it("keeps a failed message and retries without duplicating it", () => {
    const initial = createNewDemoState();
    const started = demoReducer(initial, {
      type: "start_open",
      command: { id: "command-1", message: "I am 30." },
    });
    const failed = demoReducer(started, {
      type: "fail_open",
      commandId: "command-1",
      message: "Try again.",
    });
    const retried = demoReducer(failed, {
      type: "retry_open",
      commandId: "command-1",
    });

    expect(retried.status).toBe("processing");
    expect(
      retried.messages.filter((message) => message.role === "user"),
    ).toHaveLength(1);
  });

  it("records the onboarding weight as the immutable Maintenance anchor", () => {
    const initial = createNewDemoState();
    const started = demoReducer(initial, {
      type: "start_open",
      command: { id: "onboarding-weight", message: "I weigh 74 kg" },
    });
    const profile = { ...initial.profile, currentWeightKg: 74 };
    const completed = demoReducer(started, {
      type: "complete_open",
      commandId: "onboarding-weight",
      profile,
      activeTurn: initial.activeTurn,
      acknowledgement: "Noted.",
      targets: calculateTargets(profile),
    });

    expect(completed.weightMeasurements).toMatchObject([{ weightKg: 74 }]);
  });

  it("records and corrects weight from the Fresh active dashboard", () => {
    const profile = makeReadyProfile();
    const draft = makeValidDraft("fresh-weight-dashboard");
    const active = demoReducer(
      {
        ...createNewDemoState(),
        profile,
        targets: calculateTargets(profile),
        draft,
      },
      {
        type: "activate_draft",
        commandId: "activate-fresh-weight",
        proposalId: draft.id,
        activatedAt: "2026-09-10T08:00:00.000Z",
      },
    );
    const recorded = demoReducer(active, {
      type: "record_weight",
      commandId: "record-fresh-weight",
      measurement: {
        id: "fresh-weight-1",
        date: "2026-09-11",
        weightKg: 80.4,
        commandId: "record-fresh-weight",
      },
    });
    const edited = demoReducer(recorded, {
      type: "edit_weight",
      commandId: "edit-fresh-weight",
      date: "2026-09-11",
      weightKg: 80.2,
    });

    expect(recorded.weightMeasurements.at(-1)?.weightKg).toBe(80.4);
    expect(edited.weightMeasurements.at(-1)?.weightKg).toBe(80.2);
  });

  it("applies the same closed command at most once", () => {
    const initial = {
      ...createNewDemoState(),
      profile: {
        ...createNewDemoState().profile,
        age: 30,
        equationSex: "male" as const,
        heightCm: 180,
        currentWeightKg: 80,
      },
      activeTurn: {
        type: "closed_question" as const,
        id: "choose-goal",
        field: "goal" as const,
        prompt: "Choose",
        options: [],
      },
    };
    const once = demoReducer(initial, {
      type: "apply_closed",
      commandId: "closed-1",
      label: "Maintenance",
      patch: { goal: "maintenance" },
    });
    const twice = demoReducer(once, {
      type: "apply_closed",
      commandId: "closed-1",
      label: "Maintenance",
      patch: { goal: "maintenance" },
    });

    expect(twice).toBe(once);
    expect(
      twice.messages.filter((message) => message.text === "Maintenance"),
    ).toHaveLength(1);
  });

  it("keeps a generated Draft separate from Active state", () => {
    const profile = makeReadyProfile();
    const initial = {
      ...createNewDemoState(),
      profile,
      targets: calculateTargets(profile),
      activeTurn: {
        type: "message" as const,
        id: "profile-ready",
        prompt: "Ready",
      },
    };
    const started = demoReducer(initial, {
      type: "start_plan",
      command: { id: "command-draft", message: "Generate my Draft" },
      operation: "draft",
    });
    const completed = demoReducer(started, {
      type: "complete_draft",
      commandId: "command-draft",
      draft: makeValidDraft("command-draft"),
    });

    expect(completed.draft?.plan.validation.valid).toBe(true);
    expect(completed.activePlan).toBeNull();
  });

  it("activates the exact current Draft once and ignores duplicate approval", () => {
    const profile = makeReadyProfile();
    const draft = makeValidDraft("command-draft");
    const initial = {
      ...createNewDemoState(),
      profile,
      targets: calculateTargets(profile),
      draft,
      activeTurn: {
        type: "message" as const,
        id: "profile-ready",
        prompt: "Ready",
      },
    };
    const once = demoReducer(initial, {
      type: "activate_draft",
      commandId: "approve-1",
      proposalId: draft.id,
      activatedAt: "2026-08-30T10:00:00.000Z",
    });
    const twice = demoReducer(once, {
      type: "activate_draft",
      commandId: "approve-1",
      proposalId: draft.id,
      activatedAt: "2026-08-30T10:00:00.000Z",
    });

    expect(once.draft).toBeNull();
    expect(once.activePlan?.version).toBe(1);
    expect(once.activePlan?.plan.id).toBe(draft.plan.id);
    expect(twice).toBe(once);
  });

  it("rejects a stale proposal and preserves the current Active Plan", () => {
    const profile = makeReadyProfile();
    const activeDraft = makeValidDraft("active-source");
    const activeState = demoReducer(
      {
        ...createNewDemoState(),
        profile,
        targets: calculateTargets(profile),
        draft: activeDraft,
        activeTurn: {
          type: "message" as const,
          id: "profile-ready",
          prompt: "Ready",
        },
      },
      {
        type: "activate_draft",
        commandId: "approve-existing",
        proposalId: activeDraft.id,
        activatedAt: "2026-08-30T10:00:00.000Z",
      },
    );
    const staleDraft = {
      ...makeValidDraft("stale"),
      basePlanVersion: null,
    };
    const withStaleDraft = { ...activeState, draft: staleDraft };
    const result = demoReducer(withStaleDraft, {
      type: "activate_draft",
      commandId: "approve-stale",
      proposalId: staleDraft.id,
      activatedAt: "2026-08-30T11:00:00.000Z",
    });

    expect(result).toBe(withStaleDraft);
    expect(result.activePlan?.version).toBe(1);
  });
});
