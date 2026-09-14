import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { foodCatalog } from "@/data/food-catalog";
import {
  createExistingDemoState,
  createNewDemoState,
} from "@/data/demo-fixtures";
import type { CatalogFood } from "@/domain/catalog/types";
import type { ConversationActivity } from "@/domain/agent/types";
import {
  AGENT_RATE_LIMIT_WINDOW_SECONDS,
  AGENT_TURN_RATE_LIMIT,
} from "@/domain/agent/rate-limit";
import type { DemoProfileId } from "@/domain/profile/types";
import type { DemoState } from "@/store/demo-reducer";
import {
  parseExistingState,
  type ExistingDemoState,
} from "@/store/existing-demo-store";
import { persistedStateSchema } from "@/store/local-demo-store";
import { getPool, hasPostgresConfiguration, withTransaction } from "./database";
import { ensurePersistenceInitialized } from "./migrations";

export type PersistedDemoState = DemoState | ExistingDemoState;

export interface VersionedProfile<
  T extends PersistedDemoState = PersistedDemoState,
> {
  profileId: DemoProfileId;
  version: number;
  state: T;
  activityEvents: ConversationActivity[];
}

interface MemoryStore {
  profiles: Map<DemoProfileId, VersionedProfile>;
  commands: Map<string, VersionedProfile>;
  catalog: Map<string, CatalogFood>;
  catalogSourceIds: Map<string, string>;
  lookups: Map<string, StoredLookup>;
  candidates: Map<string, StoredCandidate>;
  rateEvents: Array<{
    sessionHash: string;
    ipHash: string;
    action: string;
    createdAt: number;
  }>;
  agentTurns: Map<string, StoredAgentTurn>;
  conversationMessages: Map<DemoProfileId, StoredConversationMessage[]>;
  conversationActivities: Map<DemoProfileId, ConversationActivity[]>;
  conversationSummaries: Map<DemoProfileId, StoredConversationSummary>;
  agentSkillCalls: Map<string, StoredAgentSkillCall>;
}

export interface StoredConversationMessage {
  id: string;
  turnId: string | null;
  role: "assistant" | "user";
  content: string;
  status: "pending" | "partial" | "final" | "failed";
  createdAt: string;
  updatedAt: string;
}

export interface StoredConversationSummary {
  throughMessageId: string;
  digest: Record<string, unknown>;
}

export interface StoredAgentSkillCall {
  profileId: DemoProfileId;
  commandId: string;
  sequence: number;
  name: string;
  arguments: Record<string, unknown>;
  result: Record<string, unknown> | null;
  status: "pending" | "completed" | "rejected" | "failed";
}

export interface StoredLookup {
  id: string;
  profileId: DemoProfileId;
  query: string;
  context: Record<string, unknown>;
  status: "searching" | "ready" | "failed" | "approved" | "rejected";
  failureCode: string | null;
}

export interface StoredCandidate {
  id: string;
  lookupId: string;
  sourceUrl: string | null;
  sourceIdentifier: string;
  status: "summary" | "detailed" | "approved" | "rejected";
  data: Record<string, unknown>;
}

export interface StoredAgentTurn {
  profileId: DemoProfileId;
  commandId: string;
  expectedVersion: number;
  request: Record<string, unknown>;
  status: "pending" | "completed" | "failed";
  result: Record<string, unknown> | null;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
  attempt: number;
  leaseToken: string;
}

export interface AgentTurnLease {
  profileId: DemoProfileId;
  commandId: string;
  leaseToken: string;
}

declare global {
  var nutritionCoachMemoryStore: MemoryStore | undefined;
}

function initialMemoryStore(): MemoryStore {
  const newState = createNewDemoState();
  const existingState = createExistingDemoState();
  const catalog = new Map(
    foodCatalog.map((food) => [
      food.id,
      { ...food, kosherReview: "reviewed" } as CatalogFood,
    ]),
  );
  return {
    profiles: new Map([
      [
        "new",
        { profileId: "new", version: 1, state: newState, activityEvents: [] },
      ],
      [
        "existing",
        {
          profileId: "existing",
          version: 1,
          state: existingState,
          activityEvents: [],
        },
      ],
    ]),
    commands: new Map(),
    catalog,
    catalogSourceIds: new Map(
      [...catalog.values()].map((food) => [
        food.source.provider === "USDA FoodData Central"
          ? `usda:${food.source.fdcId}`
          : `foodsdictionary:${food.source.provider === "FoodsDictionary" ? food.source.url : food.id}`,
        food.id,
      ]),
    ),
    lookups: new Map(),
    candidates: new Map(),
    rateEvents: [],
    agentTurns: new Map(),
    conversationMessages: new Map([
      ["new", seedConversationMessages(newState.messages)],
      ["existing", seedConversationMessages(existingState.messages)],
    ]),
    conversationActivities: new Map([
      ["new", []],
      ["existing", []],
    ]),
    conversationSummaries: new Map(),
    agentSkillCalls: new Map(),
  };
}

function seedConversationMessages(
  messages: Array<{ id: string; role: "assistant" | "user"; text: string }>,
): StoredConversationMessage[] {
  const started = Date.now();
  return messages.map((message, index) => {
    const createdAt = new Date(started + index).toISOString();
    return {
      id: message.id,
      turnId: null,
      role: message.role,
      content: message.text,
      status: "final",
      createdAt,
      updatedAt: createdAt,
    };
  });
}

