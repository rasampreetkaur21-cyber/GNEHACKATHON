# ClaimShield customer and scanning update

Customer claims show a clear outcome, reason and next action. Technical rules and Unknown tables start collapsed; reviewer investigation remains available. Final Approved/Not approved reflects the actual reviewer decision.

Local CLIP ONNX and RapidOCR run without an API key. Photos and invoices scan automatically. Local OCR receives up to 4096-pixel images, tries rotated/detail regions, and extracts explicit model, serial and receipt fields. Hash and provenance gates remain active. Readable model text without physical-device linkage requires review.

Verification: 365 application tests across 16 files passed (including actual local inference); 8 OCR parser tests passed; dataset validator passed (67 assets, 246 cases); 4 dataset tests passed; production build passed. Live customer page checked: wrong photo displays a reason and replacement action with technical details collapsed.

Supported: Samsung Galaxy A26 5G, Samsung Galaxy A36 5G, Samsung Galaxy A56 5G, boAt Rockerz 450, boAt Rockerz 550, boAt Rockerz 650.

Policy examples (not accuracy measurements): APPROVE requires linked selected model, clean authenticity and all configured claim checks passed, with final reviewer confirmation. DEVICE_MISMATCH/REJECT identifies another supported model. INVALID_DEVICE/REJECT covers unrelated or unsupported products. UNCLEAR_IMAGE/NEEDS_RETAKE requests readable evidence. HUMAN_REVIEW/ESCALATE covers source/authenticity concerns and unconfirmed label linkage.

Limits: only 16 real reference images and no real boAt camera-training references were provided. Fine-model exploratory evaluation was 5/16, so its exact-identity head is disabled. Broad categories and OCR work locally, but reliable six-model real-camera accuracy is not established. Authenticity, hidden damage, genuine serial registries and warranty eligibility cannot be inferred reliably from resemblance. Missing company configuration still needs configuration or reviewer confirmation. Local inference takes several seconds. Standalone retries use the saved canonical preview; new uploads get higher-resolution OCR.

Run: npm ci; npm run local-ai:setup; npm run dev. Open http://127.0.0.1:5173 (configured origin). Model weights included. Setup recreates Python packages. Private uploads, database and .env excluded.

Changed files in this update:
- backend/src/services/customerOutcome.js
- backend/src/services/analysis.js
- backend/src/services/deviceChecks.js
- backend/src/services/deviceVerification.js
- backend/src/services/images.js
- backend/src/database/db.js
- backend/src/app.js
- backend/local_ai/ocr_fields.py
- backend/local_ai/vision.py
- backend/local_ai/test_fields.py
- backend/tests/customer-outcome.test.jsx
- backend/tests/customer-outcome-api.test.js
- frontend/src/App.jsx
- frontend/src/components/CustomerClaimStatus.jsx
- frontend/src/components/CustomerPhotoScan.jsx
- frontend/src/components/EvidenceAnalysis.jsx
- frontend/src/components/EvidenceUpload.jsx
- frontend/src/components/DeviceCheckResult.jsx
- frontend/src/utils/scan.js
- frontend/src/theme.css
