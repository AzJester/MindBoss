ALTER TABLE entries ADD COLUMN review_at TEXT;
ALTER TABLE entries ADD COLUMN last_viewed_at TEXT;
ALTER TABLE entries ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entries ADD COLUMN recurrence_rule TEXT CHECK (
  recurrence_rule IN ('daily', 'weekdays', 'weekly', 'monthly') OR recurrence_rule IS NULL
);

ALTER TABLE list_items ADD COLUMN due_at TEXT;
ALTER TABLE attachments ADD COLUMN extracted_text TEXT NOT NULL DEFAULT '';

CREATE INDEX entries_review_idx ON entries(user_id, status, review_at);
CREATE INDEX entries_recently_viewed_idx ON entries(user_id, last_viewed_at DESC);

CREATE TABLE saved_searches (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  query_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX saved_searches_user_idx ON saved_searches(user_id, updated_at DESC);

CREATE TABLE capture_templates (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('note', 'list', 'reminder')),
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  list_items_json TEXT NOT NULL DEFAULT '[]',
  tag_ids_json TEXT NOT NULL DEFAULT '[]',
  reminder_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX capture_templates_user_idx ON capture_templates(user_id, updated_at DESC);

CREATE TABLE user_preferences (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  onboarding_json TEXT NOT NULL DEFAULT '{}',
  default_capture_kind TEXT NOT NULL DEFAULT 'note' CHECK (default_capture_kind IN ('note', 'list', 'reminder')),
  quiet_start TEXT,
  quiet_end TEXT,
  weekly_review_day INTEGER NOT NULL DEFAULT 0 CHECK (weekly_review_day BETWEEN 0 AND 6),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE ai_events (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  model TEXT NOT NULL,
  input_chars INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX ai_events_user_idx ON ai_events(user_id, created_at DESC);

DROP TABLE entries_fts;
CREATE VIRTUAL TABLE entries_fts USING fts5(
  entry_id UNINDEXED,
  title,
  body,
  source_title,
  source_url,
  list_text,
  attachment_text,
  tokenize = 'unicode61 remove_diacritics 2'
);

INSERT INTO entries_fts(entry_id, title, body, source_title, source_url, list_text, attachment_text)
SELECT
  e.id,
  e.title,
  e.body,
  COALESCE(e.source_title, ''),
  COALESCE(e.source_url, ''),
  COALESCE((SELECT GROUP_CONCAT(li.text, char(10)) FROM list_items li WHERE li.entry_id = e.id), ''),
  COALESCE((SELECT GROUP_CONCAT(a.extracted_text, char(10)) FROM attachments a WHERE a.entry_id = e.id), '')
FROM entries e;
