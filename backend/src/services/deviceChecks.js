import { createDefaultAdapter } from "../ai/provider.js";
import { imageOrigin } from "./provenance.js";
import { readFileSync } from "node:fs";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { getCatalogItem, findCatalogModel, catalogIds } from "../catalog.js";
import { digest, HttpError } from "../utils/security.js";
import { ClaudeVisionAdapter, AnalysisError } from "../ai/claude.js";
import { deviceCheckObservationSchema } from "../ai/deviceCheckSchema.js";
import { evaluateDeviceCheck } from "./deviceCheckPolicy.js";
import { prepareImage } from "./images.js";
import { investigate, readInvestigation, audit } from "./investigation.js";
import { identityKey } from "../rules/engine.js";
const dataset = new URL("../../../datasets/six-product-v1/", import.meta.url);
const packagedCatalog = JSON.parse(
  readFileSync(new URL("catalog.json", dataset), "utf8"),
);
if (
  JSON.stringify(packagedCatalog.map((x) => x.model_id).sort()) !==
  JSON.stringify([...catalogIds].sort())
)
  throw new Error(
    "Dataset catalog does not match the six-product application catalog",
  );
export function createDeviceCheckService({
  db,
  uploads,
  adapter = createDefaultAdapter(),
  dailyBudget = 20,
  userBudget = 10,
}) {
  const budget =
    Number.isInteger(dailyBudget) && dailyBudget >= 0 ? dailyBudget : 0;
  const reserveCall = (userId) =>
    db
      .transaction(() => {
        const day = new Date().toISOString().slice(0, 10);
        const total = db
          .prepare(
            "SELECT (SELECT count(*) FROM device_check_calls WHERE day=?) + (SELECT count(*) FROM ai_usage WHERE day=?) n",
          )
          .get(day, day).n;
        const user = db
          .prepare(
            "SELECT (SELECT count(*) FROM device_check_calls WHERE day=? AND user_id=?) + (SELECT count(*) FROM ai_usage WHERE day=? AND user_id=?) n",
          )
          .get(day, userId, day, userId).n;
        if (total >= budget || user >= userBudget)
          throw new AnalysisError(
            "DAILY_BUDGET_EXCEEDED",
            "Daily analysis allowance reached.",
          );
        db.prepare("INSERT INTO device_check_calls VALUES(?,?,?)").run(
          randomUUID(),
          userId,
          day,
        );
      })
      .immediate();
  async function run({ userId, selected_model_id, claim_id = null, file }) {
    if (!getCatalogItem(selected_model_id))
      throw new HttpError(
        400,
        "UNSUPPORTED_MODEL",
        "Sirf supported six products mein se ek select karein.",
      );
    let claim = null;
    if (claim_id) {
      claim = db
        .prepare(
          "SELECT * FROM claims WHERE id=? AND user_id=? AND synthetic=0 AND is_draft=0",
        )
        .get(claim_id, userId);
      if (!claim)
        throw new HttpError(
          404,
          "NOT_FOUND",
          "Real submitted claim nahi mila.",
        );
      if (claim.catalog_id !== selected_model_id)
        throw new HttpError(
          400,
          "CLAIM_MODEL_MISMATCH",
          "Selected product claim ke model se match hona chahiye.",
        );
    }
    const image = await prepareImage(file.buffer, file.mimetype);
    const sha256 = digest(file.buffer),
      normalizedSha = digest(image.normalized);
    const origin = imageOrigin(sha256, normalizedSha);
    const id = randomUUID(),
      storageKey = "device-check-" + id;
    await writeFile(resolve(uploads, storageKey), image.normalized, {
      flag: "wx",
      mode: 0o600,
    });
    let duplicate;
    try {
      duplicate = db
        .transaction(() => {
          const previous = db
            .prepare(
              "SELECT 1 FROM device_checks WHERE sha256=? OR normalized_sha256=? LIMIT 1",
            )
            .get(sha256, normalizedSha);
          const evidence = db
            .prepare(
              "SELECT 1 FROM evidence WHERE sha256=? OR normalized_sha256=? LIMIT 1",
            )
            .get(sha256, normalizedSha);
          db.prepare(
            "INSERT INTO device_checks(id,user_id,claim_id,selected_model_id,sha256,normalized_sha256,origin,storage_key,mime,size) VALUES(?,?,?,?,?,?,?,?,?,?)",
          ).run(
            id,
            userId,
            claim_id,
            selected_model_id,
            sha256,
            normalizedSha,
            origin,
            storageKey,
            "image/jpeg",
            file.size ?? file.buffer.length,
          );
          return !!(previous || evidence);
        })
        .immediate();
    } catch (error) {
      await unlink(resolve(uploads, storageKey)).catch(() => {});
      throw error;
    }
    const analysisBytes=adapter.status().provider === "LOCAL" && !duplicate && origin === "user_upload_unverified" ? (await prepareImage(file.buffer,file.mimetype,{maxAnalysisDimension:4096})).normalized : image.normalized;
    return finish({
      analysisBytes,
      id,
      userId,
      selected_model_id,
      claim_id,
      claim,
      image,
      origin,
      duplicate,
      sha256,
      normalizedSha,
    });
  }
  async function finish({
    analysisBytes,
    id,
    userId,
    selected_model_id,
    claim_id,
    claim,
    image,
    origin,
    duplicate,
    sha256,
    normalizedSha,
  }) {
    let localAssessment = null;
    let observations = null,
      analysisError = null,
      model = null;
    // Known generated/reference assets and exact repeats are concerns regardless of vision availability.
    const originConcern =
      origin !== "user_upload_unverified" &&
      origin !== "real_camera" &&
      origin !== "user_camera";
    if (!duplicate && !originConcern) {
      if (Math.min(image.width, image.height) < 160) {
        observations = {
          quality: "LOW_RESOLUTION",
          device_category: "UNKNOWN",
          observed_brand: null,
          observed_model_text: null,
          serial_text: null,
          identifying_evidence_kind: "NONE",
          identifier_linked_to_pictured_device: null,
          outside_catalog: null,
          authenticity_assessed: false,
          authenticity_signals: [],
          confidence: null,
        };
      } else
        try {
          const analysis = await adapter.analyze({
            bytes: analysisBytes || image.normalized,
            kind: "device_check",
            reserveCall: () => reserveCall(userId),
          });
          observations = deviceCheckObservationSchema.parse(
            analysis.observations,
          );
          localAssessment = analysis.local_assessment ?? null;
          model = analysis.model ?? null;
        } catch (error) {
          analysisError = [
            "AI_NOT_CONFIGURED",
            "CLAUDE_TIMEOUT",
            "CLAUDE_UNAVAILABLE",
            "DAILY_BUDGET_EXCEEDED",
            "INVALID_AI_RESPONSE",
          ].includes(error.code)
            ? error.code
            : "INVALID_AI_RESPONSE";
        }
    }
    let registryConflict = false,
      claimChecks = [];
    const serial = identityKey(observations?.serial_text);
    registryConflict = !!(
      claim &&
      serial &&
      identityKey(claim.serial) &&
      serial !== identityKey(claim.serial)
    );
    if (serial) {
      const matched = db
        .prepare(
          "SELECT * FROM serial_registry WHERE verified=1 AND synthetic=0",
        )
        .all()
        .filter((r) => identityKey(r.serial) === serial);
      registryConflict ||= matched.some(
        (r) => r.model && findCatalogModel(r.model)?.id !== selected_model_id,
      );
    }
    if (claim) {
      investigate(db, claim);
      const investigation = readInvestigation(db, claim.id, "customer");
      claimChecks = (investigation?.results || []).map((r) => ({
        id: r.ruleId,
        status: r.status,
      }));
      if (["APPROVED", "REJECTED"].includes(claim.status))
        claimChecks.push({ id: "CLAIM_OPEN", status: "UNKNOWN" });
    }
    const result = {
      id,
      ...evaluateDeviceCheck({
        selected_model_id,
        observations,
        origin,
        duplicate,
        registryConflict,
        claimChecks,
        analysisError,
      }),
      analysis_model: model,
      local_assessment: localAssessment,
      claim_id,
      sha256,
      normalized_sha256: normalizedSha,
      authenticity_limit:
        "Visible-signal screening and exact hashes do not prove a real image or detect every AI generation/edit.",
      decision_scope: "VERIFICATION_RECOMMENDATION",
      image_url: `/api/device-checks/${id}/image`,
    };
    if(result.status === "UNCLEAR_IMAGE" && result.reason_code === "NEED_LINKED_MODEL" && (localAssessment?.readable_model_candidate || localAssessment?.other_model_text) && observations?.quality === "CLEAR") Object.assign(result,{status:"HUMAN_REVIEW",decision:"ESCALATE",authenticity:"UNKNOWN",reason_code:"MODEL_LINK_REVIEW",reason:"Photo mein model text mila, lekin physical device ke saath label ka link confirm nahi hua.",next_action:"Reviewer model label confirm karega. Clear device-and-label photo ho toh add kar sakte hain."});
    db.transaction(() => {
      db.prepare("UPDATE device_checks SET result_json=? WHERE id=?").run(
        JSON.stringify(result),
        id,
      );
      if (claim_id)
        audit(
          db,
          claim_id,
          userId,
          "DEVICE_CHECK_COMPLETED",
          `${result.status} / ${result.decision}: ${result.reason_code}. Advisory result; claim decision unchanged.`,
        );
    })();
    return result;
  }
  async function retry(id, userId) {
    const row = db
      .prepare("SELECT * FROM device_checks WHERE id=? AND user_id=?")
      .get(id, userId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "Saved check nahi mila.");
    const previous = row.result_json && JSON.parse(row.result_json);
    if (!previous?.analysis_error)
      throw new HttpError(
        409,
        "RETRY_NOT_AVAILABLE",
        "Is result ke liye fresh photo ya reviewer check chahiye.",
      );
    const claim = row.claim_id
      ? db
          .prepare(
            "SELECT * FROM claims WHERE id=? AND user_id=? AND synthetic=0",
          )
          .get(row.claim_id, userId)
      : null;
    if (row.claim_id && (!claim || claim.catalog_id !== row.selected_model_id))
      throw new HttpError(
        409,
        "CLAIM_CHANGED",
        "Claim details badal gaye hain; fresh check shuru karein.",
      );
    const image = await prepareImage(
      await readFile(resolve(uploads, row.storage_key)),
      "image/jpeg",
    );
    const duplicate =
      !!db
        .prepare(
          "SELECT 1 FROM device_checks WHERE id<>? AND (sha256=? OR normalized_sha256=?) LIMIT 1",
        )
        .get(id, row.sha256, row.normalized_sha256) ||
      !!db
        .prepare(
          "SELECT 1 FROM evidence WHERE sha256=? OR normalized_sha256=? LIMIT 1",
        )
        .get(row.sha256, row.normalized_sha256);
    return finish({
      id,
      userId,
      selected_model_id: row.selected_model_id,
      claim_id: row.claim_id,
      claim,
      image,
      origin: row.origin,
      duplicate,
      sha256: row.sha256,
      normalizedSha: row.normalized_sha256,
    });
  }

  function list(user, claimId = null) {
    return db
      .prepare(
        `SELECT result_json FROM device_checks WHERE result_json IS NOT NULL AND (?='reviewer' OR user_id=?) AND (? IS NULL OR claim_id=?) ORDER BY created_at DESC,rowid DESC LIMIT 50`,
      )
      .all(user.role, user.id, claimId, claimId)
      .map((r) => JSON.parse(r.result_json));
  }
  return {
    run,
    retry,
    list,
    status: () => adapter.status?.() || { status: "UNKNOWN" },
  };
}
