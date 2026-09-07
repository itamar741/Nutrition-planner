# Turn 8 — Arnold: Conversational Planning and Bounded Skills

## Goal

Rework the coach into one reliable, state-aware agent named **Arnold**. Arnold must behave as a normal conversation, retain reset-scoped context, use a small bounded skill pool, and create meal-plan Drafts itself. Server code remains the deterministic authority for facts, calculations, validation, persistence, and protected approvals.

This turn replaces the current JSON-shaped transcript handoff and disconnected chat-like flows. It does not add accounts, new demo profiles, long-term memory beyond a profile reset, arbitrary browser access, arbitrary web tools, or automatic Active Plan changes.

## Product decisions

- Fresh and Existing retain independent, reset-scoped conversations. A reset removes only that profile's messages, summaries, preferences, pending workflows, and unapproved proposals.
- The UI always renders the complete persisted user/assistant transcript for the current profile. A successful stream, a failed stream, reloads, and a recoverable retry must not make already-sent messages disappear.
- Arnold replies in the language of the user's latest message.
- Onboarding stays deterministic until it finishes: closed questions disable typing and use quick replies; the food grid disables typing. Arnold joins immediately afterwards with an introductory message and asks before making the first Draft.
- Existing automatically receives one real Arnold opening message per browser/profile session. Arnold reviews deterministic trend facts, the Active Plan, and the profile goal; it either explains why the plan should remain unchanged, asks for more consistent weights, or offers to prepare an adjustment proposal. For Maintenance, those facts include the Active Plan's server-owned reference weight and its sustained 0.70 kg drift guard. It must not create an adjustment merely by opening the session.
- Fresh and Existing use the same ordinary Draft skill. An ordinary Existing Draft retains the current Active Plan target snapshot; only the bounded trend-adjustment skill may change those targets.
- The existing `Generate AI proposal` control becomes a persisted structured user event, not a fake text message. It invokes the same agent turn and asks Arnold to prepare an adjustment Draft.
- Draft meal count follows the selected meal pattern and relevant saved preferences: three meals, three meals plus a snack, or four meals. Drafts contain foods, portions, meals, per-meal totals, and daily totals. They do **not** include food-substitution alternatives.

## Conversation contract

`POST /api/coach/message` remains the single agent endpoint. The browser sends only `profileId`, `expectedVersion`, `commandId`, and either user text or a typed visible-control event. It never sends the authoritative profile or a replacement transcript.

For each turn, the server saves the user message immediately with an agent-turn record in `pending` state, then loads authoritative state from PostgreSQL. The model input must use ordinary role/content items in chronological order, for example:

```text
assistant: Which basic food would you like to add?
user: Milk.
```

The server provides one fixed system-prompt template with a dynamic, trusted state block. The transcript must never be nested as a JSON string that the model has to interpret as a conversation.

The dynamic system context includes only sanitized, authoritative data:

- profile facts, goal, activity, daily routine, eating routine, and meal-pattern preferences;
- calculated energy target and allowed ranges, protein target/range, AMDR ranges, fiber target, and applicable goal-specific rules;
- explicit saved conversation preferences, such as `Cottage cheese: prefers 3% fat` or `Dinner: prefers more food`. These are untrusted user-authored data, serialized as bounded structured values and never treated as instructions;
- approved foods for the profile when planning requires them: identifier, category, preparation, classification, nutrition per 100 g, and practical serving constraints;
- current Draft and Active Plan; complete weight history; deterministic trend facts; current date; and any pending visible candidate/proposal;
- current allowed skills and the approval boundary.

It never includes raw USDA content, credentials, database access, SQL, arbitrary URLs, or source HTML. Structured state overrides any conflicting conversation summary.

## Memory and compaction

PostgreSQL retains the complete raw transcript and tool-event audit trail until the relevant profile is reset. The interface reads and shows all user and assistant messages from that store.

