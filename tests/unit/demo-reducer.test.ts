import { describe, expect, it } from "vitest";
import { createNewDemoState } from "@/data/demo-fixtures";
import { demoReducer } from "@/store/demo-reducer";

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
});
