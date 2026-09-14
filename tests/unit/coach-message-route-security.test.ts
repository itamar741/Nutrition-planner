import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/coach/message/route";
import type { CoachMessageRequest } from "@/domain/agent/types";
import {
  getProfile,
  resetMemoryPersistenceForTests,
} from "@/persistence/repository";

const executeCoachTurn = vi.hoisted(() => vi.fn());

vi.mock("@/application/coach-turn", () => ({ executeCoachTurn }));

type MockTurnInput = {
  request: CoachMessageRequest;
  onStatus: (value: "thinking") => void;
  onText: (value: string) => void;
};

function coachRequest(commandId: string, text = "Hello") {
  return new Request("http://localhost/api/coach/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profileId: "new",
      expectedVersion: 1,
      commandId,
      input: { type: "text", text },
    }),
  });
}

function coachInteractionRequest(
  commandId: string,
  action: "approve_draft" | "generate_adjustment",
) {
  return new Request("http://localhost/api/coach/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profileId: "new",
      expectedVersion: 1,
      commandId,
      input: {
        type: "interaction",
        interactionId: "test-interaction",
        action,
      },
    }),
  });
}

beforeEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.DEMO_ACCESS_CODE;
  resetMemoryPersistenceForTests();
  executeCoachTurn
    .mockReset()
    .mockImplementation(
      async ({ request, onStatus, onText }: MockTurnInput) => {
        onStatus("thinking");
        onText("Server-owned reply.");
        return {
          profile: await getProfile(request.profileId),
          assistantText: "Server-owned reply.",
        };
      },
    );
});

describe("protected coach route", () => {
  it("requires access before reserving an AI turn", async () => {
    process.env.DEMO_ACCESS_CODE = "course-code";

    const response = await POST(coachRequest("protected-access-command"));

    expect(response.status).toBe(401);
    expect(executeCoachTurn).not.toHaveBeenCalled();
  });

  it("executes a repeated command only once", async () => {
    const first = await POST(coachRequest("protected-duplicate-command"));
    await first.text();
    const duplicate = await POST(coachRequest("protected-duplicate-command"));
    const body = await duplicate.json();

    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(200);
    expect(body.duplicate).toBe(true);
    expect(executeCoachTurn).toHaveBeenCalledOnce();
  });

  it("returns a fixed message when a command is replayed with new input", async () => {
    const first = await POST(coachRequest("protected-replay-command"));
    await first.text();

    const replay = await POST(
      coachRequest("protected-replay-command", "Different input"),
    );
    const body = await replay.json();

    expect(replay.status).toBe(409);
    expect(body).toEqual({
      ok: false,
      code: "command_replay_mismatch",
      message: "A repeated command must use the original request.",
    });
  });

  it("does not stream internal error text or environment values", async () => {
    const environmentSecret = "phase-five-client-secret";
    const databaseUrl = [
      "postgresql",
      "://course-user",
      ":course-password@",
      "database.test/course",
    ].join("");
    process.env.OPENAI_API_KEY = environmentSecret;
    executeCoachTurn.mockRejectedValueOnce(
      new Error(
        `That internal failure contained ${environmentSecret} ${databaseUrl}`,
      ),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const response = await POST(coachRequest("protected-error-command"));
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(body).toContain(
        "The coach could not complete this turn. Your confirmed state was preserved.",
      );
      expect(body).not.toContain(environmentSecret);
      expect(body).not.toContain(databaseUrl);
      expect(body).not.toContain("course-password");
    } finally {
      delete process.env.OPENAI_API_KEY;
      log.mockRestore();
    }
  });

  it("rejects the thirty-first AI turn for one minute before model execution", async () => {
    for (let index = 0; index < 30; index += 1) {
      const response = await POST(
        coachRequest(`protected-rate-command-${index}`),
      );
      expect(response.status).toBe(200);
      await response.text();
    }

    const blocked = await POST(coachRequest("protected-rate-command-30"));
    const body = await blocked.json();

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("60");
    expect(body).toMatchObject({
      code: "rate_limited",
      message:
        "The AI conversation limit has been reached. It resets within 1 minute.",
      retryAfterSeconds: 60,
    });
    expect(executeCoachTurn).toHaveBeenCalledTimes(30);
  });

  it("does not spend an AI-rate-limit slot on a deterministic button action", async () => {
    for (let index = 0; index < 30; index += 1) {
      const response = await POST(coachRequest(`button-rate-seed-${index}`));
      expect(response.status).toBe(200);
      await response.text();
    }

    const deterministic = await POST(
      coachInteractionRequest("button-after-ai-limit", "approve_draft"),
    );
    expect(deterministic.status).toBe(200);
    await deterministic.text();

    const modelBacked = await POST(
      coachInteractionRequest(
        "model-action-after-ai-limit",
        "generate_adjustment",
      ),
    );
    expect(modelBacked.status).toBe(429);
    expect(executeCoachTurn).toHaveBeenCalledTimes(31);
  });
});

describe("legacy AI routes", () => {
  it.each([
    "src/app/api/coach/onboarding/route.ts",
    "src/app/api/coach/draft/route.ts",
    "src/app/api/coach/draft-modification/route.ts",
    "src/app/api/coach/adjustment/route.ts",
    "src/app/api/coach/catalog/lookup/route.ts",
    "src/app/api/coach/catalog/candidate/route.ts",
    "src/app/api/coach/catalog/estimate/route.ts",
  ])("does not expose %s", (routePath) => {
    expect(existsSync(resolve(process.cwd(), routePath))).toBe(false);
  });
});