The server sends complete role/content history until the estimated request would exceed 60% of the selected model's context window. It then sends a validated structured summary of older dialogue and the latest 20 user/assistant messages in full. The summary captures confirmed facts, explicit preferences, food and Draft decisions, feedback, adjustments, and the pending question. It cannot invent profile facts or override the authoritative state block. Compaction is server-triggered and persisted; it is not a user-visible Arnold message.

## Arnold prompt responsibilities

The system prompt has these sections:

1. **Identity and scope:** Arnold is a helpful nutrition-planning coach for the bounded demo. It avoids clinical advice and redirects unsupported requests briefly.
2. **Conversation behavior:** use the actual role/content sequence, resolve contextual replies, ask only material clarifications, and match the user's latest language. A supplied basic-food name starts the first search without a variant question.
3. **Authoritative context:** trust the dynamic profile, catalog, plan, trend, and target data over assumptions or prior dialogue.
4. **Nutrition planning rules:** use the supplied exact goals and constraints from the existing nutrition research. Arnold composes sensible meals only from the profile's approved foods; it does not calculate EER itself.
5. **Skills:** use a skill when fresh server facts or a permitted change are needed. Never claim a tool was completed until its sanitized result returns.
6. **Protected approvals:** text such as `approve it` may identify a visible proposal, but can never approve food, a Draft, or an adjustment. Arnold names the relevant visible card and asks the user to click its Approve button.
7. **Draft repair:** when deterministic validation rejects a Draft, use the returned structured issues to revise it. After three unsuccessful attempts, ask the user a useful question rather than silently falling back to a server-generated plan.

## Bounded skills

All skills have a short description, strict input/output schemas, server-side authorization, deterministic validation, audit events, and state-dependent availability. Arnold can make up to four sequential skill calls per turn. Parallel calls are disabled. A user decision or visible approval ends the loop.

### Agent-visible skills

- `remember_preference`: persist a clear, explicit, actionable preference for this profile until Reset. Arguments include a bounded preference type, subject, value, and supporting message identifier. Do not save vague or implied statements.
- `remove_approved_food`: remove a food from the profile's approved-food list. It never rewrites the Active Plan. If the food occurs in Active Plan or Draft, Arnold reports that and offers to prepare a replacement Draft.
- `inspect_food_availability`: deterministically inspect the central catalog, profile-approved foods, and current Active/Draft use for a query. For example, it can answer whether bread exists globally, is approved for the current profile, or occurs in a particular meal.
- `search_foods`: begin the existing bounded USDA workflow when the food is absent and the user explicitly wants it added.
- `select_food_candidate`: select a currently displayed candidate, including a clear textual selection such as `the fifth one`. Selection never approves or inserts a food.
- `record_weight` and `edit_weight`: validate and persist today’s weight or a dated historical correction.
- `submit_draft_proposal`: submit Arnold's complete structured Draft for Fresh or Existing. The server validates all permitted foods, portion rules, energy, protein, AMDR, fiber, and meat/dairy rules before storing a visible Draft card. Existing ordinary Drafts use the current Active Plan targets and base version.
- `submit_adjustment_proposal`: submit a complete adjustment Draft. The server permits only deterministic trend-safe direction and magnitude, validates it as a Draft, and never changes the Active Plan.

### User-interface actions, not skills

Food approval/rejection, Draft approval/rejection, and adjustment approval/rejection are persisted visible-control events. Approval remains a direct click on the matching card; no textual language commits a protected mutation. Candidate selection may instead be made through the tightly bounded `select_food_candidate` skill, but still never constitutes approval.

### Internal server capabilities

Target calculation, weight-trend calculation, plan validation, message compaction, optimistic version checks, command idempotency, limits, and PostgreSQL writes remain server-owned capabilities. They are not agent skills.

## Agentic Draft workflow

