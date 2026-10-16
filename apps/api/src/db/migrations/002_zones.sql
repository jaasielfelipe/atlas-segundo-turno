CREATE TABLE zone_registry (
  id TEXT PRIMARY KEY, environment TEXT NOT NULL CHECK(environment IN ('fixture','simulated','official')),
  round TEXT NOT NULL CHECK(round IN ('1','2')), election TEXT NOT NULL,
  captured_at TEXT NOT NULL, complete INTEGER NOT NULL CHECK(complete IN (0,1)), digest TEXT NOT NULL,
  UNIQUE(environment, round, digest)
);
CREATE TABLE zone_segment (
  registry_id TEXT NOT NULL REFERENCES zone_registry(id), uf TEXT NOT NULL,
  municipality TEXT NOT NULL CHECK(length(municipality)=5), zone TEXT NOT NULL CHECK(length(zone)=4),
  PRIMARY KEY(registry_id,uf,municipality,zone)
);
-- One immutable version per município–zona segment and capture. Counts are NULL when the TSE file
-- does not publish them (never zero-filled).
CREATE TABLE zone_result (
  id TEXT PRIMARY KEY, environment TEXT NOT NULL CHECK(environment IN ('fixture','simulated','official')),
  election TEXT NOT NULL, round TEXT NOT NULL CHECK(round IN ('1','2')),
  uf TEXT NOT NULL, municipality TEXT NOT NULL CHECK(length(municipality)=5), zone TEXT NOT NULL CHECK(length(zone)=4),
  captured_at TEXT NOT NULL, source_url TEXT NOT NULL, source_digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('complete','partial','needs_review')),
  total INTEGER NOT NULL CHECK(total>=0), totalized INTEGER NOT NULL CHECK(totalized>=0), not_totalized INTEGER NOT NULL CHECK(not_totalized>=0),
  electorate INTEGER CHECK(electorate>=0), turnout INTEGER CHECK(turnout>=0),
  valid INTEGER CHECK(valid>=0), blank INTEGER CHECK(blank>=0), null_votes INTEGER CHECK(null_votes>=0),
  annulled INTEGER CHECK(annulled>=0),
  UNIQUE(environment,election,uf,municipality,zone,captured_at)
);
CREATE INDEX zone_result_replay ON zone_result(environment,round,uf,zone,municipality,captured_at);
CREATE TABLE zone_candidate_vote (
  result_id TEXT NOT NULL REFERENCES zone_result(id), candidate_id TEXT NOT NULL, votes INTEGER NOT NULL CHECK(votes>=0),
  PRIMARY KEY(result_id,candidate_id)
);
CREATE TRIGGER zone_result_no_update BEFORE UPDATE ON zone_result BEGIN SELECT RAISE(ABORT,'Resultados zonais imutáveis'); END;
CREATE TRIGGER zone_result_no_delete BEFORE DELETE ON zone_result BEGIN SELECT RAISE(ABORT,'Resultados zonais imutáveis'); END;
CREATE TRIGGER zone_votes_no_update BEFORE UPDATE ON zone_candidate_vote BEGIN SELECT RAISE(ABORT,'Votos imutáveis'); END;
CREATE TRIGGER zone_votes_no_delete BEFORE DELETE ON zone_candidate_vote BEGIN SELECT RAISE(ABORT,'Votos imutáveis'); END;
CREATE TRIGGER zone_registry_no_update BEFORE UPDATE ON zone_registry BEGIN SELECT RAISE(ABORT,'Cadastro imutável'); END;
CREATE TRIGGER zone_registry_no_delete BEFORE DELETE ON zone_registry BEGIN SELECT RAISE(ABORT,'Cadastro imutável'); END;
CREATE TRIGGER zone_segment_no_update BEFORE UPDATE ON zone_segment BEGIN SELECT RAISE(ABORT,'Cadastro imutável'); END;
CREATE TRIGGER zone_segment_no_delete BEFORE DELETE ON zone_segment BEGIN SELECT RAISE(ABORT,'Cadastro imutável'); END;
