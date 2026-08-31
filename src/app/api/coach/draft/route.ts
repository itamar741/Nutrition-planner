import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { generateDraft } from "@/ai/plan";
import {
  OpenAIPlanConfigurationError,
  PlanModelContractError,
} from "@/ai/plan";
import {
  draftRequestSchema,
  draftSuccessSchema,
  planFailureSchema,
} from "@/ai/plan-contracts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let commandId: string | null = null;
  try {
    const body: unknown = await request.json();
    const parsed = draftRequestSchema.parse(body);
    commandId = parsed.commandId;
    const draft = await generateDraft(parsed);
    return NextResponse.json(
      draftSuccessSchema.parse({ ok: true, commandId, draft }),
    );
  } catch (error) {
    const failure = planFailureSchema.parse({
      ok: false,
      commandId,
      code:
        error instanceof ZodError
          ? "invalid_request"
          : error instanceof OpenAIPlanConfigurationError
            ? "not_configured"
            : error instanceof PlanModelContractError &&
                error.kind === "validation"
              ? "validation_failure"
              : "model_failure",
      message:
        error instanceof ZodError
          ? "The Draft request is incomplete or invalid."
          : error instanceof OpenAIPlanConfigurationError
            ? "Draft generation is not configured yet. Add the server-side OpenAI settings and retry."
            : error instanceof PlanModelContractError &&
                error.kind === "validation"
              ? "The proposed Draft did not pass the catalog and nutrition checks. Your confirmed state was preserved."
              : "Draft generation failed. Your confirmed state was preserved.",
    });
    const status =
      failure.code === "invalid_request"
        ? 400
        : failure.code === "not_configured"
          ? 503
          : failure.code === "validation_failure"
            ? 422
            : 502;
    return NextResponse.json(failure, { status });
  }
}
