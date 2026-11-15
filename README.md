> Local AI is now connected without a paid API key. Run `npm run local-ai:setup` on a fresh extraction. See [docs/LOCAL_AI.md](docs/LOCAL_AI.md) for actual training results and limits.

> Six-product image verification is now available at `/verify`. See [docs/DATASET_INTEGRATION.md](docs/DATASET_INTEGRATION.md) for the API, provenance policy, deployment requirements and reproducible checks.

> Guided intake update: see [docs/GUIDED_INTAKE.md](docs/GUIDED_INTAKE.md) for the four-step claim experience, migration behavior, shared assistant questionnaire and verification scope. Include `shared/` in deployments.

# ClaimShield AI

A local warranty investigation application with secure image processing, real Claude Vision, invoice image OCR, and human review. Current phase: ten-rule versioned investigations, evidence ledger, and the persistent guided assistant at /customer/chat. See docs/PHASE3.md for the rule registry, precedence, company configuration and assistant contracts; docs/PHASE2.md covers the evidence pipeline. Evidence informs; authorized people decide. All demonstration claims are visibly **SYNTHETIC**.

## Install and start

Use Node.js 22.12+ (tested on Node 25.4.0), npm 10+, and a modern browser. better-sqlite3 requires a supported native binary or a local C++ toolchain. Root and backend lockfiles fix installed versions. Root npm ci installs backend-only dependencies through postinstall.

```powershell
npm ci
Copy-Item .env.example .env
npm run db:init
npm run seed
npm run dev
```

Open http://127.0.0.1:5173 consistently (avoid switching to localhost). API health: http://127.0.0.1:3001/api/health. Register a customer through the website. New accounts have an empty dashboard; synthetic claims appear in the reviewer queue.

To provision a reviewer, set REVIEWER_EMAIL and REVIEWER_PASSWORD environment variables in your terminal, then run `npm run reviewer:create`. Password must have at least 12 characters. Clear the password environment variable afterward. There are no default credentials, and public registration cannot choose a role. Sign in at `/reviewer/login`.

## Commands

| Command                                           | Purpose                                         |
| ------------------------------------------------- | ----------------------------------------------- |
| `npm run dev`                                     | Run Vite and Express together                   |
| `npm --prefix frontend run dev`                   | Frontend only                                   |
| `npm --prefix backend run dev`                    | Backend only with watch                         |
| `npm run db:init`                                 | Initialize SQLite without resetting data        |
| `npm run seed`                                    | Load the six-device demo fixtures               |
| `npm test`                                        | Vitest and Supertest tests                      |
| `npm run build`                                   | Frontend production build                       |
| `npm start`                                       | Serve API and built frontend on port 3001       |
| `npm run import:ora -- C:/absolute/path/ords.csv` | Explicit local CSV import                       |

For a single-origin local preview, build, set FRONTEND_ORIGIN to http://127.0.0.1:3001 in .env, then run npm start. Stop other processes using port 3001 first. Deployment requires HTTPS, persistent private storage, backups, and suitable bind/proxy settings. NODE_ENV=production enables Secure cookies and requires HTTPS.

## Configuration

The backend loads root .env, which is ignored by Git. Paths resolve from the project root.

| Variable                         | Purpose                                                             |
| -------------------------------- | ------------------------------------------------------------------- |
| PORT                             | API port, default 3001                                              |
| FRONTEND_ORIGIN                  | Exact allowed browser origin, default http://127.0.0.1:5173         |
| DATABASE_PATH                    | SQLite file, default data/claimshield.sqlite                        |
| UPLOAD_DIR                       | Private uploads, default data/private                               |
| NODE_ENV                         | Production enables Secure session cookies                           |
| ANTHROPIC_API_KEY / CLAUDE_MODEL | Server-only Claude configuration; no hardcoded model                |
| AI_DAILY_BUDGET_CALLS            | Global attempted calls per UTC day, default 20; zero disables calls |

Without a key and model, the adapter reports AI_NOT_CONFIGURED. With both set, readiness is READY; calls occur only when an authenticated user explicitly starts image analysis. Status becomes ANALYSIS_PENDING, ANALYSIS_COMPLETE, ANALYSIS_FAILED or LIMITED_MODE as applicable. Failed calls and bounded retries count toward persistent call caps. No key, model or budget configuration is exposed to React. See docs/PHASE2.md for setup. Sessions use random opaque tokens; no JWT signing secret is required.

## Structure

- frontend/src: React 18, Router, Tailwind/CSS, native Fetch and authentication context.
- backend/src: Express, Zod, SQLite initialization, rules, investigations, AI boundary, CLI and importer.
- backend/tests: API/security/persistence, rules, fixture and importer tests.
- data/synthetic: generated fixtures and a separately authored expected-outcome oracle.
- data/raw: source metadata and actual header only; initial real dataset status is NOT_LOADED.
- docs: master brief, contracts, implementation and verification.

## Investigation and human review

