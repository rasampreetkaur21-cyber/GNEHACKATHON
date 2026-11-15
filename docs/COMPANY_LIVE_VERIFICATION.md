# Company dashboards and live verification — actual delivery results

Samsung and boAt now have separate company login pages and brand-scoped claim dashboards, including search, status filtering, all submitted statuses and visible synthetic labels. Company access derives from canonical catalog IDs. Only unambiguous model names can resolve legacy claims without an ID. Private drafts remain owner-only; unidentifiable legacy claims stay available to global reviewers. Customer registration/login and global reviewer access remain supported.

Status changes preserve terminal states and require customer-facing reasons, saved atomically with actor and time in structured history and the existing audit flow. Existing parseable reasons backfill idempotently. Missing reasons display No reason recorded. Human status/history and AI recommendations have separate labels. Customer claim details refresh periodically; internal notes and restricted cross-customer links are not exposed to company staff or customers.

Live device checks use existing session authentication and SQLite-backed, bounded HTTP signaling with WebRTC one-way customer video. Customer camera start is explicit; no microphone, reviewer camera or automatic recording. Only the owner and the requesting assigned-brand company reviewer can join/signal/end. Session expiry and claim finalization prevent reuse. Camera starts prefer rear video, support switching where available, and have a cancellable 20-second timeout. Navigation/end releases tracks. Explicitly previewed/saved frames use private image validation/hash storage as additional live_snapshot evidence, with session linkage; the current device photo is preserved. Snapshots are advisory reviewer evidence and are not automatically verified model matches.

## Automated verification

- npm test: PASSED, 387 tests across 19 files, no failing tests or unhandled errors in the final run (194.44 seconds).
- npm run build: PASSED (1610 modules, 22.50 seconds).
- New server coverage: 11 tests including both cross-brand denial directions, company login, draft privacy, search/filter/all-status queues, legacy handling, required public reasons/terminal states, internal-data privacy, live authorization, signal direction/audio rejection, expiry, finalization and actual private-image snapshot uploads that preserve the current device photo.
- New camera component coverage: 3 tests for explicit consent/video-only request, preview-before-save, denial/photo fallback, track cleanup and keepalive end on exit. Those component streams are mocked.
- Earlier unrestricted parallel runs hit worker-start and timeout failures on this machine. The final test configuration uses one thread worker; the complete final run passed.

## Two-session browser verification actually observed

An isolated QA database and two host-specific cookie sessions were used: customer at 127.0.0.1 and Samsung staff at localhost. No test accounts, decisions, images or snapshots were written to the real app database.

1. Both accounts signed in separately and opened the same submitted test claim.
2. Staff dashboard displayed the claim and customer/model/status. Samsung staff was denied the boAt portal.
3. Staff requested a live check, the customer saw it, and staff joined.
4. Initial real camera permission in the in-app browser stayed pending. This was not reported as a successful real-camera test. A timeout/cancellation fallback was implemented.
5. An opt-in, QA-server-only animated canvas explicitly labeled SYNTHETIC QA VIDEO / Not a real device or warranty claim supplied the test video on explicit camera start. Actual browser RTCPeerConnections exchanged SDP/ICE through the authenticated API, reached Connected, and the reviewer visibly received the video.
6. The customer previewed a frame marked not saved yet, explicitly saved it, and saw Saved live camera frame alongside claim evidence.
7. Customer ended the session. Both participants displayed Ended. Staff later saw the saved snapshot in the claim evidence.
8. Staff recorded Under Review with a test reason; the customer saw the same reason, actor and UTC time in Human decision & status history.
9. A second request used the QA fixture's cameraDenied=1 option. The customer saw the permission-denied explanation, uploaded a licensed dataset test photo through the regular photo flow, and saw both photo and saved snapshot retained. The session was ended.

The fixture is not in the production app and does not test physical hardware, recognition accuracy or cross-network TURN traversal. The QA server intentionally disables AI inference to isolate the company/live workflow; normal app local AI configuration is unchanged.

## Setup still required

Provision real Samsung/boAt staff via npm run company:staff using COMPANY_BRAND, COMPANY_EMAIL, COMPANY_NAME and COMPANY_PASSWORD. Existing emails are never overwritten/reassigned. See docs/COMPANY_LIVE.md for exact PowerShell commands and walkthrough. The production portals are /company/samsung/login and /company/boat/login.

For deployment, supply same-origin HTTPS, exact FRONTEND_ORIGIN, production Secure cookies and working WEBRTC_ICE_SERVERS with STUN/TURN relay credentials/ports. No external ICE servers are assumed. Real mobile rear-camera switching, actual camera permission/streaming and cross-network connections remain device/deployment acceptance checks. Unused requests expire after ten minutes; sessions after both participants join expire after thirty minutes. SDP/ICE cleanup occurs when expiry/end is processed. Ended metadata and saved evidence remain in history. A different staff member cannot take over an existing live session; end/expire and request a new one.

## Changed files
- backend/src/app.js
- backend/src/database/db.js
- backend/src/database/companyLive.js
- backend/src/services/companyAccess.js
- backend/src/services/liveRoutes.js
- backend/src/utils/security.js
- backend/src/cli.js
- backend/src/services/investigation.js
- backend/src/services/evidence.js
- backend/src/services/analysis.js
- backend/vitest.config.js
- backend/scripts/live-qa.js
- backend/tests/company-live.test.js
- backend/tests/live-camera-ui.test.jsx
- frontend/src/App.jsx
- frontend/src/pages/Company.jsx
- frontend/src/components/LiveDeviceCheck.jsx
- frontend/src/components/EvidenceAnalysis.jsx
- frontend/src/components/CustomerPhotoScan.jsx
- frontend/src/theme.css
- package.json
- README.md
- docs/COMPANY_LIVE.md

## Manual-review workflow follow-up
Company queues now refresh every ten seconds and include an explicit Review claim button on every row. Company claim details show customer name, product and complaint, with a prominent ManualDecision.jsx panel near the top: Approve claim, Reject claim, Request more evidence and Under review. Selecting an option does not submit: a reason and explicit Save manual decision are required. Company reviewers now see inline image previews. Fifteen focused tests passed (13 company/live API tests and 2 manual decision UI tests). Production build passed. The earlier 387-test full-suite result predates the added follow-up tests. Live UI inspection confirmed the visible options without changing any actual claim decision. Additional files: frontend/src/components/ManualDecision.jsx and backend/tests/manual-decision-ui.test.jsx.
