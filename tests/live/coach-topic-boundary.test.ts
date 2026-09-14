import { describe, expect, it } from "vitest";
import { buildArnoldSystemPrompt, runCoachAgent } from "@/ai/coach-agent";

const hasLiveConfiguration = Boolean(
  process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL,
);
const liveDescribe = hasLiveConfiguration ? describe : describe.skip;

async function askArnold(text: string, context: Record<string, unknown> = {}) {
  let streamed = "";
  const result = await runCoachAgent({
    getSystemPrompt: () =>
      buildArnoldSystemPrompt({
        profileId: "live-topic-boundary",
        allowedSkills: [],
        ...context,
      }),
    conversation: [{ role: "user", content: text }],
    getAllowedTools: () => [],
    onText: (delta) => {
      streamed += delta;
    },
    onTool: async () => {
      throw new Error("An unsupported-topic smoke test must not call a skill.");
    },
  });
  return (streamed || result.text).trim();
}

liveDescribe("live Arnold topic boundary", () => {
  it("redirects unrelated technical requests and answers general fitness information", async () => {
    const programming = await askArnold(
      "write a for loop that counts from 1 to 10",
    );
    expect(programming).not.toMatch(
      /```|range\s*\(|print\s*\(|for\s+\w+\s+in/i,
    );
    expect(programming).toMatch(/nutrition|food|meal|weight|fitness/i);
    expect(programming.length).toBeLessThanOrEqual(500);

    const technicalHebrew = await askArnold(
      "איך כותבים פונקציה ב-JavaScript שממיינת מערך?",
    );
    expect(technicalHebrew).not.toMatch(
      /```|javascript|function\s*\(|\.sort\s*\(/i,
    );
    expect(technicalHebrew).toMatch(/[\u0590-\u05ff]/);
    expect(technicalHebrew.length).toBeLessThanOrEqual(500);

    const fitness = await askArnold(
      "What are two general benefits of regular physical activity?",
    );
    expect(fitness).toMatch(
      /activity|aerobic|exercise|fitness|movement|strength/i,
    );
    expect(fitness).not.toMatch(/diagnos|treatment|prescri/i);
  }, 90_000);

  it("offers approved alternatives for a disliked meal-plan food", async () => {
    const response = await askArnold(
      "i dont like rice. any other oprions for my meal plan?",
      {
        foodAlternativeRequest: {
          responseMode: "offer_approved_options_only",
        },
        approvedFoods: [
          { id: "white-rice-cooked", name: "White rice" },
          { id: "quinoa-cooked", name: "Quinoa" },
          { id: "sweet-potato-baked", name: "Sweet potato" },
          { id: "pasta-cooked", name: "Pasta" },
        ],
      },
    );

    expect(response).toMatch(/quinoa|sweet potato|pasta/i);
    expect(response).not.toMatch(
      /what would you like to change about your meal plan/i,
    );
    expect(response).not.toMatch(/(?:try|choose|use)\s+white rice/i);
  }, 90_000);
});
