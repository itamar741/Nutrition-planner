export const AGENT_TURN_RATE_LIMIT = 30;
export const AGENT_RATE_LIMIT_WINDOW_SECONDS = 60;
export const AGENT_RATE_LIMIT_MESSAGE =
  "The AI conversation limit has been reached. It resets within 1 minute.";
export const LEGACY_AGENT_RATE_LIMIT_MESSAGE =
  "The AI conversation limit has been reached. Try again after the limit window resets.";

export function isAgentRateLimitMessage(message: string) {
  return (
    message === AGENT_RATE_LIMIT_MESSAGE ||
    message === LEGACY_AGENT_RATE_LIMIT_MESSAGE
  );
}
