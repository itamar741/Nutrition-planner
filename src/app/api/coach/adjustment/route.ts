import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  generateAdjustmentDraft,
  OpenAIPlanConfigurationError,
  PlanModelContractError,
} from "@/ai/plan";
import {
  adjustmentRequestSchema,
  adjustmentSuccessSchema,
  planFailureSchema,
} from "@/ai/plan-contracts";
import { requestHasAccess } from "@/security/demo-access";
import { createCatalogSnapshot } from "@/domain/catalog/snapshot";
import { listCatalogFoods } from "@/persistence/repository";

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
    const parsed = adjustmentRequestSchema.parse(await request.json());
    commandId = parsed.commandId;
    const draft = await generateAdjustmentDraft(
      parsed,
      undefined,
      createCatalogSnapshot(await listCatalogFoods()),
    );
    return NextResponse.json(
      adjustmentSuccessSchema.parse({ ok: true, commandId, draft }),
    );
  } catch (error) {
    const code =
      error instanceof ZodError
        ? "invalid_request"
        : error instanceof OpenAIPlanConfigurationError
          ? "not_configured"
          : error instanceof PlanModelContractError &&
              error.kind === "validation"
            ? "validation_failure"
            : "model_failure";
    const message =
      code === "not_configured"
        ? "Adjustment proposals are not configured yet. Add the server-side OpenAI settings and retry."
        : code === "validation_failure"
          ? "The proposed adjustment did not pass the catalog and nutrition checks. Your Active Plan was preserved."
          : code === "invalid_request"
            ? "The adjustment request is incomplete or invalid."
            : "The adjustment proposal could not be created. Your Active Plan was preserved.";
    return NextResponse.json(
      planFailureSchema.parse({ ok: false, commandId, code, message }),
      {
        status:
          code === "invalid_request"
            ? 400
            : code === "not_configured"
              ? 503
              : code === "validation_failure"
                ? 422
                : 502,
      },
    );
  }
}
