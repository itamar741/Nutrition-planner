# Coach topic-boundary verification

Verified on 2026-09-14.

## Implemented behavior

- The fixed Arnold prompt defines nutrition planning, food choices, basic meal preparation and cooking, weight tracking, and high-level non-medical fitness information as supported topics.
- An unsupported programming, technical-support, or unrelated request receives one brief redirect in the language of the latest user message, without a partial answer or skill call.
- General fitness responses remain informational and do not create personalized workout programs, track exercise, diagnose conditions, or change protected nutrition state.
- This is best-effort model behavior. Strict skill schemas and deterministic server-owned state transitions remain the enforceable security boundary.

## Evidence

- Prompt-contract and coach-turn regression tests pass, including the representative request `write a for loop that counts from 1 to 10` and unchanged protected-state assertions.
- The credentialed live smoke test passed one English programming redirect, one Hebrew technical redirect, and one supported general-fitness response. No secret values were logged or stored.
- Full deterministic verification passed: formatting, lint, type checking, 220 unit/API tests, the project security scan, and a production build.
- Browser verification passed: 23 Playwright tests.

The credentialed live smoke test is optional and is not part of deterministic acceptance because model output can vary. It supplements rather than replaces the prompt-contract and unchanged-state tests.
