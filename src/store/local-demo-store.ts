import {
  assistantTurnSchema,
  nutritionTargetsSchema,
  structuredProfileSchema,
} from "@/domain/profile/schemas";
import { z } from "zod";
import type { DemoState } from "./demo-reducer";

const storageKey = "nutrition-coach:new:v1";

const persistedStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    profileId: z.literal("new"),
    profile: structuredProfileSchema,
    messages: z.array(
      z
        .object({
          id: z.string(),
          role: z.enum(["assistant", "user"]),
          text: z.string(),
        })
        .strict(),
    ),
    activeTurn: assistantTurnSchema,
    targets: nutritionTargetsSchema.nullable(),
    status: z.enum(["idle", "processing", "failed"]),
    pendingCommand: z
      .object({ id: z.string(), message: z.string() })
      .strict()
      .nullable(),
    processedCommandIds: z.array(z.string()),
    error: z.string().nullable(),
  })
  .strict();

export function loadNewDemoState(): DemoState | null {
  try {
    const value = window.localStorage.getItem(storageKey);
    if (!value) return null;
    const result = persistedStateSchema.safeParse(JSON.parse(value));
    if (!result.success) return null;
    if (result.data.status !== "idle") return null;
    return result.data as DemoState;
  } catch {
    return null;
  }
}

export function saveNewDemoState(state: DemoState) {
  window.localStorage.setItem(storageKey, JSON.stringify(state));
}

export function clearNewDemoState() {
  window.localStorage.removeItem(storageKey);
}
