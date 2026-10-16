import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { Store } from '../db/store';
import { ZoneStore } from '../db/zones';
import {
  digest,
  discoverElection,
  rawDigest,
  resolveTsePath,
  type PathContext,
} from '../../../../packages/tse/src/index';
import { normalizeZone, parseZoneRegistry, segmentKey } from '../../../../packages/tse/src/zones';
import type { RoundData, ZoneResult } from '../../../../packages/domain/src/zones';

/**
 * Frozen 1st-round baseline from the official collection database of 04/10/2026 (previous
 * project, read only): the latest captured version of every município–zona segment, its raw
 * TSE body verified by SHA-256 and re-validated by the current normalizer. Nothing is fetched.
 */
export function buildBaseline(sourcePath: string, target: Store, root = process.cwd()) {
  const json = (file: string) => JSON.parse(readFileSync(resolve(root, file), 'utf8'));
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    if (
      source
        .prepare(
          "SELECT 1 FROM zone_registry WHERE environment<>'official' UNION SELECT 1 FROM zone_result WHERE environment<>'official' OR round<>'1' LIMIT 1",
        )
        .get()
    )
      throw Error('Acervo de origem não é o oficial do 1º turno');
    const registries = source
      .prepare("SELECT id, digest, captured_at FROM zone_registry WHERE environment='official'")
      .all() as { id: string; digest: string; captured_at: string }[];
    if (registries.length !== 1) throw Error('Acervo de origem com cadastro ambíguo');
    const registry = registries[0];
    const segments = source
      .prepare(
        'SELECT uf, municipality, zone FROM zone_segment WHERE registry_id=? ORDER BY uf, municipality, zone',
      )
      .all(registry.id) as RoundData['segments'];
    // The registry captured that night must be the official 1st-round EA12 kept as fixture.
    const fixtureRegistry = parseZoneRegistry(
      json('packages/fixtures/zonal/official-ea12.json'),
      'official',
    );
    const keys = (list: { uf: string; municipality: string; zone: string }[]) =>
      list.map(segmentKey).sort().join(',');
    if (keys(segments) !== keys(fixtureRegistry.segments))
      throw Error('Cadastro do acervo difere do EA12 oficial do 1º turno');
    const context: PathContext = discoverElection(
      json('packages/fixtures/official/ea11.json'),
      'official',
      '1',
    );
    const rows = source
      .prepare(
        `SELECT uf, municipality, zone, captured_at, source_url, source_digest, election FROM (
           SELECT *, ROW_NUMBER() OVER (PARTITION BY uf, municipality, zone ORDER BY captured_at DESC) rn
           FROM zone_result WHERE environment='official') WHERE rn=1 ORDER BY uf, municipality, zone`,
      )
      .all() as {
      uf: string;
      municipality: string;
      zone: string;
      captured_at: string;
      source_url: string;
      source_digest: string;
      election: string;
    }[];
    const body = source.prepare('SELECT compressed FROM collector_body WHERE digest=?');
    const bodies = new Map<string, string>();
    const results: ZoneResult[] = rows.map((r) => {
      if (r.election !== context.electionId) throw Error('Eleição incompatível no acervo');
      const stored = body.get(r.source_digest) as { compressed: Buffer } | undefined;
      if (!stored) throw Error(`Corpo ausente: ${r.source_digest}`);
      const raw = gunzipSync(stored.compressed).toString('utf8');
      if (rawDigest(raw) !== r.source_digest) throw Error(`Hash divergente: ${r.source_digest}`);
      bodies.set(r.source_digest, raw);
      const z = normalizeZone(JSON.parse(raw), {
        ...context,
        uf: r.uf,
        municipality: r.municipality,
        zone: r.zone,
        sourceUrl: r.source_url,
        capturedAt: r.captured_at,
        registry: fixtureRegistry,
        raw,
      });
      return {
        ...z.segment,
        id: digest(['baseline', segmentKey(z.segment), r.captured_at, r.source_digest]),
        environment: 'official',
        election: context.electionId,
        round: '1',
        capturedAt: r.captured_at,
        sourceUrl: r.source_url,
        sourceDigest: r.source_digest,
        status: z.status,
        total: z.snapshot.sections.total,
        totalized: z.snapshot.sections.totalized,
        notTotalized: z.snapshot.sections.total - z.snapshot.sections.totalized,
        counts: z.counts,
        candidates: z.validCandidates,
      };
    });
    const data: RoundData = {
      environment: 'official',
      round: '1',
      election: context.electionId,
      registryDigest: registry.digest,
      segments,
      results,
    };
    target.db.transaction(() => {
      const artifact = target.db.prepare('INSERT OR IGNORE INTO raw_artifact VALUES(?, ?)');
      for (const [hash, raw] of bodies) artifact.run(hash, gzipSync(raw));
      new ZoneStore(target).insert(data, registry.captured_at);
    })();
    // National aggregate published by the TSE at the end of the night, for reconciliation.
    const national = source
      .prepare(
        "SELECT payload FROM snapshot WHERE environment='official' AND office='president' AND territory_id='br' ORDER BY captured_at DESC LIMIT 1",
      )
      .get() as { payload: string } | undefined;
    return { data, national: national ? JSON.parse(national.payload) : null };
  } finally {
    source.close();
  }
}

