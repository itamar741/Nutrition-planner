import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const accessCookieName = "nutrition_demo_access";

function secret() {
  return process.env.COOKIE_SIGNING_SECRET ?? "local-demo-cookie-secret";
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function accessProtectionEnabled() {
  return Boolean(process.env.DEMO_ACCESS_CODE);
}

export function verifyAccessCode(candidate: string) {
  const expected = process.env.DEMO_ACCESS_CODE;
  if (!expected) return true;
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return (
    candidateBuffer.length === expectedBuffer.length &&
    timingSafeEqual(candidateBuffer, expectedBuffer)
  );
}

export function createAccessToken() {
  const payload = Buffer.from(
    JSON.stringify({
      sessionId: randomBytes(18).toString("base64url"),
      expiresAt: Date.now() + 12 * 60 * 60 * 1_000,
    }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyAccessToken(token: string | undefined) {
  if (!accessProtectionEnabled()) return true;
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expectedSignature = sign(payload);
  const supplied = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    return false;
  }
  try {
    const value = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { expiresAt?: number };
    return typeof value.expiresAt === "number" && value.expiresAt > Date.now();
  } catch {
    return false;
  }
}

export async function hasServerAccess() {
  if (!accessProtectionEnabled()) return true;
  const cookieStore = await cookies();
  return verifyAccessToken(cookieStore.get(accessCookieName)?.value);
}

export function requestHasAccess(request: Request) {
  if (!accessProtectionEnabled()) return true;
  const cookieHeader = request.headers.get("cookie") ?? "";
  const token = cookieHeader
    .split(";")
    .map((value) => value.trim().split("="))
    .find(([name]) => name === accessCookieName)?.[1];
  return verifyAccessToken(token);
}

export function sessionTokenFromRequest(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  return (
    cookieHeader
      .split(";")
      .map((value) => value.trim().split("="))
      .find(([name]) => name === accessCookieName)?.[1] ?? "local-demo-session"
  );
}
