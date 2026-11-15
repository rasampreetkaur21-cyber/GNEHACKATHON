import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { evaluate, chooseVerdict } from "../src/rules/engine.js";
const fixtures = JSON.parse(
  readFileSync(new URL("./fixtures/phase3-cases.json", import.meta.url)),
);
const catalogId = "samsung-galaxy-a36-5g";
const input = (key = "A") => {
  const c = structuredClone(fixtures[key].input);
  if (key === "C") return c;
  Object.assign(c.claim, {
    catalog_id: catalogId,
    product: "Mobile phone",
    model: "Galaxy A36 5G",
  });
  Object.assign(c.registry, { product: "Mobile phone", model: "SM-A366B" });
  c.policy.product = "Mobile phone";
  Object.assign(c.evidence[0].observations, {
    product_name: "Mobile phone",
    product_model: "SM-A366E/DS",
  });
  const photo = c.evidence[1];
  Object.assign(photo.observations, {
    device_category: "Mobile phone",
    model_text: "A36 5G",
  });
  c.deviceVerifications = [
    {
      active: 1,
      claim_id: c.claim.id,
      catalog_id: catalogId,
      evidence_id: photo.id,
      image_sha256: photo.sha256,
      status: "MATCH",
      reason: "The factory label identifies the selected model.",
      next_action: "Keep the photo with the claim.",
    },
  ];
  return c;
};
const rule = (data, id) => evaluate(data).results.find((r) => r.ruleId === id);
describe("Version 3.1 rule registry with independent synthetic fixtures", () => {
  it.each(["A", "B", "C", "D"])(
    "scenario %s matches its independently specified outcome",
    (key) => expect(evaluate(input(key)).outcome).toBe(fixtures[key].expected),
  );
  it("returns all ten versioned rules with grounded references, without mutating original values", () => {
    const c = input();
    const before = structuredClone(c);
    const r = evaluate(c);
    expect(r.results.map((r) => r.ruleId)).toEqual([
      "R01",
      "R02",
      "R03",
      "R04",
      "R05",
      "R06",
      "R07",
      "R08",
      "R09",
      "R10",
    ]);
    for (const result of r.results) {
      expect(result.ruleVersion).toBe("1.0");
      expect(["PASS", "FAIL", "UNKNOWN"]).toContain(result.status);
      expect(typeof result.essential).toBe("boolean");
      expect(result.reason.length).toBeGreaterThan(10);
      expect(
        result.evidenceIds.every((id) => c.evidence.some((e) => e.id === id)),
      ).toBe(true);
    }
    expect(c).toEqual(before);
    expect(evaluate(c)).toEqual(r);
  });
  it("R01 matches clear serials without guessing ambiguous OCR characters", () => {
    expect(rule(input(), "R01").status).toBe("PASS");
    const c = input();
    c.evidence[0].observations.serial_number = "WM-O/0-123";
    c.evidence[0].observations.unknown_fields.push("serial_number");
    expect(rule(c, "R01").status).toBe("PASS");
    c.evidence[1].observations.serial_text = "UNKNOWN";
    expect(rule(c, "R01").status).toBe("UNKNOWN");
  });
  it("R01 detects serial and model mismatches and preserves the original strings", () => {
    const c = input();
    c.evidence[0].observations.serial_number = "OTHER-999";
    expect(rule(c, "R01").status).toBe("FAIL");
    expect(evaluate(c).outcome).toBe("ESCALATE");
    expect(
      evaluate(c).reconciliation.facts.find(
        (f) => f.id === "evidence:invoice-a:serial_number",
      ).value,
    ).toBe("OTHER-999");
    expect(rule(c, "R01").reason).toContain("serial numbers disagree");
    expect(rule(c, "R04").status).toBe("PASS");
    c.evidence[0].observations.serial_number = c.claim.serial;
    expect(rule(c, "R01").status).toBe("PASS");
    c.evidence[0].observations.product_model = "Galaxy A56 5G";
    expect(rule(c, "R01").status).toBe("FAIL");
  });
  it("R02 rejects only as a recommendation when independently anchored; asserted expiry escalates", () => {
    const c = input("D");
    expect(rule(c, "R02").status).toBe("FAIL");
    expect(evaluate(c).outcome).toBe("REJECT_RECOMMENDED");
    c.registry.verified = 0;
    expect(rule(c, "R02").status).toBe("FAIL");
    expect(evaluate(c).outcome).toBe("ESCALATE");
  });
  it("R02 treats inconsistent purchase dates as a material contradiction even when registry coverage expired", () => {
    const c = input("D");
    c.evidence[0].observations.invoice_date = "2026-01-15";
    expect(evaluate(c).outcome).toBe("ESCALATE");
    expect(rule(c, "R02").materialContradiction).toBe(true);
  });
  it("R02 handles exact expiry and leap-day month clamping", () => {
    const c = input();
    c.claim.purchase_date =
      c.registry.purchase_date =
      c.evidence[0].observations.invoice_date =
        "2024-02-29";
    c.claim.incident_date = "2025-02-28";
    expect(rule(c, "R02").status).toBe("PASS");
    c.claim.incident_date = "2025-03-01";
    expect(rule(c, "R02").status).toBe("FAIL");
  });
  it("R03 is UNKNOWN/INFO without a configured seller list and escalates an actual authorization mismatch", () => {
    const c = input();
    c.sellers = [];
    expect(rule(c, "R03")).toMatchObject({
      status: "UNKNOWN",
      severity: "INFO",
      essential: false,
    });
    c.sellers = input().sellers;
    c.sellers[0].authorized = 0;
    expect(rule(c, "R03").status).toBe("FAIL");
    expect(evaluate(c).outcome).toBe("ESCALATE");
  });
  it("R04 needs exact-model verification even when the uploaded phone category matches", () => {
    const c = input();
    c.deviceVerifications = [];
    expect(rule(c, "R04").status).toBe("UNKNOWN");
    expect(evaluate(c).outcome).toBe("NEEDS_EVIDENCE");
    expect(evaluate(c).reconciliation.essentialEvidence).toBe(false);
  });
  it.each([
    ["INVALID_DEVICE", "FAIL", "ESCALATE"],
    ["UNVERIFIED", "UNKNOWN", "NEEDS_EVIDENCE"],
  ])(
    "uses the active %s result and passes its correction to the evidence requests",
    (status, ruleStatus, outcome) => {
      const c = input();
      const [match] = c.deviceVerifications;
      const photo = { ...c.evidence[1], id: "second-photo" };
      c.evidence.push(photo);
      c.deviceVerifications.push({
        ...match,
        evidence_id: photo.id,
        status,
        reason: "This photo did not identify the selected device.",
        next_action: "Retake the device photo with its factory label visible.",
      });
      const result = evaluate(c);
      expect(result.outcome).toBe(outcome);
      expect(result.results.find((r) => r.ruleId === "R04")).toMatchObject({
        status: ruleStatus,
        evidenceIds: [photo.id],
      });
      expect(result.nextEvidence).toContainEqual(
        expect.objectContaining({
          key: "product_photo",
          text: "Retake the device photo with its factory label visible.",
        }),
      );
    },
  );
  it("ignores inactive, foreign and wrong-image verification results", () => {
    const c = input();
    const [match] = c.deviceVerifications;
    for (const invalid of [
      { active: 0 },
      { claim_id: "another-claim" },
      { catalog_id: "samsung-galaxy-a56-5g" },
      { image_sha256: "another-image" },
      { evidence_id: c.evidence[0].id, image_sha256: c.evidence[0].sha256 },
    ]) {
      c.deviceVerifications = [{ ...match, ...invalid }];
      expect(rule(c, "R04").status).toBe("UNKNOWN");
      expect(evaluate(c).outcome).toBe("NEEDS_EVIDENCE");
    }
  });
  it("keeps a same-model serial discrepancy in R01 and treats device verification as uncertain", () => {
    const c = input();
    c.evidence[1].observations.serial_text = "OTHER-999";
    c.deviceVerifications[0].status = "UNVERIFIED";
    const result = evaluate(c);
    expect(result.results.find((r) => r.ruleId === "R01")).toMatchObject({
      status: "FAIL",
      reason: expect.stringContaining("serial numbers disagree"),
    });
    expect(result.results.find((r) => r.ruleId === "R04").status).toBe(
      "UNKNOWN",
    );
    expect(result.outcome).toBe("NEEDS_EVIDENCE");
  });
  it("R05 flags only clear damage contradictions, leaving ambiguous descriptions UNKNOWN", () => {
    const c = input();
    c.evidence[1].observations.visible_cracks = "VISIBLE";
    c.evidence[1].observations.visible_damage_types = ["CRACK"];
    expect(rule(c, "R05").status).toBe("UNKNOWN");
    c.claim.declared_no_visible_damage = 1;
    expect(rule(c, "R05").status).toBe("FAIL");
  });
  it("R06 reports only visible indicators and does not infer hidden damage or intentional misuse", () => {
    const c = input();
    expect(rule(c, "R06").status).toBe("PASS");
    c.evidence[1].observations.visible_liquid_contact_indicator = "UNKNOWN";
    expect(rule(c, "R06").status).toBe("UNKNOWN");
    c.evidence[1].observations.visible_liquid_contact_indicator = "VISIBLE";
    expect(rule(c, "R06").status).toBe("FAIL");
    expect(rule(c, "R06").reason).toContain("not inferred");
  });
  it("R07 surfaces cross-customer identity linkage without including linked customer identifiers in public rule reasoning", () => {
    const c = input();
    c.links = [
      {
        type: "SERIAL",
        otherClaimId: "private-other-id",
        evidenceId: "invoice-a",
      },
    ];
    const r = rule(c, "R07");
    expect(r.status).toBe("FAIL");
    expect(r.reason).not.toContain("private-other-id");
    expect(r.evidenceIds).toEqual(["invoice-a"]);
  });
  it("R08 treats exact cross-customer reuse as escalation, not proof of misconduct", () => {
    const c = input();
    c.links = [
      {
        type: "IMAGE",
        otherClaimId: "private-other-id",
        evidenceId: "photo-a",
      },
    ];
    expect(rule(c, "R08").status).toBe("FAIL");
    expect(rule(c, "R08").reason).toContain("not proof");
    expect(evaluate(c).outcome).toBe("ESCALATE");
  });
  it("R09 remains informational for arbitrarily large prior-claim history", () => {
    const c = input();
    const before = evaluate(c).outcome;
    c.historyCount = 10000;
    expect(rule(c, "R09")).toMatchObject({
      status: "PASS",
      severity: "INFO",
      essential: false,
    });
    expect(evaluate(c).outcome).toBe(before);
  });
  it("R10 escalates declared or recorded unauthorized repairs and independently contradicted repair history", () => {
    const c = input();
    c.claim.declared_unauthorized_repairs = true;
    expect(rule(c, "R10").status).toBe("FAIL");
    const b = input("B");
    expect(rule(b, "R10").status).toBe("FAIL");
    expect(rule(b, "R10").recordIds).toContain("service:service-b");
    b.services[0].authorized = 0;
    expect(evaluate(b).outcome).toBe("ESCALATE");
  });
  it("R10 never treats missing service records as proof of a repair", () => {
    const c = input();
    c.registry = null;
    c.services = [];
    expect(rule(c, "R10").status).toBe("UNKNOWN");
  });
  it("unknown or unsupported devices produce essential UNKNOWN, not invented matching", () => {
    const c = input("C");
    c.claim.product = "Unsupported appliance";
    c.registry = null;
    c.policy = null;
    expect(rule(c, "R01").status).toBe("UNKNOWN");
    expect(evaluate(c).outcome).toBe("NEEDS_EVIDENCE");
  });
  it("returns three useful missing-evidence requests and does not repeatedly request validated invoice/serial proof", () => {
    const c = evaluate(input("C"));
    expect(c.nextEvidence.map((e) => e.key)).toEqual([
      "invoice",
      "device_label",
      "product_photo",
    ]);
    const good = evaluate(input());
    expect(
      good.nextEvidence.some((e) =>
        ["invoice", "device_label", "product_photo"].includes(e.key),
      ),
    ).toBe(false);
  });
  it("does not use synthetic records as real independent anchors or foreign uploads as references", () => {
    const c = input();
    c.claim.synthetic = 0;
    expect(evaluate(c).outcome).not.toBe("AUTO_APPROVE");
    c.evidence.forEach((e) => (e.claim_id = "another-claim"));
    expect(evaluate(c).results.flatMap((r) => r.evidenceIds)).toEqual([]);
  });
  it("requires an explicit value threshold and the requested amount within it", () => {
    const c = input();
    c.policy.auto_approve_limit_minor = null;
    expect(evaluate(c).outcome).toBe("ESCALATE");
    c.policy.auto_approve_limit_minor = 100;
    expect(evaluate(c).outcome).toBe("ESCALATE");
    c.claim.claim_value_minor = 100;
    expect(evaluate(c).outcome).toBe("AUTO_APPROVE");
  });
});
describe("Conservative ambiguity handling", () => {
  it("does not interpret a quoted or negated damage phrase as a clear denial", () => {
    const c = input();
    c.claim.statement = "I did not say no cracks. Please inspect the screen.";
    c.evidence[1].observations.visible_cracks = "VISIBLE";
    expect(rule(c, "R05").status).toBe("UNKNOWN");
  });
  it("preserves ambiguous original OCR separately from UNKNOWN effective values", () => {
    const c = input();
    c.evidence[0].observations.serial_number = "WM-O/0-123";
    c.evidence[0].observations.unknown_fields.push("serial_number");
    const fact = evaluate(c).reconciliation.facts.find(
      (f) => f.id === "evidence:invoice-a:serial_number",
    );
    expect(fact.value).toBe("UNKNOWN");
    expect(fact.rawValue).toBe("WM-O/0-123");
  });
  it("does not call an unsupported category a contradiction when a photo is otherwise readable", () => {
    const c = input();
    c.claim.product = "Other";
    delete c.claim.catalog_id;
    c.registry = null;
    c.policy = null;
    expect(rule(c, "R04").status).toBe("UNKNOWN");
    expect(
      evaluate(c).nextEvidence.some((e) => e.key === "product_category"),
    ).toBe(true);
    expect(
      evaluate(c).nextEvidence.some((e) => e.key === "product_photo"),
    ).toBe(false);
  });
});
describe("Completeness and corroboration safeguards", () => {
  it("does not promote an all-UNKNOWN invoice to useful purchase proof merely because its observations were confirmed", () => {
    const c = input();
    for (const field of ["invoice_date", "invoice_number", "serial_number"]) {
      c.evidence[0].observations[field] = "UNKNOWN";
      c.evidence[0].observations.unknown_fields.push(field);
    }
    expect(evaluate(c).outcome).toBe("NEEDS_EVIDENCE");
    expect(evaluate(c).nextEvidence.some((e) => e.key === "invoice")).toBe(
      true,
    );
  });
  it("retains a valid product-photo match when a supplementary label photo has an unknown category", () => {
    const c = input();
    const label = structuredClone(c.evidence[1]);
    label.id = "label-photo";
    label.observations.device_category = "UNKNOWN";
    label.observations.unknown_fields.push("device_category");
    c.evidence.push(label);
    expect(rule(c, "R04").status).toBe("PASS");
    expect(evaluate(c).outcome).toBe("AUTO_APPROVE");
  });
  it("detects a clearly different invoice product category", () => {
    const c = input();
    c.evidence[0].observations.product_name = "Laptop";
    expect(rule(c, "R01").status).toBe("FAIL");
  });
});
describe("Exact verdict precedence", () => {
  const base = () => ({
    results: evaluate(input()).results,
    independentAnchor: true,
    policyValid: true,
    valueEligible: true,
    essentialEvidence: true,
    deviceVerificationStatus: "MATCH",
  });
  it("anchored expiry wins over other unknown evidence once the device matches", () => {
    const b = base();
    const warranty = b.results.find((r) => r.ruleId === "R02");
    Object.assign(warranty, { status: "FAIL", failureType: "EXPIRY" });
    b.results.find((r) => r.ruleId === "R01").status = "UNKNOWN";
    b.essentialEvidence = false;
    expect(chooseVerdict(b).outcome).toBe("REJECT_RECOMMENDED");
    Object.assign(
      b.results.find((r) => r.ruleId === "R08"),
      { status: "FAIL", severity: "MAJOR" },
    );
    expect(chooseVerdict(b).outcome).toBe("ESCALATE");
  });
  it("essential or applicable major failures win over missing evidence without a device verification result", () => {
    const b = base();
    b.results.find((r) => r.ruleId === "R01").status = "FAIL";
    b.results.find((r) => r.ruleId === "R04").status = "UNKNOWN";
    b.deviceVerificationStatus = undefined;
    expect(chooseVerdict(b).outcome).toBe("ESCALATE");
  });
  it("unknown essential checks win over automatic eligibility", () => {
    const b = base();
    b.results.find((r) => r.ruleId === "R01").status = "UNKNOWN";
    expect(chooseVerdict(b).outcome).toBe("NEEDS_EVIDENCE");
  });
  it("a saved uncertain or invalid device result takes precedence over anchored expiry", () => {
    const b = base();
    Object.assign(
      b.results.find((r) => r.ruleId === "R02"),
      {
        status: "FAIL",
        failureType: "EXPIRY",
      },
    );
    b.deviceVerificationStatus = "UNVERIFIED";
    expect(chooseVerdict(b).outcome).toBe("NEEDS_EVIDENCE");
    b.deviceVerificationStatus = "INVALID_DEVICE";
    expect(chooseVerdict(b).outcome).toBe("ESCALATE");
  });
  it("all remaining missing anchor/policy/value gates escalate and R09 cannot affect a verdict", () => {
    for (const gate of ["independentAnchor", "policyValid", "valueEligible"]) {
      const b = base();
      b[gate] = false;
      expect(chooseVerdict(b).outcome).toBe("ESCALATE");
    }
    const b = base();
    Object.assign(
      b.results.find((r) => r.ruleId === "R09"),
      { status: "FAIL", severity: "CRITICAL", essential: true },
    );
    expect(chooseVerdict(b).outcome).toBe("AUTO_APPROVE");
  });
});
