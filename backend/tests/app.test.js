import sharp from "sharp";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../src/database/db.js";
import { createApp } from "../src/app.js";
import { ClaudeVisionAdapter } from "../src/ai/claude.js";
import { hashPassword } from "../src/utils/security.js";
import { evaluate } from "../src/rules/legacy.js";
import { importOra, expectedHeaders } from "../src/services/ora.js";
let folder, db, app;
const password = "correct-horse-battery-2026";
const claim = {
  catalog_id: "samsung-galaxy-a26-5g",
  serial: "PHONE-123",
  purchase_date: "2026-01-15",
  incident_date: "2026-10-01",
  statement: "The phone does not turn on during normal use.",
  previous_repairs: 0,
};
const secure = (req) => req.set("X-ClaimShield", "1");
async function register(email = "customer@example.com") {
  const agent = request.agent(app);
  const response = await secure(agent.post("/api/auth/register")).send({
    name: "Test Customer",
    email,
    password,
  });
  expect(response.status).toBe(201);
  agent.sessionCookie = response.headers["set-cookie"][0].split(";")[0];
  return agent;
}
async function reviewer() {
  db.prepare(
    "INSERT INTO users(id,name,email,password_hash,role) VALUES(?,?,?,?,?)",
  ).run(
    randomUUID(),
    "Reviewer",
    "reviewer@example.com",
    hashPassword(password),
    "reviewer",
  );
  const agent = request.agent(app);
  expect(
    (
      await secure(agent.post("/api/auth/login")).send({
        email: "reviewer@example.com",
        password,
      })
    ).status,
  ).toBe(200);
  return agent;
}
async function submit(agent) {
  const r = await secure(agent.post("/api/claims")).send(claim);
  expect(r.status).toBe(201);
  return r.body.id;
}
beforeEach(() => {
  folder = mkdtempSync(resolve(tmpdir(), "claimshield-"));
  db = openDatabase(resolve(folder, "db.sqlite"));
  app = createApp({
    db,
    uploads: resolve(folder, "private"),
    aiAdapter: new ClaudeVisionAdapter({ apiKey: "", model: "" }),
  });
});
afterEach(() => {
  db.close();
  rmSync(folder, { recursive: true, force: true });
});
describe("Secure integrated API", () => {
  it("health is backed by SQLite and reports unconfigured AI", async () => {
    const r = await request(app).get("/api/health");
    expect(r.status).toBe(200);
    expect(r.body.database).toBe("connected");
    expect(r.body.ai.status).toBe("AI_NOT_CONFIGURED");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
  });
  it("registers, hashes passwords, logs in, and revokes sessions", async () => {
    const agent = await register();
    const user = db.prepare("SELECT * FROM users").get();
    expect(user.password_hash).not.toContain(password);
    expect((await agent.get("/api/auth/me")).body.user.role).toBe("customer");
    expect((await secure(agent.post("/api/auth/logout"))).status).toBe(200);
    expect((await agent.get("/api/auth/me")).status).toBe(401);
    expect(
      (
        await secure(agent.post("/api/auth/login")).send({
          email: user.email,
          password,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await secure(agent.post("/api/auth/login")).send({
          email: user.email,
          password: "wrong-password-123",
        })
      ).status,
    ).toBe(401);
  });
  it("rejects public role escalation and invalid payloads", async () => {
    expect(
      (
        await secure(request(app).post("/api/auth/register")).send({
          name: "Attacker",
          email: "x@y.com",
          password,
          role: "reviewer",
        })
      ).status,
    ).toBe(400);
    const a = await register();
    for (const body of [
      { ...claim, user_id: "fake" },
      { ...claim, purchase_date: "2026-02-30" },
      { ...claim, previous_repairs: -1 },
      { ...claim, statement: "short" },
    ])
      expect((await secure(a.post("/api/claims")).send(body)).status).toBe(400);
  });
  it("requires authentication and rejects cross-origin writes", async () => {
    expect((await request(app).get("/api/claims")).status).toBe(401);
    expect(
      (await secure(request(app).post("/api/claims")).send(claim)).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/auth/login")
          .send({ email: "x@y.com", password })
      ).status,
    ).toBe(403);
    expect(
      (
        await secure(request(app).post("/api/auth/login"))
          .set("Origin", "https://evil.example")
          .send({ email: "x@y.com", password })
      ).status,
    ).toBe(403);
  });
  it("requires a supported catalog ID and rejects client category or model conflicts", async () => {
    const a = await register();
    const { catalog_id, ...details } = claim;
    for (const fields of [
      { product: "Mobile phone", model: "Galaxy A26 5G" },
      { catalog_id: "samsung-galaxy-a25-5g" },
      { catalog_id: "SM-A266B" },
      { catalog_id, product: "Laptop" },
      { catalog_id, model: "Galaxy A36 5G" },
    ]) {
      const result = await secure(a.post("/api/claims")).send({
        ...details,
        ...fields,
      });
      expect(result.status).toBe(400);
    }
    expect((await a.get("/api/claims")).body.claims).toEqual([]);
  });
  it("stores the catalog category and model and ignores redundant matching values for idempotency", async () => {
    const a = await register();
    const input = { ...claim, catalog_id: "boat-rockerz-550" };
    const key = randomUUID();
    const created = await secure(a.post("/api/claims"))
      .set("Idempotency-Key", key)
      .send(input);
    expect(created.status).toBe(201);
    const identity = { product: "Headphones", model: "Rockerz 550" };
    const repeated = await secure(a.post("/api/claims"))
      .set("Idempotency-Key", key)
      .send({ ...input, ...identity });
    expect(repeated.status).toBe(201);
    expect(repeated.body.id).toBe(created.body.id);
    const detail = await a.get(`/api/claims/${created.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.claim).toMatchObject({
      catalog_id: input.catalog_id,
      ...identity,
    });
  });
  it("creates UUID claims and persists records and sessions across reopening the database", async () => {
    const a = await register();
    const id = await submit(a);
    expect(id).toMatch(/^[a-f0-9-]{36}$/);
    expect((await a.get("/api/claims")).body.claims).toHaveLength(1);
    db.close();
    db = openDatabase(resolve(folder, "db.sqlite"));
    app = createApp({
      db,
      uploads: resolve(folder, "private"),
      aiAdapter: new ClaudeVisionAdapter({ apiKey: "", model: "" }),
    });
    const persisted = db.prepare("SELECT * FROM claims WHERE id=?").get(id);
    expect(persisted.serial).toBe(claim.serial);
    expect(db.prepare("SELECT count(*) n FROM sessions").get().n).toBe(1);
    expect(db.prepare("SELECT count(*) n FROM investigations").get().n).toBe(1);
    const restored = await request(app)
      .get("/api/claims/" + id)
      .set("Cookie", a.sessionCookie);
    expect(restored.status).toBe(200);
    expect(restored.body.claim.serial).toBe(claim.serial);
  });
  it("enforces ownership, even for files, and reviewer-only endpoints", async () => {
    const a = await register(),
      id = await submit(a),
      b = await register("second@example.com");
    expect((await b.get("/api/claims/" + id)).status).toBe(404);
    expect((await b.get("/api/claims/" + id + "/evidence/fake")).status).toBe(
      404,
    );
    expect(
      (await secure(b.post("/api/claims/" + id + "/evidence"))).status,
    ).toBe(404);
    expect((await a.get("/api/reviewer/claims")).status).toBe(403);
    expect(
      (
        await secure(a.patch("/api/reviewer/claims/" + id)).send({
          status: "APPROVED",
          reason: "customer attempted decision",
        })
      ).status,
    ).toBe(403);
    const r = await reviewer();
    expect((await r.get("/api/reviewer/claims")).body.claims).toHaveLength(1);
    expect((await r.get("/api/claims/" + id)).status).toBe(200);
  });
  it("privately uploads evidence, rejects forged file types, and saves reevaluations", async () => {
    const a = await register(),
      id = await submit(a);
    const png = await sharp({
      create: { width: 40, height: 30, channels: 3, background: "#47a358" },
    })
      .png()
      .toBuffer();
    const r = await secure(a.post("/api/claims/" + id + "/evidence"))
      .field("kind", "photo")
      .attach("file", png, { filename: "photo.png", contentType: "image/png" });
    expect(r.status).toBe(201);
    expect(
      (await a.get("/api/claims/" + id + "/evidence/" + r.body.id)).status,
    ).toBe(200);
    expect(
      (await request(app).get("/api/claims/" + id + "/evidence/" + r.body.id))
        .status,
    ).toBe(401);
    expect(
      (
        await secure(a.post("/api/claims/" + id + "/evidence"))
          .field("kind", "photo")
          .attach("file", Buffer.from("fake"), {
            filename: "fake.png",
            contentType: "image/png",
          })
      ).status,
    ).toBe(400);
    expect(readdirSync(resolve(folder, "private"))).toHaveLength(2);
    expect(db.prepare("SELECT count(*) n FROM investigations").get().n).toBe(2);
  });
  it("records human decisions and prevents changes to finalized claims", async () => {
    const a = await register(),
      id = await submit(a),
      r = await reviewer();
    expect(
      (
        await secure(r.patch("/api/reviewer/claims/" + id)).send({
          status: "NEEDS_EVIDENCE",
          reason: "Please provide your purchase invoice.",
        })
      ).status,
    ).toBe(200);
    let detail = (await a.get("/api/claims/" + id)).body;
    expect(detail.claim.status).toBe("NEEDS_EVIDENCE");
    expect(detail.timeline.at(-1).detail).toContain("purchase invoice");
    expect(
      (
        await secure(r.patch("/api/reviewer/claims/" + id)).send({
          status: "APPROVED",
          reason: "Reviewed supplied records and eligibility.",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await secure(r.patch("/api/reviewer/claims/" + id)).send({
          status: "REJECTED",
          reason: "Second final decision attempt.",
        })
      ).status,
    ).toBe(409);
    expect(
      (await secure(a.post("/api/claims/" + id + "/evidence"))).status,
    ).toBe(409);
  });
});
function input() {
  return {
    claim: {
      product: "Laptop",
      serial: "LAPTOP-123",
      purchase_date: "2026-01-15",
      incident_date: "2026-10-01",
      statement: "The laptop does not turn on during normal use.",
      previous_repairs: 0,
      synthetic: 0,
    },
    evidence: [
      { id: "invoice-id", kind: "invoice" },
      { id: "photo-id", kind: "photo" },
    ],
    registry: {
      product: "Laptop",
      purchase_date: "2026-01-15",
      service_count: 0,
      verified: 1,
      synthetic: 0,
    },
    policy: { product: "Laptop", months: 12, verified: 1, synthetic: 0 },
  };
}
describe("Historical v0.1 deterministic rules", () => {
  it("returns five stable traceable results", () => {
    const i = input(),
      r = evaluate(i);
    expect(r).toEqual(evaluate(i));
    expect(r.outcome).toBe("AUTO_APPROVE");
    expect(r.results.map((r) => r.ruleId)).toEqual([
      "R01",
      "R02",
      "R03",
      "R04",
      "R05",
    ]);
    expect(r.results[2].evidenceIds).toEqual(["invoice-id", "photo-id"]);
  });
  it("requests missing evidence without accusation", () => {
    const i = input();
    i.evidence = [];
    const r = evaluate(i);
    expect(r.outcome).toBe("NEEDS_EVIDENCE");
    expect(r.results[2].status).toBe("UNKNOWN");
    expect(r.results[2].explanation).toContain("does not imply misconduct");
  });
  it("recommends human review for expiry", () => {
    const i = input();
    i.claim.incident_date = "2027-01-16";
    expect(evaluate(i).outcome).toBe("REJECT_RECOMMENDED");
  });
  it("handles coverage month-end and exact expiry inclusively", () => {
    const i = input();
    i.registry.purchase_date = "2024-02-29";
    i.claim.purchase_date = "2024-02-29";
    i.claim.incident_date = "2025-02-28";
    expect(evaluate(i).results[1].status).toBe("PASS");
    i.claim.incident_date = "2025-03-01";
    expect(evaluate(i).results[1].status).toBe("FAIL");
  });
  it("escalates product/serial mismatch and service conflicts", () => {
    const i = input();
    i.registry.product = "Mobile phone";
    expect(evaluate(i).outcome).toBe("ESCALATE");
    i.registry.product = "Laptop";
    i.registry.service_count = 1;
    expect(evaluate(i).results[3].status).toBe("FAIL");
  });
  it("never treats unverified or synthetic records as independent real verification", () => {
    for (const key of ["registry", "policy"]) {
      const i = input();
      i[key].verified = 0;
      expect(evaluate(i).outcome).toBe("ESCALATE");
    }
    const i = input();
    i.registry.synthetic = 1;
    expect(evaluate(i).outcome).toBe("ESCALATE");
  });
  it("unverified expiry never supports a rejection recommendation", () => {
    const i = input();
    i.registry.verified = 0;
    i.claim.incident_date = "2030-01-01";
    expect(evaluate(i).results[1].status).toBe("UNKNOWN");
    expect(evaluate(i).outcome).toBe("ESCALATE");
  });
});
describe("Datasets", () => {
  it("replays the forty historical appliance fixtures against the version 0.1 evaluator", () => {
    const fixtures = JSON.parse(readFileSync(
      new URL("../../data/synthetic/claims.json", import.meta.url),
    ));
    expect(fixtures).toHaveLength(40);
    expect(new Set(fixtures.map((f) => f.product)).size).toBe(4);
    const oracle = JSON.parse(
      readFileSync(
        new URL("../../data/synthetic/expected-outcomes.json", import.meta.url),
      ),
    );
    for (const f of fixtures) {
      const actual = evaluate({
        claim: { ...f, synthetic: 1 },
        registry: {
          product: f.registry_product,
          purchase_date: f.purchase_date,
          service_count: f.registry_service_count,
          verified: f.registry_verified,
          synthetic: 1,
        },
        policy: { months: 12, verified: 1, synthetic: 1 },
        evidence: f.evidence_kinds.map((kind, n) => ({ id: String(n), kind })),
      });
      expect(actual.outcome, f.fixture_id).toBe(
        oracle.find((e) => e.fixture_id === f.fixture_id).outcome,
      );
    }
  });
  it("starts NOT_LOADED and imports compatible ORDS CSV only into aggregate context", async () => {
    expect(
      db.prepare("SELECT status FROM datasets_provenance").get().status,
    ).toBe("NOT_LOADED");
    const path = resolve(folder, "ora.csv");
    writeFileSync(
      path,
      expectedHeaders.join(",") +
        "\n" +
        [
          "org-1",
          "Repair Org",
          "GBR",
          "Laptop",
          "Laptop",
          "8",
          "Example",
          "2020",
          "6",
          "Fixed",
          "",
          "group",
          "2026-01-01",
          "Battery replaced",
        ].join(",") +
        "\n",
    );
    expect((await importOra(db, path)).count).toBe(1);
    expect(db.prepare("SELECT count(*) n FROM repair_context").get().n).toBe(1);
    expect(db.prepare("SELECT count(*) n FROM serial_registry").get().n).toBe(
      0,
    );
    expect(
      db.prepare("SELECT sha256 FROM datasets_provenance").get().sha256,
    ).toHaveLength(64);
    writeFileSync(path, "bad,header\n1,2");
    await expect(importOra(db, path)).rejects.toThrow("header");
    expect(
      db.prepare("SELECT status FROM datasets_provenance").get().status,
    ).toBe("FAILED");
    expect(db.prepare("SELECT count(*) n FROM repair_context").get().n).toBe(1);
  });
});
