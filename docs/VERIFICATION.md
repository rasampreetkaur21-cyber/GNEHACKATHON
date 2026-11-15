# Verification — 2026-11-14

Executed on Windows with Node.js v25.4.0 and npm 11.7.0.

- Final backend run: npm test — 1 test file, **17 passed, 0 failed**, Vitest 4.1.12; final duration 4.53 seconds.
- Final frontend run: npm run build — passed, Vite 6.4.6, 1,591 modules transformed. HTML 0.42 kB, CSS 19.79 kB, JavaScript 212.83 kB (68.31 kB gzip).
- Final dependency installation audit: 329 packages audited, **zero known vulnerabilities** reported by npm.
- SQLite initialization and seeding succeeded. Main database: 40 SYNTHETIC claims, 40 investigations, no foreign-key violations. Repeated seeding and fixed-seed generation tested.
- Persistence test closes/reopens a file-backed database and creates a new Express app. The same session cookie retrieves the persisted claim through its API.
- HTTP smoke: Vite root, Express health, and built frontend /dashboard all returned 200.
- Browser QA used an isolated work/browser.sqlite: customer registration, empty dashboard, UUID claim submission, saved details/rules/timeline, private PNG upload, confirmed metadata and refreshed rules, sign-out, reviewer sign-in, queue with labeled synthetic claims, and saved request for more evidence with an audit reason.
- Narrow-screen QA found navigation overflow; fixed the breakpoint. Final observation: 400 px viewport and 381 px document width, no horizontal overflow. Temporary viewport override restored.
- Browser test accounts and extra claim are only in ignored work/. Main database retains exactly 40 synthetic claims and no production reviewer credentials.
- Actual ORA header retrieved with a bounded first-line request and matched expected columns. Real dataset stays NOT_LOADED, count 0. Compatible CSV import, provenance and failure retention tested using a small test fixture.
- Observed AI_NOT_CONFIGURED. No key or invented observations; no live Claude request.

Coverage: health; registration/login/logout; password hashes; unauthorized access; origin/header protection; invalid payloads; UUID claims; restart persistence; ownership including downloads; reviewer-only access; private uploads/content rejection; human decisions and terminal status; stable R01–R05 results; missing evidence; expiry/month-end boundaries; serial/service conflicts; real/synthetic trust separation; forty independent expected outcomes; ORDS import and atomic failure retention.

Resolved setup issues: Windows workspace symlinks (replaced with shared root dependencies), dependency directory permissions, JSX fragment closing tag, vulnerable initial dependencies, and Vite output permissions. Source is formatted and root package-lock.json retained. Preview processes were stopped after QA; use npm run dev.

Limits: no full browser automation suite or production deployment certification. No live policy/registry supplier, OCR, antivirus, photo interpretation, or Claude calls. Later advanced phases were not started.
