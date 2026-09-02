# Turn 5 Verification Result

Date: 2026-09-02

Status: local implementation and verification passed. Credentialed Render staging remains the final pre-merge acceptance gate.

## Scope under test

- Base commit: `fa0b8aa` (`turn-4-render-runtime-catalog`).
- Feature: replace the Fuder/ScrapingBee runtime source with USDA FoodData Central and move the runtime-food workflow into the main coach conversation.
- The final Turn 5 commit is created after this evidence file is updated.

## Automated evidence

- Formatting: passed.
- ESLint: passed.
- TypeScript typecheck: passed.
- Unit tests: passed, 13 files and 71 tests.
- Repository security scan: passed, 123 cached or untracked non-ignored files scanned.
- Production build: passed.
- Playwright browser verification: passed, 13 tests.
- Dependency audit: passed with zero vulnerabilities at the `high` threshold and zero reported vulnerabilities overall.

## USDA adapter evidence

- Search fixtures verify Foundation and SR Legacy filtering, source-order preservation, duplicate removal, and the five-candidate limit.
- Tool-input tests reject arbitrary URLs, source instructions, and extra arguments.
- Detail fixtures verify deterministic nutrient extraction by USDA nutrient ID, nullable fiber, unambiguous serving conversion, malformed required nutrients, and nutrition plausibility rejection.
- Query tests verify the cooked/raw/packaged state is added exactly once and the jasmine-rice demo alias maps to USDA's basic-food vocabulary.
- A low-volume live schema probe using USDA's public demonstration key confirmed the production search and detail response shapes for an SR Legacy cooked-rice record. No key value was stored in the repository or in this evidence.

## Product-flow evidence

- Browser tests cover opening the food tool from the main Fresh and Existing coach conversations.
- Candidate selection, deterministic detail loading, rejection, approval, and explicit AI-estimate fallback remain bounded server actions.
- A successful Fresh approval can resume plan creation with a new validated Draft; it never changes the Active Plan directly.
- An Existing approval adds the food to that profile without mutating its Active Plan.
- Lookup ownership is checked on candidate detail, rejection, estimate, and approval routes so one profile cannot act on the other profile's lookup.
- Existing reset-isolation and central-catalog persistence tests remain green.

## Security review

- The model has one closed function tool and cannot provide URLs, SQL, API configuration, database writes, or arbitrary tool names.
- USDA response parsing is deterministic and the raw response is not sent to the model or browser.
- Database mutations continue through parameterized repository commands and transactional state transitions.
- React renders source-derived strings as text; no raw HTML rendering was introduced.
- USDA and OpenAI secrets remain server-side environment variables.
- Lookup records preserve auditable request, candidate, provenance, and failure data without storing raw IP addresses.
- Manual review identified and fixed missing profile-ownership checks on candidate, rejection, and estimate operations, and expanded secret scanning to cover untracked files.

## Remaining staging gate

After setting `USDA_FDC_API_KEY` on Render and removing the obsolete ScrapingBee variable, run one deployed lookup each for cooked jasmine rice, tomato, and pasta. Record successful candidate selection and one approved detail card without copying any secret value into logs or screenshots.
