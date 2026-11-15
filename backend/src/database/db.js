import { migrateCompanyLive } from "./companyLive.js";
import { migrateAppointments } from "./appointments.js";
import { migrateDeviceChecks } from "./deviceChecks.js";
import { migratePhase3 } from "./phase3.js";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
export function openDatabase(path) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.exec(`
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('customer','reviewer')),synthetic INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS claims(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),product TEXT NOT NULL,serial TEXT NOT NULL,purchase_date TEXT NOT NULL,incident_date TEXT NOT NULL,statement TEXT NOT NULL,previous_repairs INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK(status IN ('SUBMITTED','UNDER_REVIEW','NEEDS_EVIDENCE','APPROVED','REJECTED')),synthetic INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY,claim_id TEXT NOT NULL REFERENCES claims(id),kind TEXT NOT NULL,original_name TEXT NOT NULL,storage_key TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,synthetic INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS investigations(id TEXT PRIMARY KEY,claim_id TEXT NOT NULL REFERENCES claims(id),outcome TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS rule_results(id TEXT PRIMARY KEY,investigation_id TEXT NOT NULL REFERENCES investigations(id),rule_id TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('PASS','FAIL','UNKNOWN')),explanation TEXT NOT NULL,evidence_ids TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS audit_events(id TEXT PRIMARY KEY,claim_id TEXT REFERENCES claims(id),actor_id TEXT REFERENCES users(id),action TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS warranty_policies(id TEXT PRIMARY KEY,product TEXT NOT NULL,months INTEGER NOT NULL,verified INTEGER NOT NULL DEFAULT 0,source TEXT NOT NULL,synthetic INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS serial_registry(serial TEXT PRIMARY KEY,product TEXT NOT NULL,purchase_date TEXT NOT NULL,service_count INTEGER NOT NULL,verified INTEGER NOT NULL DEFAULT 0,source TEXT NOT NULL,synthetic INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS datasets_provenance(id TEXT PRIMARY KEY,source_url TEXT NOT NULL,attribution TEXT NOT NULL,license TEXT NOT NULL,status TEXT NOT NULL,record_count INTEGER NOT NULL DEFAULT 0,sha256 TEXT,imported_at TEXT,error TEXT);
 CREATE TABLE IF NOT EXISTS repair_context(id TEXT PRIMARY KEY,dataset_id TEXT NOT NULL REFERENCES datasets_provenance(id),payload TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS claims_owner ON claims(user_id);
 CREATE INDEX IF NOT EXISTS evidence_claim ON evidence(claim_id);
 CREATE INDEX IF NOT EXISTS investigations_claim ON investigations(claim_id);
 `);
  db.prepare(
    "INSERT OR IGNORE INTO datasets_provenance(id,source_url,attribution,license,status) VALUES(?,?,?,?,?)",
  ).run(
    "ora",
    "https://github.com/openrepair/data",
    "Open Repair Alliance and contributing repair organizations",
    "CC-BY-SA-4.0",
    "NOT_LOADED",
  );
  // Additive, repeatable Phase 2 migration; legacy uploads and synthetic rows remain intact.
  const columns = new Set(
    db
      .prepare("PRAGMA table_info(evidence)")
      .all()
      .map((c) => c.name),
  );
  const additions = {
    scan_report_json: "TEXT",
    origin: "TEXT NOT NULL DEFAULT 'user_upload_unverified'",
    normalized_sha256: "TEXT",
    active: "INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))",
    replaces_evidence_id: "TEXT REFERENCES evidence(id)",
    trust_tier: "TEXT NOT NULL DEFAULT 'ASSERTED'",
    processing_status: "TEXT NOT NULL DEFAULT 'NOT_ANALYZED'",
    normalized_key: "TEXT",
    width: "INTEGER",
    height: "INTEGER",
    observations: "TEXT",
    source_reference: "TEXT",
    ai_model: "TEXT",
    prompt_version: "TEXT",
    analyzed_at: "TEXT",
    error_code: "TEXT",
    processing_message: "TEXT",
    verified_by: "TEXT REFERENCES users(id)",
    verified_at: "TEXT",
  };
  db.transaction(() => {
    for (const [name, definition] of Object.entries(additions)) {
      if (!columns.has(name))
        db.exec(`ALTER TABLE evidence ADD COLUMN ${name} ${definition}`);
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS evidence_annotations(
        id TEXT PRIMARY KEY,evidence_id TEXT NOT NULL REFERENCES evidence(id),
        actor_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL CHECK(kind IN ('ASSERTION','CORRECTION_REQUEST')),
        fields TEXT NOT NULL,note TEXT NOT NULL,trust_tier TEXT NOT NULL DEFAULT 'ASSERTED' CHECK(trust_tier='ASSERTED'),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS analysis_attempts(
        id TEXT PRIMARY KEY,evidence_id TEXT NOT NULL REFERENCES evidence(id),actor_id TEXT NOT NULL REFERENCES users(id),
        status TEXT NOT NULL,model TEXT NOT NULL,prompt_version TEXT NOT NULL,
        started_at TEXT NOT NULL,finished_at TEXT,lease_until INTEGER NOT NULL,error_code TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_pending_analysis ON analysis_attempts(evidence_id) WHERE status='ANALYSIS_PENDING';
      CREATE TABLE IF NOT EXISTS ai_usage(
        id TEXT PRIMARY KEY,attempt_id TEXT NOT NULL REFERENCES analysis_attempts(id),
        user_id TEXT NOT NULL REFERENCES users(id),day TEXT NOT NULL,created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ai_usage_day ON ai_usage(day,user_id);
      DROP TRIGGER IF EXISTS evidence_six_images;
      CREATE TRIGGER evidence_six_images BEFORE INSERT ON evidence
      WHEN NEW.active=1 AND NEW.mime IN ('image/png','image/jpeg','image/webp') AND
        (SELECT COUNT(*) FROM evidence WHERE claim_id=NEW.claim_id AND active=1 AND mime IN ('image/png','image/jpeg','image/webp'))>=6
      BEGIN SELECT RAISE(ABORT,'IMAGE_LIMIT'); END;
    `);
    db.prepare(
      "UPDATE evidence SET source_reference='upload:' || id WHERE source_reference IS NULL",
    ).run();
    db.prepare(
      "UPDATE evidence SET processing_status='LIMITED_MODE',processing_message='Synthetic placeholder or non-image document; provide a real image for analysis.' WHERE (synthetic=1 OR mime NOT IN ('image/png','image/jpeg','image/webp')) AND processing_status='NOT_ANALYZED'",
    ).run();
    db.pragma("user_version = 2");
  })();
  migratePhase3(db);
  if (
    !db
      .prepare("PRAGMA table_info(claims)")
      .all()
      .some((c) => c.name === "questionnaire_json")
  )
    db.exec("ALTER TABLE claims ADD COLUMN questionnaire_json TEXT");
  migrateDeviceChecks(db);
  migrateCompanyLive(db);
  migrateAppointments(db);
  return db;
}
