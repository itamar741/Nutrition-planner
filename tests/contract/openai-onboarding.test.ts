import { describe, expect, it, vi } from "vitest";
import { emptyProfile } from "@/data/demo-fixtures";
import { modelFactExtractionSchema } from "@/ai/contracts";
import { extractOnboardingFacts, ModelContractError } from "@/ai/onboarding";

const validExtraction = JSON.stringify({
  facts: {
    age: 30,
    equationSex: "male",
    heightCm: 180,
    currentWeightKg: 80,
    goal: null,
    dailyRoutine: null,
    exerciseType: null,
    exerciseFrequencyPerWeek: null,
    exerciseSessionMinutes: null,
    exerciseIntensity: null,
    eatingRoutine: null,
    mealPattern: null,
  },
  acknowledgement: "I captured those four details.",
});

describe("structured OpenAI onboarding contract", () => {
  it("accepts a strict multi-fact response", async () => {
    const createResponse = vi.fn().mockResolvedValue(validExtraction);
    const result = await extractOnboardingFacts(
      {
        commandId: "command-1234",
        message: "I am a 30 year old man, 180 cm and 80 kg.",
        profile: emptyProfile,
      },
      createResponse,
    );

    expect(result.patch).toEqual({
      age: 30,
      equationSex: "male",
      heightCm: 180,
      currentWeightKg: 80,
    });
    expect(createResponse).toHaveBeenCalledOnce();
  });

  it("never permits the model to overwrite a confirmed field", async () => {
    const createResponse = vi.fn().mockResolvedValue(validExtraction);
    const result = await extractOnboardingFacts(
      {
        commandId: "command-5678",
        message: "I am actually 30.",
        profile: { ...emptyProfile, age: 28 },
      },
      createResponse,
    );

    expect(result.patch).not.toHaveProperty("age");
  });

  it("AI-06 rejects arbitrary keys and invalid enums", () => {
    const parsed = JSON.parse(validExtraction) as Record<string, unknown>;
    expect(
      modelFactExtractionSchema.safeParse({ ...parsed, action: "browse_foods" })
        .success,
    ).toBe(false);

    const invalidGoal = JSON.parse(validExtraction) as {
      facts: Record<string, unknown>;
      acknowledgement: string;
    };
    invalidGoal.facts.goal = "cut";
    expect(modelFactExtractionSchema.safeParse(invalidGoal).success).toBe(
      false,
    );
  });

  it("repairs one malformed response using the same bounded contract", async () => {
    const createResponse = vi
      .fn()
      .mockResolvedValueOnce("not json")
      .mockResolvedValueOnce(validExtraction);

    const result = await extractOnboardingFacts(
      {
        commandId: "command-repair",
        message: "I am a 30 year old man, 180 cm and 80 kg.",
        profile: emptyProfile,
      },
      createResponse,
    );

    expect(result.patch.age).toBe(30);
    expect(createResponse).toHaveBeenCalledTimes(2);
    expect(createResponse.mock.calls[1]?.[0].instructions).toContain(
      "previous result",
    );
  });

  it("AI-08 returns a controlled failure after two invalid responses", async () => {
    const createResponse = vi
      .fn()
      .mockRejectedValue(new Error("transport timeout"));

    await expect(
      extractOnboardingFacts(
        {
          commandId: "command-timeout",
          message: "I am 30.",
          profile: emptyProfile,
        },
        createResponse,
      ),
    ).rejects.toBeInstanceOf(ModelContractError);
    expect(createResponse).toHaveBeenCalledTimes(2);
  });
});
