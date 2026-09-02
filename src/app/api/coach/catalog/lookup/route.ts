import { NextResponse } from "next/server";
import { z } from "zod";
import {
  FoodCatalogConfigurationError,
  FoodCatalogModelError,
  requestFoodLookupTool,
} from "@/ai/food-catalog";
import { foodLookupRequestSchema } from "@/domain/catalog/api-contracts";
import type { FoodLookupToolArguments } from "@/domain/catalog/runtime";
import {
  createLookup,
  findCatalogFood,
  getProfile,
  recordAndCheckRateLimit,
  saveCandidates,
  updateLookup,
  updateLookupContext,
} from "@/persistence/repository";
import { requestHasAccess } from "@/security/demo-access";
import { rateIdentity } from "@/security/rate-identity";
import { FuderUnavailableError, searchFuder } from "@/sources/fuder";

export const runtime = "nodejs";

function safeErrorDetails(error: unknown) {
  if (!(error instanceof Error)) return { name: "UnknownError" };
  const external = error as Error & {
    status?: unknown;
    code?: unknown;
    type?: unknown;
  };
  return {
    name: error.name,
    status: typeof external.status === "number" ? external.status : undefined,
    code: typeof external.code === "string" ? external.code : undefined,
    type: typeof external.type === "string" ? external.type : undefined,
  };
}

export async function POST(request: Request) {
  if (!requestHasAccess(request)) {
    return NextResponse.json(
      { ok: false, message: "Demo access is required." },
      { status: 401 },
    );
  }
  try {
    const input = foodLookupRequestSchema.parse(await request.json());
    const existing = await findCatalogFood(input.query);
    if (existing) {
      const profile = await getProfile(input.profileId);
      const approvedIds =
        "profile" in profile.state
          ? profile.state.profile.approvedCatalogFoodIds
          : profile.state.approvedCatalogFoodIds;
      return NextResponse.json({
        ok: true,
        outcome: "existing",
        food: existing,
        alreadyApproved: approvedIds.includes(existing.id),
        profileVersion: profile.version,
      });
    }
    if (!(await recordAndCheckRateLimit(rateIdentity(request)))) {
      return NextResponse.json(
        {
          ok: false,
          code: "rate_limited",
          message:
            "The demo food-lookup limit has been reached. Try again after the limit window resets.",
        },
        { status: 429 },
      );
    }
    const lookup = await createLookup({
      profileId: input.profileId,
      query: input.query,
      context: { conversation: input.context },
      status: "searching",
      failureCode: null,
    });
    console.info("food_lookup_started", { lookupId: lookup.id });
    let toolArguments: FoodLookupToolArguments | null = null;
    try {
      const result = await requestFoodLookupTool({
        message: input.query,
        context: input.context,
        execute: async (arguments_) => {
          toolArguments = arguments_;
          await updateLookupContext(lookup.id, {
            conversation: input.context,
            toolArguments: arguments_,
          });
          return searchFuder(arguments_);
        },
      });
      if (result.outcome === "clarification") {
        await updateLookupContext(lookup.id, {
          conversation: input.context,
          clarification: result.message,
        });
        await updateLookup(lookup.id, {
          status: "failed",
          failureCode: "needs_clarification",
        });
        return NextResponse.json({
          ok: true,
          outcome: "clarification",
          lookupId: lookup.id,
          message: result.message,
        });
      }
      await saveCandidates(
        result.candidates.map((candidate) => ({
          id: candidate.id,
          lookupId: lookup.id,
          sourceUrl: candidate.sourceUrl,
          sourceIdentifier: candidate.sourceUrl,
          status: "summary" as const,
          data: {
            title: candidate.title,
            description: candidate.description,
            sourceUrl: candidate.sourceUrl,
            toolArguments: result.arguments_,
          },
        })),
      );
      await updateLookup(lookup.id, { status: "ready", failureCode: null });
      return NextResponse.json({
        ok: true,
        outcome: "candidates",
        lookupId: lookup.id,
        message: "I found source candidates. Choose the exact food you meant.",
        candidates: result.candidates,
      });
    } catch (error) {
      const sourceFailed = error instanceof FuderUnavailableError;
      const configurationFailed =
        error instanceof FoodCatalogConfigurationError;
      const modelFailed = error instanceof FoodCatalogModelError;
      const code = sourceFailed
        ? error.code
        : configurationFailed
          ? "ai_configuration_missing"
          : error instanceof z.ZodError
            ? "invalid_tool_arguments"
            : modelFailed
              ? "invalid_model_response"
              : "ai_request_failed";
      console.error("food_lookup_failed", {
        lookupId: lookup.id,
        failureCode: code,
        ...safeErrorDetails(error),
      });
      if (toolArguments) {
        await updateLookupContext(lookup.id, {
          conversation: input.context,
          toolArguments,
        });
      }
      await updateLookup(lookup.id, { status: "failed", failureCode: code });
      return NextResponse.json(
        {
          ok: false,
          code: "source_unavailable",
          message: sourceFailed
            ? "Fuder could not return a safe candidate. Your catalog and profile were not changed."
            : configurationFailed
              ? "The AI food lookup is not configured. Confirm OPENAI_API_KEY and OPENAI_MODEL in Render, then deploy again."
              : "The AI could not prepare this lookup. Check the Render service logs for the lookup failure code; your catalog and profile were not changed.",
          lookupId: lookup.id,
          offerAiEstimate: sourceFailed,
        },
        { status: 503 },
      );
    }
  } catch (error) {
    console.error("food_lookup_request_rejected", safeErrorDetails(error));
    return NextResponse.json(
      {
        ok: false,
        code: "invalid_request",
        message:
          error instanceof z.ZodError
            ? "Enter one food or packaged product."
            : "The food lookup could not start.",
      },
      { status: 400 },
    );
  }
}
