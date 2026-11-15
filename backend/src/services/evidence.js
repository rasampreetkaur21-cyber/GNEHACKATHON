import { audit, investigate } from "./investigation.js";
import { HttpError } from "../utils/security.js";

export function saveEvidence(db, claimId, actorId, file) {
  return db
    .transaction(() => {
      const claim = db.prepare("SELECT * FROM claims WHERE id=?").get(claimId);
      if (!claim) throw new HttpError(404, "NOT_FOUND", "Claim not found.");
      if (["APPROVED", "REJECTED"].includes(claim.status))
        throw new HttpError(
          409,
          "CLAIM_CLOSED",
          "A finalized claim cannot accept evidence.",
        );
      if(file.kind==='live_snapshot' && !db.prepare("SELECT 1 FROM live_sessions WHERE id=? AND claim_id=? AND status!='ENDED' AND expires_at>? AND owner_joined=1").get(file.live_session_id,claim.id,Date.now()))throw new HttpError(409,'LIVE_ENDED','The live session ended before this frame could be saved.');
      const currentPhoto =
        file.kind === "photo"
          ? db
              .prepare(
                "SELECT * FROM evidence WHERE claim_id=? AND kind='photo' AND active=1",
              )
              .get(claim.id)
          : null;
      if (file.replaces) {
        const existing = db
          .prepare(
            "SELECT id,sha256,active FROM evidence WHERE claim_id=? AND replaces_evidence_id=?",
          )
          .get(claim.id, file.replaces);
        if (existing?.active && existing.sha256 === file.sha256)
          return { id: existing.id, duplicate: true, replacement: true };
        if (currentPhoto?.id !== file.replaces)
          throw new HttpError(
            409,
            "PHOTO_CHANGED",
            "The current photo changed. Refresh the claim before replacing it.",
          );
        if (currentPhoto.sha256 === file.sha256)
          throw new HttpError(
            409,
            "SAME_PHOTO",
            "Choose a different photo to replace the current upload.",
          );
      } else {
        const existing = db
          .prepare(
            "SELECT id FROM evidence WHERE claim_id=? AND kind=? AND sha256=? AND active=1 AND synthetic=0",
          )
          .get(claim.id, file.kind, file.sha256);
        if (existing) return { id: existing.id, duplicate: true };
        if (currentPhoto)
          throw new HttpError(
            409,
            "PHOTO_EXISTS",
            "Use Replace photo to change the current device photo.",
          );
      }
      if (currentPhoto)
        db.prepare("UPDATE evidence SET active=0 WHERE id=?").run(
          currentPhoto.id,
        );
      if (
        file.mime !== "application/pdf" &&
        db
          .prepare(
            "SELECT COUNT(*) n FROM evidence WHERE claim_id=? AND active=1 AND mime IN ('image/jpeg','image/png','image/webp')",
          )
          .get(claim.id).n >= 6
      )
        throw new HttpError(
          409,
          "IMAGE_LIMIT",
          "A claim can contain at most six active images.",
        );
      db.prepare(
        `INSERT INTO evidence(id,claim_id,kind,original_name,storage_key,mime,size,
      sha256,normalized_key,width,height,source_reference,processing_status,processing_message,replaces_evidence_id,origin,normalized_sha256,live_session_id)
      VALUES(@id,@claim_id,@kind,@original_name,@storage_key,@mime,@size,@sha256,
        @normalized_key,@width,@height,@source_reference,@processing_status,@processing_message,@replaces_evidence_id,@origin,@normalized_sha256,@live_session_id)`,
      ).run({
        ...file,
        live_session_id: file.live_session_id || null,
        origin: file.origin || "user_upload_unverified",
        normalized_sha256: file.normalized_sha256 || null,
        claim_id: claim.id,
        source_reference: "upload:" + file.id,
        processing_status: file.kind === 'live_snapshot' ? 'LIMITED_MODE' : file.replaces
          ? "ANALYSIS_QUEUED"
          : file.mime === "application/pdf"
            ? "LIMITED_MODE"
            : "NOT_ANALYZED",
        processing_message: file.kind === 'live_snapshot' ? 'Live camera frame saved for reviewer inspection. The current device photo is unchanged.' : file.replaces
          ? "Replacement photo saved. Analysis is queued."
          : file.mime === "application/pdf"
            ? "PDF retained for manual review; upload an invoice image for OCR."
            : "Image saved. Start analysis when ready.",
        replaces_evidence_id: file.replaces || null,
      });
      investigate(db, claim);
      audit(
        db,
        claim.id,
        actorId,
        file.replaces ? "PHOTO_REPLACED" : "EVIDENCE_ADDED",
        file.replaces
          ? "Replacement photo saved and the previous photo moved to history."
          : `${file.kind} evidence added; investigation refreshed.`,
      );
      return {
        id: file.id,
        duplicate: false,
        ...(file.replaces && { replacement: true }),
      };
    })
    .immediate();
}
