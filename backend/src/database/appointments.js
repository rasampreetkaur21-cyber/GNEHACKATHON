export function migrateAppointments(db){
 db.exec(`CREATE TABLE IF NOT EXISTS live_appointments(id TEXT PRIMARY KEY,claim_id TEXT NOT NULL REFERENCES claims(id),reviewer_id TEXT NOT NULL REFERENCES users(id),status TEXT NOT NULL DEFAULT 'PROPOSED',start_at INTEGER NOT NULL,duration_minutes INTEGER NOT NULL,message TEXT NOT NULL,alternative_at INTEGER,response_note TEXT,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE UNIQUE INDEX IF NOT EXISTS one_live_invitation ON live_appointments(claim_id) WHERE status IN ('PROPOSED','ACCEPTED','ALTERNATIVE');`);
 if(!db.prepare('PRAGMA table_info(live_sessions)').all().some(c=>c.name==='appointment_id'))db.exec('ALTER TABLE live_sessions ADD COLUMN appointment_id TEXT REFERENCES live_appointments(id)');
}
