# Prompt to paste into Claude

You are a senior computer-vision product engineer and a national-level hackathon judge. Audit the attached ClaimShield website and the supplied ClaimShield-AI-Dataset package, then produce an implementation and evaluation plan that can be executed in the existing repository.

The product is a closed-set claim-evidence verifier. The supported catalog must contain exactly these six options and no others:

1. Samsung Galaxy A26 5G (samsung-galaxy-a26-5g)
2. Samsung Galaxy A36 5G (samsung-galaxy-a36-5g)
3. Samsung Galaxy A56 5G (samsung-galaxy-a56-5g)
4. boAt Rockerz 450 (boat-rockerz-450)
5. boAt Rockerz 550 (boat-rockerz-550)
6. boAt Rockerz 650 (boat-rockerz-650)

The user selects exactly one model_id and uploads exactly one image. Enforce the selected model at the upload boundary. If the clear image is a different supported model, return DEVICE_MISMATCH. If it is an iPhone, another Samsung model, another headphone, laptop, mug, scenery or any subject outside the six-product catalog, return INVALID_DEVICE. If it is blurry, dark, cropped, occluded, glare-heavy, too small, packaging-only or lacks a readable identifier linked to the pictured device, return UNCLEAR_IMAGE. If it shows a synthetic/AI-generated signal, edited damage, screenshot/replay, exact duplicate, registry conflict or other authenticity concern, return HUMAN_REVIEW. Every result must contain a stable reason code, short reason, next action and confidence or null.

Do not claim exact model identity from visual appearance alone. A visual-only image can suggest category or model family. Require readable model evidence linked to the pictured device, or route to a human reviewer. Do not auto-approve a claim merely because VALID_MATCH is returned. Do not present generated fixtures as real photos. Keep synthetic, real open-license, user-camera and transformed images separate in the manifest.

Inspect the website as a judge:

- verify that only the six catalog options appear in every selector, API route, validation path, seed/demo path and UI
- verify that one selected product cannot silently accept another device image
- verify VALID_MATCH, DEVICE_MISMATCH, INVALID_DEVICE, UNCLEAR_IMAGE and HUMAN_REVIEW result states in the UI
- verify the app explains the result in user-friendly Hinglish and exposes a reviewer path for uncertainty
- verify image hash, duplicate detection, file type/size limits, EXIF/GPS stripping, server-side validation and safe failure behavior
- verify loading, error, retry, empty and accessibility states
- verify that training/evaluation data has no train-test leakage by physical device, scene or near-duplicate

Use the dataset files instead of inventing a new schema. Preserve catalog.json, integration_contract.json, data/assets.json, data/cases.json and all provenance fields. Generate real-camera collection instructions and use scripts/import_photos.py for new photos. Use scripts/augment_photos.py only for explicitly labelled stress variants.

Build a reproducible benchmark. For each model under evaluation, run the exact same frozen test cases and export benchmark/predictions.csv with:

model_name,case_id,selected_model_id,expected_status,predicted_status,reason_code,confidence,latency_ms

Calculate accuracy, macro-F1, per-class precision/recall, invalid-device recall, human-review recall, coverage, latency p50/p95 and a confusion matrix. Use scripts/make_graphs.py to create PNG charts. Never fabricate or estimate LLM accuracy. If a model has not been run, label it NOT_RUN and exclude it from measured comparisons.

Score the website using this national-hackathon rubric out of 100:

- 25 problem clarity and user impact
- 20 technical correctness and closed-set enforcement
- 15 evidence provenance, authenticity handling and honest limitations
- 15 evaluation quality, leakage controls and reproducibility
- 10 product UX, accessibility and Hinglish clarity
- 10 engineering quality, security and failure handling
- 5 novelty and demo quality

Return:

1. a judge-style score table with evidence and deductions
2. a prioritized P0/P1/P2 implementation backlog
3. exact files and functions to change
4. the measured benchmark tables and generated graphs
5. five live demo scripts covering a correct match, same-brand mismatch, cross-category invalid device, unclear photo and AI/edit/duplicate human review
6. a short final verdict that clearly separates measured results, synthetic fixture results, open-license reference images and missing real-camera data

Do not weaken closed-set validation, add unsupported product options, fabricate photos, fabricate benchmark scores, or hide uncertainty.