function memoryStore() {
  globalThis.nutritionCoachMemoryStore ??= initialMemoryStore();
  return globalThis.nutritionCoachMemoryStore;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function validateProfileState(
  profileId: DemoProfileId,
  state: unknown,
): PersistedDemoState {
  return profileId === "new"
    ? persistedStateSchema.parse(state)
    : parseExistingState(state);
}

export class StaleProfileError extends Error {
  constructor(public readonly current: VersionedProfile) {
    super("The demo changed in another browser.");
  }
}

function isSameAgentRequest(
  stored: Record<string, unknown>,
  incoming: Record<string, unknown>,
) {
  const withoutVersion = (request: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(request).filter(([key]) => key !== "expectedVersion"),
    );
  return (
    JSON.stringify(withoutVersion(stored)) ===
    JSON.stringify(withoutVersion(incoming))
  );
}

function withConversationProjection<T extends PersistedDemoState>(
  state: T,
  messages: StoredConversationMessage[],
): T {
  const visible = messages
    .filter((message) => message.content.length > 0)
    .map((message) => ({
      id: message.id,
      role: message.role,
      text: message.content,
    }));
  return { ...state, messages: visible };
}

async function postgresConversationMessages(profileId: DemoProfileId) {
  const result = await getPool().query<{
    id: string;
    turn_id: string | null;
    role: StoredConversationMessage["role"];
    content: string;
    status: StoredConversationMessage["status"];
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, turn_id, role, content, status, created_at, updated_at
     FROM conversation_messages WHERE profile_id = $1 ORDER BY sequence`,
    [profileId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    turnId: row.turn_id,
    role: row.role,
    content: row.content,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }));
}

export async function listConversationMessages(profileId: DemoProfileId) {
  if (!hasPostgresConfiguration()) {
    return clone(memoryStore().conversationMessages.get(profileId) ?? []);
  }
  await ensurePersistenceInitialized();
  return postgresConversationMessages(profileId);
}

export async function listConversationActivities(profileId: DemoProfileId) {
  if (!hasPostgresConfiguration()) {
    return clone(memoryStore().conversationActivities.get(profileId) ?? []);
  }
  await ensurePersistenceInitialized();
  const result = await getPool().query<{
    id: string;
    turn_id: string | null;
    kind: ConversationActivity["kind"];
    label: string;
    status: ConversationActivity["status"];
    created_at: Date;
  }>(
    `SELECT id, turn_id, kind, label, status, created_at
     FROM conversation_activity_events WHERE profile_id = $1 ORDER BY sequence`,
    [profileId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    turnId: row.turn_id,
    kind: row.kind,
    label: row.label,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  }));
}

export async function getProfile<T extends PersistedDemoState>(
  profileId: DemoProfileId,
): Promise<VersionedProfile<T>> {
  if (!hasPostgresConfiguration()) {
    const profile = memoryStore().profiles.get(profileId);
    if (!profile) throw new Error("Unknown demo profile.");
    const messages = await listConversationMessages(profileId);
    return {
      ...clone(profile),
      state: withConversationProjection(
        validateProfileState(profileId, profile.state) as T,
        messages,
      ),
      activityEvents: await listConversationActivities(profileId),
    } as VersionedProfile<T>;
  }
  await ensurePersistenceInitialized();
  const result = await getPool().query<{
    profile_id: DemoProfileId;
    version: number;
    state: T;
  }>(
    "SELECT profile_id, version, state FROM demo_profiles WHERE profile_id = $1",
    [profileId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Unknown demo profile.");
  return {
    profileId: row.profile_id,
    version: row.version,
    state: withConversationProjection(
      validateProfileState(row.profile_id, row.state) as T,
      await postgresConversationMessages(profileId),
    ),
    activityEvents: await listConversationActivities(profileId),
  } as VersionedProfile<T>;
}

async function mutatePostgresProfile<T extends PersistedDemoState>(
  client: PoolClient,
  profileId: DemoProfileId,
  expectedVersion: number,
  commandId: string,
  agentTurnLease: AgentTurnLease | undefined,
  mutation: (state: T) => T,
) {
  await lockPostgresProfileAgentState(client, profileId);
  if (agentTurnLease) {
    if (agentTurnLease.profileId !== profileId) {
      throw new AgentTurnLeaseLostError();
    }
    await touchPostgresAgentTurnLease(client, agentTurnLease);
  }
  const duplicate = await client.query<{ response: VersionedProfile<T> }>(
    "SELECT response FROM demo_commands WHERE profile_id = $1 AND command_id = $2",
    [profileId, commandId],
  );
  if (duplicate.rows[0]) {
    const response = duplicate.rows[0].response;
    return {
      ...response,
      state: withConversationProjection(
        validateProfileState(profileId, response.state) as T,
        await postgresConversationMessages(profileId),
      ),
      activityEvents: await postgresActivitiesWithClient(client, profileId),
    };
  }
  if (!agentTurnLease) {
    await expirePostgresAgentTurns(client, profileId);
    const active = await client.query<{ command_id: string }>(
      `SELECT command_id FROM agent_turns
       WHERE profile_id = $1 AND status = 'pending'
       LIMIT 1 FOR UPDATE`,
      [profileId],
    );
    if (active.rows[0]) {
      throw new ActiveAgentTurnError(active.rows[0].command_id);
    }
  }
  const locked = await client.query<{ version: number; state: T }>(
    "SELECT version, state FROM demo_profiles WHERE profile_id = $1 FOR UPDATE",
    [profileId],
  );
  const row = locked.rows[0];
  if (!row) throw new Error("Unknown demo profile.");
  if (row.version !== expectedVersion) {
    throw new StaleProfileError({
      profileId,
      version: row.version,
      state: row.state,
      activityEvents: await postgresActivitiesWithClient(client, profileId),
    });
  }
  const response: VersionedProfile<T> = {
    profileId,
    version: row.version + 1,
    state: validateProfileState(profileId, mutation(clone(row.state))) as T,
    activityEvents: [],
  };
  await client.query(
    "UPDATE demo_profiles SET version = $2, state = $3::jsonb, updated_at = now() WHERE profile_id = $1",
    [profileId, response.version, JSON.stringify(response.state)],
  );
  await client.query(
    "INSERT INTO demo_commands (profile_id, command_id, response) VALUES ($1, $2, $3::jsonb)",
    [profileId, commandId, JSON.stringify(response)],
  );
  await syncPostgresConversationMessages(client, profileId, response.state);
  response.activityEvents = await postgresActivitiesWithClient(
    client,
    profileId,
  );
  return response;
}

function stateMessages(state: PersistedDemoState) {
  return state.messages as Array<{
    id: string;
    role: "assistant" | "user";
    text: string;
  }>;
}

async function syncPostgresConversationMessages(
  client: PoolClient,
  profileId: DemoProfileId,
  state: PersistedDemoState,
) {
  for (const message of stateMessages(state)) {
    await client.query(
      `INSERT INTO conversation_messages
         (profile_id, id, turn_id, role, content, status)
       VALUES ($1, $2, NULL, $3, $4, 'final')
       ON CONFLICT (profile_id, id) DO UPDATE
       SET content = EXCLUDED.content, status = 'final', updated_at = now()`,
      [profileId, message.id, message.role, message.text],
    );
  }
}

async function postgresActivitiesWithClient(
  client: PoolClient,
  profileId: DemoProfileId,
) {
  const result = await client.query<{
    id: string;
    turn_id: string | null;
    kind: ConversationActivity["kind"];
    label: string;
    status: ConversationActivity["status"];
    created_at: Date;
  }>(
    `SELECT id, turn_id, kind, label, status, created_at
     FROM conversation_activity_events WHERE profile_id = $1 ORDER BY sequence`,
    [profileId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    turnId: row.turn_id,
    kind: row.kind,
    label: row.label,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  }));
}

function syncMemoryConversationMessages(
  profileId: DemoProfileId,
  state: PersistedDemoState,
) {
  const store = memoryStore();
  const current = store.conversationMessages.get(profileId) ?? [];
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of stateMessages(state)) {
    const previous = byId.get(message.id);
    const now = new Date().toISOString();
    byId.set(message.id, {
      id: message.id,
      turnId: previous?.turnId ?? null,
      role: message.role,
      content: message.text,
      status: "final",
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    });
  }
  store.conversationMessages.set(profileId, [...byId.values()]);
}

export async function mutateProfile<T extends PersistedDemoState>(input: {
  profileId: DemoProfileId;
  expectedVersion: number;
  commandId: string;
  agentTurnLease?: AgentTurnLease;
  mutation: (state: T) => T;
}): Promise<VersionedProfile<T>> {
  if (!hasPostgresConfiguration()) {
    const store = memoryStore();
    if (input.agentTurnLease) {
      if (input.agentTurnLease.profileId !== input.profileId) {
        throw new AgentTurnLeaseLostError();
      }
      touchMemoryAgentTurnLease(input.agentTurnLease);
    }
    const key = `${input.profileId}:${input.commandId}`;
    const duplicate = store.commands.get(key);
    if (duplicate) {
      return {
        ...clone(duplicate),
        state: withConversationProjection(
          validateProfileState(input.profileId, duplicate.state) as T,
          clone(store.conversationMessages.get(input.profileId) ?? []),
        ),
        activityEvents: clone(
          store.conversationActivities.get(input.profileId) ?? [],
        ),
      } as VersionedProfile<T>;
    }
    if (!input.agentTurnLease) {
      expireMemoryAgentTurns(input.profileId, Date.now() - 90_000);
      const active = [...store.agentTurns.values()].find(
        (turn) =>
          turn.profileId === input.profileId && turn.status === "pending",
      );
      if (active) throw new ActiveAgentTurnError(active.commandId);
    }
    const current = store.profiles.get(input.profileId);
    if (!current) throw new Error("Unknown demo profile.");
    if (current.version !== input.expectedVersion) {
      throw new StaleProfileError(clone(current));
    }
    const response: VersionedProfile<T> = {
      profileId: input.profileId,
      version: current.version + 1,
      state: validateProfileState(
        input.profileId,
        input.mutation(clone(current.state) as T),
      ) as T,
      activityEvents: clone(
        store.conversationActivities.get(input.profileId) ?? [],
      ),
    };
    syncMemoryConversationMessages(input.profileId, response.state);
    store.profiles.set(input.profileId, clone(response));
    store.commands.set(key, clone(response));
    return response;
  }
  await ensurePersistenceInitialized();
  return withTransaction((client) =>
    mutatePostgresProfile<T>(
      client,
      input.profileId,
      input.expectedVersion,
      input.commandId,
      input.agentTurnLease,
      input.mutation,
    ),
  );
}

export async function resetProfile(input: {
  profileId: DemoProfileId;
  expectedVersion: number;
  commandId: string;
}) {
  const profile = await mutateProfile({
    ...input,
    mutation: () =>
      input.profileId === "new"
        ? createNewDemoState()
        : createExistingDemoState(),
  });
  if (!hasPostgresConfiguration()) {
    const store = memoryStore();
    store.conversationMessages.set(
      input.profileId,
      seedConversationMessages(profile.state.messages),
    );
    store.conversationActivities.set(input.profileId, []);
    store.conversationSummaries.delete(input.profileId);
    for (const [key, turn] of store.agentTurns) {
      if (turn.profileId === input.profileId) {
        store.agentTurns.delete(key);
        for (const skillKey of store.agentSkillCalls.keys()) {
          if (skillKey.startsWith(`${input.profileId}:${turn.commandId}:`)) {
            store.agentSkillCalls.delete(skillKey);
          }
        }
      }
    }
    const lookupIds = [...store.lookups.values()]
      .filter(
        (lookup) =>
          lookup.profileId === input.profileId && lookup.status !== "approved",
      )
      .map((lookup) => lookup.id);
    for (const lookupId of lookupIds) {
      store.lookups.delete(lookupId);
      for (const [candidateId, candidate] of store.candidates) {
        if (candidate.lookupId === lookupId) {
          store.candidates.delete(candidateId);
        }
      }
    }
  } else {
    await withTransaction(async (client) => {
      await client.query(
        "DELETE FROM conversation_messages WHERE profile_id = $1",
        [input.profileId],
      );
      await client.query(
        "DELETE FROM conversation_activity_events WHERE profile_id = $1",
        [input.profileId],
      );
      await client.query(
        "DELETE FROM conversation_summaries WHERE profile_id = $1",
        [input.profileId],
      );
      await client.query("DELETE FROM agent_turns WHERE profile_id = $1", [
        input.profileId,
      ]);
      await client.query(
        "DELETE FROM food_lookups WHERE profile_id = $1 AND status <> 'approved'",
        [input.profileId],
      );
      await syncPostgresConversationMessages(
        client,
        input.profileId,
        profile.state,
      );
    });
  }
  return getProfile(input.profileId);
}

export async function listCatalogFoods(): Promise<CatalogFood[]> {
  if (!hasPostgresConfiguration()) {
    return [...memoryStore().catalog.values()].map(clone);
  }
  await ensurePersistenceInitialized();
  const result = await getPool().query<{ data: CatalogFood }>(
    "SELECT data FROM catalog_foods ORDER BY created_at, id",
  );
  return result.rows.map((row) => row.data);
}

export async function findCatalogFood(query: string) {
  const normalized = query.trim().toLocaleLowerCase("en-US");
  const foods = await listCatalogFoods();
  return (
    foods.find(
      (food) =>
        food.displayName.toLocaleLowerCase("en-US") === normalized ||
        `${food.displayName} ${food.preparation}`
          .toLocaleLowerCase("en-US")
          .includes(normalized),
    ) ?? null
  );
}

export async function createLookup(
  input: Omit<StoredLookup, "id">,
  lease?: AgentTurnLease,
) {
  const lookup = { ...input, id: randomUUID() };
  if (lease && lease.profileId !== input.profileId) {
    throw new AgentTurnLeaseLostError();
  }
  if (!hasPostgresConfiguration()) {
    if (lease) touchMemoryAgentTurnLease(lease);
    memoryStore().lookups.set(lookup.id, clone(lookup));
    return lookup;
  }
  await ensurePersistenceInitialized();
  await withTransaction(async (client) => {
    if (lease) await touchPostgresAgentTurnLease(client, lease);
    await client.query(
      `INSERT INTO food_lookups (id, profile_id, query, context, status, failure_code)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
      [
        lookup.id,
        lookup.profileId,
        lookup.query,
        JSON.stringify(lookup.context),
        lookup.status,
        lookup.failureCode,
      ],
    );
  });
  return lookup;
}

