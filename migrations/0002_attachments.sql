ALTER TABLE notes ADD COLUMN generation TEXT;
UPDATE notes SET generation = lower(hex(randomblob(16)));
CREATE UNIQUE INDEX notes_generation ON notes(generation);
CREATE TRIGGER notes_generation_insert AFTER INSERT ON notes WHEN NEW.generation IS NULL BEGIN
  UPDATE notes SET generation = lower(hex(randomblob(16))) WHERE id = NEW.id;
END;

ALTER TABLE settings ADD COLUMN uploads_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE settings ADD COLUMN max_file_bytes INTEGER NOT NULL DEFAULT 10485760;
ALTER TABLE settings ADD COLUMN max_note_files INTEGER NOT NULL DEFAULT 5;
ALTER TABLE settings ADD COLUMN max_note_bytes INTEGER NOT NULL DEFAULT 52428800;
ALTER TABLE settings ADD COLUMN max_total_bytes INTEGER NOT NULL DEFAULT 1073741824;

CREATE TABLE attachment_usage (id INTEGER PRIMARY KEY CHECK(id=1), bytes INTEGER NOT NULL DEFAULT 0 CHECK(bytes>=0));
INSERT INTO attachment_usage(id) VALUES(1);
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  note_generation TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  size INTEGER NOT NULL CHECK(size > 0),
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready','deleting')),
  created_at INTEGER NOT NULL,
  changed_at INTEGER NOT NULL,
  started_at INTEGER,
  delete_after INTEGER NOT NULL,
  retry_at INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX attachments_note ON attachments(note_generation);
CREATE INDEX attachments_cleanup ON attachments(state, delete_after, retry_at);

-- Reservations, limits and accounting run in the same SQLite transaction.
-- Avoid CASE ... END inside triggers: remote D1 SQL splitting can mistake
-- the expression's END for the trigger terminator (local SQLite accepts it).
CREATE TRIGGER attachment_reserve BEFORE INSERT ON attachments BEGIN
  SELECT RAISE(ABORT, 'ATTACHMENT_NOTE_UNAVAILABLE')
    WHERE NOT EXISTS(SELECT 1 FROM notes WHERE generation=NEW.note_generation AND expires_at>NEW.created_at AND length(trim(content))>0);
  SELECT RAISE(ABORT, 'ATTACHMENT_DISABLED')
    WHERE (SELECT uploads_enabled FROM settings WHERE id=1)=0;
  SELECT RAISE(ABORT, 'ATTACHMENT_QUOTA')
    WHERE NEW.size>(SELECT max_file_bytes FROM settings WHERE id=1)
    OR (SELECT count(*) FROM attachments WHERE note_generation=NEW.note_generation)>=(SELECT max_note_files FROM settings WHERE id=1)
    OR NEW.size+coalesce((SELECT sum(size) FROM attachments WHERE note_generation=NEW.note_generation),0)>(SELECT max_note_bytes FROM settings WHERE id=1)
    OR NEW.size+(SELECT bytes FROM attachment_usage WHERE id=1)>(SELECT max_total_bytes FROM settings WHERE id=1);
END;
CREATE TRIGGER attachment_account_insert AFTER INSERT ON attachments BEGIN
  UPDATE attachment_usage SET bytes=bytes+NEW.size WHERE id=1;
END;
CREATE TRIGGER attachment_account_delete AFTER DELETE ON attachments BEGIN
  UPDATE attachment_usage SET bytes=bytes-OLD.size WHERE id=1;
END;
-- Only completed uploads and explicit removal of ready files renew live notes.
CREATE TRIGGER attachment_renew AFTER UPDATE OF state ON attachments
WHEN (OLD.state='pending' AND NEW.state='ready') OR (OLD.state='ready' AND NEW.state='deleting') BEGIN
  UPDATE notes SET updated_at=NEW.changed_at,
    expires_at=NEW.changed_at+(SELECT retention_days FROM settings WHERE id=1)*86400000
    WHERE generation=NEW.note_generation AND expires_at>NEW.changed_at;
END;
-- Preserve object keys after deleting a note, including in-flight uploads.
CREATE TRIGGER note_attachment_delete AFTER DELETE ON notes BEGIN
  UPDATE attachments SET state='deleting' WHERE note_generation=OLD.generation;
END;
