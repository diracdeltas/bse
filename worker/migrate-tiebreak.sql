-- One-time upgrade for a database created before tie-breaking. Run it once, before deploying
-- the Worker (the new Worker fails on a database without this column).
-- last_vote is a signed timestamp: + when the track's latest vote was a win, - when it was a
-- loss. Existing tracks get 0, meaning "unknown", until they are voted on again.
ALTER TABLE tracks ADD COLUMN last_vote INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS tracks_by_rank ON tracks (rating DESC, last_vote DESC);
DROP INDEX IF EXISTS tracks_by_rating;
