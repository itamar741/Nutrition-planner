import { NextResponse } from "next/server";
import { candidateRejectRequestSchema } from "@/domain/catalog/api-contracts";
import {
  getCandidate,
  replaceCandidate,
  updateLookup,
} from "@/persistence/repository";
import { requestHasAccess } from "@/security/demo-access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!requestHasAccess(request)) {
    return NextResponse.json(
      { ok: false, message: "Demo access is required." },
      { status: 401 },
    );
  }
  try {
    const input = candidateRejectRequestSchema.parse(await request.json());
    const candidate = await getCandidate(input.candidateId);
    if (candidate.status !== "detailed") {
      throw new Error("Only a candidate awaiting review can be rejected.");
    }
    await replaceCandidate({ ...candidate, status: "rejected" });
    await updateLookup(candidate.lookupId, {
      status: "rejected",
      failureCode: null,
    });
    return NextResponse.json({
      ok: true,
      message:
        "The candidate was rejected. Tell me what was wrong so I can refine the next search.",
    });
  } catch {
    return NextResponse.json(
      { ok: false, message: "The candidate could not be rejected." },
      { status: 400 },
    );
  }
}
