import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { Snapshot } from '../../../packages/domain/src/index';

/** Official aggregate reduced to what the telão draws (EA20; never a sum of zones). */
export type Official = {
  capturedAt: string;
  generatedAt: string;
  sections: number;
  totalized: number;
  electorate: number;
  /** Abstentions in the counted sections (installed electorate − turnout). */
  abstention: number;
  turnout: number;
  /** Turnout − valid: blank, null, annulled, sub judice. */
  notValid: number;
  valid: number;
  flavio: number;
  lula: number;
};

type Finalists = { flavio: { id: string }; lula: { id: string } };

export function summarize(s: Snapshot, finalists: Finalists): Official | null {
  if (s.votes.valid === null) return null;
  const votes = (id: string) => s.candidates.find((c) => c.id === id)?.countedVotes ?? 0;
  return {
    capturedAt: s.capturedAt,
    generatedAt: s.sourceGeneratedAt,
    sections: s.sections.total,
    totalized: s.sections.totalized,
    electorate: s.electorate.total,
    abstention: Math.max(0, s.electorate.installed - s.electorate.turnout),
    turnout: s.electorate.turnout,
    notValid: Math.max(0, (s.votes.total ?? s.electorate.turnout) - s.votes.valid),
    valid: s.votes.valid,
    flavio: votes(finalists.flavio.id),
    lula: votes(finalists.lula.id),
  };
}

/**
 * Read-only data source for the telão over the 2nd-round collection database (written by the
 * collector, WAL) and the frozen 1st-round baseline. Segment versions are served incrementally by
 * SQLite rowid, in the replay tuple format the client already animates.
 */
