CREATE TABLE IF NOT EXISTS workspaces (
  user_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision > 0),
  record TEXT NOT NULL
);
