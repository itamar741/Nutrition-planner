import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAccessToken,
  demoAccessConfigurationAvailable,
  verifyAccessCode,
  verifyAccessToken,
} from "@/security/demo-access";
import { rateIdentity } from "@/security/rate-identity";
import {
  candidateDetailRequestSchema,
  candidateRejectRequestSchema,
  estimateRequestSchema,
} from "@/domain/catalog/api-contracts";

const originalCode = process.env.DEMO_ACCESS_CODE;
const originalSecret = process.env.COOKIE_SIGNING_SECRET;

beforeEach(() => {
  process.env.DEMO_ACCESS_CODE = "lecturer-demo";
  process.env.COOKIE_SIGNING_SECRET = "a-test-secret-that-is-not-committed";
});

afterEach(() => {
  if (originalCode === undefined) delete process.env.DEMO_ACCESS_CODE;
  else process.env.DEMO_ACCESS_CODE = originalCode;
  if (originalSecret === undefined) delete process.env.COOKIE_SIGNING_SECRET;
  else process.env.COOKIE_SIGNING_SECRET = originalSecret;
  vi.unstubAllEnvs();
});

describe("shared demo access", () => {
  it("accepts only the exact access code", () => {
    expect(verifyAccessCode("lecturer-demo")).toBe(true);
    expect(verifyAccessCode("lecturer-dem0")).toBe(false);
    expect(verifyAccessCode("short")).toBe(false);
  });

  it("verifies signed tokens and rejects tampering", () => {
    const token = createAccessToken();
    expect(verifyAccessToken(token)).toBe(true);
    expect(verifyAccessToken(`${token.slice(0, -1)}x`)).toBe(false);
  });

  it.each(["DEMO_ACCESS_CODE", "COOKIE_SIGNING_SECRET"] as const)(
    "fails closed when production is missing %s",
    (missingSecret) => {
      const token = createAccessToken();
      vi.stubEnv("NODE_ENV", "production");
      delete process.env[missingSecret];

      expect(demoAccessConfigurationAvailable()).toBe(false);
      expect(verifyAccessCode("lecturer-demo")).toBe(false);
      expect(verifyAccessToken(token)).toBe(false);
      expect(() => createAccessToken()).toThrow(
        "Demo access is not configured.",
      );
    },
  );

  it("rejects a short production signing secret", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.COOKIE_SIGNING_SECRET = "too-short";

    expect(demoAccessConfigurationAvailable()).toBe(false);
    expect(verifyAccessCode("lecturer-demo")).toBe(false);
  });

  it("ignores forwarding headers before access is granted", () => {
    const first = rateIdentity(
      new Request("https://demo.example", {
        headers: { "x-forwarded-for": "203.0.113.42" },
      }),
    );
    const second = rateIdentity(
      new Request("https://demo.example", {
        headers: {
          cookie: "nutrition_demo_access=forged-token",
          "x-forwarded-for": "198.51.100.9",
        },
      }),
    );

    expect(first).toEqual(second);
    expect(first.sessionHash).toBe(first.ipHash);
    expect(first.sessionHash).toHaveLength(64);
  });

  it("derives a stable identity only from a verified access token", () => {
    const token = createAccessToken();
    const request = new Request("https://demo.example", {
      headers: {
        cookie: `nutrition_demo_access=${token}`,
        "x-forwarded-for": "203.0.113.42, 10.0.0.1",
      },
    });
    const first = rateIdentity(request);
    const second = rateIdentity(
      new Request("https://demo.example", {
        headers: {
          cookie: `nutrition_demo_access=${token}`,
          "x-forwarded-for": "198.51.100.9",
        },
      }),
    );
    const anonymous = rateIdentity(new Request("https://demo.example"));

    expect(first).toEqual(second);
    expect(first).not.toEqual(anonymous);
    expect(first.sessionHash).toBe(first.ipHash);
  });

  it("requires profile ownership on every candidate follow-up", () => {
    const candidateId = "f00d0000-0000-4000-8000-000000000001";
    const lookupId = "100d0000-0000-4000-8000-000000000001";
    expect(
      candidateDetailRequestSchema.safeParse({ candidateId }).success,
    ).toBe(false);
    expect(
      candidateRejectRequestSchema.safeParse({ candidateId }).success,
    ).toBe(false);
    expect(estimateRequestSchema.safeParse({ lookupId }).success).toBe(false);
    expect(
      candidateDetailRequestSchema.safeParse({
        profileId: "new",
        candidateId,
      }).success,
    ).toBe(true);
  });
});
