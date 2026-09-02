import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAccessToken,
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

  it("produces stable hashes without retaining the raw address", () => {
    const request = new Request("https://demo.example", {
      headers: {
        cookie: "nutrition_demo_access=test-session",
        "x-forwarded-for": "203.0.113.42, 10.0.0.1",
      },
    });
    const first = rateIdentity(request);
    const second = rateIdentity(request);

    expect(first).toEqual(second);
    expect(first.ipHash).not.toContain("203.0.113.42");
    expect(first.sessionHash).not.toContain("test-session");
    expect(first.ipHash).toHaveLength(64);
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