Engine 3.2 verifies the exact device model against the claim’s current photo. Replacing a photo starts analysis for the new upload and keeps the retired photo and result in reviewer history. Each recommendation and explanation is saved as a separate snapshot.

Exact precedence: independently anchored expiry without material contradictions recommends rejection; essential/major failures escalate; missing essential evidence requests evidence; automatic recommendation requires essential checks, readable invoice and matching photo, an independent registry anchor, applicable verified policy and configured requested-value threshold. All remaining cases escalate. No outcome changes a human claim status. R09 history never affects recommendations. See docs/PHASE3.md for precise semantics.

Company policies, seller/serial/service/diagnostic records are supplied by authorized reviewers or through `npm run company:import -- C:/path/company-records.json`. No real records or approval threshold are invented. Unknown/unconfigured inputs remain unknown. The ledger exposes only the current customer's evidence and permitted company references; restricted cross-customer matches and internal notes are reviewer-only. ASSERTED/EXTRACTED/VERIFIED labels are preserved.

Customers can use the standard form or /customer/chat. The assistant persists messages and validated state transitions, collects actual secure uploads through the same API, runs the same engine, shows recorded findings and requests, asks for confirmation and then submits one real claim. Its private drafts are not in reviewer queues. LIMITED MODE works without Claude. Standard form idempotency keys and assistant request IDs/revisions prevent duplicate submissions. No free-form language-model agent approves claims.

## Synthetic data

For a fresh six-device demo, set `DATABASE_PATH=data/claimshield-demo-v2.sqlite` in `.env` before running initialization, seeding and reviewer creation. Open the reviewer queue to inspect the fixtures.

Seed 20261114 produces 72 cases across the six catalog models. Each model has four matches, four invalid devices and four unverified results. Simulated photo and invoice observations live in `data/synthetic/claims-v2.json`. Tests compare the calculated results with the separate oracle in `backend/tests/fixtures/synthetic-v2-oracle.json`. A missing-evidence case omits the invoice and supplies a photo without identifying information.

Reruns use stable fixture IDs and preserve claims already in the database. The legacy fixtures in `data/synthetic/claims.json` remain available. The demo exercises the rules and workflow using simulated observations.

## Open Repair Alliance

Source: https://github.com/openrepair/data . Published schema: https://github.com/openrepair/data/blob/main/tableschema.json . Attribution: Open Repair Alliance and contributing repair organizations. License: CC BY-SA 4.0, https://creativecommons.org/licenses/by-sa/4.0/ .

The large Git LFS dataset is not downloaded during setup. Its real header was fetched separately and matches ORDS v0.3. The CSV importer validates headers, supports quoted CSV/BOM, stages replacements, and records source, license, checksum, count, time and NOT_LOADED/IMPORTING/LOADED/FAILED status. Failed imports preserve prior context. Imported records remain aggregate repair context; they never join to claimants or serials and are never consulted by the rules. No SMART-PDM download.

## Security and current limitations

Salted scrypt passwords; hashed 256-bit opaque session tokens; eight-hour expiry; HttpOnly SameSite=Strict cookies, Secure in production. All writes require X-ClaimShield and reject a mismatched Origin. Restricted credentialed CORS, Helmet, rate limits, strict Zod payloads, parameterized SQL values, backend ownership/role checks, safe errors, and no body/secret logging. Uploads have a 5 MB limit, six-image claim cap, file-type checks, full Sharp decoding, pixel/dimension limits, metadata-free AI copies, random storage names and authenticated downloads outside public assets. SDK calls and retries have persistent budget reservations. The model has no tools or decision-changing authority.

Photo extraction and invoice image OCR are implemented, but live Claude analysis remains unverified here because no API key is configured. PDFs remain private manual-review documents. There is no antivirus scanning, email verification, password recovery, MFA, distributed worker/session/rate-limit infrastructure or real registry/policy supplier integration. Completed extractions are immutable; customers append corrections instead. Analysis status is polled while pending. The structured investigator assistant is implemented; Judge Challenge Mode and Decision Twin remain deferred. See docs/PHASE2.md and docs/PHASE2_VERIFICATION.md for current scope and checks.

Current executed-check report: docs/PHASE3_VERIFICATION.md. Operator/configuration and API details: docs/PHASE3.md.

## Samsung / boAt company portals and live checks

Company Login is available on the landing page. Provision separate brand-scoped staff with `COMPANY_BRAND`, `COMPANY_EMAIL`, `COMPANY_NAME`, `COMPANY_PASSWORD` and `npm run company:staff`. Staff URLs are `/company/samsung/login` and `/company/boat/login`; existing customer and global reviewer logins remain available.

Staff requests an optional live check from an open submitted claim. The customer explicitly starts their camera; the reviewer joins to watch one-way video without microphone or recording. The customer can preview and explicitly save an additional private frame while keeping the existing photo. Either side can end the session. HTTPS and working ICE/TURN configuration are required for deployment across networks. See [docs/COMPANY_LIVE.md](docs/COMPANY_LIVE.md) for commands, portal URLs, the complete walkthrough, expiry rules, setup and isolated acceptance testing.
