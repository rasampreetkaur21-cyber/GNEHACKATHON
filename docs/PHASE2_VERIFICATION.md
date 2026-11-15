# Phase 2 verification — 2026-11-14

Project: C:\Users\rasam\Documents\Codex\2026-11-14\files-pasted-by-the-user-claimshield

## Executed checks

- Baseline Phase 1: frontend build passed and 17 tests passed after granting local network access. The initial EACCES errors were test-socket sandbox restrictions, not application assertion failures.
- Clean `npm ci` passed, including backend postinstall installation. Root audit: 329 packages, zero known vulnerabilities. Backend audit: 207 packages, zero known vulnerabilities. Official Anthropic SDK 1.8.0, Sharp 0.35.5 and file-type 22.3.0 are installed in backend only.
- Final `npm test`: **2 test files, 45 passed, 0 failed**, Vitest 4.1.12, 11.29 seconds. Tests isolate the provider configuration so user environment secrets cannot trigger live requests.
- `npm run build`: **passed**, Vite 6.4.6, 1,592 modules. HTML 0.42 kB, CSS 21.38 kB, JavaScript 221.58 kB (71.09 kB gzip).
- Built frontend searched for SDK package names and ANTHROPIC_API_KEY / CLAUDE_MODEL / AI_DAILY_BUDGET_CALLS configuration identifiers: no matches.
- `npm run db:init`: passed. Main database remains **40 claims, all synthetic**, schema version 2, no foreign-key violations. Existing records retained.
- Actual local HTTP smoke check: customer registration, claim creation, decoded JPEG upload, explicit analysis request returning AI_NOT_CONFIGURED, persisted manual correction with ASSERTED trust, evidence retrieval through the status API, and unchanged SUBMITTED claim decision all passed. No SDK mock was used in this check; no provider request was dispatched.
- Vite root and API health both returned HTTP 200.
- Browser QA: customer registration completed. The browser tool timed out on subsequent navigation, so the remaining Phase 2 browser workflow is **unverified**. It is covered by automated API integration tests and the real HTTP smoke check, not claimed as a completed browser test.
- No Anthropic API key or model was configured. **Live Claude Vision/OCR remains unverified.** Production has no fake-analysis fallback. Successful/malformed provider responses are mocked only at the SDK network boundary in tests, exercising the real adapter, schemas, normalization and persistence.
- Temporary preview processes were stopped. QA data is confined to ignored work/ directories; no production credentials were added.

## Test coverage

The original 17 tests still pass. Twenty-eight additional cases cover:

- Valid decoded JPEG, PNG and WebP; private retrieval and stored dimensions/hash.
- Real EXIF stripping from stored and transmitted AI copies while preserving originals.
- Unsupported formats, forged image extension/content, MIME mismatch, corrupt/truncated images and rejected-file cleanup.
- 5 MB cap, dimension/pixel limits, six-image cap and repeated-upload deduplication.
- Cross-user download, status, analysis and correction access; evidence-to-claim pairing.
- Valid mocked invoice OCR and visible photo observations through the real adapter; UNKNOWN fields and trust separation.
- Malformed JSON, unexpected AI fields and schema-invalid outputs.
- Timeout, retained originals and explicit retry on the same evidence record.
- Missing key and zero-call LIMITED_MODE without dispatch.
- Duplicate pending/completed analyses without duplicate calls, jobs or evidence.
- Retry accounting, persistent global daily allowance, and refusing a retry beyond its remaining budget.
- Prompt-injection OCR retained as inert text; role/decision/trust escalation rejected.
- Customer assertions and correction requests retained separately from immutable extraction.
- Authorized reviewer confirmation without changing claim decisions or policy records.
- File-backed restart persistence of extraction, assertions, sessions and usage ledger.
- Expired interrupted jobs, stale-result rejection after a newer result, and two-job concurrency cap.
- Legacy private PDF storage/download in truthful manual-review LIMITED_MODE.

The old upload test used a PNG fixture with invalid compressed pixels. It was replaced by a genuinely encoded Sharp fixture; corrupt-pixel rejection is now explicitly covered. No production decoder check was weakened.

## Limits

No live provider accuracy, billing or account-model compatibility was tested. No full browser interaction suite completed. There is no antivirus scanner, document authenticity verification, distributed job queue or production deployment certification. Budget limits count attempted calls, not currency. Completed results are immutable; customers append correction requests. No chatbot, Decision Twin or Judge Challenge Mode was added.
