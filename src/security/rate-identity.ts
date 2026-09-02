import { createHmac } from "node:crypto";
import { sessionTokenFromRequest } from "./demo-access";

function hash(value: string) {
  return createHmac(
    "sha256",
    process.env.COOKIE_SIGNING_SECRET ?? "local-demo-cookie-secret",
  )
    .update(value)
    .digest("hex");
}

export function rateIdentity(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "local-demo-ip";
  return {
    sessionHash: hash(sessionTokenFromRequest(request)),
    ipHash: hash(ip),
  };
}