export async function updateLookup(
  id: string,
  patch: Pick<StoredLookup, "status" | "failureCode">,
  lease?: AgentTurnLease,
) {
  if (!hasPostgresConfiguration()) {
    if (lease) touchMemoryAgentTurnLease(lease);
    const current = memoryStore().lookups.get(id);
    if (!current) throw new Error("Unknown food lookup.");
    const updated = { ...current, ...patch };
    memoryStore().lookups.set(id, updated);
    return updated;
  }
  await withTransaction(async (client) => {
    if (lease) await touchPostgresAgentTurnLease(client, lease);
    const result = await client.query<{ id: string }>(
      `UPDATE food_lookups SET status = $2, failure_code = $3, updated_at = now()
       WHERE id = $1 RETURNING id`,
      [id, patch.status, patch.failureCode],
    );
    if (!result.rows[0]) throw new Error("Unknown food lookup.");
  });
}

export async function updateLookupContext(
  id: string,
  context: Record<string, unknown>,
) {
  if (!hasPostgresConfiguration()) {
    const current = memoryStore().lookups.get(id);
    if (!current) throw new Error("Unknown food lookup.");
    memoryStore().lookups.set(id, { ...current, context: clone(context) });
    return;
  }
  await getPool().query(
    "UPDATE food_lookups SET context = $2::jsonb, updated_at = now() WHERE id = $1",
    [id, JSON.stringify(context)],
  );
}

