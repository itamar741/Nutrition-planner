import { describe, expect, it } from "vitest";
import { isMeaningfulClarification } from "@/ai/food-catalog";

describe("runtime food lookup clarification guard", () => {
  it("rejects punctuation-only model output", () => {
    expect(isMeaningfulClarification("{")).toBe(false);
    expect(isMeaningfulClarification("...")).toBe(false);
  });

  it("accepts a real clarification question", () => {
    expect(
      isMeaningfulClarification("Which brand and package size do you mean?"),
    ).toBe(true);
  });
});
