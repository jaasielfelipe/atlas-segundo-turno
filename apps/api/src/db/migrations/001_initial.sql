CREATE TABLE migration (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE raw_artifact (
  digest TEXT PRIMARY KEY, compressed BLOB NOT NULL
);
CREATE TABLE snapshot (
  id TEXT PRIMARY KEY,
  environment TEXT NOT NULL CHECK(environment IN ('official','simulated','fixture')),
  election_id TEXT NOT NULL, office TEXT NOT NULL CHECK(office IN ('president','governor')),
  territory_id TEXT NOT NULL, phase TEXT NOT NULL CHECK(phase IN ('o','s')),
  captured_at TEXT NOT NULL, source_generated_at TEXT NOT NULL, source_totalized_at TEXT,
  source_idg TEXT NOT NULL, source_url TEXT NOT NULL, source_digest TEXT NOT NULL,
  raw_digest TEXT NOT NULL REFERENCES raw_artifact(digest), payload TEXT NOT NULL CHECK(json_valid(payload)),
  CHECK(environment = 'fixture' OR (environment = 'official' AND phase = 'o') OR (environment = 'simulated' AND phase = 's')),
  UNIQUE(environment, election_id, office, territory_id, phase, source_digest)
);
CREATE INDEX snapshot_feed_capture ON snapshot(environment, office, territory_id, captured_at);
CREATE TRIGGER snapshot_no_update BEFORE UPDATE ON snapshot BEGIN SELECT RAISE(ABORT, 'Snapshots são imutáveis'); END;
CREATE TRIGGER snapshot_no_delete BEFORE DELETE ON snapshot BEGIN SELECT RAISE(ABORT, 'Snapshots são imutáveis'); END;
CREATE TRIGGER raw_no_update BEFORE UPDATE ON raw_artifact BEGIN SELECT RAISE(ABORT, 'Artefatos são imutáveis'); END;
CREATE TRIGGER raw_no_delete BEFORE DELETE ON raw_artifact BEGIN SELECT RAISE(ABORT, 'Artefatos são imutáveis'); END;
CREATE TABLE watchlist (
  environment TEXT NOT NULL, territory_id TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  created_at TEXT NOT NULL, collect_bu INTEGER NOT NULL DEFAULT 0 CHECK(collect_bu = 0),
  PRIMARY KEY(environment, territory_id)
);
CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
