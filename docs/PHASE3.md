# Phase 3 — versioned investigation and guided assistant

Current investigations use the ten-rule engine, version **3.2**. Historical five-rule results use the **0.1** evaluator. Stored snapshots record the version that produced them.

## Rules and essential evidence

| Rule | Checks                                                                                                     | Role in recommendation                                                                         |
| ---- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| R01  | Asserted serial/model, readable invoice/device OCR, registry identity and category                         | Essential; clear mismatch escalates; ambiguous OCR stays UNKNOWN                               |
| R02  | Applicable verified company policy, purchase-date provenance and calendar expiry                           | Essential; independently anchored expiry can recommend rejection                               |
| R03  | Extracted seller against configured company seller records                                                 | Missing list is UNKNOWN/INFO; actual unauthorized mismatch is MAJOR                            |
| R04  | Active photo verification against the selected catalog device                                              | Essential. MATCH passes, INVALID_DEVICE fails, and UNVERIFIED or a missing result gives UNKNOWN. |
| R05  | Explicit no-cracks/dents assertion against visible extracted cracks/dents                                  | Conditional MAJOR contradiction; ambiguous language is UNKNOWN                                 |
| R06  | Visible external liquid-contact/tamper indicators only                                                     | Conditional MAJOR flag; no invisible damage or intent inferred                                 |
| R07  | Repeated serial/invoice identifiers across different customers in the company dataset                      | MAJOR reviewer-verification flag; private linked-case details                                  |
| R08  | Exact SHA-256 image reuse across different customers                                                       | MAJOR review flag; same-customer reuploads ignored; no fraud conclusion                        |
| R09  | Own previous submitted claims                                                                              | INFO only; explicitly excluded from verdict calculations                                       |
| R10  | Declared or independently recorded unauthorized repairs, and recorded repairs contradicting declared count | MAJOR clarification flag; missing records never prove a repair occurred                        |

Essential rules are R01, R02 and R04. Automatic approval also requires readable invoice proof and an exact device match. R04 uses the verification for the current photo, with a matching image hash and catalog ID. Its result supplies the retake or corrective instruction. Each rule includes its ID, version, status, severity, reason and evidence or company record references.

Identity comparison normalizes case, spaces and hyphens. R01 also treats verified model names and their catalog aliases as the same model. Serial discrepancies remain visible in R01 and the original OCR remains available in the ledger.

## Exact precedence

1. ESCALATE for an active INVALID_DEVICE verification.
2. NEEDS_EVIDENCE for an active UNVERIFIED verification.
3. REJECT_RECOMMENDED for R02 expiry with an independently confirmed purchase date and no other material contradiction.
4. ESCALATE for essential failures, R02 failure without an independent anchor, or applicable MAJOR/CRITICAL contradiction failures.
5. NEEDS_EVIDENCE for unknown essential checks or unreadable or missing essential evidence.
6. AUTO_APPROVE when the device matches, essential checks and evidence pass, a registry anchor exists, an applicable verified policy exists, and the requested amount is within that policy's configured threshold and currency.
7. ESCALATE for all remaining cases.

All outcomes remain advisory, including AUTO_APPROVE. Only reviewers update human claim status with a written reason. R09 never changes a recommendation. Purchase-date disagreements are material contradictions and prevent an anchored-expiry shortcut. Equally applicable policies or normalized registry entries that disagree are not selected arbitrarily; eligibility/anchoring remains unresolved.

No real threshold is invented. Policies default to no automatic-approval threshold. Amounts are stored as integer minor units; the customer UI collects INR rupees and converts to paise. Current currency support is INR. The threshold applies to the requested claim amount, not an AI-inferred invoice total. Missing/over-limit amounts require human review.

## Company configuration

No real seller list, policy, service history or diagnostic data was supplied. Unconfigured checks remain UNKNOWN. Company references can be entered only by an authenticated reviewer with an audit reason, or a trusted local operator:

```powershell
npm run company:import -- C:/absolute/path/company-records.json
```

The JSON envelope is `{ "reason": "documented authorization basis", "records": [...] }`. Every record requires a source and may include synthetic (default false). Synthetic source descriptions must start SYNTHETIC. Record types and fields are validated in backend/src/services/company.js:

- policy: product, months (1–120), auto_approve_limit_minor (integer or null), currency INR; optional effective_from/effective_to ISO dates.
- registry: serial, product, purchase_date, service_count; optional model/seller_name. Real and synthetic records cannot overwrite one another.
- seller: seller_name and authorized boolean.
- service: serial, service_date, authorized boolean/null, summary.
- diagnostic: serial and allowlisted facts (unauthorized_repair, requires_technician, inspection_completed, summary).

These records are VERIFIED because an authorized company actor explicitly supplies/confirms them; the application does not independently authenticate an external supplier. Operator integrity is a deployment prerequisite. Policy applicability is by category, environment and purchase-date effective range, preferring the latest effective start; conflicting equal-priority policies remain unresolved. Re-run an investigation after changing references to save a new snapshot. No Open Repair Alliance aggregate record is used as individual claim history.

## Reconciliation, ledger and persistence

The shared service reads only the current claim's uploads/assertions and permitted company references. It validates stored AI observations again, preserves ASSERTED/EXTRACTED/VERIFIED tiers, identifies supporting checks, contradictions and missing evidence, and returns the three highest-priority useful requests. Internal failures can request technician inspection unless a verified completed inspection is available.

