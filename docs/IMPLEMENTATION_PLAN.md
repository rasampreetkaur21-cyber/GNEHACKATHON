# Foundation implementation

1. a shared root dependency installation, React frontend and Express backend with lockfile.
2. Repeatable SQLite schema, foreign keys, sessions, audit and provenance.
3. Salted authentication, ownership/role checks, strict validation, private uploads, rate limits and headers.
4. Pure deterministic rules, persisted investigation runs, human-only final decisions.
5. Fixed-seed synthetic generator with independently authored oracle; optional ORDS CSV loader.
6. Landing/auth/dashboard/submission/detail/reviewer overview/queue, connected APIs and responsive states.
7. Execute backend tests, production build and HTTP smoke checks; record actual results in VERIFICATION.md.

Phase 2 adds evidence columns (user_version 2), analysis attempts, usage and annotations, secure Sharp processing and real server-only Anthropic integration. See PHASE2.md and PHASE2_VERIFICATION.md. Migrations retain existing data. No chatbot, Judge Challenge Mode, Decision Twin or default production credentials.

## Phase 3 implementation completed

Additive schema version 3, ten-rule engine with immutable snapshots and exact priority, reconciliation/next-evidence, audited company-reference configuration, shared idempotent claim service, persisted eleven-state private-draft assistant, ledger/history and internal reviewer notes. Existing evidence processing saves a new investigation on completed extraction or clarification. Operator initialization upgrades open legacy recommendations without changing final statuses. PHASE3_VERIFICATION.md records actual tests/build/integration output. No Judge Challenge Mode or Decision Twin.
