import { questionnaireSchema } from "./questionnaire.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { catalogBrands, catalogIds, getCatalogItem } from "../catalog.js";
import { createClaim, submitDraft, calendarDate } from "./claims.js";
import { investigate, readInvestigation } from "./investigation.js";
import { HttpError, digest } from "../utils/security.js";
export const CHAT_STATES = [
  "GREETING",
  "PRODUCT_SELECTION",
  "PRODUCT_DETAILS",
  "PURCHASE_DETAILS",
  "ISSUE_DESCRIPTION",
  "INVOICE_UPLOAD",
  "PHOTO_UPLOAD",
  "EVIDENCE_CHECK",
  "CLAIM_CONFIRMATION",
  "CLAIM_SUBMISSION",
  "STATUS_DISPLAY",
];
const prompts = {
  GREETING:
    "Welcome. I can guide you through a warranty claim using the same evidence and investigation system as the claim form. Select Begin to start.",
  PRODUCT_SELECTION: "Choose the brand of your device.",
  PRODUCT_DETAILS:
    "Choose the model and enter the serial printed on the device. Use UNKNOWN if the serial is unreadable.",
  PURCHASE_DETAILS:
    "Enter your purchase date. You may mark it unknown if you do not remember it.",
  ISSUE_DESCRIPTION:
    "Describe the failure and previous repairs. State only what you know.",
  INVOICE_UPLOAD:
    "Upload a readable invoice through the secure uploader. Start image analysis if configured, or skip and submit with missing evidence.",
  PHOTO_UPLOAD:
    "Upload a clear photo showing the device with its readable factory model label or About screen.",
  EVIDENCE_CHECK:
    "Review the saved rule results and the three highest-priority evidence requests. Recheck after uploads or analysis; you may continue with missing evidence for human review.",
  CLAIM_CONFIRMATION:
    "Check the product, dates, statement, value and evidence below. Confirm only if these details are correct.",
  CLAIM_SUBMISSION:
    "Details confirmed. Select Submit claim to send this real claim to the reviewer queue.",
  STATUS_DISPLAY:
    "Your claim is submitted. Check its current status or open its evidence ledger. Recommendations are advisory; reviewers decide.",
};
const schemas = {
  GREETING: z.object({ action: z.literal("BEGIN") }).strict(),
  PRODUCT_SELECTION: z.object({ brand: z.enum(catalogBrands) }).strict(),
  PRODUCT_DETAILS: z
    .object({
      catalog_id: z.enum(catalogIds),
      serial: z.string().trim().min(3).max(100),
    })
    .strict(),
  PURCHASE_DETAILS: z
    .object({
      purchase_date: z.union([calendarDate, z.literal("UNKNOWN")]),
      incident_date: z.union([calendarDate, z.literal("UNKNOWN")]),
      claim_value_minor: z.number().int().min(0).max(100000000).nullable(),
      currency: z.literal("INR").default("INR"),
    })
    .strict(),
  ISSUE_DESCRIPTION: z
    .object({
      statement: z.string().trim().min(20).max(5000),
      questionnaire: questionnaireSchema.optional(),
      previous_repairs: z.number().int().min(0).max(100),
      declared_no_visible_damage: z.boolean().nullable().default(null),
      declared_unauthorized_repairs: z.boolean().nullable().default(null),
    })
    .strict(),
  INVOICE_UPLOAD: z.object({ action: z.enum(["CONTINUE", "SKIP"]) }).strict(),
  PHOTO_UPLOAD: z.object({ action: z.enum(["CONTINUE", "SKIP"]) }).strict(),
  EVIDENCE_CHECK: z
    .object({ action: z.enum(["RECHECK", "CONTINUE"]) })
    .strict(),
  CLAIM_CONFIRMATION: z.object({ confirmed: z.literal(true) }).strict(),
  CLAIM_SUBMISSION: z.object({ action: z.literal("SUBMIT") }).strict(),
  STATUS_DISPLAY: z
    .object({
      action: z.literal("CHECK_STATUS"),
      claim_id: z.string().uuid().optional(),
    })
    .strict(),
};

function currentState(session, data) {
  // Conversations saved before device selection can resume at the brand step.
  if (
    !session.claim_id &&
    ["PRODUCT_DETAILS", "PURCHASE_DETAILS", "ISSUE_DESCRIPTION"].includes(
      session.state,
    ) &&
    !catalogBrands.includes(data.brand)
  )
    return "PRODUCT_SELECTION";
  return session.state;
}

