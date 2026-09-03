# Turn 7 — Unified Agentic Conversation

## Goal

Replace visually connected but independent handlers with one state-aware, streaming conversation for both demo profiles. PostgreSQL is the conversation memory and structured profile state remains authoritative.

## Contract

- `POST /api/coach/message` accepts a profile identifier, expected version, idempotent command identifier, and either text or a typed visible-control action.
- The server loads the profile, targets, approved foods, Draft and Active Plan, complete weight history, deterministic trend, pending workflow, and reset-scoped transcript.
- The model receives only tools permitted for the current state. Tool arguments are validated again by the server and external results are sanitized before they return to the model.
- The interface streams assistant text and explicit Thinking, Searching USDA, and Validating states.
- Food, Draft, and adjustment approval requires the corresponding visible button. Typed approval never commits a protected change.

## Memory and reliability

The complete transcript and interactions persist in the profile aggregate until that profile is reset. Up to 50 messages and 30,000 characters are supplied directly; beyond the cap, a validated digest and the latest 20 messages are supplied while the complete transcript remains stored. Agent-turn records provide pending/completed/failed state, command idempotency, one active turn per profile, recovery after 90 seconds, and completion after a browser disconnect.

## Scope

The agent can save validated onboarding facts, record or edit weight, check the central catalog, search USDA, select a displayed candidate, request Draft creation or modification, and request a deterministic adjustment. It has no database, SQL, credential, arbitrary URL, browser, or unrestricted action tool.
