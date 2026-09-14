import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/demo/access/route";
import { verifyAccessToken } from "@/security/demo-access";
import { resetMemoryPersistenceForTests } from "@/persistence/repository";

const originalCode = process.env.DEMO_ACCESS_CODE;
const originalSecret = process.env.COOKIE_SIGNING_SECRET;
const originalDatabaseUrl = process.env.DATABASE_URL;

function accessRequest(code: string, forwardedFor?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (forwardedFor) headers["x-forwarded-for"] = forwardedFor;
  return new Request("http://localhost/api/demo/access", {
    method: "POST",
    headers,
    body: JSON.stringify({ code }),
  });
}

beforeEach(() => {
  delete process.env.DATABASE_URL;
  vi.stubEnv("NODE_ENV", "test");
  process.env.DEMO_ACCESS_CODE = "lecturer-demo";
  process.env.COOKIE_SIGNING_SECRET =
    "a-production-length-test-secret-that-is-not-committed";
  resetMemoryPersistenceForTests();
});

afterEach(() => {
  if (originalCode === undefined) delete process.env.DEMO_ACCESS_CODE;
  else process.env.DEMO_ACCESS_CODE = originalCode;
  if (originalSecret === undefined) delete process.env.COOKIE_SIGNING_SECRET;
  else process.env.COOKIE_SIGNING_SECRET = originalSecret;
  vi.unstubAllEnvs();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

describe("demo access route security", () => {
  it.each(["DEMO_ACCESS_CODE", "COOKIE_SIGNING_SECRET"] as const)(
    "returns 503 without setting a cookie when %s is missing",
    async (missingSecret) => {
      vi.stubEnv("NODE_ENV", "production");
      delete process.env[missingSecret];

      const response = await POST(accessRequest("lecturer-demo"));

      expect(response.status).toBe(503);
      expect(response.headers.get("set-cookie")).toBeNull();
    },
  );

  it("fails closed when production persistence is not configured", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = await POST(accessRequest("lecturer-demo"));

    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("shares one anonymous limit even when forwarding headers change", async () => {
    for (let index = 0; index < 5; index += 1) {
      const response = await POST(
        accessRequest("wrong-code", `203.0.113.${index + 1}`),
      );
      expect(response.status).toBe(401);
    }

    const blocked = await POST(accessRequest("wrong-code", "198.51.100.200"));

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("900");
  });

  it("sets a valid signed cookie for the correct code below the limit", async () => {
    const response = await POST(accessRequest("lecturer-demo"));
    const setCookie = response.headers.get("set-cookie");
    const token = setCookie?.match(/nutrition_demo_access=([^;]+)/)?.[1];

    expect(response.status).toBe(200);
    expect(token).toBeTruthy();
    expect(verifyAccessToken(token)).toBe(true);
  });
});
