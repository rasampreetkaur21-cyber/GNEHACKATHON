export function migratePhase3(db) {
  const additions = {
    claims: {
      fixture_id: "TEXT",
      catalog_id: "TEXT",
      model: "TEXT",
      claim_value_minor: "INTEGER",
      currency: "TEXT NOT NULL DEFAULT 'INR'",
      declared_no_visible_damage: "INTEGER",
      declared_unauthorized_repairs: "INTEGER",
      is_draft: "INTEGER NOT NULL DEFAULT 0",
    },
    warranty_policies: {
      auto_approve_limit_minor: "INTEGER",
      currency: "TEXT NOT NULL DEFAULT 'INR'",
      effective_from: "TEXT",
      effective_to: "TEXT",
    },
    serial_registry: { model: "TEXT", seller_name: "TEXT" },
    investigations: {
      engine_version: "TEXT NOT NULL DEFAULT '0.1'",
      explanation:
        "TEXT NOT NULL DEFAULT 'Legacy investigation; see stored rule explanations.'",
      next_evidence: "TEXT NOT NULL DEFAULT '[]'",
      reconciliation: "TEXT NOT NULL DEFAULT '{}'",
      snapshot: "TEXT NOT NULL DEFAULT '{}'",
      private_links: "TEXT NOT NULL DEFAULT '[]'",
    },
    rule_results: {
      record_ids: "TEXT NOT NULL DEFAULT '[]'",
      rule_version: "TEXT NOT NULL DEFAULT '0.1'",
      severity: "TEXT NOT NULL DEFAULT 'INFO'",
      essential: "INTEGER NOT NULL DEFAULT 0",
    },
  };
  db.transaction(() => {
    for (const [table, fields] of Object.entries(additions)) {
      const columns = new Set(
        db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map((c) => c.name),
      );
      for (const [name, type] of Object.entries(fields))
        if (!columns.has(name))
          db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
    db.exec(`
 CREATE TABLE IF NOT EXISTS authorized_sellers(id TEXT PRIMARY KEY,seller_name TEXT NOT NULL,authorized INTEGER NOT NULL,verified INTEGER NOT NULL DEFAULT 1,source TEXT NOT NULL,synthetic INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS service_records(id TEXT PRIMARY KEY,serial TEXT NOT NULL,service_date TEXT NOT NULL,authorized INTEGER,summary TEXT NOT NULL,verified INTEGER NOT NULL DEFAULT 1,source TEXT NOT NULL,synthetic INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS diagnostic_records(id TEXT PRIMARY KEY,serial TEXT NOT NULL,facts TEXT NOT NULL,verified INTEGER NOT NULL DEFAULT 1,source TEXT NOT NULL,synthetic INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS reviewer_notes(id TEXT PRIMARY KEY,claim_id TEXT NOT NULL REFERENCES claims(id),actor_id TEXT NOT NULL REFERENCES users(id),note TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS claim_requests(user_id TEXT NOT NULL REFERENCES users(id),request_key TEXT NOT NULL,payload_hash TEXT NOT NULL,claim_id TEXT NOT NULL REFERENCES claims(id),PRIMARY KEY(user_id,request_key));
 CREATE TABLE IF NOT EXISTS chat_sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),state TEXT NOT NULL,data TEXT NOT NULL DEFAULT '{}',claim_id TEXT UNIQUE REFERENCES claims(id),revision INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS chat_messages(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES chat_sessions(id),role TEXT NOT NULL CHECK(role IN ('user','assistant')),content TEXT NOT NULL,input_json TEXT,request_id TEXT,request_hash TEXT,response_json TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(session_id,request_id));
 CREATE TABLE IF NOT EXISTS device_verifications(
   evidence_id TEXT NOT NULL REFERENCES evidence(id),
   claim_id TEXT NOT NULL REFERENCES claims(id),
   catalog_id TEXT NOT NULL,
   status TEXT NOT NULL CHECK(status IN ('MATCH','INVALID_DEVICE','UNVERIFIED')),
   observed_brand TEXT,
   observed_model TEXT,
   evidence_basis TEXT NOT NULL,
   reason TEXT NOT NULL,
   next_action TEXT NOT NULL,
   image_sha256 TEXT NOT NULL,
   prompt_version TEXT NOT NULL,
   model TEXT,
   active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 );
 CREATE UNIQUE INDEX IF NOT EXISTS device_verification_active
   ON device_verifications(evidence_id) WHERE active=1;
 CREATE INDEX IF NOT EXISTS chat_owner ON chat_sessions(user_id);
 CREATE UNIQUE INDEX IF NOT EXISTS claims_fixture_id ON claims(fixture_id);
 CREATE INDEX IF NOT EXISTS chat_message_session ON chat_messages(session_id);
 CREATE INDEX IF NOT EXISTS evidence_hash ON evidence(sha256);
 CREATE INDEX IF NOT EXISTS service_serial ON service_records(serial);
 UPDATE evidence SET active=0
 WHERE kind='photo' AND active=1 AND rowid NOT IN (
   SELECT MAX(rowid) FROM evidence WHERE kind='photo' AND active=1 GROUP BY claim_id
 );
 UPDATE device_verifications SET active=0 WHERE active=1 AND EXISTS (
   SELECT 1 FROM evidence e JOIN claims c ON c.id=e.claim_id
   WHERE e.id=device_verifications.evidence_id
     AND (e.active=0 OR c.catalog_id IS NOT device_verifications.catalog_id
       OR e.sha256<>device_verifications.image_sha256)
 );
 CREATE UNIQUE INDEX IF NOT EXISTS evidence_active_photo
   ON evidence(claim_id) WHERE kind='photo' AND active=1;
 CREATE UNIQUE INDEX IF NOT EXISTS evidence_replacement ON evidence(replaces_evidence_id);
 CREATE TABLE IF NOT EXISTS stale_device_investigations(
   claim_id TEXT PRIMARY KEY REFERENCES claims(id)
 );
 CREATE TRIGGER IF NOT EXISTS archive_photo_verification AFTER UPDATE OF active ON evidence
 WHEN OLD.kind='photo' AND OLD.active=1 AND NEW.active=0
 BEGIN
   UPDATE device_verifications SET active=0 WHERE evidence_id=NEW.id AND active=1;
   UPDATE analysis_attempts SET status='ANALYSIS_FAILED', error_code='EVIDENCE_SUPERSEDED', finished_at=CURRENT_TIMESTAMP
     WHERE evidence_id=NEW.id AND status IN ('ANALYSIS_QUEUED','ANALYSIS_PENDING');
   UPDATE evidence SET processing_status='ANALYSIS_FAILED',error_code='EVIDENCE_SUPERSEDED',
     processing_message='A replacement photo superseded this analysis.'
     WHERE id=NEW.id AND processing_status IN ('ANALYSIS_QUEUED','ANALYSIS_PENDING');
 END;
 CREATE TRIGGER IF NOT EXISTS invalidate_photo_verification AFTER UPDATE OF catalog_id ON claims
 WHEN NEW.catalog_id IS NOT OLD.catalog_id
 BEGIN
   INSERT OR IGNORE INTO stale_device_investigations(claim_id) VALUES(NEW.id);
   UPDATE device_verifications SET active=0 WHERE claim_id=NEW.id AND active=1;
   UPDATE analysis_attempts SET status='ANALYSIS_FAILED', error_code='DEVICE_CHANGED', finished_at=CURRENT_TIMESTAMP
     WHERE status IN ('ANALYSIS_QUEUED','ANALYSIS_PENDING') AND evidence_id IN
       (SELECT id FROM evidence WHERE claim_id=NEW.id AND kind='photo' AND active=1);
   UPDATE evidence SET processing_status='NOT_ANALYZED',error_code=NULL,
     processing_message='The selected device changed. Request analysis for the current selection.'
     WHERE claim_id=NEW.id AND kind='photo' AND active=1;
 END;
 CREATE TRIGGER IF NOT EXISTS invalidate_changed_photo_hash AFTER UPDATE OF sha256 ON evidence
 WHEN NEW.kind='photo' AND NEW.active=1 AND NEW.sha256<>OLD.sha256
 BEGIN
   INSERT OR IGNORE INTO stale_device_investigations(claim_id) VALUES(NEW.claim_id);
   UPDATE device_verifications SET active=0 WHERE evidence_id=NEW.id AND active=1;
   UPDATE analysis_attempts SET status='ANALYSIS_FAILED',error_code='IMAGE_HASH_MISMATCH',finished_at=CURRENT_TIMESTAMP
     WHERE evidence_id=NEW.id AND status='ANALYSIS_PENDING';
   UPDATE evidence SET processing_status='NOT_ANALYZED',error_code=NULL,
     processing_message='The recorded photo changed. Request analysis of the current photo.'
     WHERE id=NEW.id;
 END;
 `);
    db.pragma("user_version = 3");
  })();
}