export async function getLookup(id: string): Promise<StoredLookup> {
  if (!hasPostgresConfiguration()) {
    const lookup = memoryStore().lookups.get(id);
    if (!lookup) throw new Error("Unknown food lookup.");
    return clone(lookup);
  }
  const result = await getPool().query<{
    id: string;
    profile_id: DemoProfileId;
    query: string;
    context: Record<string, unknown>;
    status: StoredLookup["status"];
    failure_code: string | null;
  }>(
    "SELECT id, profile_id, query, context, status, failure_code FROM food_lookups WHERE id = $1",
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Unknown food lookup.");
  return {
    id: row.id,
    profileId: row.profile_id,
    query: row.query,
    context: row.context,
    status: row.status,
    failureCode: row.failure_code,
  };
}

export async function saveCandidates(
  candidates: StoredCandidate[],
  lease?: AgentTurnLease,
) {
  if (!hasPostgresConfiguration()) {
    if (lease) touchMemoryAgentTurnLease(lease);
    for (const candidate of candidates) {
      memoryStore().candidates.set(candidate.id, clone(candidate));
    }
    return;
  }
  await withTransaction(async (client) => {
    if (lease) await touchPostgresAgentTurnLease(client, lease);
    for (const candidate of candidates) {
      await client.query(
        `INSERT INTO food_candidates (id, lookup_id, source_url, source_identifier, status, data)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (lookup_id, source_identifier) DO UPDATE SET data = EXCLUDED.data`,
        [
          candidate.id,
          candidate.lookupId,
          candidate.sourceUrl,
          candidate.sourceIdentifier,
          candidate.status,
          JSON.stringify(candidate.data),
        ],
      );
    }
  });
}

export async function getCandidate(id: string): Promise<StoredCandidate> {
  if (!hasPostgresConfiguration()) {
    const candidate = memoryStore().candidates.get(id);
    if (!candidate) throw new Error("Unknown food candidate.");
    return clone(candidate);
  }
  const result = await getPool().query<{
    id: string;
    lookup_id: string;
    source_url: string | null;
    source_identifier: string;
    status: StoredCandidate["status"];
    data: Record<string, unknown>;
  }>(
    "SELECT id, lookup_id, source_url, source_identifier, status, data FROM food_candidates WHERE id = $1",
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Unknown food candidate.");
  return {
    id: row.id,
    lookupId: row.lookup_id,
    sourceUrl: row.source_url,
    sourceIdentifier: row.source_identifier,
    status: row.status,
    data: row.data,
  };
}

export async function replaceCandidate(
  candidate: StoredCandidate,
  lease?: AgentTurnLease,
) {
  if (!hasPostgresConfiguration()) {
    if (lease) touchMemoryAgentTurnLease(lease);
    memoryStore().candidates.set(candidate.id, clone(candidate));
    return;
  }
  await withTransaction(async (client) => {
    if (lease) await touchPostgresAgentTurnLease(client, lease);
    await client.query(
      `UPDATE food_candidates SET source_url = $2, source_identifier = $3, status = $4, data = $5::jsonb
       WHERE id = $1`,
      [
        candidate.id,
        candidate.sourceUrl,
        candidate.sourceIdentifier,
        candidate.status,
        JSON.stringify(candidate.data),
      ],
    );
  });
}

export class ActiveAgentTurnError extends Error {
  constructor(public readonly commandId: string) {
    super("Another coach turn is still processing for this shared profile.");
    this.name = "ActiveAgentTurnError";
  }
}

export class AgentTurnReplayError extends Error {
  constructor() {
    super("A repeated command must use the original request.");
    this.name = "AgentTurnReplayError";
  }
}

export class AgentTurnLeaseLostError extends Error {
  constructor() {
    super("This coach turn no longer owns the active lease.");
    this.name = "AgentTurnLeaseLostError";
  }
}

export async function assertNoActiveAgentTurn(profileId: DemoProfileId) {
  const staleBefore = Date.now() - 90_000;
  if (!hasPostgresConfiguration()) {
    expireMemoryAgentTurns(profileId, staleBefore);
    const active = [...memoryStore().agentTurns.values()].find(
      (turn) => turn.profileId === profileId && turn.status === "pending",
    );
    if (active) throw new ActiveAgentTurnError(active.commandId);
    return;
  }
  await ensurePersistenceInitialized();
  await withTransaction(async (client) => {
    await lockPostgresProfileAgentState(client, profileId);
    await expirePostgresAgentTurns(client, profileId);
    const active = await client.query<{ command_id: string }>(
      `SELECT command_id FROM agent_turns
       WHERE profile_id = $1 AND status = 'pending'
       LIMIT 1`,
      [profileId],
    );
    if (active.rows[0]) {
      throw new ActiveAgentTurnError(active.rows[0].command_id);
    }
  });
}

function agentTurnKey(profileId: DemoProfileId, commandId: string) {
  return `${profileId}:${commandId}`;
}

function assertLeaseTarget(
  lease: AgentTurnLease,
  profileId: DemoProfileId,
  commandId: string,
) {
  if (lease.profileId !== profileId || lease.commandId !== commandId) {
    throw new AgentTurnLeaseLostError();
  }
}

function touchMemoryAgentTurnLease(lease: AgentTurnLease) {
  const key = agentTurnKey(lease.profileId, lease.commandId);
  const store = memoryStore();
  const turn = store.agentTurns.get(key);
  if (
    !turn ||
    turn.status !== "pending" ||
    turn.leaseToken !== lease.leaseToken
  ) {
    throw new AgentTurnLeaseLostError();
  }
  turn.updatedAt = new Date().toISOString();
}

function expireMemoryAgentTurns(profileId: DemoProfileId, staleBefore: number) {
  const store = memoryStore();
  const now = new Date().toISOString();
  for (const [key, turn] of store.agentTurns) {
    if (
      turn.profileId !== profileId ||
      turn.status !== "pending" ||
      new Date(turn.updatedAt).getTime() > staleBefore
    ) {
      continue;
    }
    store.agentTurns.set(key, {
      ...turn,
      status: "failed",
      failureCode: "stale_pending_turn",
      updatedAt: now,
    });
    markMemoryAssistantFailed(
      profileId,
      `assistant-${turn.commandId}-${turn.attempt}`,
      "Previous attempt expired safely.",
    );
  }
}

async function touchPostgresAgentTurnLease(
  client: PoolClient,
  lease: AgentTurnLease,
) {
  const result = await client.query(
    `UPDATE agent_turns
     SET updated_at = now()
     WHERE profile_id = $1 AND command_id = $2
       AND lease_token = $3 AND status = 'pending'`,
    [lease.profileId, lease.commandId, lease.leaseToken],
  );
  if (!result.rowCount) throw new AgentTurnLeaseLostError();
}

async function lockPostgresProfileAgentState(
  client: PoolClient,
  profileId: DemoProfileId,
) {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('nutrition-coach-agent:' || $1))",
    [profileId],
  );
}

async function expirePostgresAgentTurns(
  client: PoolClient,
  profileId: DemoProfileId,
) {
  const expired = await client.query<{ command_id: string; attempt: number }>(
    `UPDATE agent_turns
     SET status = 'failed', failure_code = 'stale_pending_turn',
         updated_at = now()
     WHERE profile_id = $1 AND status = 'pending'
       AND updated_at <= now() - interval '90 seconds'
     RETURNING command_id, attempt`,
    [profileId],
  );
  for (const turn of expired.rows) {
    await client.query(
      `UPDATE conversation_messages
       SET status = 'failed',
           content = CASE WHEN content = ''
             THEN 'Previous attempt expired safely.' ELSE content END,
           updated_at = now()
       WHERE profile_id = $1 AND id = $2
         AND status IN ('pending', 'partial')`,
      [profileId, `assistant-${turn.command_id}-${turn.attempt}`],
    );
  }
}