export class TelaoSource {
  private db: Database.Database | null = null;
  private baseline: Database.Database | null = null;
  private bootstrapCache: { key: string; value: ReturnType<TelaoSource['build']> } | null = null;
  readonly finalists: Finalists;
  constructor(
    readonly livePath: string,
    readonly baselinePath: string,
    readonly root = process.cwd(),
  ) {
    this.finalists = JSON.parse(
      readFileSync(resolve(root, 'packages/fixtures/round2/finalists.json'), 'utf8'),
    );
  }
  private open() {
    if (!this.db) {
      if (!existsSync(this.livePath)) return null;
      this.db = new Database(this.livePath, { readonly: true, fileMustExist: true });
    }
    return this.db;
  }
  private openBaseline() {
    if (!this.baseline && existsSync(this.baselinePath))
      this.baseline = new Database(this.baselinePath, { readonly: true, fileMustExist: true });
    return this.baseline;
  }
  /** Registry, municipalities, per-segment sections/electorate and 1st-round final votes. */
  bootstrap() {
    const db = this.open();
    if (!db) return null;
    const registry = db
      .prepare(
        "SELECT id, election, digest, captured_at FROM zone_registry WHERE environment='official' AND round='2' ORDER BY captured_at DESC LIMIT 1",
      )
      .get() as { id: string; election: string; digest: string; captured_at: string } | undefined;
    if (!registry) return null;
    const count = db
      .prepare("SELECT COUNT(*) n FROM zone_result WHERE environment='official' AND round='2'")
      .get() as { n: number };
    // Rebuilt only when the registry changes or the first versions of segments arrive.
    const key = `${registry.digest}:${Math.min(count.n, 1)}`;
    if (this.bootstrapCache?.key !== key)
      this.bootstrapCache = { key, value: { ...this.build(db, registry), version: key } };
    return this.bootstrapCache.value;
  }
  private build(
    db: Database.Database,
    registry: { id: string; election: string; digest: string; captured_at: string },
  ) {
    const body = db
      .prepare(
        "SELECT b.compressed FROM collector_cache c JOIN collector_body b ON b.digest=c.body_digest WHERE c.job_key='bootstrap:ea12'",
      )
      .get() as { compressed: Buffer } | undefined;
    const names = new Map<string, string>();
    if (body)
      for (const uf of JSON.parse(gunzipSync(body.compressed).toString('utf8')).abr)
        for (const m of uf.mu) names.set(`${uf.cd}:${m.cd}`, m.nm);
    const segments = db
      .prepare(
        'SELECT uf, municipality, zone FROM zone_segment WHERE registry_id=? ORDER BY uf, municipality, zone',
      )
      .all(registry.id) as { uf: string; municipality: string; zone: string }[];
    // Sections and electorate per segment: latest 2nd-round version, else the 1st-round baseline.
    const sizes = new Map<string, { total: number; electorate: number | null }>();
    const fill = (rows: { k: string; total: number; electorate: number | null }[]) => {
      for (const r of rows) if (!sizes.has(r.k)) sizes.set(r.k, r);
    };
    const latest = `SELECT uf||':'||municipality||':'||zone k, total, electorate FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY uf, municipality, zone ORDER BY captured_at DESC) rn
        FROM zone_result WHERE environment='official' AND round=?) WHERE rn=1`;
    fill(db.prepare(latest).all('2') as never);
    const baseline = this.openBaseline();
    const first = new Map<string, { flavio: number; lula: number; valid: number }>();
    if (baseline) {
      fill(baseline.prepare(latest).all('1') as never);
      const rows = baseline
        .prepare(
          `SELECT r.uf||':'||r.municipality||':'||r.zone k, r.valid,
             (SELECT votes FROM zone_candidate_vote v WHERE v.result_id=r.id AND v.candidate_id=?) flavio,
             (SELECT votes FROM zone_candidate_vote v WHERE v.result_id=r.id AND v.candidate_id=?) lula
           FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY uf, municipality, zone ORDER BY captured_at DESC) rn
                 FROM zone_result WHERE environment='official' AND round='1') r WHERE r.rn=1`,
        )
        .all(this.finalists.flavio.id, this.finalists.lula.id) as {
        k: string;
        valid: number | null;
        flavio: number | null;
        lula: number | null;
      }[];
      for (const r of rows)
        first.set(r.k, { flavio: r.flavio ?? 0, lula: r.lula ?? 0, valid: r.valid ?? 0 });
    }
    const municipalities: [string, string][] = [];
    const index = new Map<string, number>();
    const segmentIndex = new Map<string, number>();
    const out: [number, string, number, number][] = [];
    for (const s of segments) {
      const m = `${s.uf}:${s.municipality}`;
      if (!index.has(m)) {
        index.set(m, municipalities.length);
        municipalities.push([m, names.get(m) ?? m]);
      }
      const k = `${m}:${s.zone}`;
      segmentIndex.set(k, out.length);
      const size = sizes.get(k);
      out.push([index.get(m)!, s.zone, size?.total ?? 0, size?.electorate ?? 0]);
    }
    return {
      environment: 'official' as const,
      round: '2' as const,
      /** Changes when the registry or segment sizes change: the client must bootstrap again. */
      version: '',
      election: registry.election,
      registryDigest: registry.digest,
      base: registry.captured_at,
      municipalities,
      segments: out,
      /** 1st-round final votes (finalists, valid) per segment, same order; null without one. */
      baseline: baseline
        ? segments.map((s) => first.get(`${s.uf}:${s.municipality}:${s.zone}`) ?? null)
        : null,
      segmentIndex,
    };
  }
  /** Segment versions after `after` (rowid), as replay event tuples, at most `limit`. */
  events(after: number, limit = 20_000) {
    const boot = this.bootstrap();
    if (!boot) return { events: [], last: after, version: null };
    const rows = this.db!.prepare(
      `SELECT r.rowid rid, r.uf||':'||r.municipality||':'||r.zone k, r.captured_at at, r.totalized,
         r.valid, r.counted_electorate est, r.turnout,
         (SELECT votes FROM zone_candidate_vote v WHERE v.result_id=r.id AND v.candidate_id=?) flavio,
         (SELECT votes FROM zone_candidate_vote v WHERE v.result_id=r.id AND v.candidate_id=?) lula
       FROM zone_result r WHERE r.environment='official' AND r.round='2' AND r.rowid>?
       ORDER BY r.rowid LIMIT ?`,
    ).all(this.finalists.flavio.id, this.finalists.lula.id, after, limit) as {
      rid: number;
      k: string;
      at: string;
      totalized: number;
      valid: number | null;
      est: number | null;
      turnout: number | null;
      flavio: number | null;
      lula: number | null;
    }[];
    const base = Date.parse(boot.base);
    const events = rows
      .filter((r) => boot.segmentIndex.has(r.k))
      .map((r) => [
        Math.round((Date.parse(r.at) - base) / 1000),
        boot.segmentIndex.get(r.k)!,
        r.totalized,
        r.valid,
        r.valid === null ? null : (r.flavio ?? 0),
        r.valid === null ? null : (r.lula ?? 0),
        r.est ?? 0,
        r.turnout ?? 0,
        r.turnout !== null && r.valid !== null ? r.turnout - r.valid : 0,
      ]);
    return { events, last: rows.at(-1)?.rid ?? after, version: boot.version };
  }
  /** Latest official EA20 aggregates of the 2nd round: Brazil, each UF and the exterior. */
  official() {
    const db = this.open();
    if (!db) return null;
    const rows = db
      .prepare(
        `SELECT territory_id t, payload FROM (
           SELECT territory_id, payload, ROW_NUMBER() OVER (PARTITION BY territory_id ORDER BY captured_at DESC, rowid DESC) rn
           FROM snapshot WHERE environment='official' AND office='president') WHERE rn=1`,
      )
      .all() as { t: string; payload: string }[];
    const out: Record<string, Official> = {};
    for (const r of rows) {
      if (r.t.includes(':')) continue; // municipal aggregates of saved municipalities
      const s = JSON.parse(r.payload) as Snapshot;
      if (s.round !== '2') continue;
      const summary = summarize(s, this.finalists);
      if (summary) out[r.t] = summary;
    }
    return out;
  }
  /** Collector lease and last heartbeat (rate, coverage), for the header. */
  status() {
    const db = this.open();
    if (!db) return { collecting: false, collector: null };
    const lease = db.prepare('SELECT expires FROM collector_owner WHERE id=1').get() as
      | { expires: number }
      | undefined;
    const file = resolve(dirname(this.livePath), 'collector-status.json');
    let collector: unknown = null;
    try {
      if (existsSync(file)) {
        const s = JSON.parse(readFileSync(file, 'utf8'));
        collector = { updatedAt: s.updatedAt, rate: s.rate?.observedRps10s, coverage: s.coverage };
      }
    } catch {
      collector = null; // mid-write
    }
    return { collecting: Boolean(lease && lease.expires > Date.now()), collector };
  }
  close() {
    this.db?.close();
    this.baseline?.close();
    this.db = this.baseline = null;
  }
}
