import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { catalog } from "../src/catalog.js";
import { evaluateDeviceCheck } from "../src/services/deviceCheckPolicy.js";
const root = new URL("../../datasets/six-product-v1/", import.meta.url);
const cases = JSON.parse(
  await readFile(new URL("data/cases.json", root), "utf8"),
).filter((c) => c.evaluation_mode === "policy_fixture");
const checks = Array.from({ length: 10 }, (_, i) => ({
  id: `R${i + 1}`,
  status: "PASS",
}));
const rows = [];
const samples = {};
for (const c of cases) {
  const selected = catalog.find((d) => d.id === c.selected_model_id);
  const actual =
    catalog.find((d) => c.case_id.endsWith(`--observed-${d.id}`)) || selected;
  const signals = {
    synthetic_indication: "SYNTHETIC_SIGNAL",
    damage_edit_indication: "EDIT_SIGNAL",
    replay_indication: "REPLAY_SIGNAL",
  };
  const observations = {
    quality: c.evidence_quality.toUpperCase(),
    device_category: actual.category,
    observed_brand: actual.brand,
    observed_model_text:
      c.observed_relation === "outside_catalog" ? null : actual.model,
    serial_text: null,
    identifying_evidence_kind:
      c.observed_relation === "unverified" ? "NONE" : "LABEL",
    identifier_linked_to_pictured_device: true,
    outside_catalog: c.observed_relation === "outside_catalog",
    authenticity_assessed: true,
    authenticity_signals: signals[c.authenticity_signal]
      ? [signals[c.authenticity_signal]]
      : [],
    confidence: null,
  };
  const start = performance.now();
  const result = evaluateDeviceCheck({
    selected_model_id: c.selected_model_id,
    observations,
    claimChecks: checks,
    duplicate: c.authenticity_signal === "exact_hash_on_other_claim",
    registryConflict: c.authenticity_signal === "registry_conflict",
  });
  const ms = performance.now() - start;
  rows.push({
    model_name: "DETERMINISTIC_POLICY_ONLY",
    case_id: c.case_id,
    selected_model_id: c.selected_model_id,
    expected_status: c.expected_status,
    predicted_status: result.status,
    reason_code: result.reason_code,
    confidence: "",
    latency_ms: ms.toFixed(5),
    evaluation_mode: "policy_fixture",
  });
  samples[result.decision === "APPROVE" ? "APPROVE" : result.status] ??= {
    ...result,
    sample_scope: "OBSERVATION_POLICY_FIXTURE_ONLY_NOT_A_REAL_IMAGE_PREDICTION",
  };
}
const fields = Object.keys(rows[0]);
const csv =
  [
    fields.join(","),
    ...rows.map((r) =>
      fields.map((k) => JSON.stringify(String(r[k]))).join(","),
    ),
  ].join("\n") + "\n";
await writeFile(new URL("benchmark/policy-predictions.csv", root), csv);
await writeFile(
  new URL("benchmark/sample-policy-results.json", root),
  JSON.stringify(samples, null, 2) + "\n",
);
const summary = {
  evaluation_mode: "POLICY_FIXTURES_ONLY",
  total: rows.length,
  matched: rows.filter((r) => r.expected_status === r.predicted_status).length,
  not_image_recognition_accuracy: true,
  image_model_benchmarks: [
    {
      model_name: process.env.CLAUDE_MODEL || "Claude vision (not configured)",
      status: "NOT_RUN",
      reason:
        "No live provider benchmark was executed. Integration tests use a mock provider.",
    },
  ],
};
await writeFile(
  new URL("benchmark/integration-measurements.json", root),
  JSON.stringify(summary, null, 2) + "\n",
);
console.log(JSON.stringify(summary, null, 2));
