import { randomUUID } from "node:crypto";
import { z } from "zod";
import { catalog } from "../catalog.js";
import {
  invoiceSchema,
  photoSchema,
  validateObservations,
} from "../ai/schemas.js";
import { claimSchema } from "./claims.js";
import { storeDeviceVerification } from "./deviceVerification.js";
import { investigate, audit } from "./investigation.js";
import { digest, hashPassword } from "../utils/security.js";

const ownerId = "synthetic-owner-v2";
const fixtureVersion = "synthetic-rules-v2";
const seller = "SYNTHETIC Demo Retailer";
const marker = z.literal("SYNTHETIC");
const fixtureSchema = z
  .object({
    label: marker,
    fixture_id: z.string().regex(/^SYNTHETIC-V2-[a-z0-9-]+$/),
    scenario: z.string().regex(/^[a-z0-9-]+$/),
    claim: claimSchema,
    evidence: z
      .array(
        z.discriminatedUnion("kind", [
          z
            .object({
              label: marker,
              kind: z.literal("photo"),
              observations: photoSchema,
            })
            .strict(),
          z
            .object({
              label: marker,
              kind: z.literal("invoice"),
              observations: invoiceSchema,
            })
            .strict(),
        ]),
      )
      .max(2)
      .refine(
        (items) =>
          new Set(items.map((item) => item.kind)).size === items.length,
        "Use at most one photo and one invoice per fixture.",
      ),
  })
  .strict()
  .refine(
    (f) =>
      f.claim.serial.startsWith("SYNTHETIC-") &&
      f.claim.statement.startsWith("SYNTHETIC "),
    "Fixture serials and statements require the SYNTHETIC prefix.",
  );

const issues = {
  "Mobile phone": [
    "The screen intermittently goes blank during ordinary use.",
    "The device shuts off unexpectedly with battery power remaining.",
    "The charging port loses connection during normal charging.",
    "The touchscreen intermittently stops responding to input.",
    "The camera app consistently fails to open.",
  ],
  Headphones: [
    "Audio intermittently drops in one earcup during playback.",
    "The headphones disconnect while playing audio nearby.",
    "The charging indicator stays dark after connecting the cable.",
    "The power button intermittently fails to start the headphones.",
    "The microphone stops picking up sound during calls.",
  ],
};

function photoOf(device, serial, overrides) {
  return {
    type: "product_photo",
    device_category: device.category,
    visible_damage_types: ["NONE_VISIBLE"],
    damage_location: "UNKNOWN",
    visible_cracks: "NOT_VISIBLE",
    visible_dents: "NOT_VISIBLE",
    visible_liquid_contact_indicator: "NOT_VISIBLE",
    visible_tamper_signs: "NOT_VISIBLE",
    serial_text: serial,
    model_text: "UNKNOWN",
    image_relevance: "RELEVANT",
    observable_facts:
      "SYNTHETIC simulation of a device with readable identification.",
    observed_brand: device.brand,
    observed_model_text: device.model,
    identifying_evidence_kind: "LABEL",
    identifier_linked_to_pictured_device: "YES",
    image_quality: "CLEAR",
    unknown_fields: [],
    ...overrides,
  };
}

const photoScenarios = {
  "matching-label": (device, serial) => photoOf(device, serial),
  "matching-alias": (device, serial) =>
    photoOf(device, serial, {
      observed_model_text:
        device.aliases.find((alias) => alias.startsWith("SM-")) ??
        device.aliases[0],
    }),
  "matching-second-label": (device, serial) =>
    photoOf(device, serial, {
      observable_facts:
        "SYNTHETIC simulation of the model marking on the underside of the device.",
    }),
  "matching-without-photo-serial": (device) => photoOf(device, "UNKNOWN"),
  "same-brand-swap": (_device, serial, choose, peers) =>
    photoOf(choose(peers), serial + "-ALT"),
  "cross-category": (_device, _serial, choose, _peers, otherCategory) =>
    photoOf(choose(otherCategory), "UNKNOWN"),
  "unrelated-image": (device) =>
    photoOf(device, "UNKNOWN", {
      device_category: "UNKNOWN",
      observed_brand: "UNKNOWN",
      observed_model_text: "UNKNOWN",
      identifying_evidence_kind: "NONE",
      identifier_linked_to_pictured_device: "NO",
      image_relevance: "IRRELEVANT",
      observable_facts: "SYNTHETIC simulation of a landscape without a device.",
    }),
  "another-wrong-label": (_device, _serial, choose, peers) =>
    photoOf(choose(peers), "UNKNOWN"),
  "ambiguous-photo": (device) =>
    photoOf(device, "UNKNOWN", {
      observed_model_text: "UNKNOWN",
      image_quality: "AMBIGUOUS",
      identifier_linked_to_pictured_device: "UNKNOWN",
      observable_facts:
        "SYNTHETIC simulation of a partly obscured device label.",
    }),
  "box-only": (device) =>
    photoOf(device, "UNKNOWN", {
      identifying_evidence_kind: "BOX",
      identifier_linked_to_pictured_device: "NO",
      observable_facts:
        "SYNTHETIC simulation of a retail box with a readable model name.",
    }),
  "missing-evidence": (device) =>
    photoOf(device, "UNKNOWN", {
      observed_model_text: "UNKNOWN",
      identifying_evidence_kind: "NONE",
      identifier_linked_to_pictured_device: "UNKNOWN",
      observable_facts:
        "SYNTHETIC simulation of a device photo without identifying evidence.",
    }),
  "serial-discrepancy": (device, serial) => photoOf(device, serial + "-ALT"),
};

