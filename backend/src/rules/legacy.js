// Pure deterministic evaluation. Customer statements never establish independent verification.
export function evaluate({ claim, evidence, policy, registry }) {
  const refs = evidence.map((e) => e.id);
  const trusted =
    registry?.verified === 1 && registry.synthetic === claim.synthetic;
  const trustedPolicy =
    policy?.verified === 1 && policy.synthetic === claim.synthetic;
  const result = (ruleId, status, explanation, evidenceIds = []) => ({
    ruleId,
    status,
    explanation,
    evidenceIds,
  });
  const identity = !trusted
    ? result(
        "R01",
        "UNKNOWN",
        "No independently verified product identity is available.",
      )
    : result(
        "R01",
        registry.product === claim.product ? "PASS" : "FAIL",
        registry.product === claim.product
          ? "Product matches the independently maintained serial record."
          : "Product and serial registry differ; a reviewer must resolve this.",
      );
  let eligibility = result(
    "R02",
    "UNKNOWN",
    "A verified applicable policy and purchase record are required.",
  );
  if (trusted && trustedPolicy && registry.product === claim.product) {
    const date = new Date(registry.purchase_date + "T00:00:00Z");
    const originalDay = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + policy.months);
    const last = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
    ).getUTCDate();
    date.setUTCDate(Math.min(originalDay, last));
    const incident = new Date(claim.incident_date + "T00:00:00Z");
    eligibility = result(
      "R02",
      incident >= new Date(registry.purchase_date + "T00:00:00Z") &&
        incident <= date
        ? "PASS"
        : "FAIL",
      `Verified coverage runs from ${registry.purchase_date} through ${date.toISOString().slice(0, 10)}; incident date is ${claim.incident_date}.`,
    );
  }
  const missing = ["invoice", "photo"].filter(
    (kind) => !evidence.some((e) => e.kind === kind),
  );
  const required = result(
    "R03",
    missing.length ? "UNKNOWN" : "PASS",
    missing.length
      ? `Please provide: ${missing.join(", ")}. Missing evidence does not imply misconduct.`
      : "Invoice and product photograph are present; document contents still require review.",
    refs,
  );
  const service = !trusted
    ? result("R04", "UNKNOWN", "Independent service history is unavailable.")
    : result(
        "R04",
        registry.service_count === claim.previous_repairs &&
          registry.purchase_date === claim.purchase_date
          ? "PASS"
          : "FAIL",
        registry.service_count === claim.previous_repairs &&
          registry.purchase_date === claim.purchase_date
          ? "Declared repair count and purchase date agree with registry."
          : "Declared service count or purchase date differs from the registry; clarification is required.",
      );
  const verification = result(
    "R05",
    trusted ? "PASS" : "UNKNOWN",
    trusted
      ? "Registry provenance is verified for this claim environment."
      : "Registry is missing or unverified; manual verification required.",
  );
  const results = [identity, eligibility, required, service, verification];
  let outcome = "ESCALATE";
  if (identity.status === "FAIL" || service.status === "FAIL")
    outcome = "ESCALATE";
  else if (eligibility.status === "FAIL") outcome = "REJECT_RECOMMENDED";
  else if (missing.length) outcome = "NEEDS_EVIDENCE";
  else if (results.every((r) => r.status === "PASS")) outcome = "AUTO_APPROVE";
  return { outcome, results }; // Every outcome remains advisory; only reviewers finalize claims.
}
