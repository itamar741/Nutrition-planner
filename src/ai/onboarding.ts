import OpenAI from "openai";
import { ZodError } from "zod";
import { getMissingFactKeys } from "@/domain/profile/onboarding";
import type {
  ProfileFactKey,
  ProfileFactPatch,
  StructuredProfile,
} from "@/domain/profile/types";
import {
  modelFactExtractionJsonSchema,
  modelFactExtractionSchema,
  type ModelFactExtraction,
} from "./contracts";

export class OpenAIConfigurationError extends Error {}
export class ModelContractError extends Error {}

export type ResponseCreator = (input: {
  instructions: string;
  userInput: string;
}) => Promise<string>;

function toPatch(
  extraction: ModelFactExtraction,
  allowedKeys: ProfileFactKey[],
): ProfileFactPatch {
  const allowed = new Set(allowedKeys);
  return Object.fromEntries(
    Object.entries(extraction.facts).filter(
      ([key, value]) => value !== null && allowed.has(key as ProfileFactKey),
    ),
  ) as ProfileFactPatch;
}

function instructionsFor(allowedKeys: ProfileFactKey[], repairIssue?: string) {
  return [
    "You extract facts for a narrow nutrition-demo onboarding flow.",
    `Extract only these currently missing fields: ${allowedKeys.join(", ")}.`,
    "Use null for anything not explicitly supported by the user's message.",
    "Do not infer medical facts, browse, recommend food, or add fields.",
    "For equationSex, map only an explicit male/man or female/woman statement.",
    "For exercise, use none, resistance, cardio, or mixed and moderate or vigorous. For none, set exerciseType to none, exerciseFrequencyPerWeek and exerciseSessionMinutes to 0, and exerciseIntensity to moderate as an ignored placeholder.",
    "Keep acknowledgement calm, factual, under 180 characters, and do not ask the next question.",
    repairIssue
      ? `Your previous result was invalid. Correct this: ${repairIssue}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function isNoExerciseMessage(message: string) {
  const normalized = message.trim();
  return (
    /^(?:[-–—•]\s*)?(?:no|none|zero)\s+(?:exercise|workouts?)\.?$/iu.test(
      normalized,
    ) ||
    /^(?:[-–—•]\s*)?(?:אין|בלי)\s+(?:פעילות גופנית|ספורט|אימונים?)\.?$/u.test(
      normalized,
    )
  );
}

async function defaultResponseCreator(input: {
  instructions: string;
  userInput: string;
}): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;
  if (!apiKey || !model) {
    throw new OpenAIConfigurationError(
      "Server-side OpenAI configuration is missing.",
    );
  }

  const client = new OpenAI({ apiKey });
  const response = await client.responses.create({
    model,
    instructions: input.instructions,
    input: input.userInput,
    store: false,
    tools: [],
    tool_choice: "none",
    text: {
      format: {
        type: "json_schema",
        name: "nutrition_onboarding_fact_extraction",
        strict: true,
        schema: modelFactExtractionJsonSchema,
      },
    },
  });

  if (response.status !== "completed" || !response.output_text) {
    throw new ModelContractError("The model response was incomplete.");
  }
  return response.output_text;
}

export async function extractOnboardingFacts(
  request: {
    commandId: string;
    message: string;
    profile: StructuredProfile;
  },
  createResponse: ResponseCreator = defaultResponseCreator,
): Promise<{ patch: ProfileFactPatch; acknowledgement: string }> {
  const allowedKeys = getMissingFactKeys(request.profile);
  const exerciseKeys: ProfileFactKey[] = [
    "exerciseType",
    "exerciseFrequencyPerWeek",
    "exerciseSessionMinutes",
    "exerciseIntensity",
  ];
  if (
    isNoExerciseMessage(request.message) &&
    exerciseKeys.every((key) => allowedKeys.includes(key))
  ) {
    return {
      patch: {
        exerciseType: "none",
        exerciseFrequencyPerWeek: 0,
        exerciseSessionMinutes: 0,
        exerciseIntensity: "moderate",
      },
      acknowledgement: "Noted: no exercise.",
    };
  }
  let repairIssue: string | undefined;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await createResponse({
        instructions: instructionsFor(allowedKeys, repairIssue),
        userInput: request.message,
      });
      const parsedJson: unknown = JSON.parse(raw);
      const extraction = modelFactExtractionSchema.parse(parsedJson);
      return {
        patch: toPatch(extraction, allowedKeys),
        acknowledgement: extraction.acknowledgement,
      };
    } catch (error) {
      if (error instanceof OpenAIConfigurationError) throw error;
      repairIssue =
        error instanceof ZodError
          ? error.issues
              .map((issue) => issue.message)
              .join("; ")
              .slice(0, 300)
          : error instanceof SyntaxError
            ? "Return valid JSON matching the supplied schema."
            : error instanceof Error
              ? error.message.slice(0, 300)
              : "Unknown structured-output error.";
    }
  }

  throw new ModelContractError(
    "The model returned invalid structured output twice.",
  );
}
