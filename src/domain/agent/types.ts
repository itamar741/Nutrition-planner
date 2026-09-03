import { z } from "zod";
import {
  foodSearchCandidateSchema,
  type FoodApprovalCandidate,
  type FoodSearchCandidate,
} from "@/domain/catalog/runtime";
import { catalogFoodSchema } from "@/domain/catalog/schemas";
import { draftProposalSchema } from "@/domain/plan/schemas";
import type { CatalogFood } from "@/domain/catalog/types";
import type { DraftProposal } from "@/domain/plan/types";

export type AgentInteraction =
  | {
      id: string;
      type: "clarification";
      workflow:
        "onboarding" | "weight" | "food" | "draft" | "adjustment" | "general";
      prompt: string;
      quickReplies: string[];
    }
  | {
      id: string;
      type: "food_candidates";
      lookupId: string;
      candidates: FoodSearchCandidate[];
    }
  | {
      id: string;
      type: "food_approval";
      candidate: FoodApprovalCandidate;
    }
  | {
      id: string;
      type: "existing_food";
      food: CatalogFood;
      alreadyApproved: boolean;
    }
  | {
      id: string;
      type: "confirm_draft_food";
      foodId: string;
      displayName: string;
    }
  | {
      id: string;
      type: "source_unavailable";
      lookupId: string;
      query: string;
      failureCode: string;
    }
  | {
      id: string;
      type: "adjustment_approval";
      draft: DraftProposal;
    };

export interface AgentSessionState {
  summary: string | null;
  pendingInteraction: AgentInteraction | null;
  pausedInteraction: AgentInteraction | null;
}

export const emptyAgentSession = (): AgentSessionState => ({
  summary: null,
  pendingInteraction: null,
  pausedInteraction: null,
});

const foodApprovalCandidateSchema = z
  .object({
    id: z.string().uuid(),
    lookupId: z.string().uuid(),
    food: catalogFoodSchema,
    sourceLabel: z.enum([
      "USDA FoodData Central verified",
      "USDA FoodData Central search data",
      "AI estimate · USDA not verified",
    ]),
  })
  .strict();

export const agentInteractionSchema = z.discriminatedUnion("type", [
  z
    .object({
      id: z.string().min(1).max(100),
      type: z.literal("clarification"),
      workflow: z.enum([
        "onboarding",
        "weight",
        "food",
        "draft",
        "adjustment",
        "general",
      ]),
      prompt: z.string().min(1).max(500),
      quickReplies: z.array(z.string().min(1).max(100)).max(6),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1).max(100),
      type: z.literal("source_unavailable"),
      lookupId: z.string().uuid(),
      query: z.string().min(1).max(120),
      failureCode: z.string().min(1).max(80),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1).max(100),
      type: z.literal("food_candidates"),
      lookupId: z.string().uuid(),
      candidates: z.array(foodSearchCandidateSchema).min(1).max(5),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1).max(100),
      type: z.literal("food_approval"),
      candidate: foodApprovalCandidateSchema,
    })
    .strict(),
  z
    .object({
      id: z.string().min(1).max(100),
      type: z.literal("existing_food"),
      food: catalogFoodSchema,
      alreadyApproved: z.boolean(),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1).max(100),
      type: z.literal("confirm_draft_food"),
      foodId: z.string().min(1).max(100),
      displayName: z.string().min(1).max(120),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1).max(100),
      type: z.literal("adjustment_approval"),
      draft: draftProposalSchema,
    })
    .strict(),
]);

export const agentSessionSchema = z
  .object({
    summary: z.string().max(4_000).nullable(),
    pendingInteraction: agentInteractionSchema.nullable(),
    pausedInteraction: agentInteractionSchema.nullable(),
  })
  .strict();

export const coachMessageRequestSchema = z
  .object({
    profileId: z.enum(["new", "existing"]),
    expectedVersion: z.number().int().positive(),
    commandId: z.string().min(8).max(100),
    input: z.discriminatedUnion("type", [
      z
        .object({
          type: z.literal("text"),
          text: z.string().trim().min(1).max(1_000),
        })
        .strict(),
      z
        .object({
          type: z.literal("interaction"),
          interactionId: z.string().min(1).max(100),
          action: z.enum([
            "select_candidate",
            "approve_food",
            "reject_food",
            "add_existing_food",
            "confirm_draft_food",
            "decline_draft_food",
            "confirm_ai_estimate",
            "refine_search",
            "approve_draft",
            "reject_draft",
            "approve_adjustment",
            "reject_adjustment",
          ]),
          candidateId: z.string().uuid().optional(),
        })
        .strict(),
    ]),
  })
  .strict();

export type CoachMessageRequest = z.infer<typeof coachMessageRequestSchema>;

export type AgentStreamEvent =
  | { type: "status"; value: "thinking" | "searching" | "validating" }
  | { type: "text_delta"; value: string }
  | { type: "state"; profile: unknown; catalogFood?: CatalogFood }
  | {
      type: "error";
      message: string;
      diagnostics?: {
        stage: string;
        failureCode: string;
        turnId: string;
        lookupId?: string;
      };
    }
  | { type: "done"; turnId: string };
