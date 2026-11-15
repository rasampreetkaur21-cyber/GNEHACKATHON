# Six-product dataset integration

## Product and API contract

The existing application catalog already contained exactly the six supplied model IDs. The API asserts equality with datasets/six-product-v1/catalog.json at startup. New claim, assistant and verification selectors accept only those products. Negative dataset subjects and historical records are retained as evidence/test history, not selectable products.

The new customer route is /verify. A signed-in customer chooses one company/model and one JPEG, PNG or WebP image. An optional owned, submitted, non-synthetic claim can be attached; its selected catalog ID must match. Each POST /api/device-checks accepts only selected_model_id, optional claim_id and exactly one image field. It rejects arbitrary origins, observations, claimed check results and unknown fields. GET /api/device-catalog supplies the closed catalog. GET /api/device-checks returns only the customer's checks, or all checks for a reviewer. POST /api/device-checks/:id/retry retries a saved provider failure without treating that same saved record as a fresh duplicate. Saved images are authenticated at /api/device-checks/:id/image. Reviewers use /reviewer/device-checks and the existing linked-claim decision workflow.

Every result contains status, decision, selected_model_id, observed_model_id, reason_code, reason, next_action, confidence and authenticity. Reasons and next actions are Hinglish. Confidence is null because calibrated vision probabilities are not available. Additional fields expose origin, server claim checks and the advisory decision scope.

## Decision policy

- Integrity/provenance/authenticity concerns take priority: known generated assets, augmentation, digital edits, reference-image replay, exact/normalized duplicates, visible synthetic/edit/replay/suspicious signals and verified-registry/claim-serial conflicts produce HUMAN_REVIEW / ESCALATE.
- Poor quality, packaging-only, an unreadable identifier or an identifier not linked to the physical device produce UNCLEAR_IMAGE / NEEDS_RETAKE.
- Linked evidence of another supported model produces DEVICE_MISMATCH / REJECT, including cross-category pairs.
- A clear outside-catalog subject, or a reliably linked unsupported model code, produces INVALID_DEVICE / REJECT.
- Linked matching model evidence with completed visible-signal screening produces VALID_MATCH. Its decision is APPROVE only if every configured claim rule is PASS for an attached real submitted claim. Missing, failed or unknown checks keep the decision ESCALATE. Closed claims cannot receive a new approval recommendation.

APPROVE and REJECT are verification recommendations; neither silently changes the existing human claim status. REAL_UNVERIFIED means no detected signal in the configured screening, not proof that an image is real. An unconfigured, timed-out, over-budget or malformed provider response safely produces HUMAN_REVIEW, with retry when appropriate.

## Provenance and compatibility

The supplied catalog, integration contract, manifests, cases, attribution files, images and legacy ZIP are preserved. Runtime code uses asset hashes/origins for provenance only; expected case labels and prompted model IDs never determine a customer's model identity. A derived provenance_hashes.json indexes metadata-stripped normalized hashes. Known open-license reference images are routed to replay review rather than treated as a new customer camera photo. Unknown uploads remain user_upload_unverified. Augmented and generated origins remain distinct.

Your explicit synthetic-evidence rule takes precedence over supplied image cases that expect UNCLEAR_IMAGE for generated sample labels. The original cases are not relabelled. Known-reference provenance can likewise route an otherwise unclear/unsupported reference image to HUMAN_REVIEW before identity evaluation. These differences must be considered when interpreting any future end-to-end benchmark.

Additive migrations create device_checks and device_check_calls and add evidence.origin and evidence.normalized_sha256. Historical evidence defaults to unverified origin. Existing investigations and claim decisions are retained. The old evidence-analysis path guards known synthetic/reference origins as UNVERIFIED with closed_set_status HUMAN_REVIEW in its evidence basis, preserving its legacy schema while preventing a MATCH bypass. New photo checks use the five-status API. Daily provider usage is counted across both analysis routes.

## Security and limits

Uploads are capped at one image and 5 MB, with MIME/signature agreement, full decoding, still-image validation, 20-megapixel/8,192-pixel limits and EXIF/GPS removal in the new flow's stored/provider JPEG. Exact raw and normalized hashes detect identical images and metadata-only variants, including concurrent submissions; they do not provide general perceptual, crop or near-duplicate detection. Cross-customer match identities are not disclosed. Dataset assets, evaluation labels and benchmarks are denied by the development file server.

A single image and a general vision model cannot guarantee authenticity or detect all generation, editing or replay. Local vision is now connected; see docs/LOCAL_AI.md. The original hosted-provider benchmark was not run. No live recognition accuracy is claimed. This dataset has 39 generated synthetic images, 12 AI-generated images and 16 open-license references, with no supplied verified real-camera customer collection. Device identity and actual warranty eligibility need real linked evidence and verified company data.

## Reproduce checks

From the project root, use Node >=22.12 and Python with the supplied dataset requirements:

```sh
npm ci
python -m pip install -r datasets/six-product-v1/requirements.txt
npm run dataset:validate
npm run dataset:test
npm run dataset:index
npm test
npm run build
npm run benchmark:requests
npm run benchmark:policy
npm run dev
```

Ship shared/ and datasets/six-product-v1/ with the backend, including catalog.json, data/assets.json and provenance_hashes.json. Configure ANTHROPIC_API_KEY and CLAUDE_MODEL in the existing .env only when live analysis is intended. Keys are never included in deliverables.

benchmark/requests.generated.json contains the frozen 162 image requests. benchmark/policy-predictions.csv measures 84 deterministic observation-policy fixtures; this is not image recognition performance. sample-policy-results.json labels its examples as policy fixtures. integration-measurements.json marks the unexecuted live vision benchmark NOT_RUN. No image-model graphs or accuracy comparisons are fabricated.
