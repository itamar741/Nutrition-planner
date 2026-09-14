import { z } from "zod";

export const turnIntentSchema = z.enum([
  "onboarding_answer",
  "plan_create",
  "plan_replace",
  "plan_revise",
  "goal_change",
  "food_alternatives",
  "food_alternative_selection",
  "draft_retry",
  "adjustment_retry",
  "weight_record",
  "weight_edit",
  "weight_delete",
  "food_search",
  "food_candidate_selection",
  "food_inspect",
  "food_remove",
  "preference_save",
  "nutrition_question",
  "fitness_question",
  "unsupported",
  "unknown",
]);

export const turnSpeechActSchema = z.enum([
  "request",
  "question",
  "hypothetical",
  "negated",
  "answer",
  "unknown",
]);

export const planChangeStrategySchema = z.enum([
  "preserve_structure",
  "different_approved_mix",
]);

export const turnReferenceScopeSchema = z.enum([
  "explicit_current",
  "persisted_interaction",
  "conversation_only",
  "none",
]);

export const turnDecisionSchema = z
  .object({
    intent: turnIntentSchema,
    speechAct: turnSpeechActSchema,
    foodNames: z.array(z.string().trim().min(1).max(120)).max(8),
    candidateOrdinal: z.number().int().min(1).max(5).nullable(),
    referenceScope: turnReferenceScopeSchema,
    planChangeStrategy: planChangeStrategySchema.nullable(),
    evidence: z.string().trim().min(1).max(240).nullable(),
  })
  .strict();

export type TurnDecision = z.infer<typeof turnDecisionSchema>;

const directPlanMutationIntents = new Set<TurnDecision["intent"]>([
  "plan_create",
  "plan_replace",
  "plan_revise",
]);

export function requestsPlanMutation(decision: TurnDecision) {
  return (
    decision.evidence !== null &&
    ((decision.referenceScope === "explicit_current" &&
      decision.speechAct === "request") ||
      (decision.referenceScope === "persisted_interaction" &&
        decision.speechAct === "answer")) &&
    ((directPlanMutationIntents.has(decision.intent) &&
      decision.speechAct === "request") ||
      (decision.intent === "food_alternative_selection" &&
        decision.speechAct === "answer") ||
      (decision.intent === "draft_retry" && decision.speechAct === "answer"))
  );
}

export function requestsFoodAlternativeOffer(decision: TurnDecision) {
  return (
    decision.intent === "food_alternatives" &&
    decision.evidence !== null &&
    decision.referenceScope === "explicit_current" &&
    (decision.speechAct === "request" || decision.speechAct === "question")
  );
}
