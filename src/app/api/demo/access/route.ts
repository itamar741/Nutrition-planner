import { NextResponse } from "next/server";
import { z } from "zod";
import {
  accessCookieName,
  createAccessToken,
  verifyAccessCode,
} from "@/security/demo-access";

export const runtime = "nodejs";

const requestSchema = z.object({ code: z.string().min(1).max(200) }).strict();

export async function POST(request: Request) {
  const result = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!result.success || !verifyAccessCode(result.data.code)) {
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
