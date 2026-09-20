CREATE TABLE IF NOT EXISTS tracks (
  id INTEGER PRIMARY KEY,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  rating REAL NOT NULL DEFAULT 1500,
  -- signed timestamp: + when the latest vote was a win, - when it was a loss, 0 if none
  last_vote INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS tracks_by_rank ON tracks (rating DESC, last_vote DESC);

CREATE TABLE IF NOT EXISTS limits (
  ip TEXT PRIMARY KEY,
  hour INTEGER NOT NULL,
  count INTEGER NOT NULL
);
