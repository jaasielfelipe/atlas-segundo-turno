CREATE TABLE collector_state (
 id TEXT PRIMARY KEY CHECK(id='global'), next_request INTEGER NOT NULL, turn INTEGER NOT NULL,
 requests INTEGER NOT NULL, bytes INTEGER NOT NULL, unchanged INTEGER NOT NULL, errors INTEGER NOT NULL
);
CREATE TABLE collector_job (
 key TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload)), missing INTEGER NOT NULL CHECK(missing IN (0,1))
);
CREATE TABLE collector_body (
 digest TEXT PRIMARY KEY, compressed BLOB NOT NULL
);
CREATE TABLE collector_cache (
 job_key TEXT PRIMARY KEY REFERENCES collector_job(key), body_digest TEXT NOT NULL REFERENCES collector_body(digest),
 captured_at TEXT NOT NULL, validated_at TEXT NOT NULL
);
CREATE TABLE collector_observation (
 id INTEGER PRIMARY KEY, job_key TEXT NOT NULL REFERENCES collector_job(key), started_at TEXT NOT NULL,
 completed_at TEXT NOT NULL, status INTEGER NOT NULL, bytes INTEGER NOT NULL,
 digest TEXT REFERENCES collector_body(digest), error TEXT
);
CREATE INDEX collector_observation_time ON collector_observation(job_key,started_at);
CREATE TRIGGER collector_body_no_update BEFORE UPDATE ON collector_body BEGIN SELECT RAISE(ABORT,'Resposta imutável'); END;
CREATE TRIGGER collector_body_no_delete BEFORE DELETE ON collector_body BEGIN SELECT RAISE(ABORT,'Resposta imutável'); END;
CREATE TABLE collector_owner (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE INDEX collector_observation_replay ON collector_observation(job_key,completed_at,id);
CREATE TRIGGER collector_observation_no_update BEFORE UPDATE ON collector_observation BEGIN SELECT RAISE(ABORT,'Observação imutável'); END;
CREATE TRIGGER collector_observation_no_delete BEFORE DELETE ON collector_observation BEGIN SELECT RAISE(ABORT,'Observação imutável'); END;
