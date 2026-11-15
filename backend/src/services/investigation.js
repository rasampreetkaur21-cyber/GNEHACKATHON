import { randomUUID } from "node:crypto";
import { ENGINE_VERSION, evaluate } from "../rules/engine.js";
import { buildContext } from "./reconciliation.js";
export function investigate(db, claim) {
  return db.transaction(() => {
    const context = buildContext(db, claim);
    const evaluated = evaluate(context);
    const id = randomUUID();
    db.prepare(
      "INSERT INTO investigations(id,claim_id,outcome,engine_version,explanation,next_evidence,reconciliation,snapshot,private_links) VALUES(?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      claim.id,
      evaluated.outcome,
      evaluated.engineVersion,
      evaluated.explanation,
      JSON.stringify(evaluated.nextEvidence),
      JSON.stringify(evaluated.reconciliation),
      JSON.stringify({ ...context, links: undefined }),
      JSON.stringify(evaluated.privateLinks),
    );
    for (const r of evaluated.results)
      db.prepare(
        "INSERT INTO rule_results(id,investigation_id,rule_id,status,explanation,evidence_ids,rule_version,severity,essential,record_ids) VALUES(?,?,?,?,?,?,?,?,?,?)",
      ).run(
        randomUUID(),
        id,
        r.ruleId,
        r.status,
        r.reason,
        JSON.stringify(r.evidenceIds),
        r.ruleVersion,
        r.severity,
        Number(r.essential),
        JSON.stringify(r.recordIds),
      );
    db.prepare("DELETE FROM stale_device_investigations WHERE claim_id=?").run(
      claim.id,
    );
    return { id, ...evaluated };
  })();
}
export function readInvestigation(db, claimId, role = "customer", id) {
  if (
    !id &&
    db
      .prepare("SELECT 1 FROM stale_device_investigations WHERE claim_id=?")
      .get(claimId)
  )
    db.transaction(() => {
      const claim = db
        .prepare(
          `SELECT c.* FROM claims c JOIN stale_device_investigations s ON s.claim_id=c.id
         WHERE c.id=? AND c.status NOT IN ('APPROVED','REJECTED')`,
        )
        .get(claimId);
      if (claim) investigate(db, claim);
    }).immediate();
  const row = id
    ? db
        .prepare("SELECT * FROM investigations WHERE id=? AND claim_id=?")
        .get(id, claimId)
    : db
        .prepare(
          "SELECT * FROM investigations WHERE claim_id=? ORDER BY rowid DESC LIMIT 1",
        )
        .get(claimId);
  if (!row) return null;
  const results = db
    .prepare(
      "SELECT rule_id ruleId,rule_version ruleVersion,status,severity,essential,explanation,evidence_ids,record_ids FROM rule_results WHERE investigation_id=? ORDER BY rule_id",
    )
    .all(row.id)
    .map((r) => ({
      ruleId: r.ruleId,
      ruleVersion: r.ruleVersion,
      status: r.status,
      severity: r.severity,
      essential: !!r.essential,
      reason: r.explanation,
      explanation: r.explanation,
      evidenceIds: JSON.parse(r.evidence_ids),
      recordIds: JSON.parse(r.record_ids),
    }));
  return {
    id: row.id,
    claim_id: row.claim_id,
    outcome: row.outcome,
    engineVersion: row.engine_version,
    explanation: row.explanation,
    created_at: row.created_at,
    results,
    nextEvidence: JSON.parse(row.next_evidence),
    reconciliation: JSON.parse(row.reconciliation),
    ...(role === "reviewer"
      ? { privateLinks: JSON.parse(row.private_links) }
      : {}),
  };
}
export function audit(db, claimId, actorId, action, detail) {
  const id=randomUUID();
  db.prepare(
    "INSERT INTO audit_events(id,claim_id,actor_id,action,detail) VALUES(?,?,?,?,?)",
  ).run(id, claimId, actorId, action, detail);
  return id;
}

export function refreshLegacyInvestigations(db) {
  return db
    .transaction(() => {
      const claims = db
        .prepare(
          `SELECT c.* FROM claims c WHERE c.status NOT IN ('APPROVED','REJECTED')
         AND (EXISTS(SELECT 1 FROM stale_device_investigations s WHERE s.claim_id=c.id)
           OR COALESCE((SELECT engine_version FROM investigations
             WHERE claim_id=c.id ORDER BY rowid DESC LIMIT 1),'')<>?)`,
        )
        .all(ENGINE_VERSION);
      for (const claim of claims) investigate(db, claim);
      return claims.length;
    })
    .immediate();
}
