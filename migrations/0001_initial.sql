CREATE TABLE notes (
  id TEXT PRIMARY KEY NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX notes_expiry ON notes(expires_at);
CREATE INDEX notes_created ON notes(created_at);

CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  background_url TEXT NOT NULL DEFAULT '',
  overlay REAL NOT NULL DEFAULT 0.75,
  link_length INTEGER NOT NULL DEFAULT 8 CHECK (link_length BETWEEN 3 AND 8),
  retention_days INTEGER NOT NULL DEFAULT 30 CHECK (retention_days BETWEEN 1 AND 365)
);
INSERT INTO settings(id) VALUES (1);

CREATE TABLE maintenance (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  ran_at INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0,
  kind TEXT,
  status TEXT
);
INSERT INTO maintenance(id) VALUES (1);
