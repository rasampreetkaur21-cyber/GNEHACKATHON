# Antigravity/Codex handoff prompt

Integrate this package into the existing ClaimShield website. Read README.md, catalog.json, integration_contract.json, data/assets.json, data/cases.json and CLAUDE_JUDGE_PROMPT.md first.

Use only the six catalog IDs in catalog.json. Remove or disable every other product option from selectors, demo data, server validation and API responses. Keep the supplied legacy ZIP untouched.

Implement one-image verification with this contract:

selected_model_id + image -> {status, observed_model_id, reason_code, reason, next_action, confidence, authenticity}

Enforce:

- same selected model plus linked readable model evidence -> VALID_MATCH
- different supported catalog model -> DEVICE_MISMATCH
- unsupported or unrelated clear subject -> INVALID_DEVICE
- blurry/dark/cropped/occluded/glare/low-resolution/packaging-only/no linked evidence -> UNCLEAR_IMAGE
- synthetic/edit/replay/duplicate/registry conflict -> HUMAN_REVIEW

Add tests for every status, all six selected models, all fifteen cross-model pairs, unsupported objects, malformed uploads, duplicate hashes and synthetic-origin fixtures. Do not equate VALID_MATCH with claim approval. Keep real, open-license, user-camera, generated and augmented origins separate.

Run the validator, unit tests, and measured benchmark. Generate graphs only from actual benchmark/predictions.csv rows. Report all unmeasured models as NOT_RUN.
