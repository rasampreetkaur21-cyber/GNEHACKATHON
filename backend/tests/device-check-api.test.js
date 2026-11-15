import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import sharp from "sharp";
import request from "supertest";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/database/db.js";
import { ClaudeVisionAdapter } from "../src/ai/claude.js";
import { catalog } from "../src/catalog.js";
import { digest } from "../src/utils/security.js";
import { createClaim } from "../src/services/claims.js";
let db, app, folder, calls, token, userId;
const observed = (device = catalog[0], extra = {}) => ({
  quality: "CLEAR",
  device_category: device.category,
  observed_brand: device.brand,
  observed_model_text: device.model,
  serial_text: null,
  identifying_evidence_kind: "LABEL",
  identifier_linked_to_pictured_device: true,
  outside_catalog: false,
  authenticity_assessed: true,
  authenticity_signals: [],
  confidence: null,
  ...extra,
});
const response = (o) => ({
  stop_reason: "end_turn",
  content: [{ type: "text", text: JSON.stringify(o) }],
});
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "claimshield-check-test-"));
  db = openDatabase(join(folder, "db.sqlite"));
  userId = randomUUID();
  token = randomUUID();
  db.prepare(
    "INSERT INTO users(id,name,email,password_hash,role) VALUES(?,?,?,?,?)",
  ).run(userId, "TEST ONLY", "check@example.invalid", "unused", "customer");
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    digest(token),
    userId,
    Date.now() + 60000,
  );
  calls = vi.fn().mockResolvedValue(response(observed()));
  const adapter = new ClaudeVisionAdapter({
    apiKey: "TEST-ONLY",
    model: "TEST-ONLY-MOCK",
    client: { messages: { create: calls } },
    maxRetries: 0,
    timeoutMs: 2000,
  });
  app = createApp({ db, uploads: join(folder, "private"), aiAdapter: adapter });
});
afterEach(async () => {
  await app.locals.analysis.waitForIdle();
  db.close();
  rmSync(folder, { recursive: true, force: true });
});
const secure = (r) =>
  r.set("X-ClaimShield", "1").set("Cookie", `cs_session=${token}`);
const image = async (size = 220) =>
  sharp({
    create: { width: size, height: size, channels: 3, background: "#6597c5" },
  })
    .png()
    .toBuffer();
