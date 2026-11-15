import { z } from "zod";
const text = z.string().min(1).max(1000);
const visible = z.enum(["VISIBLE", "NOT_VISIBLE", "UNKNOWN"]);
export const invoiceFields = [
  "seller_name",
  "invoice_number",
  "invoice_date",
  "product_name",
  "product_model",
  "serial_number",
  "customer_name",
  "gstin",
];
const legacyPhotoFields = [
  "device_category",
  "visible_damage_types",
  "damage_location",
  "visible_cracks",
  "visible_dents",
  "visible_liquid_contact_indicator",
  "visible_tamper_signs",
  "serial_text",
  "model_text",
  "image_relevance",
  "observable_facts",
];
export const deviceObservationFields = [
  "observed_brand",
  "observed_model_text",
  "identifying_evidence_kind",
  "identifier_linked_to_pictured_device",
  "image_quality",
];
export const photoFields = [...legacyPhotoFields, ...deviceObservationFields];
export const invoiceSchema = z
  .object({
    type: z.literal("invoice"),
    seller_name: text,
    invoice_number: text,
    invoice_date: text,
    product_name: text,
    product_model: text,
    serial_number: text,
    customer_name: text,
    gstin: text,
    original_text: z.string().min(1).max(12000),
    unknown_fields: z.array(z.enum(invoiceFields)).max(8),
  })
  .strict();
const legacyPhotoSchema = z
  .object({
    type: z.literal("product_photo"),
    device_category: text,
    visible_damage_types: z
      .array(
        z.enum([
          "CRACK",
          "DENT",
          "SCRATCH",
          "DISCOLORATION",
          "NONE_VISIBLE",
          "UNKNOWN",
        ]),
      )
      .min(1)
      .max(6),
    damage_location: text,
    visible_cracks: visible,
    visible_dents: visible,
    visible_liquid_contact_indicator: visible,
    visible_tamper_signs: visible,
    serial_text: text,
    model_text: text,
    image_relevance: z.enum(["RELEVANT", "IRRELEVANT", "UNKNOWN"]),
    observable_facts: z.string().min(1).max(3000),
    unknown_fields: z.array(z.enum(photoFields)).max(13),
  })
  .strict();
export const photoSchema = legacyPhotoSchema.extend({
  observed_brand: text,
  observed_model_text: text,
  identifying_evidence_kind: z.enum(["LABEL", "ABOUT_SCREEN", "BOX", "NONE"]),
  identifier_linked_to_pictured_device: z.enum(["YES", "NO", "UNKNOWN"]),
  image_quality: z.enum(["CLEAR", "BLURRY", "AMBIGUOUS"]),
  unknown_fields: z.array(z.enum(photoFields)).max(photoFields.length),
});
// The rules engine and ledger can still read earlier saved observations.
const storedPhotoSchema = z.union([photoSchema, legacyPhotoSchema]);
export function validateObservations(value, kind, { current = false } = {}) {
  const schema =
    kind === "invoice"
      ? invoiceSchema
      : current
        ? photoSchema
        : storedPhotoSchema;
  const parsed = schema.parse(value);
  const fields = kind === "invoice" ? invoiceFields : photoFields;
  parsed.unknown_fields = [
    ...new Set([
      ...parsed.unknown_fields,
      ...fields.filter(
        (k) =>
          parsed[k] === "UNKNOWN" ||
          (Array.isArray(parsed[k]) && parsed[k].includes("UNKNOWN")),
      ),
    ]),
  ];
  return parsed;
}
export const manualFields = z
  .object(
    Object.fromEntries(
      [...new Set([...invoiceFields, ...legacyPhotoFields])].map((k) => [
        k,
        z.string().trim().min(1).max(1500),
      ]),
    ),
  )
  .strict()
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field.");
