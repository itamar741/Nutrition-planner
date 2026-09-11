import { describe, expect, it } from "vitest";
import { sanitizeDiagnosticText } from "@/security/safe-diagnostics";

describe("safe server diagnostics", () => {
  it("redacts credentials and flattens control characters", () => {
    const databaseUrl = [
      "postgresql",
      "://user",
      ":password@",
      "example.test/db",
    ].join("");
    const result = sanitizeDiagnosticText(
      `TypeError\n${databaseUrl} Authorization: Bearer token-value sk-exampleSecret123456`,
    );

    expect(result).toContain("TypeError | ");
    expect(result).toContain("[redacted-database-url]");
    expect(result).toMatch(/authorization=\[redacted\]/i);
    expect(result).toContain("[redacted-api-key]");
    expect(result).not.toContain("password@example");
    expect(result).not.toContain("token-value");
  });

  it("applies a strict maximum length", () => {
    expect(sanitizeDiagnosticText("x".repeat(100), 20)).toHaveLength(20);
  });
});
