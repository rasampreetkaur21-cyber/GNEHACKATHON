import { createDefaultAdapter } from "../ai/provider.js";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  ClaudeVisionAdapter,
  AnalysisError,
  PROMPT_VERSION,
} from "../ai/claude.js";
import { prepareImage } from "./images.js";
import { audit, investigate } from "./investigation.js";
import { storeDeviceVerification } from "./deviceVerification.js";
import { digest, HttpError } from "../utils/security.js";
export const evidenceColumns =
  "id,claim_id,kind,original_name,mime,size,sha256,synthetic,created_at,trust_tier,processing_status,observations,source_reference,prompt_version,analyzed_at,error_code,processing_message,width,height,verified_at,active,replaces_evidence_id,scan_report_json,live_session_id";
export function publicEvidence(row) {
  return {
    ...row,
    observations: row.observations ? JSON.parse(row.observations) : null,
    scan_report: row.scan_report_json ? JSON.parse(row.scan_report_json) : null,
  };
}
export function createAnalysisService({
  db,
  uploads,
  adapter = createDefaultAdapter(),
  dailyBudget = process.env.AI_DAILY_BUDGET_CALLS ?? "20",
  userBudget = 10,
}) {
  const parsed = Number(dailyBudget);
  const budget = Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
  const tasks = new Set();
  let queuedTimer;
  const getClaim = (id) =>
    db.prepare("SELECT * FROM claims WHERE id=?").get(id);

  function recordFailure(
    evidence,
    code,
    promptVersion = PROMPT_VERSION,
    model = null,
  ) {
    if (evidence.kind !== "photo") return;
    const claim = getClaim(evidence.claim_id);
    const changed = storeDeviceVerification(db, evidence, claim, {
      errorCode: code,
      promptVersion,
      model,
    });
    if (changed && !["APPROVED", "REJECTED"].includes(claim.status))
      investigate(db, claim);
  }

  function recover() {
    db.transaction(() => {
      const stale = db
        .prepare(
          "SELECT * FROM analysis_attempts WHERE status='ANALYSIS_PENDING' AND lease_until<=?",
        )
        .all(Date.now());
      for (const row of stale) {
        db.prepare(
          "UPDATE analysis_attempts SET status='ANALYSIS_FAILED',error_code='ANALYSIS_INTERRUPTED',finished_at=? WHERE id=?",
        ).run(new Date().toISOString(), row.id);
        const updated = db
          .prepare(
            "UPDATE evidence SET processing_status='ANALYSIS_FAILED',error_code='ANALYSIS_INTERRUPTED',processing_message='Analysis was interrupted. Your upload is preserved; retry explicitly.' WHERE id=? AND processing_status='ANALYSIS_PENDING'",
          )
          .run(row.evidence_id);
        if (updated.changes)
          recordFailure(
            db
              .prepare("SELECT * FROM evidence WHERE id=?")
              .get(row.evidence_id),
            "ANALYSIS_INTERRUPTED",
            row.prompt_version,
            row.model,
          );
      }
    }).immediate();
  }
  function reserveCall(attemptId, userId) {
    db.transaction(() => {
      const job = db
        .prepare("SELECT status,lease_until FROM analysis_attempts WHERE id=?")
        .get(attemptId);
      if (job.status !== "ANALYSIS_PENDING" || job.lease_until <= Date.now())
        throw new AnalysisError(
          "ANALYSIS_INTERRUPTED",
          "This analysis attempt expired. Retry explicitly.",
        );
      const day = new Date().toISOString().slice(0, 10);
      const total = db
        .prepare(
          "SELECT (SELECT COUNT(*) FROM ai_usage WHERE day=?) + (SELECT COUNT(*) FROM device_check_calls WHERE day=?) n",
        )
        .get(day, day).n;
      const user = db
        .prepare(
          "SELECT (SELECT COUNT(*) FROM ai_usage WHERE day=? AND user_id=?) + (SELECT COUNT(*) FROM device_check_calls WHERE day=? AND user_id=?) n",
        )
        .get(day, userId, day, userId).n;
      if (total >= budget || user >= userBudget)
        throw new AnalysisError(
          "DAILY_BUDGET_EXCEEDED",
          "Daily image-analysis allowance reached. Your upload is saved; manual information and review remain available.",
          "LIMITED_MODE",
        );
      db.prepare("INSERT INTO ai_usage VALUES(?,?,?,?,?)").run(
        randomUUID(),
        attemptId,
        userId,
        day,
        new Date().toISOString(),
      );
    }).immediate();
  }
  function currentAttempt(attemptId, evidence) {
    const job = db
      .prepare(
        `SELECT a.status,a.lease_until FROM analysis_attempts a
        JOIN evidence e ON e.id=a.evidence_id
        WHERE a.id=? AND e.active=1 AND e.sha256=?`,
      )
      .get(attemptId, evidence.sha256);
    return job?.status === "ANALYSIS_PENDING" && job.lease_until > Date.now();
  }
  async function run(evidence, attemptId, userId) {
    try {
      if (!currentAttempt(attemptId, evidence)) return;
      // Re-decode the actual original, including legacy Phase 1 images, before every dispatch.
      const input = await readFile(resolve(uploads, evidence.storage_key));
      if (evidence.kind === "photo" && digest(input) !== evidence.sha256)
        throw new AnalysisError(
          "IMAGE_HASH_MISMATCH",
          "The saved photo does not match its recorded hash. Replace the photo to verify the device.",
        );
      const { normalized } = await prepareImage(input, evidence.mime, {maxAnalysisDimension:adapter.status().provider === "LOCAL" ? 4096 : 1568});
      const result = await adapter.analyze({
        bytes: normalized,
        kind: evidence.kind,
        reserveCall: () => reserveCall(attemptId, userId),
      });
      db.transaction(() => {
        if (!currentAttempt(attemptId, evidence)) return;
        db.prepare(
          "UPDATE evidence SET observations=?,trust_tier='EXTRACTED',processing_status='ANALYSIS_COMPLETE',ai_model=?,prompt_version=?,analyzed_at=?,error_code=NULL,processing_message='Extracted observations require human review; they are not independently verified.' WHERE id=?",
        ).run(
          JSON.stringify(result.observations),
          result.model,
          result.promptVersion,
          new Date().toISOString(),
          evidence.id,
        );
        db.prepare(
          "UPDATE analysis_attempts SET status='ANALYSIS_COMPLETE',finished_at=? WHERE id=?",
        ).run(new Date().toISOString(), attemptId);
        db.prepare("UPDATE evidence SET scan_report_json=? WHERE id=?").run(result.local_assessment ? JSON.stringify(result.local_assessment) : null,evidence.id);
        const claim = getClaim(evidence.claim_id);
        storeDeviceVerification(db, evidence, claim, result);
        investigate(db, claim);
        audit(
          db,
          evidence.claim_id,
          userId,
          "EVIDENCE_ANALYZED",
          "Schema-validated observations saved as EXTRACTED; claim decision unchanged.",
        );
      }).immediate();
    } catch (error) {
      const known = error instanceof AnalysisError;
      const status = known ? error.processingStatus : "ANALYSIS_FAILED";
      const code = known ? error.code : "IMAGE_PROCESSING_FAILED";
      const message = known
        ? error.message
        : "Image processing failed. The original evidence is preserved; retry or enter information manually.";
      db.transaction(() => {
        if (!currentAttempt(attemptId, evidence)) return;
        db.prepare(
          "UPDATE evidence SET processing_status=?,error_code=?,processing_message=? WHERE id=?",
        ).run(status, code, message, evidence.id);
        db.prepare(
          "UPDATE analysis_attempts SET status=?,error_code=?,finished_at=? WHERE id=?",
        ).run(status, code, new Date().toISOString(), attemptId);
        const claim = getClaim(evidence.claim_id);
        storeDeviceVerification(db, evidence, claim, {
          errorCode: code,
          promptVersion: PROMPT_VERSION,
          model: adapter.model,
        });
        investigate(db, claim);
        audit(
          db,
          evidence.claim_id,
          userId,
          "ANALYSIS_UNAVAILABLE",
          `${code}: original evidence retained.`,
        );
      }).immediate();
    }
  }
  function start(evidence, userId, { queued = false } = {}) {
    if (!queued) recover();
    const outcome = db
      .transaction(() => {
        const e = db
          .prepare("SELECT * FROM evidence WHERE id=?")
          .get(evidence.id);
        if (queued && (!e?.active || e.processing_status !== "ANALYSIS_QUEUED"))
          return { status: e?.processing_status, cached: true };
        if (!e.active)
          throw new HttpError(
            409,
            "EVIDENCE_SUPERSEDED",
            "This photo is in evidence history.",
          );
        if (
          [
            "ANALYSIS_PENDING",
            "ANALYSIS_COMPLETE",
            "SIMULATED_FIXTURE",
          ].includes(e.processing_status)
        )
          return { status: e.processing_status, cached: true };
        if (
          e.synthetic ||
          !["image/jpeg", "image/png", "image/webp"].includes(e.mime) ||
          !["photo", "invoice"].includes(e.kind)
        ) {
          db.prepare(
            "UPDATE evidence SET processing_status='LIMITED_MODE',processing_message='Analyze a real product photo or invoice image. Other documents remain available for manual review.' WHERE id=?",
          ).run(e.id);
          recordFailure(e, "LIMITED_MODE");
          return { status: "LIMITED_MODE" };
        }
        if (adapter.status().status === "AI_NOT_CONFIGURED") {
          db.prepare(
            "UPDATE evidence SET processing_status='AI_NOT_CONFIGURED',error_code='AI_NOT_CONFIGURED',processing_message='Image analysis is not configured. Your upload is preserved; you can enter information manually.' WHERE id=?",
          ).run(e.id);
          recordFailure(e, "AI_NOT_CONFIGURED");
          return { status: "AI_NOT_CONFIGURED" };
        }
        if (
          db
            .prepare(
              "SELECT COUNT(*) n FROM analysis_attempts WHERE status='ANALYSIS_PENDING'",
            )
            .get().n >= 2
        ) {
          if (queued) return { status: "ANALYSIS_QUEUED" };
          throw new HttpError(
            429,
            "ANALYSIS_BUSY",
            "Two images are already being analyzed. Please try again shortly.",
          );
        }
        const id = randomUUID();
        db.prepare(
          "INSERT INTO analysis_attempts(id,evidence_id,actor_id,status,model,prompt_version,started_at,lease_until) VALUES(?,?,?,?,?,?,?,?)",
        ).run(
          id,
          e.id,
          userId,
          "ANALYSIS_PENDING",
          adapter.model,
          PROMPT_VERSION,
          new Date().toISOString(),
          Date.now() + 120000,
        );
        db.prepare(
          "UPDATE evidence SET processing_status='ANALYSIS_PENDING',error_code=NULL,processing_message='Analysis is in progress. The original image is safely stored.' WHERE id=?",
        ).run(e.id);
        audit(
          db,
          e.claim_id,
          userId,
          "ANALYSIS_STARTED",
          queued
            ? "Analysis started for the replacement photo."
            : "Image analysis requested explicitly.",
        );
        return { status: "ANALYSIS_PENDING", attemptId: id, evidence: e };
      })
      .immediate();
    if (outcome.attemptId) {
      const task = new Promise((resolve) => setImmediate(resolve)).then(() =>
        run(outcome.evidence, outcome.attemptId, userId),
      );
      tasks.add(task);
      task
        .then(
          () => {
            tasks.delete(task);
            resumeQueued();
          },
          () => tasks.delete(task),
        )
        .catch(() => {});
    }
    return { status: outcome.status, cached: !!outcome.cached };
  }
  function resumeQueued() {
    clearTimeout(queuedTimer);
    recover();
    for (const row of db
      .prepare(
        `SELECT e.id,c.user_id FROM evidence e JOIN claims c ON c.id=e.claim_id
       WHERE e.active=1 AND e.processing_status='ANALYSIS_QUEUED'
         AND c.status NOT IN ('APPROVED','REJECTED') ORDER BY e.rowid`,
      )
      .all()) {
      const outcome = start(row, row.user_id, { queued: true });
      if (outcome.status === "ANALYSIS_QUEUED") {
        const { expiry } = db
          .prepare(
            "SELECT MIN(lease_until) expiry FROM analysis_attempts WHERE status='ANALYSIS_PENDING'",
          )
          .get();
        queuedTimer = setTimeout(
          resumeQueued,
          Math.max(25, expiry - Date.now()),
        );
        queuedTimer.unref();
        break;
      }
    }
  }
  resumeQueued();
  return {
    start,
    recover,
    resumeQueued,
    status: () => adapter.status(),
    waitForIdle: async () => {
      resumeQueued();
      while (tasks.size) await Promise.all([...tasks]);
      clearTimeout(queuedTimer);
    },
  };
}
