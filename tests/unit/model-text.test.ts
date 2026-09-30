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
});
