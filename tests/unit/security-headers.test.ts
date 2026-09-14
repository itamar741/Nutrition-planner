import { describe, expect, it } from "vitest";
import { browserSecurityHeaders } from "../../next.config";

function headerMap(isProduction: boolean) {
  return new Map(
    browserSecurityHeaders(isProduction).map(({ key, value }) => [key, value]),
  );
}

describe("browser security headers", () => {
  it("applies the common browser protections in every environment", () => {
    const headers = headerMap(false);

    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(headers.get("Permissions-Policy")).toBe(
      "camera=(), microphone=(), geolocation=()",
    );
  });

  it("adds CSP and HSTS only in production", () => {
    const development = headerMap(false);
    const production = headerMap(true);
    const policy = production.get("Content-Security-Policy");

    expect(development.has("Content-Security-Policy")).toBe(false);
    expect(development.has("Strict-Transport-Security")).toBe(false);
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(production.get("Strict-Transport-Security")).toBe(
      "max-age=31536000",
    );
  });
});
