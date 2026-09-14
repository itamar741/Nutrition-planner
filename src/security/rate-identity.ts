import { createHash } from "node:crypto";
import { verifiedAccessSessionIdFromRequest } from "./demo-access";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function rateIdentity(request: Request) {
  const sessionId = verifiedAccessSessionIdFromRequest(request);
  const trustedIdentity = sessionId
    ? `access-session:${sessionId}`
    : "anonymous-demo-access";
  const identityHash = hash(trustedIdentity);
  return {
    sessionHash: identityHash,
    ipHash: identityHash,
  };
}
