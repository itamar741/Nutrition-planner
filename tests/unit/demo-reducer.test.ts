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
    const active = {
      ...createNewDemoState(),
      profile,
      targets: calculateTargets(profile),
      draft: null,
      activePlan: {
        schemaVersion: 1 as const,
        version: 1,
        activatedAt: "2026-09-10T08:00:00.000Z",
        maintenanceReferenceWeightKg: null,
        plan: draft.plan,
      },
    };
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
    const deleted = demoReducer(edited, {
      type: "delete_weight",
      commandId: "delete-fresh-weight",
      date: "2026-09-11",
    });

    expect(recorded.weightMeasurements.at(-1)?.weightKg).toBe(80.4);
    expect(edited.weightMeasurements.at(-1)?.weightKg).toBe(80.2);
    expect(deleted.weightMeasurements).toHaveLength(0);
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
      optionId: "goal-maintenance",
      label: "Maintenance",
      patch: { goal: "maintenance" },
    });
    const twice = demoReducer(once, {
      type: "apply_closed",
      commandId: "closed-1",
      optionId: "goal-maintenance",
      label: "Maintenance",
      patch: { goal: "maintenance" },
    });

    expect(twice).toBe(once);
    expect(
      twice.messages.filter((message) => message.text === "Maintenance"),
    ).toHaveLength(1);
  });
});
