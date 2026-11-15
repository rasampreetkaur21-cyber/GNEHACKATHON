# Guided warranty intake

This extends the existing ClaimShield application. It uses the existing supported catalog (Samsung Galaxy A26/A36/A56 and boAt Rockerz 450/550/650); unsupported appliance and laptop choices are not added.

## Implementation

- `shared/questionnaire.js`: product-specific issues, purposeful conditional questions, uncertainty choices, safe troubleshooting choices, summary generation, evidence suggestions and shared semantic validation.
- `frontend/src/components/ProblemQuestions.jsx`: shared accessible question controls used by the form and existing saved assistant conversations.
- `frontend/src/components/GuidedClaim.jsx`: four-step product/problem/evidence/review flow with company-first model filtering (Samsung or boAt), back navigation, unknown purchase/serial support, multiple symptoms, editable summary, explicit regeneration, optional evidence and upload recovery through the existing saved-claim page.
- `backend/src/services/questionnaire.js`: strict versioned Zod envelope plus shared validation. Rejects unsupported issues, unrelated detail keys, stale conditional answers and invalid exact dates.
- `claims.questionnaire_json`: nullable additive migration, run automatically on database open. Historical rows remain null. Full structured answers and the customer's edited statement are saved separately. Existing integer repair-count storage remains compatible; investigations use null rather than zero when a questionnaire reports an uncertain or uncounted repair history. A reported absence is represented as zero for comparison with independently recorded service history.
- Investigation facts explicitly label questionnaire answers as CUSTOMER / ASSERTED. The original evidence-driven rule outcomes and synthetic separation remain intact. Contradictory service history requests human clarification; it does not decide fraud or finalize the claim.
- The claim detail view exposes the structured assertions to customers and reviewers. Legacy forms, API clients, saved conversations, evidence analysis and reviewer workflows remain supported.

## Running

From the project root, with Node 22.12 or later:

```sh
npm ci
npm run dev
```

The app is at http://127.0.0.1:5173 and the API at http://127.0.0.1:3001. See the existing README for reviewer provisioning, company-record import and optional AI configuration. `npm run build` builds the frontend; `npm test` runs backend, API, rules, rendering and browser-like interaction coverage.

Ship the shared directory with the backend and frontend. No API key is needed for questionnaire summaries or normal submission. AI image analysis keeps the existing optional configuration and limited-mode behavior.

## Verification scope

New tests cover catalog-specific choices, conditional visibility, unknown answers, stale-answer rejection, factual summary generation, preserved summary edits, minimal-typing interaction journeys, product changes, persistence, legacy null records, missing-evidence review, independently recorded repair contradictions, and assistant persistence/submission without configured AI. Existing regression coverage continues to exercise evidence uploads, analysis, reviewer workflows, authorization and synthetic fixture outcomes.

A live browser journey submitted a local QA claim with an unreadable serial, unknown purchase/incident dates, uncertain repair history and no invoice. It saved successfully and returned NEEDS_EVIDENCE; R10 remained UNKNOWN. No external warranty verification or live AI-provider call was performed. Mobile styles are included; automated interaction coverage uses jsdom rather than a mobile browser/device lab.

## Deliberate compatibility behavior

A relative report such as “past 7 days” remains in structured answers and the summary. It is not converted to an invented exact incident date. Without an exact date (or an explicit Today answer), the existing incident-date column stores UNKNOWN and coverage remains uncertain. Edited statements are never silently regenerated. When answers change after editing, the review step asks the customer to check their preserved text. Changing product clears issue answers and selected evidence; changing evidence-relevant answers clears file selections so unrelated files are not submitted.

The existing assistant session steps and history remain available; its issue step reuses the same questionnaire and validation as the four-step form. Existing assistant conversations without questionnaire data remain readable.
