import { createChatService } from "../src/services/chat.js";
import { randomUUID } from "node:crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { openDatabase } from "../src/database/db.js";
import { createClaim, claimSchema } from "../src/services/claims.js";
import { readInvestigation } from "../src/services/investigation.js";
import { catalog } from "../src/catalog.js";
import {
  issues,
  followups,
  changeAnswer,
  summarize,
  questionnaireErrors,
  evidenceRequests,
} from "../../shared/questionnaire.js";
import ProblemQuestions from "../../frontend/src/components/ProblemQuestions.jsx";
const answers = (extra = {}) => ({
  version: 1,
  issue: "Battery or charging problems",
  noticed: "Don't remember",
  frequency: "Sometimes",
  usability: "Partially working",
  repairs: "Not sure",
  damage: "Not sure",
  tried: "No",
  actions: [],
  details: { charging: "Not sure", charger: "Not tried" },
  ...extra,
});
const input = (a = answers()) => ({
  catalog_id: catalog[0].id,
  serial: "UNKNOWN",
  purchase_date: "UNKNOWN",
  incident_date: "UNKNOWN",
  previous_repairs: 0,
  statement: summarize("Mobile phone", a),
  questionnaire: a,
});
describe("evidence-aware guided intake", () => {
  it("offers only catalog-specific issues, with at most three relevant followups", () => {
    for (const d of catalog)
      for (const issue of issues[d.category])
        expect(followups(d.category, issue).length).toBeLessThanOrEqual(3);
    expect(issues.Headphones).not.toContain("Screen or touch problems");
    expect(followups("Mobile phone", "Overheating")).toEqual([]);
    expect(followups("Headphones", "Screen or touch problems")).toEqual([]);
  });
  it("renders conditional questions and appropriate unknown options without unrelated questions", () => {
    const html = renderToStaticMarkup(
      <ProblemQuestions
        category="Mobile phone"
        answers={answers()}
        onChange={() => {}}
      />,
    );
    expect(html).toContain("Not tried");
    expect(html).not.toContain("Who repaired it?");
    expect(html).not.toContain("Which side");
    const repaired = renderToStaticMarkup(
      <ProblemQuestions
        category="Headphones"
        answers={answers({
          issue: "One side not working",
          repairs: "Yes",
          details: { side: "Left" },
        })}
        onChange={() => {}}
      />,
    );
    expect(repaired).toContain("Who repaired it?");
    expect(repaired).toContain("Which side");
    expect(repaired).not.toContain("indicate that it is charging");
  });
  it("clears stale answers and rejects tampered issue combinations", () => {
    const changed = changeAnswer(answers(), "issue", "Overheating");
    expect(changed.details).toEqual({});
    expect(
      questionnaireErrors(
        "Headphones",
        answers({ issue: "Screen or touch problems" }),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      claimSchema.safeParse(input(answers({ details: { side: "Left" } })))
        .success,
    ).toBe(false);
    expect(
      changeAnswer(
        answers({ repairs: "Yes", repairer: "Self" }),
        "repairs",
        "Not sure",
      ).repairer,
    ).toBeUndefined();
  });
  it("preserves uncertainty, includes dynamic answers and never claims verification", () => {
    const s = summarize("Mobile phone", answers());
    expect(s).toContain("date is unknown");
    expect(s).toContain("history is unknown");
    expect(s).toContain("Not tried");
    expect(s).not.toMatch(/verified|no previous repairs/i);
    expect(evidenceRequests(answers()).map((x) => x[1])).not.toContain(
      "Visible issue photo",
    );
  });
  it("normal customer journey persists selections, edited summary and missing evidence for review", () => {
    const db = openDatabase(":memory:");
    try {
      db.prepare(
        "INSERT INTO users(id,name,email,password_hash,role) VALUES('u','Customer','u@x.test','unused','customer')",
      ).run();
      const a = answers({
        noticed: "Today",
        repairs: "No",
        damage: "No known damage",
      });
      const body = {
        ...input(a),
        incident_date: new Date().toISOString().slice(0, 10),
        statement: "My own edited summary: the phone charges only sometimes.",
      };
      const id = createClaim(db, "u", body);
      const saved = db.prepare("SELECT * FROM claims WHERE id=?").get(id);
      expect(JSON.parse(saved.questionnaire_json)).toEqual(a);
      expect(saved.statement).toBe(body.statement);
      const review = readInvestigation(db, id, "reviewer");
      expect(review.outcome).not.toBe("AUTO_APPROVE");
      expect(review.results.some((r) => r.status === "UNKNOWN")).toBe(true);
      expect(
        db.prepare("SELECT COUNT(*) n FROM evidence WHERE claim_id=?").get(id)
          .n,
      ).toBe(0);
      // Historical clients remain supported, with no questionnaire required.
      const legacy = { ...input() };
      delete legacy.questionnaire;
      const old = createClaim(db, "u", legacy);
      expect(
        db.prepare("SELECT questionnaire_json FROM claims WHERE id=?").get(old)
          .questionnaire_json,
      ).toBeNull();
    } finally {
      db.close();
    }
  });
  it("uncertain repair history cannot become a false zero-repair contradiction or accusation", () => {
    const db = openDatabase(":memory:");
    try {
      db.prepare(
        "INSERT INTO users(id,name,email,password_hash,role) VALUES('u','Customer','u@x.test','unused','customer')",
      ).run();
      const id = createClaim(db, "u", input());
      const review = readInvestigation(db, id, "reviewer");
      expect(review.results.find((r) => r.ruleId === "R10").status).toBe(
        "UNKNOWN",
      );
      expect(review.explanation.toLowerCase()).not.toContain("fraud");
      expect(
        db
          .prepare("SELECT snapshot FROM investigations WHERE claim_id=?")
          .get(id).snapshot,
      ).toContain('"previous_repairs":null');
    } finally {
      db.close();
    }
  });
  it("a recorded repair contradicting a reported absence requests human clarification without an accusation", () => {
    const db = openDatabase(":memory:");
    try {
      db.prepare(
        "INSERT INTO users(id,name,email,password_hash,role) VALUES('u','Customer','u@x.test','unused','customer')",
      ).run();
      db.prepare(
        "INSERT INTO serial_registry(serial,product,purchase_date,service_count,verified,source,synthetic,model) VALUES(?,?,?,?,?,?,?,?)",
      ).run(
        "TEST-SERIAL",
        "Mobile phone",
        "2026-01-01",
        2,
        1,
        "TEST ONLY independent record",
        0,
        "Galaxy A26 5G",
      );
      const id = createClaim(db, "u", {
        ...input(answers({ repairs: "No" })),
        serial: "TEST-SERIAL",
      });
      const result = readInvestigation(db, id, "reviewer");
      const repair = result.results.find((r) => r.ruleId === "R10");
      expect(repair.status).toBe("FAIL");
      expect(repair.reason).toContain("Human clarification");
      expect(repair.reason.toLowerCase()).not.toMatch(/fraud|lying/);
      expect(
        db.prepare("SELECT status FROM claims WHERE id=?").get(id).status,
      ).toBe("SUBMITTED");
      expect(result.outcome).not.toBe("AUTO_APPROVE");
    } finally {
      db.close();
    }
  });

  it("assistant persists the same structured questionnaire and supports missing evidence in limited mode", () => {
    const db = openDatabase(":memory:");
    try {
      db.prepare(
        "INSERT INTO users(id,name,email,password_hash,role) VALUES('u','Customer','u@x.test','unused','customer')",
      ).run();
      const chat = createChatService({
        db,
        aiStatus: () => ({ status: "AI_NOT_CONFIGURED" }),
      });
      let session = chat.create("u");
      const send = (input) => {
        session = chat.respond(session.id, "u", {
          requestId: randomUUID(),
          revision: session.revision,
          input,
        });
      };
      send({ action: "BEGIN" });
      send({ brand: "Samsung" });
      send({ catalog_id: catalog[0].id, serial: "UNKNOWN" });
      send({
        purchase_date: "UNKNOWN",
        incident_date: "UNKNOWN",
        claim_value_minor: null,
      });
      const body = input();
      send({
        statement: body.statement,
        previous_repairs: 0,
        questionnaire: body.questionnaire,
      });
      expect(JSON.parse(session.claim.questionnaire_json)).toEqual(
        body.questionnaire,
      );
      expect(session.mode).toBe("LIMITED_MODE");
      send({ action: "SKIP" });
      send({ action: "SKIP" });
      send({ action: "CONTINUE" });
      send({ confirmed: true });
      send({ action: "SUBMIT" });
      expect(session.claim.is_draft).toBe(0);
      expect(session.investigation.outcome).toBe("NEEDS_EVIDENCE");
    } finally {
      db.close();
    }
  });
});
