export function migrateCompanyLive(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS company_staff(user_id TEXT PRIMARY KEY REFERENCES users(id),brand TEXT NOT NULL CHECK(brand IN ('samsung','boat')));
    CREATE TABLE IF NOT EXISTS claim_status_changes(id TEXT PRIMARY KEY,claim_id TEXT NOT NULL REFERENCES claims(id),status TEXT NOT NULL,reason TEXT,actor_id TEXT REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX IF NOT EXISTS status_changes_claim ON claim_status_changes(claim_id);
    CREATE TABLE IF NOT EXISTS live_sessions(id TEXT PRIMARY KEY,claim_id TEXT NOT NULL REFERENCES claims(id),requested_by TEXT NOT NULL REFERENCES users(id),status TEXT NOT NULL DEFAULT 'WAITING',owner_joined INTEGER NOT NULL DEFAULT 0,reviewer_joined INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,expires_at INTEGER NOT NULL,ended_at TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS one_live_per_claim ON live_sessions(claim_id) WHERE status IN ('WAITING','CONNECTING','CONNECTED','DISCONNECTED');
    CREATE TABLE IF NOT EXISTS live_signals(id INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT NOT NULL REFERENCES live_sessions(id),actor_id TEXT NOT NULL REFERENCES users(id),payload TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS live_signal_session ON live_signals(session_id,id);
  `);
  const columns = db.prepare('PRAGMA table_info(evidence)').all();
  if (!columns.some(c=>c.name === 'live_session_id')) db.exec('ALTER TABLE evidence ADD COLUMN live_session_id TEXT REFERENCES live_sessions(id)');
  const insert=db.prepare('INSERT OR IGNORE INTO claim_status_changes(id,claim_id,status,reason,actor_id,created_at) VALUES(?,?,?,?,?,?)');
  db.transaction(()=>{
    for(const e of db.prepare("SELECT * FROM audit_events WHERE action='REVIEWER_DECISION' AND claim_id IS NOT NULL").all()) {
      const match=/^(UNDER_REVIEW|NEEDS_EVIDENCE|APPROVED|REJECTED):\s*([\s\S]*)$/.exec(e.detail);
      if(match) insert.run(e.id,e.claim_id,match[1],match[2] || null,e.actor_id,e.created_at);
    }
  })();
}