export async function renewAgentTurnLease(lease: AgentTurnLease) {
  if (!hasPostgresConfiguration()) {
    touchMemoryAgentTurnLease(lease);
    return;
  }
  await ensurePersistenceInitialized();
  await withTransaction((client) => touchPostgresAgentTurnLease(client, lease));
}

function insertMemoryAssistant(
  profileId: DemoProfileId,
  commandId: string,
  id: string,
) {
  const store = memoryStore();
  const messages = store.conversationMessages.get(profileId) ?? [];
  const now = new Date().toISOString();
  messages.push({
    id,
    turnId: commandId,
    role: "assistant",
    content: "",
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });
  store.conversationMessages.set(profileId, messages);
}

function markMemoryAssistantFailed(
  profileId: DemoProfileId,
  id: string,
  fallback: string,
) {
  const store = memoryStore();
  const messages = store.conversationMessages.get(profileId) ?? [];
  const message = messages.find((candidate) => candidate.id === id);
  if (!message) return;
  message.status = "failed";
  if (!message.content) message.content = fallback;
  message.updatedAt = new Date().toISOString();
}

function insertMemoryConversationStart(
  input: {
    profileId: DemoProfileId;
    commandId: string;
    userMessage?: { id: string; content: string };
    userAction?: { id: string; label: string };
  },
  createdAt: string,
) {
  const store = memoryStore();
  const messages = store.conversationMessages.get(input.profileId) ?? [];
  if (input.userMessage) {
    messages.push({
      id: input.userMessage.id,
      turnId: input.commandId,
      role: "user",
      content: input.userMessage.content,
      status: "final",
      createdAt,
      updatedAt: createdAt,
    });
  }
  store.conversationMessages.set(input.profileId, messages);
  if (input.userAction) {
    const activities = store.conversationActivities.get(input.profileId) ?? [];
    activities.push({
      id: input.userAction.id,
      turnId: input.commandId,
      kind: "user_action",
      label: input.userAction.label,
      status: "completed",
      createdAt,
    });
    store.conversationActivities.set(input.profileId, activities);
  }
  insertMemoryAssistant(
    input.profileId,
    input.commandId,
    `assistant-${input.commandId}-1`,
  );
}

async function insertPostgresConversationStart(
  client: PoolClient,
  input: {
    profileId: DemoProfileId;
    commandId: string;
    userMessage?: { id: string; content: string };
    userAction?: { id: string; label: string };
  },
  attempt: number,
) {
  if (input.userMessage) {
    await client.query(
      `INSERT INTO conversation_messages
         (profile_id, id, turn_id, role, content, status)
       VALUES ($1, $2, $3, 'user', $4, 'final')
       ON CONFLICT (profile_id, id) DO NOTHING`,
      [
        input.profileId,
        input.userMessage.id,
        input.commandId,
        input.userMessage.content,
      ],
    );
  }
  if (input.userAction) {
    await client.query(
      `INSERT INTO conversation_activity_events
         (profile_id, id, turn_id, kind, label, status)
       VALUES ($1, $2, $3, 'user_action', $4, 'completed')
       ON CONFLICT (profile_id, id) DO NOTHING`,
      [
        input.profileId,
        input.userAction.id,
        input.commandId,
        input.userAction.label,
      ],
    );
  }
  await client.query(
    `INSERT INTO conversation_messages
       (profile_id, id, turn_id, role, content, status)
     VALUES ($1, $2, $3, 'assistant', '', 'pending')
     ON CONFLICT (profile_id, id) DO NOTHING`,
    [
      input.profileId,
      `assistant-${input.commandId}-${attempt}`,
      input.commandId,
    ],
  );
}

