import {
  identityKey,
  modelIdentityKey,
  readable,
  usableObservation,
  validDate,
} from "../rules/engine.js";
import { validateObservations } from "../ai/schemas.js";
function observations(row, claim) {
  try {
    if (!usableObservation(row, claim)) return null;
    return validateObservations(
      typeof row.observations === "string"
        ? JSON.parse(row.observations)
        : row.observations,
      row.kind,
    );
  } catch {
    return null;
  }
}
export function buildContext(db, claim) {
  // Legacy integer column remains compatible. Uncertain counts are not zero repairs.
  if (claim.questionnaire_json) {
    const a = JSON.parse(claim.questionnaire_json);
    claim = { ...claim, previous_repairs: a.repairs === "No" ? 0 : null };
  }
  const evidence = db
    .prepare(
      "SELECT * FROM evidence WHERE claim_id=? AND active=1 ORDER BY rowid",
    )
    .all(claim.id);
  const annotations = db
    .prepare(
      "SELECT a.* FROM evidence_annotations a JOIN evidence e ON e.id=a.evidence_id WHERE e.claim_id=? AND e.active=1 ORDER BY a.rowid",
    )
    .all(claim.id);
  const deviceVerifications = db
    .prepare(
      `SELECT v.evidence_id,v.claim_id,v.catalog_id,v.status,v.reason,v.next_action,v.image_sha256,v.active
       FROM device_verifications v JOIN evidence e ON e.id=v.evidence_id AND e.claim_id=v.claim_id
       WHERE v.claim_id=? AND v.catalog_id=? AND v.active=1 AND e.kind='photo'
         AND e.active=1 AND e.sha256=v.image_sha256
       ORDER BY v.rowid DESC`,
    )
    .all(claim.id, claim.catalog_id ?? null);
  const parsed = evidence
    .map((e) => ({ e, o: observations(e, claim) }))
    .filter((x) => x.o);
  const serialCandidates = [
    claim.serial,
    ...parsed.map((x) =>
      x.o.unknown_fields.includes(
        x.e.kind === "invoice" ? "serial_number" : "serial_text",
      )
        ? "UNKNOWN"
        : x.o.serial_number || x.o.serial_text,
    ),
  ]
    .map(identityKey)
    .filter(Boolean);
  const serial = serialCandidates[0];
  const registryRows = db
    .prepare(
      "SELECT * FROM serial_registry WHERE synthetic=? ORDER BY verified DESC,serial",
    )
    .all(claim.synthetic)
    .filter((r) => identityKey(r.serial) === serial);
  const topRegistry = registryRows.filter(
    (r) => r.verified === registryRows[0]?.verified,
  );
  const registryAmbiguous =
    new Set(
      topRegistry.map((r) =>
        JSON.stringify([
          r.product,
          modelIdentityKey(r.model),
          r.purchase_date,
          r.service_count,
        ]),
      ),
    ).size > 1;
  const registry = registryAmbiguous ? undefined : topRegistry[0];
  const purchase =
    registry?.verified === 1 ? registry.purchase_date : claim.purchase_date;
  const policyRows = db
    .prepare(
      `SELECT * FROM warranty_policies WHERE product=? AND synthetic=?
       AND (id GLOB 'SYNTHETIC-V2-POLICY-*')=?
       ORDER BY verified DESC,COALESCE(effective_from,'') DESC,id`,
    )
    .all(
      claim.product,
      claim.synthetic,
      Number(
        claim.synthetic === 1 &&
          claim.user_id === "synthetic-owner-v2" &&
          !!claim.fixture_id,
      ),
    )
    .filter(
      (p) =>
        (!p.effective_from ||
          (validDate(purchase) && p.effective_from <= purchase)) &&
        (!p.effective_to ||
          (validDate(purchase) && p.effective_to >= purchase)),
    );
  const topPolicies = policyRows.filter(
    (p) =>
      p.verified === policyRows[0]?.verified &&
      p.effective_from === policyRows[0]?.effective_from,
  );
  const policyAmbiguous =
    new Set(
      topPolicies.map((p) =>
        JSON.stringify([p.months, p.auto_approve_limit_minor, p.currency]),
      ),
    ).size > 1;
  const policy = policyAmbiguous ? undefined : topPolicies[0];
  const sellers = db
    .prepare("SELECT * FROM authorized_sellers WHERE synthetic=? ORDER BY id")
    .all(claim.synthetic);
  const services = db
    .prepare(
      "SELECT * FROM service_records WHERE synthetic=? ORDER BY service_date,id",
    )
    .all(claim.synthetic)
    .filter((r) => serial && identityKey(r.serial) === serial);
  const diagnostics = db
    .prepare("SELECT * FROM diagnostic_records WHERE synthetic=? ORDER BY id")
    .all(claim.synthetic)
    .filter((r) => serial && identityKey(r.serial) === serial);
  const other = db
    .prepare(
      "SELECT id,serial FROM claims WHERE user_id<>? AND synthetic=? AND is_draft=0 ORDER BY id",
    )
    .all(claim.user_id, claim.synthetic);
  const links = [];
  for (const c of other) {
    if (serial && identityKey(c.serial) === serial)
      links.push({
        type: "SERIAL",
        otherClaimId: c.id,
        evidenceId:
          parsed.find(
            (x) => identityKey(x.o.serial_number || x.o.serial_text) === serial,
          )?.e.id || null,
      });
  }
  const ownInvoices = parsed.filter(
    (x) =>
      x.e.kind === "invoice" &&
      !x.o.unknown_fields.includes("invoice_number") &&
      readable(x.o.invoice_number),
  );
  if (ownInvoices.length) {
    const invoices = db
      .prepare(
        "SELECT e.* FROM evidence e JOIN claims c ON c.id=e.claim_id WHERE c.user_id<>? AND c.synthetic=? AND c.is_draft=0 AND e.kind='invoice' AND e.active=1 AND e.processing_status IN ('ANALYSIS_COMPLETE','SIMULATED_FIXTURE') ORDER BY e.id",
      )
      .all(claim.user_id, claim.synthetic);
    for (const e of invoices) {
      const o = observations(e, claim);
      if (!o || o.unknown_fields.includes("invoice_number")) continue;
      for (const x of ownInvoices)
        if (
          identityKey(o.invoice_number) &&
          identityKey(o.invoice_number) === identityKey(x.o.invoice_number)
        )
          links.push({
            type: "INVOICE",
            otherClaimId: e.claim_id,
            otherEvidenceId: e.id,
            evidenceId: x.e.id,
          });
    }
  }
  for (const e of evidence.filter(
    (e) =>
      ["image/png", "image/jpeg", "image/webp"].includes(e.mime) &&
      /^[a-f0-9]{64}$/.test(e.sha256),
  )) {
    const duplicates = db
      .prepare(
        "SELECT e.id,e.claim_id FROM evidence e JOIN claims c ON c.id=e.claim_id WHERE e.sha256=? AND e.active=1 AND c.user_id<>? AND c.synthetic=? AND c.is_draft=0 ORDER BY e.id",
      )
      .all(e.sha256, claim.user_id, claim.synthetic);
    for (const d of duplicates)
      links.push({
        type: "IMAGE",
        evidenceId: e.id,
        otherClaimId: d.claim_id,
        otherEvidenceId: d.id,
      });
  }
  const historyCount = db
    .prepare(
      "SELECT COUNT(*) n FROM claims WHERE user_id=? AND id<>? AND is_draft=0 AND synthetic=?",
    )
    .get(claim.user_id, claim.id, claim.synthetic).n;
  return {
    claim,
    evidence,
    annotations,
    deviceVerifications,
    registry,
    policy,
    sellers,
    services,
    diagnostics,
    links,
    historyCount,
    linkageChecked: true,
    registryCandidates: topRegistry,
    policyCandidates: topPolicies,
    registryAmbiguous,
    policyAmbiguous,
  };
}
