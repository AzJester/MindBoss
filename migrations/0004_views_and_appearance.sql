ALTER TABLE user_preferences ADD COLUMN view_mode TEXT NOT NULL DEFAULT 'feed' CHECK (view_mode IN ('feed', 'board', 'calendar', 'flex'));
ALTER TABLE user_preferences ADD COLUMN group_by_time INTEGER NOT NULL DEFAULT 0 CHECK (group_by_time IN (0, 1));
ALTER TABLE user_preferences ADD COLUMN compact_view INTEGER NOT NULL DEFAULT 0 CHECK (compact_view IN (0, 1));
ALTER TABLE user_preferences ADD COLUMN hide_tag_nav INTEGER NOT NULL DEFAULT 0 CHECK (hide_tag_nav IN (0, 1));
ALTER TABLE user_preferences ADD COLUMN theme TEXT NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark', 'light', 'system'));
ALTER TABLE user_preferences ADD COLUMN font_family TEXT NOT NULL DEFAULT 'system' CHECK (font_family IN ('system', 'modern', 'classic'));
ALTER TABLE user_preferences ADD COLUMN display_timezone TEXT NOT NULL DEFAULT 'America/Phoenix';
ALTER TABLE user_preferences ADD COLUMN board_tag_ids_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE user_preferences ADD COLUMN sort_order TEXT NOT NULL DEFAULT 'newest' CHECK (sort_order IN ('newest', 'oldest'));
