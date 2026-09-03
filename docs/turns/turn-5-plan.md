# Turn 5 — Secure USDA Food Addition Through Main Coach Chat

Status: implemented locally; final verification and credentialed Render staging are required before merge.

## Intent and rationale

Replace the unreliable Fuder HTML search with the official English USDA FoodData Central API. Keep the capability agentic but bounded: the model translates and normalizes a food request, while application code owns the source request, candidate validation, nutrient extraction, approval, persistence, and plan continuation.

The feature belongs inside the main coach conversation. It accepts Hebrew or English, supports basic foods only, and never allows the model to browse, select silently, parse nutrition values, or write state.

## Implementation contract

1. The model receives one strict `search_usda_foods` tool with `normalizedEnglishQuery` and `cooked | raw | packaged` preparation.
2. The server searches the central catalog first, then calls USDA with Foundation and SR Legacy filters and a five-result limit.
3. The server stores each returned `fdcId`; the browser selects only an application candidate UUID.
4. The selected USDA detail is parsed by nutrient IDs 1008, 1003, 1005, 1004, and 1079. Missing fiber remains `null`; missing required macros reject the record.
5. The model returns only closed category and `neutral | meat | dairy` classification for the selected title.
6. Explicit approval transactionally creates or reuses the central record and adds it to the requesting profile. Rejection continues the conversation.
7. An AI estimate is offered only after a source failure and an explicit user action; its provenance remains permanently unverified.
8. Historical Fuder catalog records remain readable, but no new Fuder lookup is possible.

## Merge-readiness contract

Before merge, record evidence for functional completeness, specification-derived verification, engineering hygiene, rationale, and auditability. Run the secret scan, dependency review, `npm audit`, prompt/SQL/XSS injection tests, complete verification registry, and credentialed Render smoke test. No model or source output may bypass validation or approval.