export function generateSynthetic(seed = 20261114) {
  let state = seed >>> 0;
  const random = (limit) => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return Math.floor((state / 2 ** 32) * limit);
  };
  const choose = (items) => items[random(items.length)];
  const date = (day) =>
    new Date(Date.UTC(2024, 0, 1 + day)).toISOString().slice(0, 10);
  const fixtures = [];
  for (const device of catalog) {
    const peers = catalog.filter(
      (item) => item.brand === device.brand && item.id !== device.id,
    );
    const otherCategory = catalog.filter(
      (item) => item.category !== device.category,
    );
    for (const [index, [scenario, buildPhoto]] of Object.entries(
      photoScenarios,
    ).entries()) {
      const serial = `SYNTHETIC-${device.id.toUpperCase()}-${index + 1}-${random(
        2 ** 32,
      )
        .toString(16)
        .toUpperCase()
        .padStart(8, "0")}`;
      const day = random(640);
      const purchase_date = date(day);
      const incident_date = date(day + 15 + random(230));
      const claim = {
        catalog_id: device.id,
        serial,
        purchase_date,
        incident_date,
        statement: `SYNTHETIC demo case. ${choose(issues[device.category])}`,
        previous_repairs: random(2),
        claim_value_minor: 2000 + random(12001),
        currency: "INR",
      };
      const evidence = [
        {
          label: "SYNTHETIC",
          kind: "photo",
          observations: buildPhoto(
            device,
            serial,
            choose,
            peers,
            otherCategory,
          ),
        },
      ];
      if (scenario !== "missing-evidence")
        evidence.push({
          label: "SYNTHETIC",
          kind: "invoice",
          observations: {
            type: "invoice",
            seller_name: seller,
            invoice_number: `SYNTHETIC-INV-${serial.slice("SYNTHETIC-".length)}`,
            invoice_date: purchase_date,
            product_name: device.category,
            product_model: device.model,
            serial_number: serial,
            customer_name: "SYNTHETIC Demo Customer",
            gstin: "UNKNOWN",
            original_text:
              "SYNTHETIC invoice fixture for rules and workflow testing.",
            unknown_fields: ["gstin"],
          },
        });
      fixtures.push({
        label: "SYNTHETIC",
        fixture_id: `SYNTHETIC-V2-${device.id}-${scenario}`,
        scenario,
        claim,
        evidence,
      });
    }
  }
  for (let i = fixtures.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [fixtures[i], fixtures[j]] = [fixtures[j], fixtures[i]];
  }
  return fixtures;
}

