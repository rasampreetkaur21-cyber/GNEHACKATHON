export function migrateDeviceChecks(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS device_checks(
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),claim_id TEXT REFERENCES claims(id),
 selected_model_id TEXT NOT NULL,sha256 TEXT NOT NULL,normalized_sha256 TEXT NOT NULL,
 origin TEXT NOT NULL,storage_key TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,
 result_json TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE INDEX IF NOT EXISTS device_checks_hash ON device_checks(sha256,normalized_sha256);
 CREATE INDEX IF NOT EXISTS device_checks_owner ON device_checks(user_id);
 CREATE TABLE IF NOT EXISTS device_check_calls(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),day TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS device_check_usage ON device_check_calls(day,user_id);`);
}