/** Sums of the baseline segments by status, compared with the national aggregate. */
export function baselineReport(
  data: RoundData,
  national: {
    capturedAt: string;
    sourceGeneratedAt: string;
    sections: { total: number; totalized: number };
    electorate: { total: number; turnout: number };
    votes: { valid: number | null; blank: number | null; null: number | null };
    candidates: { id: string; number: string; countedVotes: number | null }[];
  } | null,
  finalists: { flavio: string; lula: string },
) {
  const byStatus = (s: string) => data.results.filter((r) => r.status === s);
  const sum = (rows: ZoneResult[]) => ({
    sections: rows.reduce((n, r) => n + r.totalized, 0),
    electorate: rows.reduce((n, r) => n + (r.counts.electorate ?? 0), 0),
    turnout: rows.reduce((n, r) => n + (r.counts.turnout ?? 0), 0),
    valid: rows.reduce((n, r) => n + (r.counts.valid ?? 0), 0),
    blank: rows.reduce((n, r) => n + (r.counts.blank ?? 0), 0),
    null: rows.reduce((n, r) => n + (r.counts.null ?? 0), 0),
    flavio: rows.reduce(
      (n, r) => n + (r.candidates.find((c) => c.id === finalists.flavio)?.votes ?? 0),
      0,
    ),
    lula: rows.reduce(
      (n, r) => n + (r.candidates.find((c) => c.id === finalists.lula)?.votes ?? 0),
      0,
    ),
  });
  const all = sum(data.results);
  const tse = national && {
    capturedAt: national.capturedAt,
    sourceGeneratedAt: national.sourceGeneratedAt,
    sections: national.sections.totalized,
    electorate: national.electorate.total,
    turnout: national.electorate.turnout,
    valid: national.votes.valid,
    blank: national.votes.blank,
    null: national.votes.null,
    flavio: national.candidates.find((c) => c.id === finalists.flavio)?.countedVotes ?? null,
    lula: national.candidates.find((c) => c.id === finalists.lula)?.countedVotes ?? null,
  };
  return {
    segments: {
      registry: data.segments.length,
      captured: data.results.length,
      complete: byStatus('complete').length,
      partial: byStatus('partial').length,
      needsReview: byStatus('needs_review').length,
    },
    sums: { allCaptured: all, complete: sum(byStatus('complete')) },
    national: tse,
    /** Sum of every captured segment minus the national aggregate (0 = reconciled). */
    difference: tse
      ? Object.fromEntries(
          (Object.keys(all) as (keyof typeof all)[]).map((k) => [
            k,
            tse[k] === null ? null : all[k] - (tse[k] as number),
          ]),
        )
      : null,
  };
}

/**
 * Adds a new version for every baseline segment that is not complete, fetched now from the
 * official 1st-round EA20 (sequential, ≥500 ms apart). Older versions stay untouched; the
 * fetched body is validated exactly like a live capture before it is stored.
 */
export async function refreshBaseline(
  store: Store,
  fetcher: typeof fetch = fetch,
  root = process.cwd(),
  spacingMs = 500,
) {
  const json = (file: string) => JSON.parse(readFileSync(resolve(root, file), 'utf8'));
  const context = discoverElection(json('packages/fixtures/official/ea11.json'), 'official', '1');
  const registry = parseZoneRegistry(
    json('packages/fixtures/zonal/official-ea12.json'),
    'official',
  );
  const zones = new ZoneStore(store);
  const current = zones.load('official', '1', new Date().toISOString());
  if (!current) throw Error('Base do 1º turno ausente');
  const latest = new Map<string, ZoneResult>();
  for (const r of current.results) latest.set(segmentKey(r), r);
  const pending = [...latest.values()].filter((r) => r.status !== 'complete');
  const outcome: { segment: string; before: string; after: string; changed: boolean }[] = [];
  for (const r of pending) {
    const url = resolveTsePath('EA20', {
      ...context,
      uf: r.uf,
      municipality: r.municipality,
      zone: r.zone,
    });
    if (url !== r.sourceUrl) throw Error('URL divergente da base');
    const response = await fetcher(url, { headers: { accept: 'application/json' } });
    if (response.status !== 200) throw Error(`HTTP ${response.status} em ${url}`);
    const raw = await response.text();
    const capturedAt = new Date().toISOString();
    const hash = rawDigest(raw);
    const z = normalizeZone(JSON.parse(raw), {
      ...context,
      uf: r.uf,
      municipality: r.municipality,
      zone: r.zone,
      sourceUrl: url,
      capturedAt,
      registry,
      raw,
    });
    const changed = hash !== r.sourceDigest;
    if (changed)
      store.db.transaction(() => {
        store.db
          .prepare('INSERT OR IGNORE INTO raw_artifact VALUES(?, ?)')
          .run(hash, gzipSync(raw));
        zones.insert(
          {
            ...current,
            results: [
              {
                ...z.segment,
                id: digest(['baseline', segmentKey(z.segment), capturedAt, hash]),
                environment: 'official',
                election: context.electionId,
                round: '1',
                capturedAt,
                sourceUrl: url,
                sourceDigest: hash,
                status: z.status,
                total: z.snapshot.sections.total,
                totalized: z.snapshot.sections.totalized,
                notTotalized: z.snapshot.sections.total - z.snapshot.sections.totalized,
                counts: z.counts,
                candidates: z.validCandidates,
              },
            ],
          },
          current.results[0]?.capturedAt ?? capturedAt,
        );
      })();
    outcome.push({ segment: segmentKey(r), before: r.status, after: z.status, changed });
    await new Promise((done) => setTimeout(done, spacingMs));
  }
  return outcome;
}
