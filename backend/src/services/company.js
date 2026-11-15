import { z } from "zod";
import { randomUUID } from "node:crypto";
import { calendarDate } from "./claims.js";
import { HttpError } from "../utils/security.js";
import { audit } from "./investigation.js";
const referenceProducts = z.enum([
  "Mobile phone",
  "Laptop",
  "Washing machine",
  "Air conditioner",
]);
const base = {
  source: z.string().trim().min(5).max(500),
  synthetic: z.boolean().default(false),
};
export const companyRecordSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("policy"),
      ...base,
      product: referenceProducts,
      months: z.number().int().min(1).max(120),
      auto_approve_limit_minor: z
        .number()
        .int()
        .min(0)
        .max(100000000)
        .nullable(),
      currency: z.literal("INR"),
      effective_from: calendarDate.optional(),
      effective_to: calendarDate.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("registry"),
      ...base,
      serial: z.string().trim().min(3).max(100),
      product: referenceProducts,
      purchase_date: calendarDate,
      service_count: z.number().int().min(0).max(100),
      model: z.string().trim().max(100).optional(),
      seller_name: z.string().trim().max(200).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("seller"),
      ...base,
      seller_name: z.string().trim().min(2).max(200),
      authorized: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("service"),
      ...base,
      serial: z.string().trim().min(3).max(100),
      service_date: calendarDate,
      authorized: z.boolean().nullable(),
      summary: z.string().trim().min(5).max(1000),
    })
    .strict(),
  z
    .object({
      type: z.literal("diagnostic"),
      ...base,
      serial: z.string().trim().min(3).max(100),
      facts: z
        .object({
          unauthorized_repair: z.boolean().optional(),
          requires_technician: z.boolean().optional(),
          inspection_completed: z.boolean().optional(),
          summary: z.string().max(1000).optional(),
        })
        .strict(),
    })
    .strict(),
]);
export function configureRecord(db, input, actorId, reason) {
  const b = companyRecordSchema.parse(input);
  z.string().trim().min(10).max(1500).parse(reason);
  if (b.synthetic && !b.source.startsWith("SYNTHETIC"))
    throw new HttpError(
      400,
      "SYNTHETIC_LABEL_REQUIRED",
      "Synthetic records require a SYNTHETIC source label.",
    );
  const id = randomUUID();
  return db.transaction(() => {
    if (b.type === "policy")
      db.prepare(
        "INSERT INTO warranty_policies(id,product,months,verified,source,synthetic,auto_approve_limit_minor,currency,effective_from,effective_to) VALUES(?,?,?,1,?,?,?,?,?,?)",
      ).run(
        id,
        b.product,
        b.months,
        b.source,
        Number(b.synthetic),
        b.auto_approve_limit_minor,
        b.currency,
        b.effective_from || null,
        b.effective_to || null,
      );
    if (b.type === "registry") {
      const existing = db
        .prepare("SELECT synthetic FROM serial_registry WHERE serial=?")
        .get(b.serial);
      if (existing && existing.synthetic !== Number(b.synthetic))
        throw new HttpError(
          409,
          "REGISTRY_ENVIRONMENT_CONFLICT",
          "Real and synthetic registry records cannot overwrite each other.",
        );
    }
    if (b.type === "registry")
      db.prepare(
        "INSERT INTO serial_registry(serial,product,purchase_date,service_count,verified,source,synthetic,model,seller_name) VALUES(?,?,?,?,1,?,?,?,?) ON CONFLICT(serial) DO UPDATE SET product=excluded.product,purchase_date=excluded.purchase_date,service_count=excluded.service_count,verified=1,source=excluded.source,synthetic=excluded.synthetic,model=excluded.model,seller_name=excluded.seller_name",
      ).run(
        b.serial,
        b.product,
        b.purchase_date,
        b.service_count,
        b.source,
        Number(b.synthetic),
        b.model || null,
        b.seller_name || null,
      );
    if (b.type === "seller")
      db.prepare("INSERT INTO authorized_sellers VALUES(?,?,?,1,?,?)").run(
        id,
        b.seller_name,
        Number(b.authorized),
        b.source,
        Number(b.synthetic),
      );
    if (b.type === "service")
      db.prepare("INSERT INTO service_records VALUES(?,?,?,?,?,1,?,?)").run(
        id,
        b.serial,
        b.service_date,
        b.authorized == null ? null : Number(b.authorized),
        b.summary,
        b.source,
        Number(b.synthetic),
      );
    if (b.type === "diagnostic")
      db.prepare("INSERT INTO diagnostic_records VALUES(?,?,?,1,?,?)").run(
        id,
        b.serial,
        JSON.stringify(b.facts),
        b.source,
        Number(b.synthetic),
      );
    audit(
      db,
      null,
      actorId,
      "COMPANY_RECORD_CONFIGURED",
      `${b.type}: ${reason}`,
    );
    return { id: b.type === "registry" ? b.serial : id, type: b.type };
  })();
}
