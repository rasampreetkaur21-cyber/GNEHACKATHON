# Company review and live device verification

## Staff setup

Use the existing database and `.env`. Do not use customer registration for staff.

```powershell
$env:COMPANY_BRAND='samsung'  # or boat
$env:COMPANY_EMAIL='reviewer@your-company.example'
$env:COMPANY_NAME='Samsung Warranty Team'
$env:COMPANY_PASSWORD='<choose a unique password of at least 12 characters>'
npm run company:staff
Remove-Item Env:COMPANY_PASSWORD
```

Repeat with `COMPANY_BRAND='boat'` and a separate email/password. Existing emails are refused: provisioning never overwrites, promotes or reassigns an account. `npm run reviewer:create` continues to create a global reviewer using `REVIEWER_EMAIL` and `REVIEWER_PASSWORD`.

URLs: `/company` selects a portal; `/company/samsung/login`, `/company/boat/login` sign in staff; `/company/samsung`, `/company/boat` show company queues. Customers keep `/login`, `/register`, `/dashboard`. Global reviewers keep `/reviewer/login` and `/reviewer`.

An additive, repeatable migration creates a company_staff assignment table, status-change history and live-session tables. Company staff use the legacy reviewer storage slot plus a mandatory brand assignment; session authentication exposes the effective role `company_reviewer`. Authorization always uses that effective role, never the raw storage role. The canonical catalog ID determines brand. Only legacy rows without a canonical ID can fall back to an unambiguous catalog model/alias. Unidentifiable legacy claims remain in the global reviewer portal. Private drafts are owner-only.

## Review walkthrough

1. Customer submits a claim with a selected product and uploads evidence normally.
2. Assigned company staff signs in, searches by claim ID/customer/model, filters status and opens the claim. Synthetic claims remain labeled.
3. The human status/history is separate from the AI recommendation and rule explanations. Every new status change requires a 10–1500 character customer-facing reason. Its actor, reason, time and status are saved atomically with the audit event. Historical reasons are backfilled where parseable; missing reasons display “No reason recorded”. Approved and Rejected cannot be reopened.
4. Staff chooses **Request live device check**. The customer sees the request on their claim page without refreshing, then explicitly chooses **Start camera & join**. Staff chooses **Join live check**. Use separate browser profiles or two devices so logins do not replace each other.
5. The customer shows the product and readable attached model label/About screen. Only the customer's video is sent; there is no microphone capture, reviewer camera or recording. Mobile prefers the rear camera. Switch camera appears when the browser exposes multiple cameras.
6. Customer chooses **Preview a frame**, inspects it, then **Save frame as evidence**. Only that explicit action uploads the still image. It is private `live_snapshot` evidence linked to the session, passes the existing type/size/hash/image pipeline and does not replace the current product photo. Snapshots are reviewer evidence, not automatic verified model matches. The regular explicit Replace photo flow remains available.
7. Either participant chooses **End live check**. Navigation/page exit releases media tracks and attempts a keepalive end request. Server expiry also prevents reuse. A camera failure or unanswered permission request (20-second timeout) leaves photo uploads available. No decision is inferred from joining or disconnecting.

## HTTPS and ICE/TURN

Localhost/127.0.0.1 work as secure browser contexts. Real devices accessing an HTTP LAN IP usually cannot start a camera. Serve the frontend and `/api` through the same HTTPS origin, set `FRONTEND_ORIGIN` to that exact public origin, and set `NODE_ENV=production` for Secure session cookies. Reverse-proxy the API to Express; signaling uses authenticated HTTP polling, so no WebSocket upgrade is needed.

For different networks configure ICE/TURN in the server environment before starting:

```powershell
$env:WEBRTC_ICE_SERVERS='[{"urls":"stun:your-stun.example:3478"},{"urls":["turn:your-turn.example:3478?transport=udp","turns:your-turn.example:5349?transport=tcp"],"username":"your-limited-lifetime-user","credential":"your-limited-lifetime-credential"}]'
```

These example hostnames are placeholders. Supply a working TURN service, valid TLS certificate and reachable UDP/TCP relay ports. No ICE servers are configured by default; local-network host candidates can connect, but cross-network reachability is not guaranteed. TURN credentials returned to session participants must be limited-lifetime relay credentials, never administrative credentials. Rotate them as required. TURN connectivity, mobile switching and real-camera streaming still require deployment acceptance on actual devices/networks.

## Session/security behavior

Requests expire after ten minutes without both participants joining. After both join, the session expires after thirty minutes. Expiry/finalization is checked on every live request; expired/ended SDP and ICE signals are deleted when processed. Ended session metadata and explicit snapshot evidence remain as history. One active request per claim; only its requesting company reviewer and the claim owner can signal or end it. Another same-brand staff member cannot take over an existing session. Signaling is bounded/rate-limited, rejects audio SDP and is advisory. Company staff cannot access the global claim queue, configure global company records, read global internal notes, or access other-brand/draft evidence.

## Isolated acceptance environment

```powershell
npm run build
$env:LIVE_QA_PASSWORD='<choose a test-only password, at least 12 characters>'
npm run live:qa
```

This creates a disposable database in the OS temp folder, not the real app database. Customer: `http://127.0.0.1:3101/login` with `customer@live-qa.invalid`. Company: `http://localhost:3102/company/samsung/login` with `samsung@live-qa.invalid`. Both use the password supplied above. Host-specific cookies create separate authenticated sessions; normal deployment should use distinct browser profiles/devices. The script prints the test claim ID. The boAt test account is `boat@live-qa.invalid` for the boAt portal. Stop with Ctrl+C. No QA accounts are added to your real database.

Automated checks include actual private-image snapshot uploads; component camera tests use mocked streams and do not establish real-camera playback or network traversal. See the delivery verification report for the browser steps actually observed.

For a deterministic browser/WebRTC acceptance test without a physical camera, opt in to `$env:LIVE_QA_SYNTHETIC_CAMERA='1'` before `npm run live:qa`. Only the isolated QA server then supplies an animated canvas labeled **SYNTHETIC QA VIDEO — Not a real device or warranty claim** when the customer presses Start camera. The real app never includes that override. Add `?cameraDenied=1` to the QA customer claim URL to test permission-denied photo fallback. This fixture tests actual peer-to-peer video transport and explicit frame saving, not hardware-camera access, device recognition or cross-network TURN reachability.

## Scheduled live demonstrations

Company claim pages now propose a date/time (explicit IST), duration and a customer-facing description of what to show. The invitation appears on the customer's dashboard and claim page. Customers can accept, decline with a reason, or suggest another time. The requesting reviewer confirms alternative times. Both sides can cancel with a reason; changes are version-checked and audited. Declining an optional appointment does not reject a warranty claim.

Scheduled rooms require an accepted appointment and enforce joining from 10 minutes before the slot until 15 minutes after its end. New company UI uses this agreed appointment flow. Existing instant-session API calls and previously created rooms remain supported for compatibility; customer camera consent is always required. Expired or cancelled invitations remain in history. Rescheduling/cancelling ends a linked active room.

The reviewer now sees Waiting for customer video rather than an empty player before a stream arrives. Both participants must join the same room. If both join but WebRTC cannot connect within 45 seconds, the attempt ends with a specific error and photo fallback. Working HTTPS, camera permission and ICE/TURN are still deployment requirements, not something scheduling can replace. Notifications are in-app while signed in; email/SMS and operating-system reminders are not sent.
