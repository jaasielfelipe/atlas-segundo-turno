import type { Store } from './store';
import type { Environment, Round } from '../../../../packages/domain/src/index';
import type { RoundData, ZoneResult } from '../../../../packages/domain/src/zones';
import { validateOrigin } from '../../../../packages/tse/src/index';

type Row = Omit<ZoneResult, 'counts' | 'candidates'> & {
  electorate: number | null;
  turnout: number | null;
  valid: number | null;
  blank: number | null;
  null_votes: number | null;
  annulled: number | null;
};

/** Normalized zone storage of one round: registry, segment versions and candidate votes. */
export class ZoneStore {
  constructor(readonly store: Pick<Store, 'db'>) {}
  /** Inserts a registry and segment versions (fixtures, tests and the frozen 1st-round baseline). */
  insert(data: RoundData, capturedAt: string) {
    const db = this.store.db,
      registryId = `${data.environment}:${data.round}:${data.registryDigest}`;
    db.transaction(() => {
      db.prepare('INSERT OR IGNORE INTO zone_registry VALUES(?,?,?,?,?,?,?)').run(
        registryId,
        data.environment,
        data.round,
        data.election,
        capturedAt,
        1,
        data.registryDigest,
      );
      const segment = db.prepare('INSERT OR IGNORE INTO zone_segment VALUES(?,?,?,?)');
      for (const s of data.segments) segment.run(registryId, s.uf, s.municipality, s.zone);
      const result = db.prepare(
        'INSERT OR IGNORE INTO zone_result VALUES(@id,@environment,@election,@round,@uf,@municipality,@zone,@capturedAt,@sourceUrl,@sourceDigest,@status,@total,@totalized,@notTotalized,@electorate,@turnout,@valid,@blank,@null,@annulled)',
      );
      const vote = db.prepare('INSERT INTO zone_candidate_vote VALUES(?,?,?)');
      for (const r of data.results) {
        if (
          r.environment !== data.environment ||
          r.round !== data.round ||
          r.election !== data.election
        )
          throw Error('Ambiente/turno/eleição misturados');
        validateOrigin(r.sourceUrl, r.environment);
        const { counts, candidates, ...rest } = r;
        if (result.run({ ...rest, ...counts }).changes)
          for (const c of candidates) vote.run(r.id, c.id, c.votes);
      }
    })();
  }
  /** Latest registry of `round` and every version captured up to `at`. */
  load(environment: Environment, round: Round, at: string): RoundData | null {
    const db = this.store.db;
    const registry = db
      .prepare(
        'SELECT * FROM zone_registry WHERE environment=? AND round=? AND captured_at<=? ORDER BY captured_at DESC LIMIT 1',
      )
      .get(environment, round, at) as { id: string; election: string; digest: string } | undefined;
    if (!registry) return null;
    const rows = db
      .prepare(
        'SELECT id,environment,election,round,uf,municipality,zone,captured_at AS capturedAt,source_url AS sourceUrl,source_digest AS sourceDigest,status,total,totalized,not_totalized AS notTotalized,electorate,turnout,valid,blank,null_votes,annulled FROM zone_result WHERE environment=? AND round=? AND captured_at<=? ORDER BY captured_at',
      )
      .all(environment, round, at) as Row[];
    const votes = new Map<string, { id: string; votes: number }[]>();
    for (const v of db
      .prepare(
        'SELECT v.result_id, v.candidate_id AS id, v.votes FROM zone_candidate_vote v JOIN zone_result r ON r.id=v.result_id WHERE r.environment=? AND r.round=? AND r.captured_at<=?',
      )
      .all(environment, round, at) as { result_id: string; id: string; votes: number }[])
      votes.set(v.result_id, [...(votes.get(v.result_id) ?? []), { id: v.id, votes: v.votes }]);
    return {
      environment,
      round,
      election: registry.election,
      registryDigest: registry.digest,
      segments: db
        .prepare(
          'SELECT uf,municipality,zone FROM zone_segment WHERE registry_id=? ORDER BY uf,municipality,zone',
        )
        .all(registry.id) as RoundData['segments'],
      results: rows.map(({ electorate, turnout, valid, blank, null_votes, annulled, ...r }) => ({
        ...r,
        counts: { electorate, turnout, valid, blank, null: null_votes, annulled },
        candidates: votes.get(r.id) ?? [],
      })),
    };
  }
}
