CREATE TABLE IF NOT EXISTS rows (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, kind TEXT NOT NULL, path TEXT, target TEXT, ref TEXT, source TEXT, campaign TEXT, country TEXT, screen INTEGER, visit TEXT, city TEXT, region TEXT, device TEXT, browser TEXT, os TEXT, depth INTEGER, secs INTEGER, dc INTEGER);
CREATE INDEX IF NOT EXISTS rows_ts ON rows (ts);
-- Existing table? Add the data-center flag once, in the D1 console:
--   ALTER TABLE rows ADD COLUMN dc INTEGER;
