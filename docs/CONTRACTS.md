# API contracts

All paths have /api prefix. Errors: `{error:{code,message,details?}}`. HTTP 400 validation, 401 missing authentication, 403 role/origin violation, 404 missing or inaccessible claim, 409 duplicate email or finalized claim. Every write requires `X-ClaimShield: 1`; browser Origin must match FRONTEND_ORIGIN. Server sessions determine identity and role.

| Method/path                          | Access                     | Contract                                                                        |
| ------------------------------------ | -------------------------- | ------------------------------------------------------------------------------- |
| GET /health                          | public                     | SQLite health and truthful AI status                                            |
| POST /auth/register                  | public                     | name/email/password → customer + session                                        |
| POST /auth/login                     | public                     | email/password → user + session                                                 |
| GET /auth/me                         | authenticated              | public user fields                                                              |
| POST /auth/logout                    | authenticated              | revoke current session                                                          |
| POST /claims                         | customer                   | catalog_id/serial/purchase_date/incident_date/statement/previous_repairs → UUID id |
| GET /claims                          | authenticated              | owned claims                                                                    |
| GET /claims/:id                      | owner/reviewer             | claim, investigation, evidence metadata, activity, AI status                    |
| POST /claims/:id/evidence            | owner/reviewer, open claim | multipart kind/file → UUID; refresh rules                                       |
| GET /claims/:id/evidence/:evidenceId | owner/reviewer             | private attachment download                                                     |
| GET /reviewer/claims                 | reviewer                   | queue and dataset provenance                                                    |
| PATCH /reviewer/claims/:id           | reviewer                   | status/reason → audited update                                                  |

New claims require a canonical device ID from `backend/src/catalog.js`. The server derives `product` (category) and `model` from the selected device. If the request includes either field, its value must match the catalog exactly. Existing claims without a catalog ID return `catalog_id: null` and retain their stored category and model. Use valid ISO calendar dates and an incident date on or after purchase and no later than today. Serial is 3–100 chars, statement is 20–5000 chars, and repairs is an integer from 0 to 100. Extra fields are rejected. Password is 12–128 chars. Reviewer reason is 10–1500 chars.

Evidence kinds: invoice/photo/service_record/warranty; PNG/JPEG/WebP plus legacy manual-review PDF up to 5 MB, photo must be image. Private storage keys never returned. Synthetic downloads explicitly identify their fixture nature.

Claim status starts SUBMITTED. Reviewers may select UNDER_REVIEW, NEEDS_EVIDENCE, APPROVED, REJECTED. APPROVED/REJECTED are terminal. Rules never finalize status. Reviewer reasons are visible to customers.

Investigation results: ruleId, status (PASS/FAIL/UNKNOWN), explanation, evidenceIds. Outcomes are advisory. Synthetic flags must match before verified registry/policy data counts. Policy match is by product/environment. Only synthetic policies/registries are seeded; real claims require manual verification.

Provenance retains URL, attribution, license, status, record count, SHA-256, import time and error. repair_context has no claimant/serial relationship.

Phase 2 adds analysis, annotation and reviewer-verification endpoints, processing states and trust tiers. See PHASE2.md for their contracts. Up to six images per claim; images must fully decode within 20 MP and 8,192 px per side. Metadata-free copies are sent to AI. Filesystem keys, server model and budget configuration remain private.

## Phase 3 current additions

See PHASE3.md for versioned R01–R10, exact recommendation priority, company records, ledger privacy and assistant state/input contracts. New routes: GET /claims/:id/investigations; GET /claims/:id/ledger; POST /claims/:id/investigate; POST /reviewer/claims/:id/notes; POST /reviewer/company-records; GET/POST /chat/sessions; GET /chat/sessions/:sessionId; POST /chat/sessions/:sessionId/messages (all /api-prefixed).

Claim requests also accept claim_value_minor (integer/null), currency INR, and optional declared_no_visible_damage / declared_unauthorized_repairs booleans/null. Purchase date may be UNKNOWN. The UI collects requested INR rupees and storage/API use paise. Normal submissions support a user-scoped Idempotency-Key UUID. The assistant's PRODUCT_SELECTION accepts `{brand}`. PRODUCT_DETAILS accepts `{catalog_id, serial}` and requires the ID to belong to the selected brand. Chat submission uses request UUIDs and optimistic revisions, requires confirmation, and publishes one private draft. Reviewers cannot view unsubmitted customer drafts. Rule results now include ruleVersion, severity, essential, reason and recordIds. Historical snapshots keep their original version.

## Six-device photo verification

`GET /claims/:id/evidence/:evidenceId/analysis` includes `device_verification` for a catalog claim after a photo analysis attempt produces a result. It contains the selected model, readable observed model and brand, evidence basis, status, reason, next action, prompt version, and timestamp. The provider model stays private.

`MATCH` requires a clear factory label or About screen physically linked to the pictured device and identifying the selected model. `INVALID_DEVICE` indicates clear contradictory device evidence or an unrelated subject. `UNVERIFIED` covers unreadable or unlinked identifiers, same-model serial conflicts, packaging, and analysis failures. These results are advisory. Earlier photo analysis remains readable, and a new photo can be analyzed for device verification. A retry can supersede the active result for an evidence upload while retaining its history.

Engine 3.2 reads the verification for the claim’s current photo and checks its image hash and the current catalog ID. A mismatch recommends `ESCALATE`. An unresolved result recommends `NEEDS_EVIDENCE`. A match meets the device requirement for `AUTO_APPROVE` when the other approval conditions also pass.

Each claim has one active device photo. On upgrade, the most recently uploaded photo becomes current. To replace it, the claim owner submits a photo to `POST /claims/:id/evidence` with the active photo ID in the multipart `replaces` field. The upload starts analysis when capacity is available. The six-image limit applies to active uploads. An exact retry returns the same active replacement. Reviewers can see superseded photo verifications and their source files in the ledger. Changing the selected catalog ID retires prior verification results for that claim.