export async function reserveAgentTurn(input: {
  profileId: DemoProfileId;
  expectedVersion: number;
  commandId: string;
  request: Record<string, unknown>;
  userMessage?: { id: string; content: string };
  userAction?: { id: string; label: string };
}): Promise<{
  outcome: "reserved" | "resumed" | "duplicate";
  turn: StoredAgentTurn;
  assistantMessageId: string;
}> {
  const now = new Date();
  const staleBefore = now.getTime() - 90_000;
  if (!hasPostgresConfiguration()) {
    const store = memoryStore();
    const key = agentTurnKey(input.profileId, input.commandId);
    const duplicate = store.agentTurns.get(key);
    if (duplicate) {
      if (!isSameAgentRequest(duplicate.request, input.request)) {
        throw new AgentTurnReplayError();
      }
      if (duplicate.status === "completed") {
        return {
          outcome: "duplicate",
          turn: clone(duplicate),
          assistantMessageId: `assistant-${input.commandId}-${duplicate.attempt}`,
        };
      }
      const stalePending =
        duplicate.status === "pending" &&
        new Date(duplicate.updatedAt).getTime() <= staleBefore;
      if (duplicate.status === "pending" && !stalePending) {
        return {
          outcome: "duplicate",
          turn: clone(duplicate),
          assistantMessageId: `assistant-${input.commandId}-${duplicate.attempt}`,
        };
      }
      const current = store.profiles.get(input.profileId);
      if (!current) throw new Error("Unknown demo profile.");
      if (current.version !== input.expectedVersion) {
        throw new StaleProfileError(clone(current));
      }
      markMemoryAssistantFailed(
        input.profileId,
        `assistant-${input.commandId}-${duplicate.attempt}`,
        duplicate.failureCode ?? "Previous attempt failed safely.",
      );
      const leaseToken = randomUUID();
      const resumed = {
        ...duplicate,
        expectedVersion: input.expectedVersion,
        status: "pending" as const,
        result: null,
        failureCode: null,
        attempt: duplicate.attempt + 1,
        leaseToken,
        updatedAt: now.toISOString(),
      };
      store.agentTurns.set(key, clone(resumed));
      const assistantMessageId = `assistant-${input.commandId}-${resumed.attempt}`;
      insertMemoryAssistant(
        input.profileId,
        input.commandId,
        assistantMessageId,
      );
      return {
        outcome: "resumed",
        turn: clone(resumed),
        assistantMessageId,
      };
    }
    const current = store.profiles.get(input.profileId);
    if (!current) throw new Error("Unknown demo profile.");
    if (current.version !== input.expectedVersion) {
      throw new StaleProfileError(clone(current));
    }
    expireMemoryAgentTurns(input.profileId, staleBefore);
    const active = [...store.agentTurns.values()].find(
      (turn) => turn.profileId === input.profileId && turn.status === "pending",
    );
    if (active) {
      throw new ActiveAgentTurnError(active.commandId);
    }
    const turn: StoredAgentTurn = {
      ...input,
      status: "pending",
      result: null,
      failureCode: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      attempt: 1,
      leaseToken: randomUUID(),
    };
    store.agentTurns.set(key, clone(turn));
    insertMemoryConversationStart(input, now.toISOString());
    return {
      outcome: "reserved",
      turn,
      assistantMessageId: `assistant-${input.commandId}-1`,
    };
  }
  await ensurePersistenceInitialized();
  return withTransaction(async (client) => {
    await lockPostgresProfileAgentState(client, input.profileId);
    const duplicate = await client.query<{
      profile_id: DemoProfileId;
      command_id: string;
      expected_version: number;
      request: Record<string, unknown>;
      status: StoredAgentTurn["status"];
      result: Record<string, unknown> | null;
      failure_code: string | null;
      created_at: Date;
      updated_at: Date;
      attempt: number;
      lease_token: string;
    }>(
      "SELECT * FROM agent_turns WHERE profile_id = $1 AND command_id = $2 FOR UPDATE",
      [input.profileId, input.commandId],
    );
    if (duplicate.rows[0]) {
      const row = duplicate.rows[0];
      if (!isSameAgentRequest(row.request, input.request)) {
        throw new AgentTurnReplayError();
      }
      const storedTurn: StoredAgentTurn = {
        profileId: row.profile_id,
        commandId: row.command_id,
        expectedVersion: row.expected_version,
        request: row.request,
        status: row.status,
        result: row.result,
        failureCode: row.failure_code,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        attempt: row.attempt,
        leaseToken: row.lease_token,
      };
      const stalePending =
        row.status === "pending" && row.updated_at.getTime() <= staleBefore;
      if (
        row.status === "completed" ||
        (row.status === "pending" && !stalePending)
      ) {
        return {
          outcome: "duplicate" as const,
          turn: storedTurn,
          assistantMessageId: `assistant-${input.commandId}-${row.attempt}`,
        };
      }
      const current = await client.query<{ version: number; state: unknown }>(
        "SELECT version, state FROM demo_profiles WHERE profile_id = $1 FOR UPDATE",
        [input.profileId],
      );
      const currentProfile = current.rows[0];
      if (!currentProfile) throw new Error("Unknown demo profile.");
      if (currentProfile.version !== input.expectedVersion) {
        throw new StaleProfileError({
          profileId: input.profileId,
          version: currentProfile.version,
          state: validateProfileState(input.profileId, currentProfile.state),
          activityEvents: await postgresActivitiesWithClient(
            client,
            input.profileId,
          ),
        });
      }
      await client.query(
        `UPDATE conversation_messages
         SET status = 'failed',
             content = CASE WHEN content = '' THEN 'Previous attempt failed safely.' ELSE content END,
             updated_at = now()
         WHERE profile_id = $1 AND id = $2`,
        [input.profileId, `assistant-${input.commandId}-${row.attempt}`],
      );
      const leaseToken = randomUUID();
      const resumed = await client.query<{
        attempt: number;
        updated_at: Date;
      }>(
        `UPDATE agent_turns
         SET expected_version = $3, status = 'pending', result = NULL,
             failure_code = NULL, attempt = attempt + 1, lease_token = $4,
             updated_at = now()
         WHERE profile_id = $1 AND command_id = $2
         RETURNING attempt, updated_at`,
        [input.profileId, input.commandId, input.expectedVersion, leaseToken],
      );
      const attempt = resumed.rows[0].attempt;
      await insertPostgresConversationStart(client, input, attempt);
      return {
        outcome: "resumed" as const,
        turn: {
          ...storedTurn,
          expectedVersion: input.expectedVersion,
          status: "pending",
          result: null,
          failureCode: null,
          updatedAt: resumed.rows[0].updated_at.toISOString(),
          attempt,
          leaseToken,
        },
        assistantMessageId: `assistant-${input.commandId}-${attempt}`,
      };
    }
    const locked = await client.query<{ version: number; state: unknown }>(
      "SELECT version, state FROM demo_profiles WHERE profile_id = $1 FOR UPDATE",
      [input.profileId],
    );
    const profile = locked.rows[0];
    if (!profile) throw new Error("Unknown demo profile.");
    if (profile.version !== input.expectedVersion) {
      throw new StaleProfileError({
        profileId: input.profileId,
        version: profile.version,
        state: validateProfileState(input.profileId, profile.state),
        activityEvents: await postgresActivitiesWithClient(
          client,
          input.profileId,
        ),
      });
    }
    await expirePostgresAgentTurns(client, input.profileId);
    const active = await client.query<{ command_id: string }>(
      "SELECT command_id FROM agent_turns WHERE profile_id = $1 AND status = 'pending' LIMIT 1",
      [input.profileId],
    );
    if (active.rows[0]) {
      throw new ActiveAgentTurnError(active.rows[0].command_id);
    }
    const leaseToken = randomUUID();
    const inserted = await client.query<{
      created_at: Date;
      updated_at: Date;
      attempt: number;
    }>(
      `INSERT INTO agent_turns
         (profile_id, command_id, expected_version, request, status, lease_token)
       VALUES ($1, $2, $3, $4::jsonb, 'pending', $5)
       RETURNING created_at, updated_at, attempt`,
      [
        input.profileId,
        input.commandId,
        input.expectedVersion,
        JSON.stringify(input.request),
        leaseToken,
      ],
    );
    await insertPostgresConversationStart(client, input, 1);
    return {
      outcome: "reserved" as const,
      turn: {
        ...input,
        status: "pending",
        result: null,
        failureCode: null,
        createdAt: inserted.rows[0].created_at.toISOString(),
        updatedAt: inserted.rows[0].updated_at.toISOString(),
        attempt: inserted.rows[0].attempt,
        leaseToken,
      },
      assistantMessageId: `assistant-${input.commandId}-1`,
    };
  });
}

export async function finishAgentTurn(input: {
  profileId: DemoProfileId;
  commandId: string;
  leaseToken: string;
  status: "completed" | "failed";
  result?: Record<string, unknown>;
  failureCode?: string;
}) {
  const key = agentTurnKey(input.profileId, input.commandId);
  if (!hasPostgresConfiguration()) {
    const store = memoryStore();
    const turn = store.agentTurns.get(key);
    if (!turn) throw new Error("Unknown agent turn.");
    if (turn.status !== "pending" || turn.leaseToken !== input.leaseToken) {
      throw new AgentTurnLeaseLostError();
    }
    store.agentTurns.set(key, {
      ...turn,
      status: input.status,
      result: input.result ? clone(input.result) : null,
      failureCode: input.failureCode ?? null,
      updatedAt: new Date().toISOString(),
    });
    return;
  }
  const result = await getPool().query(
    `UPDATE agent_turns
     SET status = $3, result = $4::jsonb, failure_code = $5, updated_at = now()
     WHERE profile_id = $1 AND command_id = $2
       AND lease_token = $6 AND status = 'pending'`,
    [
      input.profileId,
      input.commandId,
      input.status,
      JSON.stringify(input.result ?? null),
      input.failureCode ?? null,
      input.leaseToken,
    ],
  );
  if (!result.rowCount) throw new AgentTurnLeaseLostError();
}

export async function updateAssistantMessage(input: {
  profileId: DemoProfileId;
  messageId: string;
  lease: AgentTurnLease;
  content: string;
  status: "partial" | "final" | "failed";
}) {
  const content = input.content.slice(0, 4_000);
  if (input.lease.profileId !== input.profileId) {
    throw new AgentTurnLeaseLostError();
  }
  if (!hasPostgresConfiguration()) {
    touchMemoryAgentTurnLease(input.lease);
    const messages =
      memoryStore().conversationMessages.get(input.profileId) ?? [];
    const message = messages.find(
      (candidate) => candidate.id === input.messageId,
    );
    if (!message) throw new Error("Unknown assistant message.");
    if (message.turnId !== input.lease.commandId) {
      throw new AgentTurnLeaseLostError();
    }
    message.content = content;
    message.status = input.status;
    message.updatedAt = new Date().toISOString();
    return;
  }
  await ensurePersistenceInitialized();
  await withTransaction(async (client) => {
    await touchPostgresAgentTurnLease(client, input.lease);
    const result = await client.query(
      `UPDATE conversation_messages
       SET content = $3, status = $4, updated_at = now()
       WHERE profile_id = $1 AND id = $2 AND role = 'assistant'
         AND turn_id = $5`,
      [
        input.profileId,
        input.messageId,
        content,
        input.status,
        input.lease.commandId,
      ],
    );
    if (!result.rowCount) throw new Error("Unknown assistant message.");
  });
}

