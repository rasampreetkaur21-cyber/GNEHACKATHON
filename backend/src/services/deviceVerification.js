import { imageOrigin, reviewOrigin } from "./provenance.js";
import { findCatalogModel, getCatalogItem } from "../catalog.js";
import { category, identityKey, readable } from "../rules/engine.js";

const retake =
  "Take a sharp, well-lit photo showing the actual device and its readable factory model label or About screen in the same frame.";
const replacement =
  "Upload the selected device with its readable model label or About screen. If you selected the wrong model, ask a reviewer to help correct the claim.";

const failureDetails = {
  AI_NOT_CONFIGURED: [
    "Photo analysis is unavailable because the AI service is unconfigured.",
    "Ask a reviewer to check a clear photo of the device and its model label or About screen.",
  ],
  INVALID_AI_RESPONSE: [
    "The photo analysis returned an invalid response.",
    "Retry analysis. If it still fails, ask a reviewer to check the photo.",
  ],
  CLAUDE_TIMEOUT: [
    "Photo analysis timed out.",
    "Retry analysis. If it still times out, ask a reviewer to check the photo.",
  ],
  DAILY_BUDGET_EXCEEDED: [
    "The daily photo analysis allowance has been reached.",
    "Retry when the allowance resets, or ask a reviewer to check the photo.",
  ],
  ANALYSIS_INTERRUPTED: [
    "Photo analysis was interrupted.",
    "Retry analysis from the saved photo.",
  ],
  IMAGE_HASH_MISMATCH: [
    "The saved photo does not match its recorded hash.",
    "Replace the photo with a clear image of the device and its model label.",
  ],
  LIMITED_MODE: ["This upload is unavailable for photo analysis.", retake],
};

function observed(value, field) {
  const text = value[field];
  return readable(text) &&
    !/^(?:not visible|not shown|illegible|unavailable|uncertain)$/i.test(
      text.trim(),
    ) &&
    !value.unknown_fields.includes(field)
    ? text.trim()
    : null;
}

const brandKey = (text) => text.normalize("NFKC").toLowerCase().trim();

function isSpecificModel(text) {
  // A code or model name can be compared. Prose and alternative readings are uncertain.
  return (
    text.length <= 64 &&
    /\d/.test(text) &&
    /^(?:[\p{L}\d]+(?:[-_.][\p{L}\d]+)*)(?:\s+[\p{L}\d]+(?:[-_.][\p{L}\d]+)*){0,4}(?:\/DS)?$/iu.test(
      text,
    ) &&
    !/\b(?:or|maybe|possibly|uncertain|unknown|unreadable|illegible)\b/i.test(
      text,
    )
  );
}

function categoryKey(text) {
  const key = text.toLowerCase().trim();
  if (
    /^(?:bluetooth |wireless |wired |over[- ]ear |on[- ]ear )?(?:headphones?|headset)$/.test(
      key,
    )
  )
    return "Headphones";
  if (/^(?:mobile|cell(?:ular)?)(?: phone)?$/.test(key)) return "Mobile phone";
  const known = category(key);
  if (typeof known === "string") return known;
  if (
    /^(?:tablets?|(?:desktop )?computers?|televisions?|tvs?|monitors?|cameras?|speakers?|earbuds?|earphones?|printers?|refrigerators?|smartwatches?)$/.test(
      key,
    )
  )
    return key;
  return null;
}

