import type { CatalogFood } from "@/domain/catalog/types";
import type { ConversationActivity } from "@/domain/agent/types";
import type { DemoProfileId } from "@/domain/profile/types";
import type { DemoState } from "./demo-reducer";
import type { ExistingDemoState } from "./existing-demo-store";
import type {
  ExistingDemoCloudAction,
  NewDemoCloudAction,
} from "./cloud-action-schemas";

export type ClientDemoState = DemoState | ExistingDemoState;

export interface CloudProfile<T extends ClientDemoState = ClientDemoState> {
  profileId: DemoProfileId;
  version: number;
  state: T;
  activityEvents?: ConversationActivity[];
}

export class CloudStateError extends Error {
  constructor(
    message: string,
    public readonly current: CloudProfile | null = null,
  ) {
    super(message);
  }
}

async function parseResponse(response: Response) {
  const body = (await response.json().catch(() => null)) as {
    ok?: boolean;
    message?: string;
    profile?: CloudProfile;
    catalog?: CatalogFood[];
    agentRateLimit?: { limited: boolean; retryAfterSeconds: number };
  } | null;
  if (!response.ok || !body?.ok) {
    throw new CloudStateError(
      body?.message ?? "The cloud demo state is unavailable.",
      body?.profile ?? null,
    );
  }
  return body;
}

export async function loadCloudProfile<T extends ClientDemoState>(
  profileId: DemoProfileId,
) {
  const body = await parseResponse(
    await fetch(`/api/demo/state/${profileId}`, { cache: "no-store" }),
  );
  return {
    profile: body.profile as CloudProfile<T>,
    catalog: body.catalog ?? [],
    agentRateLimit: body.agentRateLimit ?? {
      limited: false,
      retryAfterSeconds: 0,
    },
  };
}

export async function sendCloudAction<T extends ClientDemoState>(input: {
  profileId: DemoProfileId;
  expectedVersion: number;
  commandId: string;
  action: NewDemoCloudAction | ExistingDemoCloudAction;
}) {
  const body = await parseResponse(
    await fetch(`/api/demo/state/${input.profileId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedVersion: input.expectedVersion,
        commandId: input.commandId,
        action: input.action,
      }),
    }),
  );
  return body.profile as CloudProfile<T>;
}

export async function resetCloudProfile<T extends ClientDemoState>(input: {
  profileId: DemoProfileId;
  expectedVersion: number;
  commandId: string;
}) {
  const body = await parseResponse(
    await fetch(`/api/demo/state/${input.profileId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedVersion: input.expectedVersion,
        commandId: input.commandId,
        action: "reset",
      }),
    }),
  );
  return body.profile as CloudProfile<T>;
}
