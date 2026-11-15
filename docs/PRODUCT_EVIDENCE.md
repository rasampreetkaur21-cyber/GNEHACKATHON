# Product-specific evidence report

The main report now uses the selected product's actual six-product-v1 catalog record: product name, brand, category, manufacturer source link and per-origin asset counts. Counts are computed from that product's model_id in assets.json. Real, generated and augmented origins stay separately labeled. Dataset coverage is not an accuracy score.

The uploaded photo has a separate evidence panel: detected category, readable model/serial text, image quality and the remaining assessment needed. Catalog metadata never populates missing OCR fields or supplies a fake device identity. Unreadable fields receive clear explanations and product-specific next steps. Repeated UNKNOWN rows are omitted from the readable extraction; original values are preserved in the reviewer audit record. Damage and authenticity are explicitly described as requiring review because the local category/OCR pipeline cannot establish them.

Changed files: backend/src/services/productReference.js; backend/src/app.js; frontend/src/components/ProductEvidenceReport.jsx; frontend/src/components/EvidenceAnalysis.jsx; frontend/src/theme.css; backend/tests/product-reference.test.jsx.

Tests added: six product-specific dataset/provenance checks; one mismatch/no-substitution check; one unsupported-selection check. The tests also confirm that rendering does not change raw evidence. Live customer view verified with Samsung Galaxy A26 5G's dataset card, separate photo findings and no repeated UNKNOWN table. This improves presentation and traceability, not the trained model's accuracy. The existing exact-model limitations remain; no new recognition accuracy is claimed.

Validation: the full suite ran 373 tests: 372 passed and the development-server configuration check hit its default five-second timeout. All six tests in that affected file passed on an isolated rerun with a 20-second timeout. All eight new product-reference tests passed. Production website build passed. This is functional validation, not a real-world recognition accuracy benchmark.

Judge explanation: We use a closed six-product catalog and local vision plus OCR. Catalog knowledge, photo observations and claim eligibility are distinct. Unreadable or unsupported evidence triggers an explained retake or human review, while audit data remains available.
