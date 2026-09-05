import { beforeEach, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  responses: [] as Array<Record<string, unknown>>,
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    responses = {
      create: vi.fn(async (request: Record<string, unknown>) => {
        provider.calls.push(request);
        const response = provider.responses.shift();
        if (!response) throw new Error("Missing mocked response.");
        return {
          async *[Symbol.asyncIterator]() {
            if (typeof response.streamedText === "string") {
              yield {
                type: "response.output_text.delta",
                delta: response.streamedText,
              };
            }
            yield { type: "response.completed", response };
          },
        };
      }),
    };
  },
}));

import { runCoachAgent } from "@/ai/coach-agent";

function proposalCall(index: number) {
  return {
    status: "completed",
    output_text: "",
    output: [
      {
        type: "function_call",
        name: "submit_draft_proposal",
        call_id: `call-${index}`,
        arguments: JSON.stringify({
          summary: "Draft candidate",
          meals: ["breakfast", "lunch", "dinner"].map((id) => ({
            id,
            items: [{ catalogFoodId: "approved-food", grams: 100 }],
          })),
        }),
      },
    ],
  };
}

describe("Arnold bounded skill loop", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_MODEL = "test-model";
    provider.calls = [];
    provider.responses = [];
  });

  it("uses chronological role/content input and disables proposal submission after three failures", async () => {
    provider.responses = [
      proposalCall(1),
      proposalCall(2),
      proposalCall(3),
      {
        status: "completed",
        output_text: "Which approved protein should I prioritize?",
        output: [],
      },
    ];
    let attempts = 0;
    const toolsSeen: string[] = [];
    const result = await runCoachAgent({
      getSystemPrompt: () => "fixed prompt",
      conversation: [
        { role: "assistant", content: "What fat percentage?" },
        { role: "user", content: "Yes, 3%." },
      ],
      getAllowedTools: () => (attempts < 3 ? ["submit_draft_proposal"] : []),
      onText: vi.fn(),
      onTool: async (call, sequence) => {
        attempts += 1;
        toolsSeen.push(`${sequence}:${call.name}`);
        return {
          accepted: false,
          attempt: attempts,
          attemptsRemaining: 3 - attempts,
        };
      },
    });

    expect(attempts).toBe(3);
    expect(toolsSeen).toEqual([
      "1:submit_draft_proposal",
      "2:submit_draft_proposal",
      "3:submit_draft_proposal",
    ]);
    expect(provider.calls[0].input).toEqual([
      { role: "assistant", content: "What fat percentage?" },
      { role: "user", content: "Yes, 3%." },
    ]);
    expect(provider.calls[0].input).not.toEqual(expect.any(String));
    expect(provider.calls[3]).toMatchObject({
      tools: [],
      tool_choice: "none",
    });
    expect(provider.calls[3]).not.toHaveProperty("parallel_tool_calls");
    expect(result.text).toBe("Which approved protein should I prioritize?");
  });

  it("does not repeat identical prose emitted before and after a skill call", async () => {
    const repeated = "Do you mean cow's milk, and what fat percentage?";
    provider.responses = [
      {
        status: "completed",
        streamedText: repeated,
        output_text: repeated,
        output: [
          {
            type: "function_call",
            name: "inspect_food_availability",
            call_id: "call-inspect",
            arguments: JSON.stringify({ query: "cow's milk" }),
          },
        ],
      },
      {
        status: "completed",
        streamedText: repeated,
        output_text: repeated,
        output: [],
      },
    ];
    const onText = vi.fn();

    const result = await runCoachAgent({
      getSystemPrompt: () => "fixed prompt",
      conversation: [{ role: "user", content: "milk" }],
      getAllowedTools: () => ["inspect_food_availability"],
      onText,
      onTool: async () => ({ approved: false, matches: [] }),
    });

    expect(result.text).toBe(repeated);
    expect(onText.mock.calls.flat().join("")).toBe(repeated);
  });

  it("tags provider failures with a safe diagnostic stage", async () => {
    provider.responses = [];

    await expect(
      runCoachAgent({
        getSystemPrompt: () => "fixed prompt",
        conversation: [{ role: "user", content: "milk" }],
        getAllowedTools: () => [],
        onText: vi.fn(),
        onTool: vi.fn(),
      }),
    ).rejects.toMatchObject({
      message: "Missing mocked response.",
      stage: "provider_request",
    });
  });
});
