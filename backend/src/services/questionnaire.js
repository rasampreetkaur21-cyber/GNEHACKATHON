import { z } from "zod";
import { questionnaireErrors } from "../../../shared/questionnaire.js";
const text = z.string().trim().max(1000);
export const questionnaireSchema = z
  .object({
    version: z.literal(1),
    issue: text,
    other: text.optional(),
    noticed: text,
    exactDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    frequency: text,
    usability: text,
    repairs: text,
    repairer: text.optional(),
    repairWhen: text.optional(),
    serviceRecord: text.optional(),
    damage: text,
    damageWhat: text.optional(),
    damageWhen: text.optional(),
    tried: text,
    actions: z.array(text).max(6).default([]),
    actionOther: text.optional(),
    symptoms: text.optional(),
    details: z.record(z.string(), text).default({}),
  })
  .strict();
export function validateQuestionnaire(category, a, ctx) {
  for (const message of questionnaireErrors(category, a))
    ctx.addIssue({ code: "custom", path: ["questionnaire"], message });
  if (
    a.exactDate &&
    (isNaN(Date.parse(a.exactDate)) ||
      new Date(a.exactDate).toISOString().slice(0, 10) !== a.exactDate ||
      a.exactDate > new Date().toISOString().slice(0, 10))
  )
    ctx.addIssue({
      code: "custom",
      path: ["questionnaire", "exactDate"],
      message: "Use a valid date on or before today.",
    });
}
