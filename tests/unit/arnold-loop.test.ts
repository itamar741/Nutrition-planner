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
          changeContext: {
            kind: "new_request",
            evidence: "Generate my Draft Meal Plan",
            scope: "unspecified",
            requiredCatalogFoodIds: [],
            excludedCatalogFoodIds: [],
          },
        }),
      },
    ],
  };
}

function foodSearchCall() {
  return {
    status: "completed",
    output_text: "",
    output: [
      {
        type: "function_call",
        name: "search_foods",
        call_id: "call-search",
        arguments: JSON.stringify({
          requestedFoodPhrase: "milk",
          normalizedEnglishQuery: "milk",
          purpose: "catalog_only",
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
        { role: "assistant", content: "Which basic food should I add?" },
        { role: "user", content: "Milk." },
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
      { role: "assistant", content: "Which basic food should I add?" },
      { role: "user", content: "Milk." },
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
    const repeated = "I found the currently approved foods.";
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

  it("discards prose from a round that ends in a skill call", async () => {
    provider.responses = [
      {
        status: "completed",
        streamedText: "Recorded 68.3 kg for today.",
        output_text: "Recorded 68.3 kg for today.",
        output: [
          {
            type: "function_call",
            name: "record_weight",
            call_id: "call-weight",
            arguments: JSON.stringify({ weightKg: 68.3 }),
          },
        ],
      },
      {
        status: "completed",
        streamedText: "Updated today’s weight from 69.1 kg to 68.3 kg.",
        output_text: "Updated today’s weight from 69.1 kg to 68.3 kg.",
        output: [],
      },
    ];
    const onText = vi.fn();

    const result = await runCoachAgent({
      getSystemPrompt: () => "fixed prompt",
      conversation: [{ role: "user", content: "I weigh 68.3 kg today" }],
      getAllowedTools: () => ["record_weight"],
      onText,
      onTool: async () => ({
        operation: "updated",
        previousWeightKg: 69.1,
        measurement: { date: "2026-09-11", weightKg: 68.3 },
      }),
    });

    expect(result.text).toBe("Updated today’s weight from 69.1 kg to 68.3 kg.");
    expect(onText.mock.calls.flat().join("")).toBe(result.text);
  });

  it("forces the bounded food search before prose for an explicit named-food request", async () => {
    provider.responses = [
      foodSearchCall(),
      {
        status: "completed",
        output_text: "I found three relevant candidates.",
        output: [],
      },
    ];
    const onTool = vi.fn(async () => ({ outcome: "candidates", count: 3 }));

    await runCoachAgent({
      getSystemPrompt: () => "fixed prompt",
      conversation: [
        { role: "user", content: "I want to add milk to my catalog" },
      ],
      getAllowedTools: () => ["search_foods"],
      getRequiredFirstTool: () => "search_foods",
      onText: vi.fn(),
      onTool,
    });

    expect(provider.calls[0]).toMatchObject({
      tool_choice: { type: "function", name: "search_foods" },
      parallel_tool_calls: false,
    });
    expect(onTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "search_foods",
        arguments: {
          requestedFoodPhrase: "milk",
          normalizedEnglishQuery: "milk",
          purpose: "catalog_only",
        },
      }),
      1,
    );
  });

  it("allows the model to repair a rejected Draft with another bounded call", async () => {
    provider.responses = [
      proposalCall(1),
      proposalCall(2),
      {
        status: "completed",
        output_text: "The validated Draft is ready.",
        output: [],
      },
    ];
    let attempts = 0;
    const onTool = vi.fn(async () => {
      attempts += 1;
      return { accepted: attempts > 1 };
    });

    await runCoachAgent({
      getSystemPrompt: () => "fixed prompt",
      conversation: [{ role: "user", content: "Generate my Draft Meal Plan" }],
      getAllowedTools: () => (attempts < 2 ? ["submit_draft_proposal"] : []),
      getRequiredFirstTool: () => "submit_draft_proposal",
      onText: vi.fn(),
      onTool,
    });

    expect(onTool).toHaveBeenCalledTimes(2);
    expect(provider.calls[0]).toMatchObject({
      tool_choice: { type: "function", name: "submit_draft_proposal" },
    });
    expect(provider.calls[1]).toMatchObject({ tool_choice: "auto" });
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
