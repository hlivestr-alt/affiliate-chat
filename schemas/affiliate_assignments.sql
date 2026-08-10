CREATE TABLE IF NOT EXISTS affiliate_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  affiliate_id TEXT NOT NULL DEFAULT '',
  affiliate_name TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  conversation_id TEXT NOT NULL DEFAULT '',
  original_batch_number INTEGER,
  drive_folder_id TEXT NOT NULL DEFAULT '',
  drive_folder_old_name TEXT NOT NULL DEFAULT '',
  drive_folder_new_name TEXT NOT NULL DEFAULT '',
  drive_link TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  link_sent_at TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  UNIQUE(drive_folder_id)
);

CREATE INDEX IF NOT EXISTS idx_affiliate_assignments_state
ON affiliate_assignments(state);

CREATE INDEX IF NOT EXISTS idx_affiliate_assignments_conversation
ON affiliate_assignments(conversation_id);
