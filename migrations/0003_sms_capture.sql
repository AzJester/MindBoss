CREATE TABLE sms_messages (
  message_sid TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_id TEXT REFERENCES entries(id) ON DELETE SET NULL,
  from_number_hash TEXT NOT NULL,
  keyword TEXT NOT NULL,
  received_at TEXT NOT NULL
);
CREATE INDEX sms_messages_user_idx ON sms_messages(user_id, received_at DESC);
