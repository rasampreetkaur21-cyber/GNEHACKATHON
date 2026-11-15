# Phase 2 — private image processing and Claude extraction

This extends the Phase 1 project. Authentication, claim ownership, deterministic investigations and human final decisions remain intact. AI observations never update policies, serial registry, user permissions or claim decisions.

## Install and configure

Run `npm ci` from the project root. Its postinstall runs `npm --prefix backend ci` against backend/package-lock.json. The official Anthropic SDK, Sharp and file-type are declared and installed in backend only; they are not frontend dependencies or browser imports. Root and backend lockfiles are both required.

Copy .env.example to .env if you have no local configuration. Set these server-only values in root .env or the server process environment:

```dotenv
ANTHROPIC_API_KEY=your-secret-api-key
CLAUDE_MODEL=your-current-vision-capable-model-id
AI_DAILY_BUDGET_CALLS=20
```

Do not commit .env. Do not prefix secrets with VITE\_. The former CLAUDE_API_KEY placeholder is replaced by ANTHROPIC_API_KEY. There is no hardcoded model or model fallback. Select a vision-capable model available to your Anthropic account. Public API responses reveal readiness, not key/model/budget values. Model identifiers are recorded only in private database provenance.

The default global daily cap is 20 attempted API calls; invalid or negative values fail closed at zero. A separate ten-call daily limit applies to each requesting account. Counters are persisted in SQLite and reset by UTC date, not server restart. Every network attempt, including retries, reserves one call before dispatch. This is a call cap, not a monetary/token budget. Responses are limited to 2,500 output tokens. Failed requests and timeouts may still be billable and retain their reservations.

Run `npm run db:init` for the additive migration, then `npm run dev`. Existing data is retained. There are no API calls on startup, seed, page load, or upload.

## Test a new real photograph

1. Open http://127.0.0.1:5173, register or sign in as a customer.
2. Submit a claim and optionally select product/invoice images, or open an existing open claim and upload them there.
3. Upload a genuine JPEG, PNG or WebP under 5 MB. At most six images belong to a claim. Observe transmitted-byte progress and wait for server confirmation.
4. Select **Start evidence analysis** on a photo or invoice image. This sends an oriented, metadata-free JPEG copy to Anthropic. The original stays private on your server.
5. Observe ANALYSIS_PENDING, then the saved observations, explicit UNKNOWN fields and EXTRACTED trust label. Invoice OCR includes original extracted text when returned by the model.
6. If the key/model is absent, see AI_NOT_CONFIGURED. Provider or parse failures show ANALYSIS_FAILED. Budget limits and unsupported analysis categories show LIMITED_MODE. Files remain downloadable; no observations are fabricated.
7. Use **Provide missing information or request a correction**. These entries remain ASSERTED and do not overwrite original extraction. An authorized reviewer can explicitly confirm complete extracted observations as VERIFIED and separately record a claim decision.

Configuration changes require a backend restart. Completed analyses are returned from storage and do not incur another call. Pending duplicate requests coalesce. Failed/limited requests can be retried explicitly on the same evidence record; the upload is not duplicated. A completed extraction is intentionally immutable in this phase; corrections are appended separately.

## API additions

All paths below start with `/api/claims/:id/evidence`. Every endpoint requires a session and checks both claim ownership/reviewer role and evidence-to-claim membership. Every write also requires `X-ClaimShield: 1` and an allowed Origin when supplied.

| Method/path                   | Result                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| POST /                        | Multipart kind/file, private original and normalized image, UUID id; repeated identical claim/kind/hash returns the existing id |
| GET /:evidenceId              | Authenticated attachment download, never a public static file                                                                   |
| POST /:evidenceId/analyze     | Empty JSON object, 202 while pending; cached/missing-config/limited states return 200                                           |
| GET /:evidenceId/analysis     | Safe metadata, processing state, validated observations and appended annotations                                                |
| POST /:evidenceId/annotations | kind ASSERTION or CORRECTION_REQUEST, fields object, note; always ASSERTED                                                      |
| POST /:evidenceId/verify      | Reviewer only; reason of at least ten characters; confirms a complete extraction as VERIFIED, audited                           |

The existing claim-detail API now includes public processing metadata and observations. Filesystem keys, secrets, model configuration and budget configuration are omitted. Manual fields are allowlisted in backend/src/ai/schemas.js. Extra request and AI-output fields are rejected.

## Upload and processing safeguards

- Multer enforces 5 MB, one file and one category field per request. JPEG/PNG/WebP signatures must match MIME. Sharp fully decodes and re-encodes to reject broken pixel data, limits input to 20 million pixels and 8,192 px per side, and rejects animated/multipage images.
- Private originals and copies use random UUID filenames. Copies are auto-oriented, resized within 1,568 px, flattened and encoded as JPEG without EXIF/GPS/XMP. SHA-256 and dimensions are persisted. The actual original is decoded again before an AI dispatch, including legacy images.
- Six images per claim are enforced within an immediate transaction and a SQLite trigger. Repeated identical uploads reuse the existing evidence id. Rejected files and normalized copies are cleaned up.
- Upload/manual requests: 20 per account per 15 minutes. Analysis requests: 10 per account per 15 minutes. Existing general/auth limits remain. At most two analyses can be pending application-wide, enforced using database transactions.
- Each SDK attempt has a 20-second timeout and abort signal. At most one transient retry is permitted; SDK automatic retries are disabled so every dispatch is counted. No tools, browsing, file access or database operations are exposed to the model. SDK request logging is disabled.
- The fixed system prompt treats all image/OCR text as untrusted, prohibits following embedded instructions, accusations, internal-damage inferences and confidence scores. Only strict Zod-validated observation objects are accepted. Unknown fields are retained as UNKNOWN. Extracted text is rendered as plain React text, never executable HTML.
- SQLite retains processing attempts, source references, hashes, timestamps, model and prompt version, trust, assertions, corrections and audits. Active jobs have a two-minute lease. Expired jobs become failed on recovery; no automatic potentially billable replay occurs after restart. Late expired responses cannot overwrite a newer result.
- No AI result is passed into the warranty rules engine. OCR presence is not proof of invoice authenticity or independent policy eligibility. A verified evidence label alone does not approve a claim.

## Legacy compatibility and limitations

Existing PDF documents remain private and downloadable. New PDF documents can still be stored for manual review, but this phase performs image OCR only and truthfully marks PDFs LIMITED_MODE. Other document categories remain manual-review attachments. Synthetic placeholder evidence is never submitted to Claude or displayed as a genuine extraction.

Live Claude analysis requires a configured provider. Automated tests can mock SDK responses while exercising the adapter, image normalization, schema validation, persistence and API flow. The six-device seed uses labeled simulated observations for rules and workflow fixtures.

This is a single-server in-process worker with persistent attempts and restart recovery, not a durable distributed job queue. It has no antivirus scanner, semantic truth guarantee, document authenticity check, arbitrary reanalysis of completed records, token-price calculator or production deployment certification. Original private files intentionally retain their metadata; only AI copies are stripped. No chatbot, Decision Twin or Judge Challenge Mode was added.

## Official implementation references

- Anthropic SDK and timeout/retry contract: https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript
- Messages image input contract: https://platform.claude.com/docs/en/api/typescript/messages/create
- Sharp decoder and input limits: https://sharp.pixelplumbing.com/api-constructor/
- Sharp metadata behavior: https://sharp.pixelplumbing.com/api-output/