export function verifyDevice(claim, observations, errorCode) {
  const selected = getCatalogItem(claim.catalog_id);
  if (!selected) return null;

  const brand = observations && observed(observations, "observed_brand");
  const model = observations && observed(observations, "observed_model_text");
  const result = {
    selected_model: selected.model,
    observed_brand: brand || null,
    observed_model: model || null,
    evidence_basis: {
      identifying_evidence_kind:
        observations && observed(observations, "identifying_evidence_kind"),
      identifier_linked_to_pictured_device:
        observations &&
        observed(observations, "identifier_linked_to_pictured_device"),
      image_quality: observations && observed(observations, "image_quality"),
      device_category:
        observations && observed(observations, "device_category"),
      image_relevance:
        observations && observed(observations, "image_relevance"),
      analysis_error: errorCode || null,
    },
  };
  const outcome = (status, reason, next_action) => ({
    ...result,
    status,
    reason,
    next_action,
  });
  const unverified = (reason, action = retake) =>
    outcome("UNVERIFIED", reason, action);
  const invalid = (reason) => outcome("INVALID_DEVICE", reason, replacement);
  if (!observations)
    return unverified(
      ...(failureDetails[errorCode] || [
        "Photo analysis could not be completed.",
        "Retry analysis from the saved photo, or ask a reviewer to check it.",
      ]),
    );

  const {
    identifying_evidence_kind: kind,
    identifier_linked_to_pictured_device: link,
    image_quality: quality,
    device_category: observedCategory,
    image_relevance: relevance,
  } = result.evidence_basis;
  if (quality !== "CLEAR")
    return unverified(
      quality === "BLURRY"
        ? "The photo is too blurry to verify the model."
        : "The photo or identifying evidence is ambiguous.",
    );
  if (kind === "BOX")
    return unverified(
      "The model identifier appears on packaging and cannot identify the pictured device.",
    );

  const observedDevice = findCatalogModel(model);
  const modelMatches = observedDevice?.id === selected.id;
  const brandMatches = !!brand && brandKey(brand) === brandKey(selected.brand);
  const actualCategory = observedCategory && categoryKey(observedCategory);
  const categoryMatches = actualCategory === selected.category;
  const deviceIdentifier = kind === "LABEL" || kind === "ABOUT_SCREEN";
  if (deviceIdentifier && link !== "YES")
    return unverified(
      "The photo does not clearly link the identifier to the pictured device.",
    );
  if (
    !deviceIdentifier &&
    modelMatches &&
    ((actualCategory && !categoryMatches) || (brand && !brandMatches))
  )
    return unverified(
      "The model text conflicts with the pictured brand or category and has no clear link to the device.",
    );
  if (relevance === "IRRELEVANT") {
    if (deviceIdentifier || modelMatches || brandMatches || categoryMatches)
      return unverified(
        "The photo contains conflicting information about what device is pictured.",
      );
    return invalid(
      "The clear photo shows a subject unrelated to the selected device.",
    );
  }
  if (actualCategory && !categoryMatches)
    return invalid(
      `The pictured device is identified as ${observedCategory}. The selected category is ${selected.category}.`,
    );
  if (brand && !brandMatches)
    return invalid(
      `The photo shows the brand ${brand}. The selected brand is ${selected.brand}.`,
    );
  if (!deviceIdentifier || !model)
    return unverified(
      "The photo does not show a readable model on the device label or About screen.",
    );
  if (!modelMatches) {
    if (observedDevice || isSpecificModel(model))
      return invalid(
        `The pictured device identifier reads ${model}. The selected model is ${selected.model}.`,
      );
    return unverified(
      "The model text could not be read as a single device identifier.",
    );
  }

  const observedSerial = identityKey(observed(observations, "serial_text"));
  const claimSerial = identityKey(claim.serial);
  if (observedSerial && claimSerial && observedSerial !== claimSerial)
    return unverified(
      "The pictured model matches, but the readable serial differs from the claim serial.",
      "Check the serial entered on the claim and upload a clear photo showing the model and serial on the same device.",
    );
  return outcome(
    "MATCH",
    `A readable ${kind === "LABEL" ? "factory label" : "About screen"} on the pictured device identifies the selected model.`,
    "Keep this photo with the claim. No retake is needed.",
  );
}