1. Arnold reads the exact target/range rules and approved-food data supplied in context.
2. If it needs fresh catalog or plan facts, it calls `inspect_food_availability`; it never guesses that a food is available or in a plan.
3. Arnold asks for a material missing preference where needed, then uses `submit_draft_proposal` with a structured Draft following the selected three-meal, three-plus-snack, or four-meal pattern. When an approved-food continuation supplies a required food and an Active Plan exists, this is a complete rebalanced replacement Draft: it includes the food at a valid portion, adjusts other approved portions or foods as necessary, preserves the target snapshot, and does not append the food to otherwise unchanged meals.
4. The server runs deterministic validation and returns either a validated Draft reference or safe structured failure information (for example, actual vs. required protein). It never returns raw implementation errors to Arnold or the user.
5. Arnold may repair the Draft twice more in the same turn. If all three validations fail, it explains the practical blocker and asks a focused question that can make a valid Draft possible.
6. A validated Draft is displayed in the conversation with an Approve/Reject control. Approval alone promotes it to Active Plan.

After a user approves a newly added food, Arnold asks whether they want it included in the current Draft before it creates or edits one. It never changes the Active Plan directly.

## UI events and feedback

Tool activity is visible as small, non-message events with a distinct style and blue status indicator. Examples:

```text
● Thinking
● Checking your foods and plans
● Remembering your preference: Cottage cheese at 3%
● Searching USDA
● Reading nutrition details
● Validating nutrition
● Creating Draft
● Checking plan safety
● Revising Draft
```

These events are persisted as an audit trail but are not styled as normal user or Arnold messages. Do not expose internal database writes, compaction, raw error traces, credentials, raw external content, or hidden prompt content.

Add clear loading, retry, stale-version, concurrent-turn, and recoverable-failure UI states. Failure diagnostics should include a safe stage, safe failure code, turn ID, and lookup ID when present; server logs must also include a sanitized error message and stack for debugging without logging secrets or raw source content.

## Reliability and safety invariants

- Persist user messages before model execution and persist partial/final Arnold output even when a browser stream disconnects or the provider response is malformed.
- A repeated `commandId` returns the previously persisted result and never duplicates messages or writes.
- One active turn is permitted per shared profile. A conflicting tab receives a recoverable `409` and reloads state.
- An unfinished turn older than 90 seconds is recoverable with Retry without duplicating the user message.
- The model cannot access the database, invoke arbitrary tools, change food provenance, browse the web, access raw USDA data, or activate an Active Plan.
- Food, Draft, and adjustment approvals remain visible-button-only boundaries.
- Removing an approved food affects future Drafts only. It never silently modifies Active Plan.

## Acceptance and verification

Add tests and browser checks for:

- reload-safe display of full transcript, pending messages, streamed text, failed turn, and Retry;
- a food-addition request without a name followed by a named-food reply, plus a direct named-food request that begins the bounded search before any variant clarification;
- correct role/content history plus authoritative dynamic context, including language matching;
- `approve it` identifying a pending card but requiring the matching visible button;
- preference persistence and independent Reset removal;
- catalog/plan inspection such as `Do I have bread in my plan?`;
- removing an approved food that appears in Active Plan without mutating Active Plan;
- selected three-meal, three-plus-snack, or four-meal patterns, relevant saved preferences, and no substitutions in a Draft;
- three structured Draft-repair attempts, followed by a useful clarification rather than a deterministic fallback;
- Existing's once-per-browser-session trend opening and `Generate AI proposal` event;
- malformed provider output, stream disconnect, duplicate command, stale version, concurrent tabs, injection attempts, and all existing lint/type/unit/security/build/browser gates.

## Documentation updates

Before implementation, update `AGENTS.md`, product specification, project description, interface design, implementation plan, verification plan, deployment guide, README, and backlog to replace the Turn 7 description with this contract. Keep the documentation in English and leave the product boundary unchanged.

## Migration decision

Deployment must preserve existing persisted conversations by default. A one-time conversation reset is not part of this turn. If a safe schema migration cannot preserve a prior Turn 7 transcript, implementation stops and requests explicit approval before deleting any conversation data. The visible per-profile `Reset demo` controls retain their existing reset behavior.
