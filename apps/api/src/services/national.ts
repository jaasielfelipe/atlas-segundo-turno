import { gzipSync } from 'node:zlib';
import type { Store } from '../db/store';
import { PersistentCollector } from './collector';
import {
  discoverElection,
  resolveTsePath,
  parseCatalog,
  parseTracking,
  normalizeEA20,
  rawDigest,
  digest,
  validateOrigin,
  type PathContext,
} from '../../../../packages/tse/src/index';
import { parseZoneRegistry, normalizeZone } from '../../../../packages/tse/src/zones';
import { tseTransport } from '../../../../packages/tse/src/http';
import type { CollectJob } from '../../../../packages/tse/src/collector';
import type { Round, Territory } from '../../../../packages/domain/src/index';

type Source = { raw: string; url: string; capturedAt: string };
export type CollectionProfile = {
  intervalMs: number;
  maxInFlight: number;
  burst: number;
  auditMs: number;
  zonePollMs: number;
  ea14PollMs: number;
  ea15PollMs: number;
  aggregatePollMs: number;
  favoritePollMs: number;
};
/** Former 2 req/s planning profile; kept for tests and limited rehearsals. */
export const CONSERVATIVE_PROFILE: CollectionProfile = {
  intervalMs: 500,
  maxInFlight: 2,
  burst: 1,
  auditMs: 10_800_000,
  zonePollMs: 900_000,
  ea14PollMs: 30_000,
  ea15PollMs: 180_000,
  aggregatePollMs: 60_000,
  favoritePollMs: 120_000,
};
/**
 * Election-night profile for a start rate of 80 req/s (operator decision, 03/10/2026).
 * Steady demand while zones are pending ≈ 6292/120 + 56/20 + 28/30 + 1/10 + favorites ≈ 57 req/s,
 * leaving headroom for hints, backlog and retries. Due is eligibility, not a freshness guarantee.
 */
