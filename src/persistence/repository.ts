import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { foodCatalog } from "@/data/food-catalog";
import {
  createExistingDemoState,
  createNewDemoState,
} from "@/data/demo-fixtures";
import type { CatalogFood } from "@/domain/catalog/types";
import type { DemoProfileId } from "@/domain/profile/types";
import type { DemoState } from "@/store/demo-reducer";
import {
  existingStateSchema,
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
}

declare global {
  var nutritionCoachMemoryStore: MemoryStore | undefined;
}

function initialMemoryStore(): MemoryStore {
  const catalog = new Map(
    foodCatalog.map((food) => [
      food.id,
      { ...food, kosherReview: "reviewed" } as CatalogFood,
    ]),
  );
  return {
    profiles: new Map([
      ["new", { profileId: "new", version: 1, state: createNewDemoState() }],
      [
        "existing",
        {
          profileId: "existing",
          version: 1,
          state: createExistingDemoState(),
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
  };
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
    : existingStateSchema.parse(state);
}

export class StaleProfileError extends Error {
  constructor(public readonly current: VersionedProfile) {
    super("The demo changed in another browser.");
  }
}

export async function getProfile<T extends PersistedDemoState>(
  profileId: DemoProfileId,
): Promise<VersionedProfile<T>> {
  if (!hasPostgresConfiguration()) {
    const profile = memoryStore().profiles.get(profileId);
    if (!profile) throw new Error("Unknown demo profile.");
    return {
      ...clone(profile),
      state: validateProfileState(profileId, profile.state),
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
    state: validateProfileState(row.profile_id, row.state),
  } as VersionedProfile<T>;
}

async function mutatePostgresProfile<T extends PersistedDemoState>(
  client: PoolClient,
  profileId: DemoProfileId,
  expectedVersion: number,
  commandId: string,
  mutation: (state: T) => T,
) {
  const duplicate = await client.query<{ response: VersionedProfile<T> }>(
    "SELECT response FROM demo_commands WHERE profile_id = $1 AND command_id = $2",
    [profileId, commandId],
  );
  if (duplicate.rows[0]) return duplicate.rows[0].response;
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
    });
  }
  const response: VersionedProfile<T> = {
    profileId,
    version: row.version + 1,
    state: validateProfileState(profileId, mutation(clone(row.state))) as T,
  };
  await client.query(
    "UPDATE demo_profiles SET version = $2, state = $3::jsonb, updated_at = now() WHERE profile_id = $1",
    [profileId, response.version, JSON.stringify(response.state)],
  );
  await client.query(
    "INSERT INTO demo_commands (profile_id, command_id, response) VALUES ($1, $2, $3::jsonb)",
    [profileId, commandId, JSON.stringify(response)],
  );
  return response;
}

export async function mutateProfile<T extends PersistedDemoState>(input: {
  profileId: DemoProfileId;
  expectedVersion: number;
  commandId: string;
  mutation: (state: T) => T;
}): Promise<VersionedProfile<T>> {
  if (!hasPostgresConfiguration()) {
    const store = memoryStore();
    const key = `${input.profileId}:${input.commandId}`;
    const duplicate = store.commands.get(key);
    if (duplicate) return clone(duplicate) as VersionedProfile<T>;
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
    };
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
    for (const [key, turn] of store.agentTurns) {
      if (turn.profileId === input.profileId) store.agentTurns.delete(key);
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
      await client.query("DELETE FROM agent_turns WHERE profile_id = $1", [
        input.profileId,
      ]);
      await client.query(
        "DELETE FROM food_lookups WHERE profile_id = $1 AND status <> 'approved'",
        [input.profileId],
      );
    });
  }
  return profile;
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

export async function createLookup(input: Omit<StoredLookup, "id">) {
  const lookup = { ...input, id: randomUUID() };
  if (!hasPostgresConfiguration()) {
    memoryStore().lookups.set(lookup.id, clone(lookup));
    return lookup;
  }
  await ensurePersistenceInitialized();
  await getPool().query(
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
  return lookup;
}

export async function updateLookup(
  id: string,
  patch: Pick<StoredLookup, "status" | "failureCode">,
) {
  if (!hasPostgresConfiguration()) {
    const current = memoryStore().lookups.get(id);
    if (!current) throw new Error("Unknown food lookup.");
    const updated = { ...current, ...patch };
    memoryStore().lookups.set(id, updated);
    return updated;
  }
  const result = await getPool().query<{ id: string }>(
    `UPDATE food_lookups SET status = $2, failure_code = $3, updated_at = now()
     WHERE id = $1 RETURNING id`,
    [id, patch.status, patch.failureCode],
  );
  if (!result.rows[0]) throw new Error("Unknown food lookup.");
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

export async function saveCandidates(candidates: StoredCandidate[]) {
  if (!hasPostgresConfiguration()) {
    for (const candidate of candidates) {
      memoryStore().candidates.set(candidate.id, clone(candidate));
    }
    return;
  }
  await withTransaction(async (client) => {
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

export async function replaceCandidate(candidate: StoredCandidate) {
  if (!hasPostgresConfiguration()) {
    memoryStore().candidates.set(candidate.id, clone(candidate));
    return;
  }
  await getPool().query(
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
}

export class ActiveAgentTurnError extends Error {
  constructor(public readonly commandId: string) {
    super("Another coach turn is still processing for this shared profile.");
    this.name = "ActiveAgentTurnError";
  }
}

function agentTurnKey(profileId: DemoProfileId, commandId: string) {
  return `${profileId}:${commandId}`;
}

export async function reserveAgentTurn(input: {
  profileId: DemoProfileId;
  expectedVersion: number;
  commandId: string;
  request: Record<string, unknown>;
}): Promise<{ outcome: "reserved" | "duplicate"; turn: StoredAgentTurn }> {
  const now = new Date();
  const staleBefore = now.getTime() - 90_000;
  if (!hasPostgresConfiguration()) {
    const store = memoryStore();
    const key = agentTurnKey(input.profileId, input.commandId);
    const duplicate = store.agentTurns.get(key);
    if (duplicate) return { outcome: "duplicate", turn: clone(duplicate) };
    const current = store.profiles.get(input.profileId);
    if (!current) throw new Error("Unknown demo profile.");
    if (current.version !== input.expectedVersion) {
      throw new StaleProfileError(clone(current));
    }
    for (const [turnKey, turn] of store.agentTurns) {
      if (turn.profileId !== input.profileId || turn.status !== "pending") {
        continue;
      }
      if (new Date(turn.updatedAt).getTime() > staleBefore) {
        throw new ActiveAgentTurnError(turn.commandId);
      }
      store.agentTurns.set(turnKey, {
        ...turn,
        status: "failed",
        failureCode: "stale_pending_turn",
        updatedAt: now.toISOString(),
      });
    }
    const turn: StoredAgentTurn = {
      ...input,
      status: "pending",
      result: null,
      failureCode: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    store.agentTurns.set(key, clone(turn));
    return { outcome: "reserved", turn };
  }
  await ensurePersistenceInitialized();
  return withTransaction(async (client) => {
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
    }>("SELECT * FROM agent_turns WHERE profile_id = $1 AND command_id = $2", [
      input.profileId,
      input.commandId,
    ]);
    if (duplicate.rows[0]) {
      const row = duplicate.rows[0];
      return {
        outcome: "duplicate" as const,
        turn: {
          profileId: row.profile_id,
          commandId: row.command_id,
          expectedVersion: row.expected_version,
          request: row.request,
          status: row.status,
          result: row.result,
          failureCode: row.failure_code,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
        },
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
      });
    }
    await client.query(
      `UPDATE agent_turns
       SET status = 'failed', failure_code = 'stale_pending_turn', updated_at = now()
       WHERE profile_id = $1 AND status = 'pending' AND updated_at <= now() - interval '90 seconds'`,
      [input.profileId],
    );
    const active = await client.query<{ command_id: string }>(
      "SELECT command_id FROM agent_turns WHERE profile_id = $1 AND status = 'pending' LIMIT 1",
      [input.profileId],
    );
    if (active.rows[0]) {
      throw new ActiveAgentTurnError(active.rows[0].command_id);
    }
    const inserted = await client.query<{
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO agent_turns
         (profile_id, command_id, expected_version, request, status)
       VALUES ($1, $2, $3, $4::jsonb, 'pending')
       RETURNING created_at, updated_at`,
      [
        input.profileId,
        input.commandId,
        input.expectedVersion,
        JSON.stringify(input.request),
      ],
    );
    return {
      outcome: "reserved" as const,
      turn: {
        ...input,
        status: "pending",
        result: null,
        failureCode: null,
        createdAt: inserted.rows[0].created_at.toISOString(),
        updatedAt: inserted.rows[0].updated_at.toISOString(),
      },
    };
  });
}

export async function finishAgentTurn(input: {
  profileId: DemoProfileId;
  commandId: string;
  status: "completed" | "failed";
  result?: Record<string, unknown>;
  failureCode?: string;
}) {
  const key = agentTurnKey(input.profileId, input.commandId);
  if (!hasPostgresConfiguration()) {
    const store = memoryStore();
    const turn = store.agentTurns.get(key);
    if (!turn) throw new Error("Unknown agent turn.");
    store.agentTurns.set(key, {
      ...turn,
      status: input.status,
      result: input.result ? clone(input.result) : null,
      failureCode: input.failureCode ?? null,
      updatedAt: new Date().toISOString(),
    });
    return;
  }
  await getPool().query(
    `UPDATE agent_turns
     SET status = $3, result = $4::jsonb, failure_code = $5, updated_at = now()
     WHERE profile_id = $1 AND command_id = $2`,
    [
      input.profileId,
      input.commandId,
      input.status,
      JSON.stringify(input.result ?? null),
      input.failureCode ?? null,
    ],
  );
}

export async function recordAndCheckAgentRateLimit(input: {
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
      (event) => event.action === "agent_turn",
    );
    const hourly = events.filter(
      (event) =>
        event.createdAt > now - 60 * 60 * 1_000 &&
        (event.sessionHash === input.sessionHash ||
          event.ipHash === input.ipHash),
    ).length;
    if (hourly >= 30 || events.length >= 100) return false;
    store.rateEvents.push({ ...input, action: "agent_turn", createdAt: now });
    return true;
  }
  await ensurePersistenceInitialized();
  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(740031)");
    const counts = await client.query<{ hourly: string; daily: string }>(
      `SELECT
         count(*) FILTER (WHERE created_at > now() - interval '1 hour' AND (session_hash = $1 OR ip_hash = $2)) AS hourly,
         count(*) FILTER (WHERE created_at > now() - interval '1 day') AS daily
       FROM rate_limit_events
       WHERE action = 'agent_turn' AND created_at > now() - interval '1 day'`,
      [input.sessionHash, input.ipHash],
    );
    if (
      Number(counts.rows[0]?.hourly ?? 0) >= 30 ||
      Number(counts.rows[0]?.daily ?? 0) >= 100
    ) {
      return false;
    }
    await client.query(
      "INSERT INTO rate_limit_events (session_hash, ip_hash, action) VALUES ($1, $2, 'agent_turn')",
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
      mutation: (state) => addToState(state, food.id),
    });
    store.catalog.set(food.id, clone(food));
    store.catalogSourceIds.set(input.sourceIdentifier, food.id);
    return { food, profile };
  }

  await ensurePersistenceInitialized();
  return withTransaction(async (client) => {
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
}) {
  const food = (await listCatalogFoods()).find(
    (candidate) => candidate.id === input.foodId,
  );
  if (!food) throw new Error("The catalog food no longer exists.");
  const profile = await mutateProfile({
    profileId: input.profileId,
    expectedVersion: input.expectedVersion,
    commandId: input.commandId,
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
