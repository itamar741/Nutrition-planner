import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as approveCatalogFood } from "@/app/api/coach/catalog/approve/route";

const getCandidate = vi.hoisted(() => vi.fn());

vi.mock("@/domain/catalog/api-contracts", () => ({
  candidateDecisionRequestSchema: {
    parse: () => ({
      candidateId: "candidate-id",
      profileId: "new",
      expectedVersion: 1,
      commandId: "approve-command",
    }),
  },
}));

vi.mock("@/domain/catalog/schemas", () => ({
  catalogFoodSchema: { parse: (value: unknown) => value },
}));

vi.mock("@/security/demo-access", () => ({ requestHasAccess: () => true }));

vi.mock("@/persistence/repository", () => ({
  approveCatalogFood: vi.fn(),
  getCandidate,
  getLookup: vi.fn(),
  updateLookup: vi.fn(),
  StaleProfileError: class StaleProfileError extends Error {},
}));

describe("catalog route errors", () => {
  beforeEach(() => getCandidate.mockReset());

  it("does not expose internal approval errors", async () => {
    const environmentSecret = "phase-five-catalog-secret";
    const databaseUrl = [
      "postgresql",
      "://course-user",
      ":course-password@",
      "database.test/course",
    ].join("");
    process.env.OPENAI_API_KEY = environmentSecret;
    getCandidate.mockRejectedValueOnce(
      new Error(`database failed: ${databaseUrl}; key=${environmentSecret}`),
    );

    try {
      const response = await approveCatalogFood(
        new Request("http://localhost/api/coach/catalog/approve", {
          method: "POST",
          body: "{}",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body).toEqual({
        ok: false,
        message: "Approval could not be saved.",
      });
      expect(JSON.stringify(body)).not.toContain(environmentSecret);
      expect(JSON.stringify(body)).not.toContain(databaseUrl);
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });
});