async function post(bytes, model = catalog[0].id, fields = {}) {
  let r = secure(request(app).post("/api/device-checks")).field(
    "selected_model_id",
    model,
  );
  for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
  return r.attach("image", bytes, {
    filename: "device.png",
    contentType: "image/png",
  });
}
it("serves exactly six canonical products and requires authentication", async () => {
  expect((await request(app).get("/api/device-catalog")).status).toBe(401);
  const r = await secure(request(app).get("/api/device-catalog"));
  expect(r.body.products.map((x) => x.model_id)).toEqual(
    catalog.map((d) => d.id),
  );
});
it.each(catalog)(
  "validates a single image for $model without auto-approving an unlinked claim",
  async (device) => {
    calls.mockResolvedValue(response(observed(device)));
    const r = await post(await image(), device.id);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      status: "VALID_MATCH",
      decision: "ESCALATE",
      selected_model_id: device.id,
      observed_model_id: device.id,
      confidence: null,
      authenticity: "REAL_UNVERIFIED",
    });
    expect(calls).toHaveBeenCalledTimes(1);
    expect(calls.mock.calls[0][0].system).toContain("Use null for unreadable nullable");
    expect(
      calls.mock.calls[0][0].messages[0].content.filter(
        (x) => x.type === "image",
      ),
    ).toHaveLength(1);
    expect(db.prepare("SELECT COUNT(*) n FROM device_checks").get().n).toBe(1);
  },
);
it.each([
  [observed(catalog[1]), "DEVICE_MISMATCH", "REJECT"],
  [
    observed(catalog[0], {
      observed_model_text: null,
      identifying_evidence_kind: "NONE",
      outside_catalog: true,
      device_category: "mug",
    }),
    "INVALID_DEVICE",
    "REJECT",
  ],
  [
    observed(catalog[0], { quality: "BLURRY" }),
    "UNCLEAR_IMAGE",
    "NEEDS_RETAKE",
  ],
  [
    observed(catalog[0], { authenticity_signals: ["EDIT_SIGNAL"] }),
    "HUMAN_REVIEW",
    "ESCALATE",
  ],
])("returns actual route status %s", async (o, status, decision) => {
  calls.mockResolvedValue(response(o));
  const r = await post(await image());
  expect(r.status).toBe(201);
  expect(r.body).toMatchObject({ status, decision });
});
it("detects exact duplicates, including concurrent submissions, without leaking another customer's details", async () => {
  const bytes = await image();
  const results = await Promise.all([post(bytes), post(bytes)]);
  expect(results.map((r) => r.body.reason_code)).toContain("DUPLICATE_SIGNAL");
  expect(calls).toHaveBeenCalledTimes(1);
    expect(calls.mock.calls[0][0].system).toContain("Use null for unreadable nullable");
  const duplicate = results.find(
    (r) => r.body.reason_code === "DUPLICATE_SIGNAL",
  ).body;
  expect(duplicate).not.toHaveProperty("other_user_id");
  expect(duplicate.status).toBe("HUMAN_REVIEW");
});
it("detects normalized duplicates after a metadata-only change", async () => {
  const original = await image();
  const changed = await sharp(original)
    .withMetadata({ exif: { IFD0: { Artist: "TEST METADATA" } } })
    .png()
    .toBuffer();
  expect(digest(original)).not.toBe(digest(changed));
  await post(original);
  const r = await post(changed);
  expect(r.body.reason_code).toBe("DUPLICATE_SIGNAL");
});
it("recognizes supplied generated fixtures as synthetic; filenames and model labels do not grant real provenance", async () => {
  const bytes = readFileSync(
    new URL(
      "../../datasets/six-product-v1/data/images/attached/samsung-galaxy-a26-5g/match.jpg",
      import.meta.url,
    ),
  );
  const r = await secure(request(app).post("/api/device-checks"))
    .field("selected_model_id", catalog[0].id)
    .attach("image", bytes, {
      filename: "real-camera.jpg",
      contentType: "image/jpeg",
    });
  expect(r.body).toMatchObject({
    status: "HUMAN_REVIEW",
    authenticity: "SYNTHETIC_SIGNAL",
    origin: "generated_synthetic",
  });
  expect(calls).not.toHaveBeenCalled();
});
it("rejects unsupported IDs, extra observations/origin fields, missing or multiple images and oversized files", async () => {
  expect((await post(await image(), "apple-iphone")).status).toBe(400);
  expect(
    (await post(await image(), catalog[0].id, { origin: "real_camera" }))
      .status,
  ).toBe(400);
  expect(
    (
      await secure(request(app).post("/api/device-checks")).field(
        "selected_model_id",
        catalog[0].id,
      )
    ).status,
  ).toBe(400);
  const bytes = await image();
  const multi = await secure(request(app).post("/api/device-checks"))
    .field("selected_model_id", catalog[0].id)
    .attach("image", bytes, "a.png")
    .attach("image", bytes, "b.png");
  expect(multi.status).toBe(400);
  const large = await post(Buffer.alloc(5 * 1024 * 1024 + 1));
  expect(large.status).toBe(400);
  expect(large.body.error.code).toBe("LIMIT_FILE_SIZE");
  expect(calls).not.toHaveBeenCalled();
  expect(db.prepare("SELECT count(*) n FROM device_checks").get().n).toBe(0);
});
it("rejects MIME spoofing and corrupt image bytes", async () => {
  const jpeg = await sharp(await image())
    .jpeg()
    .toBuffer();
  const r = await post(jpeg);
  expect(r.status).toBe(400);
  expect(r.body.error.code).toBe("INVALID_FILE");
  expect((await post(Buffer.from("not an image"))).status).toBe(400);
});
it("low-resolution images request retake without a provider call", async () => {
  const r = await post(await image(80));
  expect(r.body).toMatchObject({
    status: "UNCLEAR_IMAGE",
    reason_code: "RETAKE_RESOLUTION",
  });
  expect(calls).not.toHaveBeenCalled();
});
it("safe analysis failure and saved-photo retry reuse the record rather than creating a false duplicate", async () => {
  calls.mockRejectedValueOnce(new Error("provider unavailable"));
  const first = await post(await image());
  expect(first.body).toMatchObject({
    status: "HUMAN_REVIEW",
    decision: "ESCALATE",
    analysis_error: "CLAUDE_UNAVAILABLE",
  });
  const retry = await secure(
    request(app).post(`/api/device-checks/${first.body.id}/retry`),
  ).send({});
  expect(retry.status).toBe(200);
  expect(retry.body.status).toBe("VALID_MATCH");
  expect(retry.body.id).toBe(first.body.id);
  expect(db.prepare("SELECT count(*) n FROM device_checks").get().n).toBe(1);
});
it("strips GPS/EXIF from stored/provider image and protects saved photos", async () => {
  const bytes = await sharp(await image())
    .withMetadata({ exif: { IFD0: { Artist: "PRIVATE TEST" } } })
    .png()
    .toBuffer();
  const r = await post(bytes);
  expect(r.status).toBe(201);
  const sent = Buffer.from(
    calls.mock.calls[0][0].messages[0].content.find((x) => x.type === "image")
      .source.data,
    "base64",
  );
  expect((await sharp(sent).metadata()).exif).toBeUndefined();
  expect((await request(app).get(r.body.image_url)).status).toBe(401);
  const photo = await secure(request(app).get(r.body.image_url));
  expect(photo.status).toBe(200);
  const b = await sharp(photo.body).metadata();
  expect(b.exif).toBeUndefined();
});
it("validates attached claim ownership, catalog and real-data separation", async () => {
  const id = createClaim(db, userId, {
    catalog_id: catalog[0].id,
    serial: "TEST-SERIAL",
    purchase_date: "UNKNOWN",
    incident_date: "UNKNOWN",
    previous_repairs: 0,
    statement: "TEST ONLY claim. Battery intermittently fails.",
  });
  const bytes = await image();
  const r = await post(bytes, catalog[0].id, { claim_id: id });
  expect(r.status).toBe(201);
  expect(r.body.decision).toBe("ESCALATE");
  expect(r.body.claim_checks.some((c) => c.status === "UNKNOWN")).toBe(true);
  expect(
    (await post(await image(), catalog[1].id, { claim_id: id })).status,
  ).toBe(400);
  db.prepare("UPDATE claims SET synthetic=1 WHERE id=?").run(id);
  expect(
    (await post(await image(), catalog[0].id, { claim_id: id })).status,
  ).toBe(404);
});
it("preserves reviewer access while keeping other customers out", async () => {
  const r = await post(await image());
  const otherId = randomUUID(),
    otherToken = randomUUID();
  db.prepare(
    "INSERT INTO users(id,name,email,password_hash,role) VALUES(?,?,?,?,?)",
  ).run(otherId, "OTHER TEST", "other@test.invalid", "unused", "customer");
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    digest(otherToken),
    otherId,
    Date.now() + 60000,
  );
  expect(
    (
      await request(app)
        .get(r.body.image_url)
        .set("Cookie", `cs_session=${otherToken}`)
    ).status,
  ).toBe(404);
  expect(
    (
      await request(app)
        .get("/api/device-checks")
        .set("Cookie", `cs_session=${otherToken}`)
    ).body.checks,
  ).toHaveLength(0);
  db.prepare("UPDATE users SET role='reviewer' WHERE id=?").run(otherId);
  expect(
    (
      await request(app)
        .get(r.body.image_url)
        .set("Cookie", `cs_session=${otherToken}`)
    ).status,
  ).toBe(200);
});
it("APPROVE requires the real investigation engine to pass every configured check and leaves the human claim decision unchanged", async () => {
  // Isolated test DB: trusted-company and verified-evidence fixture, never installed in customer data.
  const serial = "ISOLATED-APPROVAL-TEST";
  const id = createClaim(db, userId, {
    catalog_id: catalog[0].id,
    serial,
    purchase_date: "2026-01-15",
    incident_date: "2026-02-01",
    previous_repairs: 0,
    statement: "TEST ONLY: No visible cracks. Device will not charge.",
    declared_no_visible_damage: true,
    claim_value_minor: 1000,
  });
  db.prepare(
    "INSERT INTO serial_registry(serial,product,model,purchase_date,service_count,verified,source,synthetic) VALUES(?,?,?,?,?,?,?,?)",
  ).run(
    serial,
    "Mobile phone",
    catalog[0].model,
    "2026-01-15",
    0,
    1,
    "ISOLATED TEST ONLY",
    0,
  );
  db.prepare(
    "INSERT INTO warranty_policies(id,product,months,verified,source,synthetic,auto_approve_limit_minor,currency) VALUES(?,?,?,?,?,?,?,?)",
  ).run(
    "test-policy",
    "Mobile phone",
    12,
    1,
    "ISOLATED TEST ONLY",
    0,
    50000,
    "INR",
  );
  db.prepare(
    "INSERT INTO authorized_sellers(id,seller_name,authorized,verified,source,synthetic) VALUES(?,?,?,?,?,?)",
  ).run("test-seller", "ISOLATED TEST STORE", 1, 1, "ISOLATED TEST ONLY", 0);
  const invoice = {
    type: "invoice",
    seller_name: "ISOLATED TEST STORE",
    invoice_number: "TEST-INV",
    invoice_date: "2026-01-15",
    product_name: "Mobile phone",
    product_model: catalog[0].model,
    serial_number: serial,
    customer_name: "TEST ONLY",
    gstin: "UNKNOWN",
    original_text: "ISOLATED TEST ONLY",
    unknown_fields: ["gstin"],
  };
  const photo = {
    type: "product_photo",
    device_category: "Mobile phone",
    visible_damage_types: ["NONE_VISIBLE"],
    damage_location: "UNKNOWN",
    visible_cracks: "NOT_VISIBLE",
    visible_dents: "NOT_VISIBLE",
    visible_liquid_contact_indicator: "NOT_VISIBLE",
    visible_tamper_signs: "NOT_VISIBLE",
    serial_text: serial,
    model_text: catalog[0].model,
    image_relevance: "RELEVANT",
    observable_facts: "ISOLATED TEST ONLY",
    unknown_fields: ["damage_location"],
  };
  let photoId, photoHash;
  for (const [kind, o] of [
    ["invoice", invoice],
    ["photo", photo],
  ]) {
    const eid = randomUUID(),
      hash = digest(`isolated-${kind}`);
    db.prepare(
      "INSERT INTO evidence(id,claim_id,kind,original_name,storage_key,mime,size,sha256,trust_tier,processing_status,observations,synthetic,source_reference) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      eid,
      id,
      kind,
      "ISOLATED TEST",
      "unused",
      "image/jpeg",
      100,
      hash,
      "VERIFIED",
      "ANALYSIS_COMPLETE",
      JSON.stringify(o),
      0,
      "test-only",
    );
    if (kind === "photo") {
      photoId = eid;
      photoHash = hash;
    }
  }
  db.prepare(
    "INSERT INTO device_verifications(evidence_id,claim_id,catalog_id,status,observed_brand,observed_model,evidence_basis,reason,next_action,image_sha256,prompt_version,model) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    photoId,
    id,
    catalog[0].id,
    "MATCH",
    "Samsung",
    catalog[0].model,
    JSON.stringify({ selected_model: catalog[0].model }),
    "ISOLATED verified evidence fixture",
    "TEST ONLY",
    photoHash,
    "TEST ONLY",
    "TEST ONLY",
  );
  calls.mockResolvedValue(
    response(observed(catalog[0], { serial_text: serial })),
  );
  const r = await post(await image(), catalog[0].id, { claim_id: id });
  expect(r.status).toBe(201);
  expect(r.body.claim_checks).toHaveLength(10);
  expect(
    r.body.claim_checks.every((c) => c.status === "PASS"),
    JSON.stringify(r.body),
  ).toBe(true);
  expect(r.body).toMatchObject({ status: "VALID_MATCH", decision: "APPROVE" });
  expect(
    db.prepare("SELECT status FROM claims WHERE id=?").get(id).status,
  ).toBe("SUBMITTED");
});
it("registry conflicts are checked even without an attached claim", async () => {
  db.prepare(
    "INSERT INTO serial_registry(serial,product,model,purchase_date,service_count,verified,source,synthetic) VALUES(?,?,?,?,?,?,?,?)",
  ).run(
    "REGISTRY-TEST",
    "Mobile phone",
    catalog[1].model,
    "2026-01-15",
    0,
    1,
    "ISOLATED TEST",
    0,
  );
  calls.mockResolvedValue(
    response(observed(catalog[0], { serial_text: "REGISTRY-TEST" })),
  );
  const r = await post(await image());
  expect(r.body).toMatchObject({
    status: "HUMAN_REVIEW",
    reason_code: "REGISTRY_CONFLICT",
  });
});
it("zero analysis budget safely escalates without dispatching a provider call", async () => {
  const adapter = new ClaudeVisionAdapter({
    apiKey: "TEST ONLY",
    model: "TEST ONLY",
    client: { messages: { create: calls } },
    maxRetries: 0,
  });
  app = createApp({
    db,
    uploads: join(folder, "private"),
    aiAdapter: adapter,
    aiDailyBudget: 0,
  });
  const r = await post(await image());
  expect(r.body).toMatchObject({
    status: "HUMAN_REVIEW",
    analysis_error: "DAILY_BUDGET_EXCEEDED",
  });
  expect(calls).not.toHaveBeenCalled();
});
it("the legacy evidence-analysis route cannot promote a known synthetic dataset photo to MATCH", async () => {
  const id = createClaim(db, userId, {
    catalog_id: catalog[0].id,
    serial: "LEGACY-TEST",
    purchase_date: "UNKNOWN",
    incident_date: "UNKNOWN",
    previous_repairs: 0,
    statement: "ISOLATED TEST: device will not charge.",
  });
  const bytes = readFileSync(
    new URL(
      "../../datasets/six-product-v1/data/images/attached/samsung-galaxy-a26-5g/match.jpg",
      import.meta.url,
    ),
  );
  const uploaded = await secure(request(app).post(`/api/claims/${id}/evidence`))
    .field("kind", "photo")
    .attach("file", bytes, { filename: "test.jpg", contentType: "image/jpeg" });
  expect(uploaded.status).toBe(201);
  calls.mockResolvedValue(
    response({
      type: "product_photo",
      device_category: "Mobile phone",
      visible_damage_types: ["NONE_VISIBLE"],
      damage_location: "UNKNOWN",
      visible_cracks: "NOT_VISIBLE",
      visible_dents: "NOT_VISIBLE",
      visible_liquid_contact_indicator: "NOT_VISIBLE",
      visible_tamper_signs: "NOT_VISIBLE",
      serial_text: "LEGACY-TEST",
      model_text: catalog[0].model,
      image_relevance: "RELEVANT",
      observable_facts: "ISOLATED TEST",
      observed_brand: "Samsung",
      observed_model_text: catalog[0].model,
      identifying_evidence_kind: "LABEL",
      identifier_linked_to_pictured_device: "YES",
      image_quality: "CLEAR",
      unknown_fields: ["damage_location"],
    }),
  );
  const started = await secure(
    request(app).post(`/api/claims/${id}/evidence/${uploaded.body.id}/analyze`),
  ).send({});
  expect(started.status).toBe(202);
  await app.locals.analysis.waitForIdle();
  const verification = db
    .prepare(
      "SELECT * FROM device_verifications WHERE evidence_id=? AND active=1",
    )
    .get(uploaded.body.id);
  expect(verification.status).toBe("UNVERIFIED");
  expect(verification.reason).toContain("Known generated");
  expect(JSON.parse(verification.evidence_basis).closed_set_status).toBe(
    "HUMAN_REVIEW",
  );
});

