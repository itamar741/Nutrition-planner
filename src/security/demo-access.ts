import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const accessCookieName = "nutrition_demo_access";

const localSigningSecret = "local-demo-cookie-secret";
const minimumSigningSecretLength = 32;

export function demoAccessConfigurationAvailable() {
  if (process.env.NODE_ENV !== "production") return true;
  const accessCode = process.env.DEMO_ACCESS_CODE;
  const signingSecret = process.env.COOKIE_SIGNING_SECRET;
  return Boolean(
    accessCode?.trim() &&
    signingSecret &&
    signingSecret.trim().length >= minimumSigningSecretLength,
  );
}

function secret() {
  const configured = process.env.COOKIE_SIGNING_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("Demo access is not configured.");
  }
  return localSigningSecret;
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function accessProtectionEnabled() {
  return (
    process.env.NODE_ENV === "production" ||
    Boolean(process.env.DEMO_ACCESS_CODE)
  );
}

export function verifyAccessCode(candidate: string) {
  if (!demoAccessConfigurationAvailable()) return false;
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
  if (!demoAccessConfigurationAvailable()) {
    throw new Error("Demo access is not configured.");
  }
  const payload = Buffer.from(
    JSON.stringify({
      sessionId: randomBytes(18).toString("base64url"),
      expiresAt: Date.now() + 12 * 60 * 60 * 1_000,
    }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function verifiedAccessTokenPayload(token: string | undefined) {
  if (!demoAccessConfigurationAvailable() || !token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expectedSignature = sign(payload);
  const supplied = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    return null;
  }
  try {
    const value = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { sessionId?: string; expiresAt?: number };
    if (
      typeof value.sessionId !== "string" ||
      value.sessionId.length === 0 ||
      typeof value.expiresAt !== "number" ||
      value.expiresAt <= Date.now()
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export function verifyAccessToken(token: string | undefined) {
  if (!accessProtectionEnabled()) return true;
  return verifiedAccessTokenPayload(token) !== null;
}

export function verifiedAccessSessionId(token: string | undefined) {
  return verifiedAccessTokenPayload(token)?.sessionId ?? null;
}

function accessTokenFromRequest(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  return cookieHeader
    .split(";")
    .map((value) => value.trim().split("="))
    .find(([name]) => name === accessCookieName)?.[1];
}

export async function hasServerAccess() {
  if (!accessProtectionEnabled()) return true;
  const cookieStore = await cookies();
  return verifyAccessToken(cookieStore.get(accessCookieName)?.value);
}

export function requestHasAccess(request: Request) {
  if (!accessProtectionEnabled()) return true;
  return verifyAccessToken(accessTokenFromRequest(request));
}

export function verifiedAccessSessionIdFromRequest(request: Request) {
  return verifiedAccessSessionId(accessTokenFromRequest(request));
}
