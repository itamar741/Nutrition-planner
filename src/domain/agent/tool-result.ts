export const coachToolResultStatuses = [
  "completed",
  "blocked",
  "needs_user_action",
  "rejected",
] as const;

export type CoachToolResultStatus = (typeof coachToolResultStatuses)[number];

export type CoachToolResult = {
  status: CoachToolResultStatus;
  code: string;
  message: string;
} & Record<string, unknown>;

export function coachToolResult(
  status: CoachToolResultStatus,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): CoachToolResult {
  return { status, code, message, ...details };
}
