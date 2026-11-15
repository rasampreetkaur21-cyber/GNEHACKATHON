import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { catalog } from "../src/catalog.js";
import { evaluateDeviceCheck } from "../src/services/deviceCheckPolicy.js";
const base = JSON.parse(
  readFileSync(
    new URL("../../datasets/six-product-v1/catalog.json", import.meta.url),
  ),
);
const policyCases = JSON.parse(
  readFileSync(
    new URL("../../datasets/six-product-v1/data/cases.json", import.meta.url),
  ),
).filter((c) => c.evaluation_mode === "policy_fixture");
export const observation = (device = catalog[0], extra = {}) => ({
  quality: "CLEAR",
  device_category: device.category,
  observed_brand: device.brand,
  observed_model_text: device.model,
  serial_text: null,
  identifying_evidence_kind: "LABEL",
  identifier_linked_to_pictured_device: true,
  outside_catalog: false,
  authenticity_assessed: true,
  authenticity_signals: [],
  confidence: null,
  ...extra,
});
const checks = Array.from({ length: 10 }, (_, i) => ({
  id: `R${i + 1}`,
  status: "PASS",
}));
const evaluate = (extra = {}) =>
  evaluateDeviceCheck({
    selected_model_id: catalog[0].id,
    observations: observation(),
    claimChecks: checks,
    ...extra,
  });
