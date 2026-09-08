PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  login TEXT NOT NULL,
  avatar_url TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT 'America/Phoenix',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  return_to TEXT NOT NULL DEFAULT '/',
  expires_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('note', 'list', 'reminder')),
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'android_share', 'chrome_extension', 'mindchuk_import')),
  source_url TEXT,
  source_title TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'trashed')),
  pinned_at TEXT,
  reminder_at TEXT,
  reminder_state TEXT CHECK (reminder_state IN ('pending', 'sending', 'delivered', 'completed') OR reminder_state IS NULL),
  import_hash TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX entries_feed_idx ON entries(user_id, status, pinned_at, created_at DESC);
CREATE INDEX entries_kind_idx ON entries(user_id, kind, status, created_at DESC);
CREATE INDEX entries_reminder_idx ON entries(reminder_state, reminder_at);
CREATE UNIQUE INDEX entries_import_hash_idx ON entries(user_id, import_hash) WHERE import_hash IS NOT NULL;

CREATE TABLE list_items (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  position INTEGER NOT NULL,
  completed_at TEXT
);
CREATE INDEX list_items_entry_idx ON list_items(entry_id, position);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#22d3aa',
  parent_id TEXT REFERENCES tags(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, normalized_name)
);
CREATE INDEX tags_parent_idx ON tags(user_id, parent_id);

CREATE TABLE tag_triggers (
  id TEXT PRIMARY KEY,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  trigger_text TEXT NOT NULL,
  normalized_trigger TEXT NOT NULL,
  UNIQUE(tag_id, normalized_trigger)
);

CREATE TABLE entry_tags (
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('manual', 'trigger', 'import')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(entry_id, tag_id)
);
CREATE INDEX entry_tags_tag_idx ON entry_tags(tag_id, entry_id);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX attachments_entry_idx ON attachments(entry_id);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint_hash TEXT NOT NULL UNIQUE,
  subscription_ciphertext TEXT NOT NULL,
  device_label TEXT NOT NULL DEFAULT 'Browser',
  created_at TEXT NOT NULL,
  last_success_at TEXT
);

CREATE TABLE clip_tokens (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE TABLE entry_events (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX entry_events_entry_idx ON entry_events(entry_id, created_at DESC);

CREATE TABLE idempotency_keys (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id, key)
);

CREATE VIRTUAL TABLE entries_fts USING fts5(
  entry_id UNINDEXED,
  title,
  body,
  source_title,
  source_url,
  list_text,
  tokenize = 'unicode61 remove_diacritics 2'
);
