import { afterEach, describe, expect, it, vi } from "vitest";
import { coachMessageRequestSchema } from "@/domain/agent/types";
import { createNewDemoState } from "@/data/demo-fixtures";
import { sendCoachMessage } from "@/store/agent-client";

afterEach(() => vi.unstubAllGlobals());

describe("unified coach contract", () => {
  it("accepts bounded text and visible interaction actions", () => {
    expect(
      coachMessageRequestSchema.parse({
        profileId: "new",
        expectedVersion: 1,
        commandId: "agent-command-123",
        input: { type: "text", text: "cottage" },
      }).input.type,
    ).toBe("text");
    expect(
      coachMessageRequestSchema.parse({
        profileId: "existing",
        expectedVersion: 3,
        commandId: "agent-command-456",
        input: {
          type: "interaction",
          interactionId: "proposal-1",
          action: "reject_adjustment",
        },
      }).input.type,
    ).toBe("interaction");
  });

  it("rejects arbitrary tools, URLs, and authoritative browser state", () => {
    expect(
      coachMessageRequestSchema.safeParse({
        profileId: "new",
        expectedVersion: 1,
        commandId: "agent-command-789",
        input: {
          type: "interaction",
          interactionId: "candidate-1",
          action: "execute_sql",
          url: "https://attacker.example",
        },
        profile: { goal: "muscle_gain" },
      }).success,
    ).toBe(false);
  });

  it("consumes status, text, and final state from the server stream", async () => {
    const state = createNewDemoState();
    const encoder = new TextEncoder();
    const events = [
      { type: "status", value: "thinking" },
      { type: "text_delta", value: "Hello" },
      { type: "state", profile: { profileId: "new", version: 2, state } },
      { type: "done", turnId: "agent-command-stream" },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  encoder.encode(
                    events
                      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
                      .join(""),
                  ),
                );
                controller.close();
              },
            }),
            { headers: { "Content-Type": "text/event-stream" } },
          ),
      ),
    );
    const statuses: string[] = [];
    let text = "";
    const result = await sendCoachMessage({
      request: {
        profileId: "new",
        expectedVersion: 1,
        commandId: "agent-command-stream",
        input: { type: "text", text: "hello" },
      },
      onStatus: (status) => statuses.push(status),
      onText: (delta) => {
        text += delta;
      },
    });
    expect(statuses).toEqual(["thinking"]);
    expect(text).toBe("Hello");
    expect(result.profile.version).toBe(2);
  });
});