export function storeDeviceVerification(db, evidence, claim, analysis) {
  if (evidence.kind !== "photo" || evidence.active === 0) return false;
  let result = verifyDevice(
    claim,
    analysis.observations ?? null,
    analysis.errorCode,
  );
  if (!result) return false;
  const origin =
    evidence.origin && evidence.origin !== "user_upload_unverified"
      ? evidence.origin
      : imageOrigin(evidence.sha256, evidence.normalized_sha256);
  if (claim.synthetic !== 1 && reviewOrigin(origin))
    result = {
      ...result,
      status: "UNVERIFIED",
      reason:
        "Known generated, augmented or reference image requires human authenticity review.",
      next_action:
        "Actual device ki fresh original camera photo dein aur reviewer check lein.",
      evidence_basis: {
        ...result.evidence_basis,
        origin,
        closed_set_status: "HUMAN_REVIEW",
      },
    };
  if (claim.synthetic !== 1 && analysis.local_assessment?.authenticity_signals?.length) result={...result,status:"UNVERIFIED",reason:"The photo has a visible source/authenticity concern that needs human review.",next_action:"Upload a fresh original photo of the actual device, or let a reviewer assess this evidence.",evidence_basis:{...result.evidence_basis,closed_set_status:"HUMAN_REVIEW",signals:analysis.local_assessment.authenticity_signals}};
  const { selected_model, evidence_basis, ...decision } = result;
  const row = {
    evidence_id: evidence.id,
    claim_id: claim.id,
    catalog_id: claim.catalog_id,
    ...decision,
    evidence_basis: JSON.stringify({ ...evidence_basis, selected_model }),
    image_sha256: evidence.sha256,
    prompt_version: analysis.promptVersion,
    model: analysis.model ?? null,
  };
  const active = db
    .prepare(
      "SELECT * FROM device_verifications WHERE evidence_id=? AND active=1",
    )
    .get(evidence.id);
  if (
    active &&
    Object.entries(row).every(([key, value]) => active[key] === value)
  )
    return false;
  db.prepare(
    "UPDATE device_verifications SET active=0 WHERE evidence_id=? AND active=1",
  ).run(evidence.id);
  db.prepare(
    `INSERT INTO device_verifications(evidence_id,claim_id,catalog_id,status,
    observed_brand,observed_model,evidence_basis,reason,next_action,image_sha256,prompt_version,model)
    VALUES(@evidence_id,@claim_id,@catalog_id,@status,@observed_brand,@observed_model,
      @evidence_basis,@reason,@next_action,@image_sha256,@prompt_version,@model)`,
  ).run(row);
  return true;
}

export function readDeviceVerification(db, evidenceId) {
  const row = db
    .prepare(
      `SELECT v.status,v.observed_brand,v.observed_model,v.evidence_basis,v.reason,
        v.next_action,v.prompt_version,v.created_at
       FROM device_verifications v
       JOIN evidence e ON e.id=v.evidence_id AND e.claim_id=v.claim_id
       JOIN claims c ON c.id=e.claim_id
       WHERE e.id=? AND v.active=1 AND e.kind='photo' AND e.active=1
         AND e.sha256=v.image_sha256 AND c.catalog_id=v.catalog_id`,
    )
    .get(evidenceId);
  if (!row) return null;
  return publicVerification(row);
}

function publicVerification(row) {
  const { selected_model, ...evidence_basis } = JSON.parse(row.evidence_basis);
  return { ...row, selected_model, evidence_basis };
}

export function readVerificationHistory(db, claimId, evidenceId = null) {
  return db
    .prepare(
      `SELECT v.rowid AS id,v.evidence_id,v.status,v.observed_brand,v.observed_model,
       v.evidence_basis,v.reason,v.next_action,v.prompt_version,v.created_at,
       e.original_name AS evidence_name,
       CASE WHEN v.active=1 AND e.active=1 AND e.sha256=v.image_sha256
         AND c.catalog_id=v.catalog_id THEN 1 ELSE 0 END AS active
     FROM device_verifications v
     JOIN evidence e ON e.id=v.evidence_id AND e.claim_id=v.claim_id
     JOIN claims c ON c.id=e.claim_id
     WHERE v.claim_id=? AND (? IS NULL OR e.id=?) ORDER BY v.rowid DESC`,
    )
    .all(claimId, evidenceId, evidenceId)
    .map(publicVerification);
}
