-- One-time upgrade for a database created before Elo ratings. Run it once, before deploying
-- the Worker, and never again: the UPDATE below would overwrite ratings earned since.
ALTER TABLE tracks ADD COLUMN rating REAL NOT NULL DEFAULT 1500;

-- Old votes don't record who played whom, so approximate: each net win is worth about 16
-- points (half of K, the swing against an equally rated opponent). Every vote is one win
-- and one loss, so this stays zero-sum like Elo itself.
UPDATE tracks SET rating = 1500 + 16 * (wins - losses);

CREATE INDEX IF NOT EXISTS tracks_by_rating ON tracks (rating DESC);
DROP INDEX IF EXISTS tracks_by_wins;