export async function appendConversationActivity(input: {
  profileId: DemoProfileId;
  id: string;
  turnId: string | null;
  kind: ConversationActivity["kind"];
  label: string;
  status?: ConversationActivity["status"];
  lease?: AgentTurnLease;
}) {
  if (input.lease) {
    assertLeaseTarget(
      input.lease,
      input.profileId,
      input.turnId ?? input.lease.commandId,
    );
  }
  const activity: ConversationActivity = {
    id: input.id,
    turnId: input.turnId,
    kind: input.kind,
    label: input.label.slice(0, 240),
    status: input.status ?? "completed",
    createdAt: new Date().toISOString(),
  };
  if (!hasPostgresConfiguration()) {
    if (input.lease) touchMemoryAgentTurnLease(input.lease);
    const store = memoryStore();
    const activities = store.conversationActivities.get(input.profileId) ?? [];
    const current = activities.find((item) => item.id === input.id);
    if (current) Object.assign(current, activity);
    else activities.push(activity);
    store.conversationActivities.set(input.profileId, activities);
    return clone(activity);
  }
  await ensurePersistenceInitialized();
  return withTransaction(async (client) => {
    if (input.lease) {
      await touchPostgresAgentTurnLease(client, input.lease);
    }
    const result = await client.query<{ created_at: Date }>(
      `INSERT INTO conversation_activity_events
         (profile_id, id, turn_id, kind, label, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (profile_id, id) DO UPDATE
       SET label = EXCLUDED.label, status = EXCLUDED.status, updated_at = now()
       RETURNING created_at`,
      [
        input.profileId,
        input.id,
        input.turnId,
        input.kind,
        activity.label,
        activity.status,
      ],
    );
    return { ...activity, createdAt: result.rows[0].created_at.toISOString() };
  });
}

export async function saveConversationSummary(input: {
  profileId: DemoProfileId;
  throughMessageId: string;
  digest: Record<string, unknown>;
  lease?: AgentTurnLease;
}) {
  if (!hasPostgresConfiguration()) {
    if (input.lease) {
      if (input.lease.profileId !== input.profileId) {
        throw new AgentTurnLeaseLostError();
      }
      touchMemoryAgentTurnLease(input.lease);
    }
    memoryStore().conversationSummaries.set(input.profileId, {
      throughMessageId: input.throughMessageId,
      digest: clone(input.digest),
    });
    return;
  }
  await ensurePersistenceInitialized();
  await withTransaction(async (client) => {
    if (input.lease) {
      if (input.lease.profileId !== input.profileId) {
        throw new AgentTurnLeaseLostError();
      }
      await touchPostgresAgentTurnLease(client, input.lease);
    }
    await client.query(
      `INSERT INTO conversation_summaries (profile_id, through_message_id, digest)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (profile_id) DO UPDATE
       SET through_message_id = EXCLUDED.through_message_id,
           digest = EXCLUDED.digest, updated_at = now()`,
      [input.profileId, input.throughMessageId, JSON.stringify(input.digest)],
    );
  });
}

export async function recordAgentSkillCall(
  input: StoredAgentSkillCall & { lease?: AgentTurnLease },
) {
  if (input.sequence < 1 || input.sequence > 4) {
    throw new Error("Agent skill sequence is out of bounds.");
  }
  const key = `${input.profileId}:${input.commandId}:${input.sequence}`;
  const stored: StoredAgentSkillCall = {
    profileId: input.profileId,
    commandId: input.commandId,
    sequence: input.sequence,
    name: input.name,
    arguments: input.arguments,
    result: input.result,
    status: input.status,
  };
  if (!hasPostgresConfiguration()) {
    if (input.lease) {
      assertLeaseTarget(input.lease, input.profileId, input.commandId);
      touchMemoryAgentTurnLease(input.lease);
    }
    memoryStore().agentSkillCalls.set(key, clone(stored));
    return;
  }
  await ensurePersistenceInitialized();
  await withTransaction(async (client) => {
    if (input.lease) {
      assertLeaseTarget(input.lease, input.profileId, input.commandId);
      await touchPostgresAgentTurnLease(client, input.lease);
    }
    await client.query(
      `INSERT INTO agent_skill_calls
         (profile_id, command_id, sequence, name, arguments, result, status)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
       ON CONFLICT (profile_id, command_id, sequence) DO UPDATE
       SET result = EXCLUDED.result, status = EXCLUDED.status, updated_at = now()`,
      [
        input.profileId,
        input.commandId,
        input.sequence,
        input.name,
        JSON.stringify(input.arguments),
        JSON.stringify(input.result),
        input.status,
      ],
    );
  });
}

export async function recordAndCheckAgentRateLimit(input: {
  sessionHash: string;
  ipHash: string;
}): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const now = Date.now();
  const windowMs = AGENT_RATE_LIMIT_WINDOW_SECONDS * 1_000;
  if (!hasPostgresConfiguration()) {
    const store = memoryStore();
    store.rateEvents = store.rateEvents.filter(
      (event) => event.createdAt > now - 24 * 60 * 60 * 1_000,
    );
    const recent = store.rateEvents.filter(
      (event) =>
        event.action === "agent_turn" &&
        event.createdAt > now - windowMs &&
        (event.sessionHash === input.sessionHash ||
          event.ipHash === input.ipHash),
    );
    if (recent.length >= AGENT_TURN_RATE_LIMIT) {
      const oldestEventAt = Math.min(...recent.map((event) => event.createdAt));
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((oldestEventAt + windowMs - now) / 1_000),
        ),
      };
    }
    store.rateEvents.push({ ...input, action: "agent_turn", createdAt: now });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  await ensurePersistenceInitialized();
  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(740031)");
    const counts = await client.query<{
      recent: string;
      retry_after_seconds: string | null;
    }>(
      `SELECT
         count(*) AS recent,
         ceil(extract(epoch FROM
           (min(created_at) + ($3 * interval '1 second') - now())
         )) AS retry_after_seconds
       FROM rate_limit_events
       WHERE action = 'agent_turn'
         AND created_at > now() - ($3 * interval '1 second')
         AND (session_hash = $1 OR ip_hash = $2)`,
      [input.sessionHash, input.ipHash, AGENT_RATE_LIMIT_WINDOW_SECONDS],
    );
    if (Number(counts.rows[0]?.recent ?? 0) >= AGENT_TURN_RATE_LIMIT) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Number(counts.rows[0]?.retry_after_seconds ?? 1),
        ),
      };
    }
    await client.query(
      "INSERT INTO rate_limit_events (session_hash, ip_hash, action) VALUES ($1, $2, 'agent_turn')",
      [input.sessionHash, input.ipHash],
    );
    return { allowed: true, retryAfterSeconds: 0 };
  });
}

