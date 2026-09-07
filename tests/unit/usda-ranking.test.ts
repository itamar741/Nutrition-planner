import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const responses = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("openai", () => ({
  default: class OpenAI {
    responses = { create: responses.create };
  },
}));

import { rankUsdaCandidates, requestFoodLookupTool } from "@/ai/food-catalog";

describe("bounded USDA semantic ranking", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_MODEL = "test-model";
    responses.create.mockReset();
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;
  });

  it("repairs one invalid ID-only result and never sends nutrition details", async () => {
    responses.create
      .mockResolvedValueOnce({
        status: "completed",
        output_text: JSON.stringify({
          outcome: "candidates",
          candidateFdcIds: [999],
          clarification: null,
        }),
      })
      .mockResolvedValueOnce({
        status: "completed",
        output_text: JSON.stringify({
          outcome: "candidates",
          candidateFdcIds: [12, 10],
          clarification: null,
        }),
      });

    await expect(
      rankUsdaCandidates({
        query: "milk",
        replyLanguage: "English",
        candidates: [
          {
            fdcId: 10,
            title: "Milk, whole",
            description: "SR Legacy · Dairy and Egg Products",
            dataType: "SR Legacy",
          },
          {
            fdcId: 12,
            title: "Milk, reduced fat",
            description: "Foundation Foods · Dairy and Egg Products",
            dataType: "Foundation",
          },
        ],
      }),
    ).resolves.toEqual({ outcome: "candidates", candidateFdcIds: [12, 10] });

    expect(responses.create).toHaveBeenCalledTimes(2);
    expect(responses.create.mock.calls[0]?.[0]).toMatchObject({
      store: false,
      tools: [],
      tool_choice: "none",
    });
    expect(
      JSON.parse(String(responses.create.mock.calls[0]?.[0]?.input)),
    ).toEqual({
      requestedFood: "milk",
      replyLanguage: "English",
      candidates: [
        {
          fdcId: 10,
          title: "Milk, whole",
          description: "SR Legacy · Dairy and Egg Products",
          dataType: "SR Legacy",
        },
        {
          fdcId: 12,
          title: "Milk, reduced fat",
          description: "Foundation Foods · Dairy and Egg Products",
          dataType: "Foundation",
        },
      ],
    });
  });

  it("forces the legacy bounded lookup for a supplied basic food name", async () => {
    responses.create.mockResolvedValueOnce({
      status: "completed",
      output_text: "",
      output: [
        {
          type: "function_call",
          name: "search_usda_foods",
          call_id: "lookup-milk",
          arguments: JSON.stringify({ normalizedEnglishQuery: "milk" }),
        },
      ],
    });
    const execute = vi.fn(async () => []);

    await expect(
      requestFoodLookupTool({
        message: "milk",
        context: "general",
        execute,
      }),
    ).resolves.toMatchObject({
      outcome: "candidates",
      arguments_: { normalizedEnglishQuery: "milk", preparation: null },
    });

    expect(responses.create).toHaveBeenCalledOnce();
    expect(responses.create.mock.calls[0]?.[0]).toMatchObject({
      store: false,
      tool_choice: { type: "function", name: "search_usda_foods" },
    });
    expect(execute).toHaveBeenCalledWith({
      normalizedEnglishQuery: "milk",
      preparation: null,
    });
  });
});
