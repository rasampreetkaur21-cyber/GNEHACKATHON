import { questionnaireSchema, validateQuestionnaire } from "./questionnaire.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { catalogIds, getCatalogItem } from "../catalog.js";
import { investigate, audit } from "./investigation.js";
import { HttpError, digest } from "../utils/security.js";
export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    "Invalid calendar date",
  );
export const claimSchema = z
  .object({
    catalog_id: z.enum(catalogIds),
    product: z.string().optional(),
    model: z.string().optional(),
    serial: z.string().trim().min(3).max(100),
    purchase_date: z.union([calendarDate, z.literal("UNKNOWN")]),
    incident_date: z.union([calendarDate, z.literal("UNKNOWN")]),
    questionnaire: questionnaireSchema.optional(),
    statement: z.string().trim().min(20).max(5000),
    previous_repairs: z.number().int().min(0).max(100),
    claim_value_minor: z
      .number()
      .int()
      .min(0)
      .max(100000000)
      .nullable()
      .optional(),
    currency: z.literal("INR").default("INR"),
    declared_no_visible_damage: z.boolean().nullable().optional(),
    declared_unauthorized_repairs: z.boolean().nullable().optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.purchase_date === "UNKNOWN" ||
      v.incident_date === "UNKNOWN" ||
      v.incident_date >= v.purchase_date,
    "Incident must be on or after purchase",
  )
  .refine(
    (v) =>
      v.incident_date === "UNKNOWN" ||
      v.incident_date <= new Date().toISOString().slice(0, 10),
    "Incident cannot be in the future",
  )
  .transform(({ product, model, ...claim }, ctx) => {
    const device = getCatalogItem(claim.catalog_id);
    if (claim.questionnaire) {
      validateQuestionnaire(device.category, claim.questionnaire, ctx);
      if (
        claim.questionnaire.exactDate &&
        claim.incident_date !== claim.questionnaire.exactDate
      )
        ctx.addIssue({
          code: "custom",
          path: ["incident_date"],
          message: "Incident date must match the reported exact date.",
        });
    }
    if (product !== undefined && product !== device.category)
      ctx.addIssue({
        code: "custom",
        path: ["product"],
        message: "Product does not match the selected catalog device.",
      });
    if (model !== undefined && model !== device.model)
      ctx.addIssue({
        code: "custom",
        path: ["model"],
        message: "Model does not match the selected catalog device.",
      });
    return { ...claim, product: device.category, model: device.model };
  });
export function createClaim(
  db,
  userId,
  input,
  { draft = false, idempotencyKey = null } = {},
) {
  const b = claimSchema.parse(input);
  return db.transaction(() => {
    const hash = digest(JSON.stringify(b));
    if (idempotencyKey) {
      z.string().uuid().parse(idempotencyKey);
      const previous = db
        .prepare(
          "SELECT * FROM claim_requests WHERE user_id=? AND request_key=?",
        )
        .get(userId, idempotencyKey);
      if (previous) {
        if (previous.payload_hash !== hash)
          throw new HttpError(
            409,
            "REQUEST_REUSED",
            "This claim request key was already used for different details.",
          );
        return previous.claim_id;
      }
    }
    const id = randomUUID();
    db.prepare(
      "INSERT INTO claims(id,user_id,catalog_id,product,serial,model,purchase_date,incident_date,statement,previous_repairs,claim_value_minor,currency,declared_no_visible_damage,declared_unauthorized_repairs,is_draft) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      userId,
      b.catalog_id,
      b.product,
      b.serial,
      b.model,
      b.purchase_date,
      b.incident_date,
      b.statement,
      b.previous_repairs,
      b.claim_value_minor ?? null,
      b.currency,
      b.declared_no_visible_damage == null
        ? null
        : Number(b.declared_no_visible_damage),
      b.declared_unauthorized_repairs == null
        ? null
        : Number(b.declared_unauthorized_repairs),
      Number(draft),
    );
    if (b.questionnaire)
      db.prepare("UPDATE claims SET questionnaire_json=? WHERE id=?").run(
        JSON.stringify(b.questionnaire),
        id,
      );
    investigate(db, db.prepare("SELECT * FROM claims WHERE id=?").get(id));
    audit(
      db,
      id,
      userId,
      draft ? "DRAFT_CREATED" : "CLAIM_SUBMITTED",
      draft
        ? "Private draft prepared for evidence collection; not submitted to reviewers."
        : "Claim submitted for investigation.",
    );
    if (idempotencyKey)
      db.prepare("INSERT INTO claim_requests VALUES(?,?,?,?)").run(
        userId,
        idempotencyKey,
        hash,
        id,
      );
    return id;
  })();
}
export function submitDraft(db, id, userId) {
  return db.transaction(() => {
    const c = db
      .prepare("SELECT * FROM claims WHERE id=? AND user_id=?")
      .get(id, userId);
    if (!c) throw new HttpError(404, "NOT_FOUND", "Claim not found.");
    if (!c.is_draft) return id;
    db.prepare("UPDATE claims SET is_draft=0 WHERE id=?").run(id);
    investigate(db, { ...c, is_draft: 0 });
    audit(
      db,
      id,
      userId,
      "CLAIM_SUBMITTED",
      "Customer confirmed and submitted the guided-assistant claim.",
    );
    return id;
  })();
}