export async function recordAndCheckDemoAccessRateLimit(input: {
  sessionHash: string;
  ipHash: string;
}) {
  const now = Date.now();
  const windowStart = now - 15 * 60 * 1_000;
  if (!hasPostgresConfiguration()) {
    const store = memoryStore();
    store.rateEvents = store.rateEvents.filter(
      (event) => event.createdAt > now - 24 * 60 * 60 * 1_000,
    );
    const attempts = store.rateEvents.filter(
      (event) =>
        event.action === "demo_access" &&
        event.createdAt > windowStart &&
        (event.sessionHash === input.sessionHash ||
          event.ipHash === input.ipHash),
    ).length;
    if (attempts >= 5) return false;
    store.rateEvents.push({ ...input, action: "demo_access", createdAt: now });
    return true;
  }
  await ensurePersistenceInitialized();
  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(740032)");
    const counts = await client.query<{ attempts: string }>(
      `SELECT count(*) AS attempts
       FROM rate_limit_events
       WHERE action = 'demo_access'
         AND created_at > now() - interval '15 minutes'
         AND (session_hash = $1 OR ip_hash = $2)`,
      [input.sessionHash, input.ipHash],
    );
    if (Number(counts.rows[0]?.attempts ?? 0) >= 5) return false;
    await client.query(
      "INSERT INTO rate_limit_events (session_hash, ip_hash, action) VALUES ($1, $2, 'demo_access')",
      [input.sessionHash, input.ipHash],
    );
    return true;
  });
}

export async function recordAndCheckRateLimit(input: {
  sessionHash: string;
  ipHash: string;
}) {
  const now = Date.now();
  if (!hasPostgresConfiguration()) {
    const store = memoryStore();
    store.rateEvents = store.rateEvents.filter(
      (event) => event.createdAt > now - 24 * 60 * 60 * 1_000,
    );
    const events = store.rateEvents.filter(
      (event) => event.action === "food_lookup",
    );
    const hourly = events.filter(
      (event) =>
        event.createdAt > now - 60 * 60 * 1_000 &&
        (event.sessionHash === input.sessionHash ||
          event.ipHash === input.ipHash),
    ).length;
    const daily = events.length;
    if (hourly >= 10 || daily >= 30) return false;
    store.rateEvents.push({ ...input, action: "food_lookup", createdAt: now });
    return true;
  }
  await ensurePersistenceInitialized();
  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(740030)");
    const counts = await client.query<{ hourly: string; daily: string }>(
      `SELECT
         count(*) FILTER (WHERE created_at > now() - interval '1 hour' AND (session_hash = $1 OR ip_hash = $2)) AS hourly,
         count(*) FILTER (WHERE created_at > now() - interval '1 day') AS daily
       FROM rate_limit_events
       WHERE action = 'food_lookup' AND created_at > now() - interval '1 day'`,
      [input.sessionHash, input.ipHash],
    );
    if (
      Number(counts.rows[0]?.hourly ?? 0) >= 10 ||
      Number(counts.rows[0]?.daily ?? 0) >= 30
    ) {
      return false;
    }
    await client.query(
      "INSERT INTO rate_limit_events (session_hash, ip_hash, action) VALUES ($1, $2, 'food_lookup')",
      [input.sessionHash, input.ipHash],
    );
    return true;
  });
}

export async function approveCatalogFood(input: {
  food: CatalogFood;
  sourceIdentifier: string;
  profileId: DemoProfileId;
  expectedVersion: number;
  commandId: string;
  agentTurnLease?: AgentTurnLease;
}) {
  const normalizedIdentity =
    `${input.food.displayName} ${input.food.preparation} ${input.food.brand ?? ""}`
      .trim()
      .toLocaleLowerCase("en-US");
  const addToState = (
    state: PersistedDemoState,
    approvedFoodId: string,
  ): PersistedDemoState => {
    if ("profile" in state) {
      return {
        ...state,
        profile: {
          ...state.profile,
          approvedCatalogFoodIds: [
            ...new Set([
              ...state.profile.approvedCatalogFoodIds,
              approvedFoodId,
            ]),
          ],
        },
      };
    }
    return {
      ...state,
      approvedCatalogFoodIds: [
        ...new Set([...state.approvedCatalogFoodIds, approvedFoodId]),
      ],
    };
  };

  if (!hasPostgresConfiguration()) {
    const store = memoryStore();
    const sourceDuplicateId = store.catalogSourceIds.get(
      input.sourceIdentifier,
    );
    const duplicate =
      (sourceDuplicateId ? store.catalog.get(sourceDuplicateId) : undefined) ??
      [...store.catalog.values()].find(
        (food) =>
          `${food.displayName} ${food.preparation} ${food.brand ?? ""}`
            .trim()
            .toLocaleLowerCase("en-US") === normalizedIdentity ||
          (food.source.provider === "Fuder" &&
            (food.source.url === input.sourceIdentifier ||
              `fuder:${food.source.url}` === input.sourceIdentifier)),
      );
    const food = duplicate ?? input.food;
    const profile = await mutateProfile({
      profileId: input.profileId,
      expectedVersion: input.expectedVersion,
      commandId: input.commandId,
      agentTurnLease: input.agentTurnLease,
      mutation: (state) => addToState(state, food.id),
    });
    store.catalog.set(food.id, clone(food));
    store.catalogSourceIds.set(input.sourceIdentifier, food.id);
    return { food, profile };
  }

  await ensurePersistenceInitialized();
  return withTransaction(async (client) => {
    await lockPostgresProfileAgentState(client, input.profileId);
    const existing = await client.query<{ data: CatalogFood }>(
      "SELECT data FROM catalog_foods WHERE normalized_identity = $1 OR source_identifier = $2 LIMIT 1",
      [normalizedIdentity, input.sourceIdentifier],
    );
    const food = existing.rows[0]?.data ?? input.food;
    if (!existing.rows[0]) {
      await client.query(
        `INSERT INTO catalog_foods (id, normalized_identity, source_identifier, data)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [
          food.id,
          normalizedIdentity,
          input.sourceIdentifier,
          JSON.stringify(food),
        ],
      );
    }
    const profile = await mutatePostgresProfile(
      client,
      input.profileId,
      input.expectedVersion,
      input.commandId,
      input.agentTurnLease,
      (state) => addToState(state, food.id),
    );
    await client.query(
      "UPDATE food_candidates SET status = 'approved' WHERE source_identifier = $1",
      [input.sourceIdentifier],
    );
    return { food, profile };
  });
}

export async function addExistingFoodToProfile(input: {
  foodId: string;
  profileId: DemoProfileId;
  expectedVersion: number;
  commandId: string;
  agentTurnLease?: AgentTurnLease;
}) {
  const food = (await listCatalogFoods()).find(
    (candidate) => candidate.id === input.foodId,
  );
  if (!food) throw new Error("The catalog food no longer exists.");
  const profile = await mutateProfile({
    profileId: input.profileId,
    expectedVersion: input.expectedVersion,
    commandId: input.commandId,
    agentTurnLease: input.agentTurnLease,
    mutation: (state) => {
      if ("profile" in state) {
        return {
          ...state,
          profile: {
            ...state.profile,
            approvedCatalogFoodIds: [
              ...new Set([...state.profile.approvedCatalogFoodIds, food.id]),
            ],
          },
        };
      }
      return {
        ...state,
        approvedCatalogFoodIds: [
          ...new Set([...state.approvedCatalogFoodIds, food.id]),
        ],
      };
    },
  });
  return { food, profile };
}

export function resetMemoryPersistenceForTests() {
  globalThis.nutritionCoachMemoryStore = initialMemoryStore();
}
