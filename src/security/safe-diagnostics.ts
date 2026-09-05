const DATABASE_URL = /\b(?:postgres|postgresql):\/\/[^\s)]+/gi;
const BEARER_TOKEN = /\bBearer\s+[^\s,;]+/gi;
const SECRET_ASSIGNMENT =
  /\b(password|secret|api[-_ ]?key|authorization)\s*[:=]\s*[^\s,;]+/gi;
const OPENAI_STYLE_KEY = /\bsk-[A-Za-z0-9_-]{12,}\b/g;

export function sanitizeDiagnosticText(value: string, maximum = 600) {
  return value
    .replace(DATABASE_URL, "[redacted-database-url]")
    .replace(BEARER_TOKEN, "Bearer [redacted]")
    .replace(SECRET_ASSIGNMENT, "$1=[redacted]")
    .replace(OPENAI_STYLE_KEY, "[redacted-api-key]")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[\r\n]+/g, " | ")
    .slice(0, maximum);
}
