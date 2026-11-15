import { cpSync, mkdirSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import { openDatabase } from "../src/database/db.js";
import { readInvestigation } from "../src/services/investigation.js";
import { readDeviceVerification } from "../src/services/deviceVerification.js";
import { catalogIds } from "../src/catalog.js";
import { generateSynthetic, seedSynthetic } from "../src/services/synthetic.js";
import { isFileLoadingAllowed, normalizePath, resolveConfig } from "vite";

const root = new URL("../../", import.meta.url);
const input = JSON.parse(
  readFileSync(new URL("data/synthetic/claims-v2.json", root)),
);
const oracle = JSON.parse(
  readFileSync(new URL("./fixtures/synthetic-v2-oracle.json", import.meta.url)),
);
let db;
beforeEach(() => {
  db = openDatabase(":memory:");
});
afterEach(() => db.close());

it("regenerates the checked-in dataset and varies order, serials, dates and issues with the seed", () => {
  expect(generateSynthetic()).toEqual(input);
  const different = generateSynthetic(7);
  expect(different.map((f) => f.fixture_id)).not.toEqual(
    input.map((f) => f.fixture_id),
  );
  const byId = (rows) =>
    Object.fromEntries(rows.map((f) => [f.fixture_id, f.claim]));
  const original = byId(input);
  const alternate = byId(different);
  expect(Object.keys(alternate).sort()).toEqual(Object.keys(original).sort());
  for (const field of ["serial", "purchase_date", "incident_date", "statement"])
    expect(
      Object.keys(original).some(
        (id) => original[id][field] !== alternate[id][field],
      ),
    ).toBe(true);
  expect(new Set(input.map((f) => f.claim.serial)).size).toBe(72);
});

it("runs the calculated verification and rule results against independent scenario expectations", () => {
  expect(seedSynthetic(db, input)).toEqual({
    count: 72,
    inserted: 72,
    unchanged: 0,
  });
  const results = new Map(catalogIds.map((id) => [id, []]));
  for (const fixture of input) {
    const claim = db
      .prepare("SELECT * FROM claims WHERE fixture_id=?")
      .get(fixture.fixture_id);
    expect(claim).toMatchObject({
      synthetic: 1,
      user_id: "synthetic-owner-v2",
      catalog_id: fixture.claim.catalog_id,
    });
    const photo = db
      .prepare("SELECT * FROM evidence WHERE claim_id=? AND kind='photo'")
      .get(claim.id);
    expect(photo).toMatchObject({
      synthetic: 1,
      processing_status: "SIMULATED_FIXTURE",
      trust_tier: "SIMULATED",
      ai_model: null,
    });
    const verification = readDeviceVerification(db, photo.id);
    const expected = oracle.scenarios[fixture.scenario];
    const investigation = readInvestigation(db, claim.id);
    expect(verification.status, fixture.fixture_id).toBe(expected.verification);
    expect(investigation.outcome, fixture.fixture_id).toBe(
      expected.recommendation,
    );
    expect(investigation.results.find((r) => r.ruleId === "R04").status).toBe(
      expected.r04,
    );
    if (expected.r01)
      expect(investigation.results.find((r) => r.ruleId === "R01").status).toBe(
        expected.r01,
      );
    expect(
      investigation.reconciliation.facts.some(
        (f) => f.source === "SYNTHETIC_FIXTURE",
      ),
    ).toBe(true);
    results.get(claim.catalog_id).push(verification.status);
  }
  const balanced = Array.from({ length: 4 }, () => [
    "MATCH",
    "INVALID_DEVICE",
    "UNVERIFIED",
  ])
    .flat()
    .sort();
  for (const statuses of results.values())
    expect(statuses.sort()).toEqual(balanced);
  expect(db.prepare("SELECT count(*) AS n FROM ai_usage").get().n).toBe(0);
  expect(
    db.prepare("SELECT count(*) AS n FROM analysis_attempts").get().n,
  ).toBe(0);
});

it("is idempotent, preserves reviewer decisions, and leaves legacy and real rows alone", () => {
  db.exec(`INSERT INTO users(id,name,email,password_hash,role,synthetic) VALUES
    ('synthetic-owner','Legacy owner','legacy@example.invalid','unused','customer',1),
    ('real-owner','Real owner','real@example.invalid','unused','customer',0);
    INSERT INTO claims(id,user_id,product,serial,purchase_date,incident_date,statement,previous_repairs,synthetic)
    VALUES('old','synthetic-owner','Laptop','LEGACY-1','2025-01-01','2025-02-01','Old test claim',0,1),
    ('real','real-owner','Mobile phone','REAL-1','2025-01-01','2025-02-01','Ordinary claim',0,0);
    INSERT INTO warranty_policies(id,product,months,verified,source,synthetic)
    VALUES('SYN-Mobile phone','Mobile phone',12,1,'SYNTHETIC legacy policy',1),
    ('real-policy','Mobile phone',7,1,'Company policy',0);`);
  const preserved = () => ({
    claims: db
      .prepare("SELECT * FROM claims WHERE id IN ('old','real') ORDER BY id")
      .all(),
    policies: db
      .prepare(
        "SELECT * FROM warranty_policies WHERE id IN ('SYN-Mobile phone','real-policy') ORDER BY id",
      )
      .all(),
    owners: db
      .prepare(
        "SELECT * FROM users WHERE id IN ('synthetic-owner','real-owner') ORDER BY id",
      )
      .all(),
  });
  const originals = preserved();
  seedSynthetic(db, input);
  const match = db
    .prepare(
      "SELECT * FROM claims WHERE fixture_id LIKE '%-matching-label' LIMIT 1",
    )
    .get();
  expect(readInvestigation(db, match.id).outcome).toBe("AUTO_APPROVE");
  db.prepare("UPDATE claims SET status='APPROVED' WHERE id=?").run(match.id);
  const tables = [
    "claims",
    "users",
    "evidence",
    "investigations",
    "device_verifications",
    "audit_events",
    "serial_registry",
    "warranty_policies",
    "authorized_sellers",
  ];
  const snapshot = () =>
    tables.map((table) =>
      db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    );
  const before = snapshot();
  expect(seedSynthetic(db, input)).toEqual({
    count: 72,
    inserted: 0,
    unchanged: 72,
  });
  expect(snapshot()).toEqual(before);
  expect(preserved()).toEqual(originals);
  expect(db.pragma("foreign_key_check")).toEqual([]);
});

it("rejects unsupported catalog IDs and labels embedded in runtime fixture input", () => {
  const bad = structuredClone(input);
  bad[bad.length - 1].claim.catalog_id = "unsupported-catalog-id";
  expect(() => seedSynthetic(db, bad)).toThrow();
  expect(() =>
    seedSynthetic(db, [{ ...input[0], expected: "MATCH" }]),
  ).toThrow();
  expect(db.prepare("SELECT count(*) AS n FROM users").get().n).toBe(0);
});

it("runs the application seed in a deployment without either test oracle", () => {
  const folder = mkdtempSync(join(tmpdir(), "claimshield-oracle-"));
  try {
    for (const path of [
      "backend/src",
      "shared",
      "datasets/six-product-v1/data/assets.json",
      "datasets/six-product-v1/provenance_hashes.json",
      "backend/package.json",
      "data/synthetic/claims-v2.json",
    ]) {
      const target = join(folder, path);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(fileURLToPath(new URL(path, root)), target, { recursive: true });
    }
    const cli = join(folder, "backend", "src", "cli.js");
    const resolver = new URL(
      "./fixtures/seed-cli-dependencies.mjs",
      import.meta.url,
    ).href;
    const { status, stdout, stderr } = spawnSync(
      process.execPath,
      ["--import", resolver, cli, "seed"],
      {
        cwd: folder,
        encoding: "utf8",
        env: {
          ...process.env,
          DATABASE_PATH: join(folder, "demo.sqlite"),
          DOTENV_CONFIG_QUIET: "true",
        },
      },
    );
    expect(status, stderr).toBe(0);
    expect(stdout).toContain("inserted: 72");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}, 20000);

it("keeps both oracle files and seed observations off the development server", async () => {
  const config = await resolveConfig(
    {
      root: fileURLToPath(new URL("frontend/", root)),
    },
    "serve",
  );
  for (const path of [
    "backend/tests/fixtures/synthetic-v2-oracle.json",
    "data/synthetic/expected-outcomes.json",
    "data/synthetic/claims-v2.json",
  ]) {
    const filename = normalizePath(fileURLToPath(new URL(path, root)));
    expect(isFileLoadingAllowed(config, filename)).toBe(false);
  }
  expect(
    isFileLoadingAllowed(
      config,
      normalizePath(fileURLToPath(new URL("backend/src/catalog.js", root))),
    ),
  ).toBe(true);
});
