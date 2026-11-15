# Scheduled live verification update

Company reviewers can propose a date/time (explicit Asia/Kolkata / IST), 15- or 30-minute duration and what the customer should show. Active invitations appear in the signed-in customer dashboard and claim page. Customers can accept, decline with a reason, suggest another time or cancel. The requesting company reviewer confirms alternatives or cancels. Responses are version-checked to prevent stale edits, brand/owner-authorized and audited with dates/reasons. Unanswered/expired/cancelled history is retained. Declining an appointment never rejects the warranty claim.

New company UI starts scheduled rooms only for an accepted invitation during the allowed window (10 minutes before start through 15 minutes after the end). Server validates agreement, requesting staff and joining window for appointment-linked rooms. Existing instant-room API calls/legacy sessions remain supported for backward compatibility and still require explicit customer camera consent. Invitations and room outcomes are advisory; manual claim decisions remain separate.

The reviewer no longer sees an empty player while only they have joined: Waiting for customer video explains how the customer joins. Video is displayed when a stream arrives. A two-participant attempt that cannot connect within 45 seconds ends with a retry/photo-fallback message. This does not replace a working camera, permission, HTTPS or ICE/TURN relay.

## Actual validation
- Full suite after migration fix: 392 passed, 1 local-model inference timeout out of 393 tests. The isolated local-model rerun passed all 5 tests. Do not describe this as a clean one-run full-suite pass.
- Final focused company/live, deployment seed and camera suites: 24 tests passed across 3 files, including real API appointment acceptance, alternatives, decline, notifications, stale-version rejection, cross-brand denial, time-window enforcement and cancellation ending linked video.
- Final production build passed (1612 modules, 20.91 seconds).
- An initial deployment seed test exposed an unwanted HTTP-route dependency in database migration; migration was separated into backend/src/database/appointments.js. Seed regression tests passed after the fix.
- Two separate host/cookie sessions in an isolated QA database: company sent 15 Nov 2026 9:35 am IST with a what-to-show message; customer dashboard displayed it; customer accepted; company saw confirmation and started the room; reviewer displayed Waiting for customer video; customer explicitly joined; actual browser WebRTC reached Connected using a clearly labeled animated SYNTHETIC QA VIDEO fixture; customer ended the room. No real customer appointment or decision was submitted during this test.
- Physical camera and cross-network TURN behavior remain unverified in this environment. Earlier actual camera permission remained pending; a 20-second permission timeout and cancellation remain supported.

## Files changed in this update
backend/src/database/appointments.js; backend/src/database/db.js; backend/src/services/appointments.js; backend/src/services/liveRoutes.js; backend/src/app.js; backend/scripts/live-qa.js; backend/tests/company-live.test.js; frontend/src/components/LiveAppointment.jsx; frontend/src/components/LiveDeviceCheck.jsx; frontend/src/pages/Company.jsx; frontend/src/App.jsx; frontend/src/theme.css; docs/COMPANY_LIVE.md.

Run and provision accounts using README / docs/COMPANY_LIVE.md. Normal local preview is http://127.0.0.1:5173/. No email/SMS is sent; these are in-app notifications. For remote deployment configure same-origin HTTPS, exact FRONTEND_ORIGIN and valid WEBRTC_ICE_SERVERS with working STUN/TURN. Real camera/mobile switching and network testing are still required. The QA video fixture is opt-in in the isolated test server only and is never in the production app. Private uploads, real database, .env and platform-specific Python packages are excluded from the archive.
