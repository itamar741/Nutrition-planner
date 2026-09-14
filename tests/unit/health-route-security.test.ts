import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";

const originalDatabaseUrl = process.env.DATABASE_URL;

afterEach(() => {
  vi.unstubAllEnvs();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

describe("health route persistence security", () => {
  it("fails closed in production when PostgreSQL is not configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.DATABASE_URL;

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      message: "Persistence is unavailable.",
    });
  });

  it("preserves in-memory persistence outside production", async () => {
    vi.stubEnv("NODE_ENV", "test");
    delete process.env.DATABASE_URL;

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("allows the explicit local browser-test memory adapter", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_IN_MEMORY_PERSISTENCE_FOR_E2E", "true");
    delete process.env.DATABASE_URL;

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
