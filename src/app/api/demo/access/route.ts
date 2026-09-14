import { NextResponse } from "next/server";
import { z } from "zod";
import {
  accessCookieName,
  createAccessToken,
  demoAccessConfigurationAvailable,
  verifyAccessCode,
} from "@/security/demo-access";
import { recordAndCheckDemoAccessRateLimit } from "@/persistence/repository";
import { rateIdentity } from "@/security/rate-identity";

export const runtime = "nodejs";

const requestSchema = z.object({ code: z.string().min(1).max(200) }).strict();

export async function POST(request: Request) {
  if (!demoAccessConfigurationAvailable()) {
    return NextResponse.json(
      { ok: false, message: "Demo access is temporarily unavailable." },
      { status: 503 },
    );
  }
  const result = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!result.success) {
    return NextResponse.json(
      { ok: false, message: "That demo access code is not valid." },
      { status: 401 },
    );
  }
  let rateLimitAllowed: boolean;
  try {
    rateLimitAllowed = await recordAndCheckDemoAccessRateLimit(
      rateIdentity(request),
    );
  } catch {
    return NextResponse.json(
      { ok: false, message: "Demo access is temporarily unavailable." },
      { status: 503 },
    );
  }
  if (!rateLimitAllowed) {
    return NextResponse.json(
      {
        ok: false,
        message: "Too many access attempts. Please wait before trying again.",
      },
      { status: 429, headers: { "Retry-After": "900" } },
    );
  }
  if (!verifyAccessCode(result.data.code)) {
    return NextResponse.json(
      { ok: false, message: "That demo access code is not valid." },
      { status: 401 },
    );
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(accessCookieName, createAccessToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
  return response;
}