Each run saves a new UUID, engine and rule versions, timestamp, recommendation, rule results, evidence requests, and an immutable input snapshot. Startup and database initialization append a current result for open claims and drafts evaluated by an older engine. Finalized cases retain their historical recommendation and reviewer decision.

The ledger displays actual backend values, upload IDs, source/trust, rules, company references, supporting/contradictory checks, timestamps and requests. Customers never receive other customers' linked claim/evidence identifiers. Reviewers alone receive private linkage and internal notes. Addresses, phone numbers and repair-shop associations are not used as risk signals or verdict inputs.

## Guided assistant

Frontend route: **/customer/chat**. Its eleven server-owned states are GREETING → PRODUCT_SELECTION → PRODUCT_DETAILS → PURCHASE_DETAILS → ISSUE_DESCRIPTION → INVOICE_UPLOAD → PHOTO_UPLOAD → EVIDENCE_CHECK → CLAIM_CONFIRMATION → CLAIM_SUBMISSION → STATUS_DISPLAY.

Sessions and messages are persisted in SQLite. Each transition validates only the expected structured fields; arbitrary messages cannot set state, role, rules or policies. The assistant is intentionally a structured conversation, not a free-form language-model agent. With Claude unavailable it is explicitly LIMITED MODE. With Vision configured it remains a structured assistant and uses the existing image-analysis API only on request; conversation turns incur no extra Claude calls.

After issue details, the assistant prepares one **private draft** using the same claim service. Uploads go through the existing secure API and may use the same Vision adapter and budget. Drafts are absent from normal dashboards/reviewer queues, and reviewers cannot access another user's unsubmitted draft. EVIDENCE_CHECK calls the same investigation service as the normal form. Confirmation and a separate Submit action publish that draft to the reviewer queue. The server returns its actual persisted UUID. No chatbot-only verification engine exists.

Request UUIDs and optimistic revisions prevent repeated/concurrent transitions or duplicate submissions. Standard form submissions use a user-scoped Idempotency-Key; reuse with altered content returns 409. Assistant sessions are limited to 20 per user, 200 messages each, and 60 write interactions per account per 15 minutes. Existing upload, image, authentication, request and AI-budget limits remain.

## API additions

All paths start /api. Existing health/auth/claim/evidence/reviewer endpoints remain.

| Method | Path                                     | Access/purpose                                                               |
| ------ | ---------------------------------------- | ---------------------------------------------------------------------------- |
| GET    | /claims/:id/investigations               | Owner/reviewer; snapshot summaries                                           |
| GET    | /claims/:id/ledger?investigation_id=UUID | Owner/reviewer; selected snapshot; foreign snapshot IDs return 404           |
| POST   | /claims/:id/investigate                  | Owner/reviewer, open claim; append a run, empty JSON body                    |
| POST   | /reviewer/claims/:id/notes               | Reviewer; note of 10–3000 chars; customer sees only a generic audit event    |
| POST   | /reviewer/company-records                | Reviewer; `{record,reason}` with strict record schema                        |
| GET    | /chat/sessions                           | Customer; own session summaries                                              |
| POST   | /chat/sessions                           | Customer; create, empty JSON body                                            |
| GET    | /chat/sessions/:sessionId                | Customer session owner only                                                  |
| POST   | /chat/sessions/:sessionId/messages       | Customer owner; `{requestId,revision,input}`; state-specific validated input |

All writes require the existing security header and allowed Origin when supplied. Authentication comes only from the verified server session. Claim details now include versioned explanations and richer rules. Reviewer queue shows automated recommendation and human status separately. Reference-record edits and every reviewer decision/note are audited. No credentials are exposed.

## Run

```powershell
npm ci
# Create .env from .env.example only if needed; preserve existing configuration.
npm run db:init
npm run seed
npm run dev
```

Open http://127.0.0.1:5173/customer/chat after customer sign-in. Reviewer sign-in remains /reviewer/login; provision accounts using REVIEWER_EMAIL/REVIEWER_PASSWORD and npm run reviewer:create. Tests: npm test. Build: npm run build. Built API/frontend: npm start with the documented same-origin FRONTEND_ORIGIN configuration. Claude setup is unchanged: server-only ANTHROPIC_API_KEY, CLAUDE_MODEL and AI_DAILY_BUDGET_CALLS.

## Security and remaining boundaries

This is a single-company foundation; all authorized reviewers share that company dataset and reference-configuration capability. Production needs organization scoping and a dedicated administrative role if those privileges must differ. Company provenance is manually supplied, not cryptographically attested. Text/date/category normalization and contradiction recognition are deliberately conservative, not general-purpose natural-language understanding. Diagnostic records are supplied company records, not a live hardware integration.

Existing limitations remain: no antivirus, at-rest database encryption, distributed worker or production deployment certification. Evidence/corrections are append-oriented; ordinary customers cannot silently replace original assertions or extracted observations. Live Claude accuracy remains unverified without a key. Browser-level end-to-end interaction was not completed in this phase; actual HTTP workflows and automated integration tests were executed. Judge Challenge Mode and Decision Twin are not implemented.

Company reference facts are associated by serial within the single company dataset. Before using personal service information in production, add company entitlement/serial-ownership checks and restrict reference summaries to claimant-appropriate content.