export const LIVE_PROFILE: CollectionProfile = {
  intervalMs: 1000 / 80,
  maxInFlight: 64,
  burst: 4,
  auditMs: 1_800_000,
  zonePollMs: 120_000,
  ea14PollMs: 10_000,
  ea15PollMs: 30_000,
  aggregatePollMs: 20_000,
  favoritePollMs: 30_000,
};
type Feed = {
  type: 'zone' | 'aggregate' | 'EA14' | 'EA15';
  context: PathContext;
  territory?: Territory;
};
/** Presidential collection of one round: national zones, aggregates and tracking hints. */
export class NationalCollection {
  readonly collector: PersistentCollector;
  readonly registry: ReturnType<typeof parseZoneRegistry>;
  readonly territories: Territory[];
  readonly feeds = new Map<string, Feed>();
  private readonly municipalZones = new Map<string, string[]>();
  private readonly hintTargets = new Map<string, string[]>();
  private watchSignature: string | null = null;
  readonly context: ReturnType<typeof discoverElection>;
  constructor(
    readonly store: Store,
    readonly environment: 'official' | 'simulated',
    readonly round: Round,
    config: Source,
    catalog: Source,
    readonly now = Date.now,
    readonly profile: CollectionProfile = CONSERVATIVE_PROFILE,
  ) {
    for (const source of [config, catalog]) {
      validateOrigin(source.url, environment);
      if (!Number.isFinite(Date.parse(source.capturedAt))) throw Error('Captura inválida');
    }
    const expected =
      environment === 'official'
        ? 'https://resultados.tse.jus.br/oficial/comum/config/ele-c.json'
        : 'https://resultados-sim.tse.jus.br/simulado/simulado2026/comum/config/ele-c.json';
    if (config.url !== expected) throw Error('Origem EA11 incompatível');
    this.context = discoverElection(JSON.parse(config.raw), environment, round);
    if (catalog.url !== resolveTsePath('EA12', this.context))
      throw Error('Origem EA12 incompatível');
    this.registry = parseZoneRegistry(JSON.parse(catalog.raw), environment);
    this.territories = parseCatalog(JSON.parse(catalog.raw), environment);
    const ufs = [...new Set(this.registry.segments.map((s) => s.uf))].sort();
    if (
      ufs.join(',') !==
      'ac,al,am,ap,ba,ce,df,es,go,ma,mg,ms,mt,pa,pb,pe,pi,pr,rj,rn,ro,rr,rs,sc,se,sp,to,zz'
    )
      throw Error('Cadastro nacional incompleto');
    const binding = digest([environment, round, this.context.electionId, this.registry.digest]);
    const bound = store.getState('national:binding');
    const other = store.db
      .prepare(
        'SELECT 1 FROM snapshot WHERE environment<>? UNION SELECT 1 FROM zone_registry WHERE environment<>? LIMIT 1',
      )
      .get(environment, environment);
    if (other || (bound && bound !== binding))
      throw Error(
        'Banco/eleição/cadastro incompatível; usar banco separado e revisar mudança cadastral',
      );
    store.db.transaction(() => {
      store.setState('national:binding', binding);
      for (const source of [config, catalog]) {
        store.db
          .prepare('INSERT OR IGNORE INTO raw_artifact VALUES(?,?)')
          .run(rawDigest(source.raw), gzipSync(source.raw));
        store.setState(
          `national:source:${rawDigest(source.raw)}`,
          JSON.stringify({ url: source.url, capturedAt: source.capturedAt }),
        );
      }
      const id = `${environment}:${round}:${this.registry.digest}`;
      store.db
        .prepare('INSERT OR IGNORE INTO zone_registry VALUES(?,?,?,?,?,?,?)')
        .run(
          id,
          environment,
          round,
          this.context.electionId,
          catalog.capturedAt,
          1,
          this.registry.digest,
        );
      const insert = store.db.prepare('INSERT OR IGNORE INTO zone_segment VALUES(?,?,?,?)');
      for (const s of this.registry.segments) insert.run(id, s.uf, s.municipality, s.zone);
    })();
    this.collector = new PersistentCollector(store, now, {
      intervalMs: profile.intervalMs,
      maxInFlight: profile.maxInFlight,
      burst: profile.burst,
      pollMs: profile.zonePollMs,
      auditMs: profile.auditMs,
    });
    const add = (feed: Feed, priority: number, pollMs: number) =>
      this.addFeed(feed, priority, pollMs);
    for (const s of this.registry.segments) {
      const key = add({ type: 'zone', context: { ...this.context, ...s } }, 0, profile.zonePollMs);
      const m = `${s.uf}:${s.municipality}`;
      this.municipalZones.set(m, [...(this.municipalZones.get(m) ?? []), key]);
    }
    add({ type: 'EA14', context: this.context }, 30, profile.ea14PollMs);
    for (const uf of ufs)
      add({ type: 'EA15', context: { ...this.context, uf } }, 30, profile.ea15PollMs);
    for (const territory of this.territories.filter((t) => t.kind !== 'municipality'))
      add(
        { type: 'aggregate', context: { ...this.context, uf: territory.id }, territory },
        40,
        profile.aggregatePollMs,
      );
    this.syncWatchlist();
    this.collector.save();
  }
  private addFeed(feed: Feed, priority: number, pollMs: number) {
    const type = feed.type === 'zone' || feed.type === 'aggregate' ? 'EA20' : feed.type;
    const url = resolveTsePath(type, feed.context);
    const key = `${this.environment}:${feed.context.electionId}:${feed.context.round}:${feed.type}:${feed.context.uf ?? 'br'}:${feed.context.municipality ?? ''}:${feed.context.zone ?? ''}`;
    const known = this.feeds.has(key);
    this.feeds.set(key, feed);
    this.collector.queue.add({
      key,
      url,
      kind: feed.type === 'zone' ? 'zone' : feed.type === 'aggregate' ? 'aggregate' : 'tracking',
      priority,
      pollMs,
      municipality: feed.context.municipality
        ? `${feed.context.uf}:${feed.context.municipality}`
        : undefined,
    });
    if (!known) {
      const routes: string[] = [];
      if (feed.type === 'EA15') routes.push(`EA14:${feed.context.uf}`);
      if (feed.type === 'aggregate') {
        if (feed.context.municipality)
          routes.push(`EA15:${feed.context.uf}:${feed.context.municipality}`);
        else routes.push(`EA14:${feed.context.uf}`, `EA15:${feed.context.uf}:${feed.context.uf}`);
      }
      for (const route of routes)
        this.hintTargets.set(route, [...(this.hintTargets.get(route) ?? []), key]);
    }
    return key;
  }
  /**
   * Municipal aggregates exist only for saved territories; zones are national regardless.
   * Safe to call while the collector runs (live mode re-reads the watchlist periodically).
   * Returns true when the plan changed.
   */
  syncWatchlist() {
    const enabled = this.store.watchlist(this.environment).filter((w) => w.enabled);
    const ids = new Set(enabled.map((w) => w.territoryId));
    const signature = [...ids].sort().join(',');
    if (signature === this.watchSignature) return false;
    this.watchSignature = signature;
    const added: string[] = [];
    for (const entry of enabled) {
      const territory = this.territories.find((t) => t.id === entry.territoryId);
      if (!territory || territory.kind !== 'municipality') continue;
      const key = this.addFeed(
        {
          type: 'aggregate',
          context: { ...this.context, uf: territory.uf!, municipality: territory.tseCode! },
          territory,
        },
        10,
        this.profile.favoritePollMs,
      );
      added.push(key);
    }
    this.collector.queue.setFavorites(ids);
    // A newly (re)saved territory starts now, not at its stored fallback cadence.
    for (const key of added) this.collector.queue.hint(key, this.now());
    return true;
  }
  private parse(raw: string, job: Readonly<CollectJob>, capturedAt: string) {
    const feed = this.feeds.get(job.key);
    if (
      !feed ||
      job.url !==
        resolveTsePath(
          feed.type === 'zone' || feed.type === 'aggregate' ? 'EA20' : feed.type,
          feed.context,
        )
    )
      throw Error('Job fora do plano validado');
    const body = JSON.parse(raw);
    if (feed.type === 'zone')
      return {
        feed,
        zone: normalizeZone(body, {
          ...feed.context,
          uf: feed.context.uf!,
          municipality: feed.context.municipality!,
          zone: feed.context.zone!,
          sourceUrl: job.url,
          capturedAt,
          registry: this.registry,
          raw,
        }),
      };
    if (feed.type === 'aggregate')
      return {
        feed,
        snapshot: normalizeEA20(body, {
          environment: this.environment,
          electionId: feed.context.electionId,
          round: feed.context.round,
          office: 'president',
          territory: feed.territory!,
          sourceUrl: job.url,
          capturedAt,
          raw,
        }),
      };
    const hints = parseTracking(
      body,
      this.environment,
      feed.context.electionId,
      feed.context.round,
      feed.type,
    );
    if (new Set(hints.map((h) => h.code)).size !== hints.length) throw Error('Tracking duplicado');
    if (
      hints.some((h) =>
        h.code.length === 5
          ? !this.municipalZones.has(`${feed.context.uf}:${h.code}`)
          : !this.territories.some((t) => t.id === h.code),
      )
    )
      throw Error('Tracking fora do cadastro');
    if (
      feed.type === 'EA15' &&
      hints.some((h) => h.code.length === 2 && h.code !== feed.context.uf)
    )
      throw Error('UF do tracking incompatível');
    return { feed, hints };
  }
  transport(fetcher?: typeof fetch) {
    return tseTransport({
      fetch: fetcher,
      validate: (raw, job) => {
        const parsed = this.parse(raw, job, new Date(this.now()).toISOString());
        return parsed.zone ? { complete: parsed.zone.status === 'complete' } : undefined;
      },
    });
  }
  readonly accept = (raw: string, job: Readonly<CollectJob>, capturedAt: string) => {
    const parsed = this.parse(raw, job, capturedAt),
      db = this.store.db;
    if (parsed.snapshot) this.store.insert(parsed.snapshot, raw);
    if (parsed.zone) {
      const z = parsed.zone,
        s = z.snapshot;
      db.prepare('INSERT OR IGNORE INTO raw_artifact VALUES(?,?)').run(s.rawDigest, gzipSync(raw));
      const last = db
        .prepare(
          'SELECT source_digest FROM zone_result WHERE environment=? AND election=? AND uf=? AND municipality=? AND zone=? ORDER BY captured_at DESC LIMIT 1',
        )
        .get(
          this.environment,
          s.electionId,
          z.segment.uf,
          z.segment.municipality,
          z.segment.zone,
        ) as { source_digest: string } | undefined;
      if (last?.source_digest !== s.rawDigest) {
        const id = digest([job.key, capturedAt, s.rawDigest]);
        db.prepare('INSERT INTO zone_result VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
          id,
          this.environment,
          s.electionId,
          s.round,
          z.segment.uf,
          z.segment.municipality,
          z.segment.zone,
          capturedAt,
          job.url,
          s.rawDigest,
          z.status,
          s.sections.total,
          s.sections.totalized,
          s.sections.total - s.sections.totalized,
          z.counts.electorate,
          z.counts.turnout,
          z.counts.valid,
          z.counts.blank,
          z.counts.null,
          z.counts.annulled,
        );
        const vote = db.prepare('INSERT INTO zone_candidate_vote VALUES(?,?,?)');
        for (const c of z.validCandidates) vote.run(id, c.id, c.votes);
      }
    }
    if (parsed.hints)
      for (const h of parsed.hints) {
        const key = `hint:${job.key}:${h.code}`;
        const previous = this.store.getState(key);
        if (previous === h.changeHint) continue;
        this.store.setState(key, h.changeHint);
        if (parsed.feed.type === 'EA15')
          for (const target of this.municipalZones.get(`${parsed.feed.context.uf}:${h.code}`) ?? [])
            this.collector.queue.hint(target, this.now());
        const route =
          parsed.feed.type === 'EA14'
            ? `EA14:${h.code}`
            : `EA15:${parsed.feed.context.uf}:${h.code}`;
        for (const target of this.hintTargets.get(route) ?? []) {
          // First index observation is not evidence of a change since an already captured result.
          // Keep its regular fallback; actual later hint changes still expedite corrections.
          if (
            previous === undefined &&
            this.collector.queue.jobs.get(target)?.lastSuccess !== undefined
          )
            continue;
          this.collector.queue.hint(target, this.now());
        }
      }
  };
  run(
    signal: AbortSignal,
    fetcher?: typeof fetch,
    rate?: Parameters<PersistentCollector['run']>[3],
    onResult?: Parameters<PersistentCollector['run']>[4],
  ) {
    return this.collector.run(this.transport(fetcher), signal, this.accept, rate, onResult);
  }
  status() {
    const latest = `WITH latest AS (SELECT *, ROW_NUMBER() OVER(PARTITION BY uf,municipality,zone ORDER BY captured_at DESC) rn FROM zone_result WHERE environment=? AND election=?), coverage AS (SELECT s.uf,s.zone,COUNT(*) expected,SUM(CASE WHEN r.status='complete' THEN 1 ELSE 0 END) complete,COUNT(r.id) observed FROM zone_segment s LEFT JOIN latest r ON r.uf=s.uf AND r.municipality=s.municipality AND r.zone=s.zone AND r.rn=1 WHERE s.registry_id=? GROUP BY s.uf,s.zone)`;
    const coverage = this.store.db
      .prepare(
        `${latest} SELECT COALESCE(SUM(observed),0) observedSegments,COALESCE(SUM(complete),0) completeSegments,COALESCE(SUM(CASE WHEN expected=complete THEN 1 ELSE 0 END),0) completeZones FROM coverage`,
      )
      .get(
        this.environment,
        this.context.electionId,
        `${this.environment}:${this.round}:${this.registry.digest}`,
      ) as { observedSegments: number; completeSegments: number; completeZones: number };
    return {
      environment: this.environment,
      expectedSegments: this.registry.segments.length,
      expectedZones: new Set(this.registry.segments.map((s) => `${s.uf}:${s.zone}`)).size,
      jobs: this.collector.queue.jobs.size,
      stats: { ...this.collector.queue.stats },
      registryDigest: this.registry.digest,
      ...coverage,
    };
  }
}
