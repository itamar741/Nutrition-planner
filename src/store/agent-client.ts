import type {
  AgentStreamEvent,
  CoachMessageRequest,
} from "@/domain/agent/types";
import type {
  PersistedDemoState,
  VersionedProfile,
} from "@/persistence/repository";
import type { CatalogFood } from "@/domain/catalog/types";

export class AgentClientError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly current?: VersionedProfile,
    readonly diagnostics?: Record<string, string>,
  ) {
    super(message);
  }
}

export async function sendCoachMessage(input: {
  request: CoachMessageRequest;
  onStatus?: (
    value:
      | "thinking"
      | "searching"
      | "validating"
      | "checking_foods"
      | "remembering"
      | "creating_draft"
      | "revising_draft",
  ) => void;
  onText?: (value: string) => void;
}): Promise<{ profile: VersionedProfile; catalogFood?: CatalogFood }> {
  const response = await fetch("/api/coach/message", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(input.request),
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || contentType.includes("application/json")) {
    const body = (await response.json()) as {
      ok?: boolean;
      message?: string;
      code?: string;
      profile?: VersionedProfile;
      catalogFood?: CatalogFood;
    };
    if (response.ok && body.profile) {
      return { profile: body.profile, catalogFood: body.catalogFood };
    }
    throw new AgentClientError(
      body.message ?? "The coach request failed.",
      body.code,
      body.profile,
    );
  }
  if (!response.body)
    throw new AgentClientError("The coach stream was unavailable.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: { profile: VersionedProfile; catalogFood?: CatalogFood } | null =
    null;
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const line = block.split("\n").find((item) => item.startsWith("data: "));
      if (!line) continue;
      const event = JSON.parse(line.slice(6)) as AgentStreamEvent;
      if (event.type === "status") input.onStatus?.(event.value);
      if (event.type === "text_delta") input.onText?.(event.value);
      if (event.type === "state") {
        result = {
          profile: event.profile as VersionedProfile<PersistedDemoState>,
          ...(event.catalogFood ? { catalogFood: event.catalogFood } : {}),
        };
      }
      if (event.type === "error") {
        throw new AgentClientError(
          event.message,
          event.diagnostics?.failureCode,
          undefined,
          event.diagnostics,
        );
      }
    }
    if (done) break;
  }
  if (!result)
    throw new AgentClientError(
      "The coach response ended before state was saved.",
    );
  return result;
}