export function seedSynthetic(db, input = generateSynthetic()) {
  const fixtures = z
    .array(fixtureSchema)
    .nonempty()
    .refine(
      (items) => new Set(items.map((f) => f.fixture_id)).size === items.length,
      "Fixture IDs must be unique.",
    )
    .parse(input);
  return db
    .transaction(() => {
      const existingOwner = db
        .prepare("SELECT synthetic,role FROM users WHERE id=?")
        .get(ownerId);
      if (
        existingOwner &&
        (existingOwner.synthetic !== 1 || existingOwner.role !== "customer")
      )
        throw new Error("The reserved synthetic owner ID is already in use.");
      if (!existingOwner)
        db.prepare(
          `INSERT INTO users(id,name,email,password_hash,role,synthetic)
        VALUES(?,?,?,?,'customer',1)`,
        ).run(
          ownerId,
          "SYNTHETIC Demo Customer",
          "synthetic-v2@example.invalid",
          hashPassword(randomUUID() + randomUUID()),
        );

      const insert =
        db.prepare(`INSERT INTO claims(id,fixture_id,user_id,catalog_id,product,model,serial,
      purchase_date,incident_date,statement,previous_repairs,claim_value_minor,currency,synthetic)
      VALUES(@id,@fixture_id,@owner,@catalog_id,@product,@model,@serial,
        @purchase_date,@incident_date,@statement,@previous_repairs,@claim_value_minor,@currency,1)
      ON CONFLICT(fixture_id) DO NOTHING`);
      const existing = db.prepare(
        "SELECT user_id,synthetic FROM claims WHERE fixture_id=?",
      );
      const inserted = [];
      const insertRegistry = db.prepare(
        `INSERT INTO serial_registry(serial,product,purchase_date,service_count,verified,source,synthetic,model,seller_name)
        VALUES(?,?,?,?,1,'SYNTHETIC demo registry',1,?,?)`,
      );
      const insertEvidence = db.prepare(
        `INSERT INTO evidence(id,claim_id,kind,original_name,storage_key,mime,size,sha256,synthetic,
        source_reference,processing_status,trust_tier,observations,processing_message,prompt_version)
        VALUES(?,?,?,?,'','text/plain',0,?,1,?,'SIMULATED_FIXTURE','SIMULATED',?,
          'SYNTHETIC observations for rules and workflow testing.',?)`,
      );
      for (const f of fixtures) {
        const old = existing.get(f.fixture_id);
        if (old) {
          if (old.user_id !== ownerId || old.synthetic !== 1)
            throw new Error(
              `Fixture ID is in use by an unrelated claim: ${f.fixture_id}`,
            );
          continue;
        }
        const claim = {
          ...f.claim,
          id: randomUUID(),
          fixture_id: f.fixture_id,
          owner: ownerId,
          claim_value_minor: f.claim.claim_value_minor ?? null,
          synthetic: 1,
        };
        insert.run(claim);
        insertRegistry.run(
          claim.serial,
          claim.product,
          claim.purchase_date,
          claim.previous_repairs,
          claim.model,
          seller,
        );
        for (const e of f.evidence) {
          const id = randomUUID();
          const observations = validateObservations(e.observations, e.kind, {
            current: true,
          });
          const sha256 = digest(
            JSON.stringify([f.fixture_id, e.kind, observations]),
          );
          insertEvidence.run(
            id,
            claim.id,
            e.kind,
            `SYNTHETIC-${e.kind}.txt`,
            sha256,
            `SYNTHETIC:${f.fixture_id}:${e.kind}`,
            JSON.stringify(observations),
            fixtureVersion,
          );
          if (e.kind === "photo")
            storeDeviceVerification(db, { id, kind: e.kind, sha256 }, claim, {
              observations,
              promptVersion: fixtureVersion,
            });
        }
        audit(
          db,
          claim.id,
          ownerId,
          "SYNTHETIC_SEEDED",
          `SYNTHETIC scenario ${f.scenario} from fixture ${f.fixture_id}.`,
        );
        inserted.push(claim.id);
      }
      if (inserted.length) {
        for (const product of new Set(fixtures.map((f) => f.claim.product)))
          db.prepare(
            `INSERT INTO warranty_policies(id,product,months,verified,source,synthetic,auto_approve_limit_minor)
          VALUES(?,?,12,1,'SYNTHETIC demo policy',1,20000) ON CONFLICT(id) DO NOTHING`,
          ).run(`SYNTHETIC-V2-POLICY-${product}`, product);
        db.prepare(
          `INSERT INTO authorized_sellers(id,seller_name,authorized,verified,source,synthetic)
        VALUES('SYNTHETIC-V2-SELLER',?,1,1,'SYNTHETIC demo seller record',1) ON CONFLICT(id) DO NOTHING`,
        ).run(seller);
        const getClaim = db.prepare("SELECT * FROM claims WHERE id=?");
        for (const id of inserted) investigate(db, getClaim.get(id));
      }
      return {
        count: fixtures.length,
        inserted: inserted.length,
        unchanged: fixtures.length - inserted.length,
      };
    })
    .immediate();
}
