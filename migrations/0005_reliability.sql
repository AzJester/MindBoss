ALTER TABLE entries ADD COLUMN recurrence_anchor_day INTEGER;
ALTER TABLE entries ADD COLUMN last_mutation_id TEXT;
ALTER TABLE user_preferences ADD COLUMN last_weekly_review_at TEXT;
CREATE TABLE attachment_cleanup (
  r2_key TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
CREATE TABLE deleted_entry_ids (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deleted_at TEXT NOT NULL
);
CREATE TABLE push_deliveries (
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  due_at TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  PRIMARY KEY(entry_id, subscription_id, due_at)
);
