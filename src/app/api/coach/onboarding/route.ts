import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { calculateTargets } from "@/domain/nutrition/calculations";
import { applyFactPatch, getNextTurn } from "@/domain/profile/onboarding";
import {
  onboardingFailureSchema,
  onboardingRequestSchema,
  onboardingSuccessSchema,
} from "@/ai/contracts";
import {
  extractOnboardingFacts,
  ModelContractError,
  OpenAIConfigurationError,
} from "@/ai/onboarding";
import { requestHasAccess } from "@/security/demo-access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!requestHasAccess(request)) {
    return NextResponse.json(
      { ok: false, message: "Demo access is required." },
      { status: 401 },
    );
  }
  let commandId: string | null = null;

  try {
    const body: unknown = await request.json();
    const parsed = onboardingRequestSchema.parse(body);
    commandId = parsed.commandId;
    const extraction = await extractOnboardingFacts(parsed);
    const profile = applyFactPatch(parsed.profile, extraction.patch);
    const activeTurn = getNextTurn(profile);
    const response = onboardingSuccessSchema.parse({
      ok: true,
      commandId,
      profile,
      activeTurn,
      targets: calculateTargets(profile),
      acknowledgement: extraction.acknowledgement,
    });
    return NextResponse.json(response);
  } catch (error) {
    const failure = onboardingFailureSchema.parse({
      ok: false,
      commandId,
      code:
        error instanceof ZodError
          ? "invalid_request"
          : error instanceof OpenAIConfigurationError
            ? "not_configured"
            : "model_failure",
      message:
        error instanceof ZodError
          ? "That message could not be validated. Check the requested format and try again."
          : error instanceof OpenAIConfigurationError
            ? "The coach is not configured yet. Add the server-side OpenAI settings and retry."
            : error instanceof ModelContractError
              ? "The coach returned an invalid response. Your confirmed details were not changed."
              : "The coach could not process that message. Your confirmed details were not changed.",
    });
    const status =
      failure.code === "invalid_request"
        ? 400
        : failure.code === "not_configured"
          ? 503
          : 502;
    return NextResponse.json(failure, { status });
  }
}
