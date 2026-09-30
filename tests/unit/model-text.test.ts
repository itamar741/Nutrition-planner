import { describe, expect, it } from "vitest";
import { normalizeModelText } from "@/ai/model-text";

describe("model text normalization", () => {
  it("decodes safe numeric and common named entities", () => {
    expect(
      normalizeModelText(
        "High in&#x20;calories &amp; protein.&#10;Try cottage cheese.",
      ),
    ).toBe("High in calories & protein.\nTry cottage cheese.");
  });

  it("preserves unsupported and unsafe entities", () => {
    expect(normalizeModelText("A &copy; B &#0; C &#xD800;")).toBe(
      "A &copy; B &#0; C &#xD800;",
    );
  });

  it("collapses an adjacent duplicate response with a polite preface", () => {
    expect(
      normalizeModelText(
        "I’m sorry, but I can help with nutrition or food—please send an in-scope request. I can help with nutrition or food—please send an in-scope request.",
      ),
    ).toBe(
      "I’m sorry, but I can help with nutrition or food—please send an in-scope request.",
    );
  });
});