export function createChatService({ db, aiStatus }) {
  const own = (id, userId) => {
    const row = db
      .prepare("SELECT * FROM chat_sessions WHERE id=? AND user_id=?")
      .get(id, userId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "Conversation not found.");
    return row;
  };
  function view(id, userId) {
    const s = own(id, userId);
    const data = JSON.parse(s.data);
    const state = currentState(s, data);
    const claim = s.claim_id
      ? db
          .prepare("SELECT * FROM claims WHERE id=? AND user_id=?")
          .get(s.claim_id, userId)
      : null;
    const messages = db
      .prepare(
        "SELECT id,role,content,created_at FROM chat_messages WHERE session_id=? ORDER BY rowid",
      )
      .all(id);
    return {
      id: s.id,
      state,
      revision: s.revision,
      data,
      claim,
      mode: aiStatus().status === "READY" ? "STRUCTURED_MODE" : "LIMITED_MODE",
      ai: aiStatus(),
      prompt: prompts[state],
      messages,
      investigation: claim ? readInvestigation(db, claim.id, "customer") : null,
    };
  }
  function create(userId) {
    return db
      .transaction(() => {
        if (
          db
            .prepare("SELECT COUNT(*) n FROM chat_sessions WHERE user_id=?")
            .get(userId).n >= 20
        )
          throw new HttpError(
            429,
            "SESSION_LIMIT",
            "Conversation limit reached. Continue an existing session.",
          );
        const id = randomUUID();
        db.prepare(
          "INSERT INTO chat_sessions(id,user_id,state) VALUES(?,?,?)",
        ).run(id, userId, "GREETING");
        db.prepare(
          "INSERT INTO chat_messages(id,session_id,role,content) VALUES(?,?,?,?)",
        ).run(randomUUID(), id, "assistant", prompts.GREETING);
        return view(id, userId);
      })
      .immediate();
  }
  function respond(id, userId, body) {
    const request = z
      .object({
        requestId: z.string().uuid(),
        revision: z.number().int().min(0),
        input: z.record(z.string(), z.unknown()),
      })
      .strict()
      .parse(body);
    return db
      .transaction(() => {
        const s = own(id, userId);
        const hash = digest(JSON.stringify(request.input));
        const previous = db
          .prepare(
            "SELECT request_hash,response_json FROM chat_messages WHERE session_id=? AND request_id=?",
          )
          .get(id, request.requestId);
        if (previous) {
          if (previous.request_hash !== hash)
            throw new HttpError(
              409,
              "REQUEST_REUSED",
              "This request ID was already used for different input.",
            );
          const reply = JSON.parse(previous.response_json);
          if (reply.claim)
            reply.investigation = readInvestigation(
              db,
              reply.claim.id,
              "customer",
            );
          return { ...reply, cached: true };
        }
        if (s.revision !== request.revision)
          throw new HttpError(
            409,
            "STALE_CONVERSATION",
            "Conversation changed. Reload it before continuing.",
          );
        if (
          db
            .prepare("SELECT COUNT(*) n FROM chat_messages WHERE session_id=?")
            .get(id).n >= 200
        )
          throw new HttpError(
            429,
            "MESSAGE_LIMIT",
            "This conversation reached its message limit. Your claim is saved.",
          );
        const data = JSON.parse(s.data);
        const state = currentState(s, data);
        const input = schemas[state].parse(request.input);
        let next = state,
          claimId = s.claim_id;
        let assistant;
        switch (state) {
          case "GREETING":
            next = "PRODUCT_SELECTION";
            break;
          case "PRODUCT_SELECTION":
            data.brand = input.brand;
            delete data.product;
            delete data.model;
            next = "PRODUCT_DETAILS";
            break;
          case "PRODUCT_DETAILS":
            if (getCatalogItem(input.catalog_id).brand !== data.brand)
              throw new HttpError(
                400,
                "CATALOG_BRAND_MISMATCH",
                "Choose a model from the selected brand.",
              );
            Object.assign(data, input);
            next = "PURCHASE_DETAILS";
            break;
          case "PURCHASE_DETAILS":
            if (
              (input.incident_date !== "UNKNOWN" &&
                input.incident_date > new Date().toISOString().slice(0, 10)) ||
              (input.incident_date !== "UNKNOWN" &&
                input.purchase_date !== "UNKNOWN" &&
                input.incident_date < input.purchase_date)
            )
              throw new HttpError(
                400,
                "INVALID_DATES",
                "Incident date must be on/after purchase and not in the future.",
              );
            Object.assign(data, input);
            next = "ISSUE_DESCRIPTION";
            break;
          case "ISSUE_DESCRIPTION": {
            Object.assign(data, input);
            if (input.questionnaire)
              data.incident_date =
                input.questionnaire.exactDate ||
                (input.questionnaire.noticed === "Today"
                  ? new Date().toISOString().slice(0, 10)
                  : "UNKNOWN");
            const { brand, ...claim } = data;
            claimId = createClaim(db, userId, claim, { draft: true });
            next = "INVOICE_UPLOAD";
            break;
          }
          case "INVOICE_UPLOAD":
            if (
              input.action === "CONTINUE" &&
              !db
                .prepare(
                  "SELECT id FROM evidence WHERE claim_id=? AND kind='invoice'",
                )
                .get(claimId)
            )
              throw new HttpError(
                400,
                "EVIDENCE_REQUIRED",
                "Upload an invoice, or explicitly select Skip.",
              );
            next = "PHOTO_UPLOAD";
            break;
          case "PHOTO_UPLOAD":
            if (
              input.action === "CONTINUE" &&
              !db
                .prepare(
                  "SELECT id FROM evidence WHERE claim_id=? AND kind='photo' AND active=1",
                )
                .get(claimId)
            )
              throw new HttpError(
                400,
                "EVIDENCE_REQUIRED",
                "Upload a photo, or explicitly select Skip.",
              );
            investigate(
              db,
              db.prepare("SELECT * FROM claims WHERE id=?").get(claimId),
            );
            next = "EVIDENCE_CHECK";
            break;
          case "EVIDENCE_CHECK":
            if (input.action === "RECHECK")
              investigate(
                db,
                db.prepare("SELECT * FROM claims WHERE id=?").get(claimId),
              );
            else next = "CLAIM_CONFIRMATION";
            break;
          case "CLAIM_CONFIRMATION":
            next = "CLAIM_SUBMISSION";
            break;
          case "CLAIM_SUBMISSION":
            submitDraft(db, claimId, userId);
            next = "STATUS_DISPLAY";
            break;
          case "STATUS_DISPLAY": {
            const c = db
              .prepare(
                "SELECT * FROM claims WHERE id=? AND user_id=? AND is_draft=0",
              )
              .get(input.claim_id || claimId, userId);
            if (!c) throw new HttpError(404, "NOT_FOUND", "Claim not found.");
            assistant = `Claim ${c.id}: ${c.status}. Final status is recorded by authorized reviewers.`;
            break;
          }
        }
        const messageId = randomUUID();
        db.prepare(
          "INSERT INTO chat_messages(id,session_id,role,content,input_json,request_id,request_hash) VALUES(?,?,?,?,?,?,?)",
        ).run(
          messageId,
          id,
          "user",
          JSON.stringify(input),
          JSON.stringify(input),
          request.requestId,
          hash,
        );
        db.prepare(
          "UPDATE chat_sessions SET state=?,data=?,claim_id=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        ).run(next, JSON.stringify(data), claimId, id);
        let text = assistant || prompts[next];
        if (next === "EVIDENCE_CHECK") {
          const i = readInvestigation(db, claimId, "customer");
          text +=
            ` Recorded recommendation: ${i.outcome}. ${i.explanation} ` +
            i.nextEvidence.map((e) => e.text).join(" ");
        }
        if (next === "STATUS_DISPLAY" && state !== "STATUS_DISPLAY")
          text += ` Persisted claim ID: ${claimId}.`;
        db.prepare(
          "INSERT INTO chat_messages(id,session_id,role,content) VALUES(?,?,?,?)",
        ).run(randomUUID(), id, "assistant", text);
        const result = view(id, userId);
        db.prepare("UPDATE chat_messages SET response_json=? WHERE id=?").run(
          JSON.stringify(result),
          messageId,
        );
        return result;
      })
      .immediate();
  }
  return {
    create,
    view,
    respond,
    list: (userId) =>
      db
        .prepare(
          "SELECT id,state,data,claim_id,revision,updated_at FROM chat_sessions WHERE user_id=? ORDER BY rowid DESC",
        )
        .all(userId)
        .map(({ data, ...s }) => ({
          ...s,
          state: currentState(s, JSON.parse(data)),
        })),
  };
}