describe("six-product device decision policy (observation-level, not vision accuracy)", () => {
  it("matches the supplied six-product catalog exactly", () =>
    expect(catalog.map((x) => x.id)).toEqual(base.map((x) => x.model_id)));
  it.each(catalog)(
    "approves $model only when linked evidence, screening and every claim check pass",
    (device) => {
      const r = evaluate({
        selected_model_id: device.id,
        observations: observation(device),
      });
      expect(r.status).toBe("VALID_MATCH");
      expect(r.decision).toBe("APPROVE");
      expect(r.authenticity).toBe("REAL_UNVERIFIED");
      expect(r.confidence).toBeNull();
    },
  );
  const pairs = catalog.flatMap((a, i) =>
    catalog.slice(i + 1).map((b) => [a, b]),
  );
  it.each(pairs)(
    "rejects both directions of cross-model pair %j / %j",
    (a, b) => {
      for (const [selected, observed] of [
        [a, b],
        [b, a],
      ]) {
        const r = evaluate({
          selected_model_id: selected.id,
          observations: observation(observed),
        });
        expect(r.status).toBe("DEVICE_MISMATCH");
        expect(r.decision).toBe("REJECT");
        expect(r.observed_model_id).toBe(observed.id);
      }
    },
  );
  it.each(["phone", "headphones", "laptop", "mug", "scenery", "random object"])(
    "rejects clear unsupported %s",
    (subject) => {
      expect(
        evaluate({
          observations: observation(catalog[0], {
            device_category: subject,
            observed_model_text: null,
            observed_brand: null,
            identifying_evidence_kind: "NONE",
            identifier_linked_to_pictured_device: null,
            outside_catalog: true,
          }),
        }),
      ).toMatchObject({ status: "INVALID_DEVICE", decision: "REJECT" });
    },
  );
  it.each(["BLURRY", "DARK", "CROPPED", "OCCLUDED", "GLARE", "LOW_RESOLUTION"])(
    "requests retake for %s",
    (quality) =>
      expect(
        evaluate({ observations: observation(catalog[0], { quality }) }),
      ).toMatchObject({ status: "UNCLEAR_IMAGE", decision: "NEEDS_RETAKE" }),
  );
  it("does not approve lookalikes, packaging, detached labels, missing authenticity or failing/unknown checks", () => {
    expect(
      evaluate({
        observations: observation(catalog[0], {
          identifying_evidence_kind: "NONE",
        }),
      }).status,
    ).toBe("UNCLEAR_IMAGE");
    expect(
      evaluate({
        observations: observation(catalog[0], {
          identifying_evidence_kind: "BOX",
        }),
      }).status,
    ).toBe("UNCLEAR_IMAGE");
    expect(
      evaluate({
        observations: observation(catalog[0], {
          identifier_linked_to_pictured_device: false,
        }),
      }).status,
    ).toBe("UNCLEAR_IMAGE");
    expect(
      evaluate({
        observations: observation(catalog[0], { authenticity_assessed: false }),
      }).status,
    ).toBe("HUMAN_REVIEW");
    for (const c of [
      [],
      [{ id: "x", status: "UNKNOWN" }],
      [{ id: "x", status: "FAIL" }],
    ])
      expect(evaluate({ claimChecks: c })).toMatchObject({
        status: "VALID_MATCH",
        decision: "ESCALATE",
      });
  });
  it.each([
    "generated_synthetic",
    "ai_generated",
    "augmented_real",
    "digital_edit",
    "simulated_screenshot",
    "real_open_license",
  ])("routes provenance %s to review even with linked evidence", (origin) =>
    expect(evaluate({ origin })).toMatchObject({
      status: "HUMAN_REVIEW",
      decision: "ESCALATE",
    }),
  );
  it.each([
    "SYNTHETIC_SIGNAL",
    "EDIT_SIGNAL",
    "REPLAY_SIGNAL",
    "SUSPICIOUS_SIGNAL",
  ])("routes visible %s to review", (signal) =>
    expect(
      evaluate({
        observations: observation(catalog[0], {
          authenticity_signals: [signal],
        }),
      }),
    ).toMatchObject({ status: "HUMAN_REVIEW", decision: "ESCALATE" }),
  );
  it("prioritizes duplicate and registry concerns and never approves missing analysis", () => {
    expect(evaluate({ duplicate: true, observations: null })).toMatchObject({
      status: "HUMAN_REVIEW",
      authenticity: "DUPLICATE_SIGNAL",
    });
    expect(evaluate({ registryConflict: true })).toMatchObject({
      status: "HUMAN_REVIEW",
      reason_code: "REGISTRY_CONFLICT",
    });
    expect(
      evaluate({ observations: null, analysisError: "AI_NOT_CONFIGURED" }),
    ).toMatchObject({
      status: "HUMAN_REVIEW",
      decision: "ESCALATE",
      confidence: null,
    });
  });
  it.each(policyCases)("implements dataset policy fixture $case_id", (c) => {
    const selected = catalog.find((x) => x.id === c.selected_model_id);
    const actual =
      catalog.find((x) => c.case_id.endsWith(`--observed-${x.id}`)) || selected;
    const signals = {
      synthetic_indication: "SYNTHETIC_SIGNAL",
      damage_edit_indication: "EDIT_SIGNAL",
      replay_indication: "REPLAY_SIGNAL",
    };
    const o = observation(actual, {
      quality: c.evidence_quality.toUpperCase(),
      identifying_evidence_kind:
        c.observed_relation === "unverified" ? "NONE" : "LABEL",
      outside_catalog: c.observed_relation === "outside_catalog",
      observed_model_text:
        c.observed_relation === "outside_catalog" ? null : actual.model,
      authenticity_signals: signals[c.authenticity_signal]
        ? [signals[c.authenticity_signal]]
        : [],
    });
    const r = evaluate({
      selected_model_id: selected.id,
      observations: o,
      duplicate: c.authenticity_signal === "exact_hash_on_other_claim",
      registryConflict: c.authenticity_signal === "registry_conflict",
    });
    expect(r.status).toBe(c.expected_status);
  });
  it("rejects a reliably linked but unsupported model code even without a provider outside-catalog flag", () => {
    expect(
      evaluate({
        observations: observation(catalog[0], {
          observed_model_text: "Galaxy A25 5G",
          outside_catalog: null,
        }),
      }),
    ).toMatchObject({ status: "INVALID_DEVICE", decision: "REJECT" });
  });
});
