import Database from 'better-sqlite3';
import { gunzipSync } from 'node:zlib';
import { tseTimestamp } from '../packages/domain/src/index';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * Development data for the map/feed prototype (not committed, regenerable):
 *  - apps/web/public/dev/municipios.geojson: IBGE municipal meshes keyed by TSE id `uf:00000`;
 *  - apps/web/public/dev/replay-round1.json: every município–zona version of the official 1st
 *    round night (04–05/10/2026) from the previous project's database, read only.
 * The replay is real 1st-round data used to see motion; it is never shown as the 2nd round.
 *   pnpm prototype:data [caminho/para/collection.sqlite]
 */
const source = process.argv[2] ?? '../ele2026/data/official/collection.sqlite';
const out = 'apps/web/public/dev';
mkdirSync(out, { recursive: true });
const finalists = JSON.parse(readFileSync('packages/fixtures/round2/finalists.json', 'utf8'));
const catalog = JSON.parse(readFileSync('packages/fixtures/zonal/official-ea12.json', 'utf8'));

// TSE municipality id ↔ IBGE code (EA12 `cdi`), name; exterior has no geometry.
const municipalities: { id: string; uf: string; ibge: string; name: string }[] = [];
for (const uf of catalog.abr)
  for (const m of uf.mu)
    municipalities.push({ id: `${uf.cd}:${m.cd}`, uf: uf.cd, ibge: m.cdi, name: m.nm });
const byIbge = new Map(municipalities.filter((m) => m.ibge).map((m) => [m.ibge, m]));

const features = [];
for (const file of readdirSync('packages/fixtures/maps').filter((f) =>
  f.endsWith('-municipalities.geojson'),
)) {
  const g = JSON.parse(readFileSync(`packages/fixtures/maps/${file}`, 'utf8'));
  for (const f of g.features) {
    const m = byIbge.get(f.properties.codarea);
    if (!m) throw Error(`Município IBGE sem correspondência TSE: ${f.properties.codarea}`);
    features.push({
      type: 'Feature',
      id: features.length,
      properties: { id: m.id, uf: m.uf, name: m.name },
      geometry: f.geometry,
    });
  }
}
writeFileSync(`${out}/municipios.geojson`, JSON.stringify({ type: 'FeatureCollection', features }));
writeFileSync(`${out}/ufs.geojson`, readFileSync('packages/fixtures/maps/br-ufs.geojson'));
const mapped = new Set(features.map((f) => f.properties.id));
const missing = municipalities.filter((m) => m.uf !== 'zz' && !mapped.has(m.id));

const db = new Database(source, { readonly: true, fileMustExist: true });
const rows = db
  .prepare(
    `SELECT r.id, r.uf, r.municipality, r.zone, r.captured_at, r.total, r.totalized, r.valid, r.source_digest,
       (SELECT votes FROM zone_candidate_vote v WHERE v.result_id=r.id AND v.candidate_id=?) flavio,
       (SELECT votes FROM zone_candidate_vote v WHERE v.result_id=r.id AND v.candidate_id=?) lula
     FROM zone_result r WHERE r.environment='official' ORDER BY r.captured_at`,
  )
  .all(finalists.flavio.id, finalists.lula.id) as {
  uf: string;
  municipality: string;
  zone: string;
  captured_at: string;
  source_digest: string;
  generated?: string;
  counts?: { te: number; est: number; c: number; notValid: number };
  total: number;
  totalized: number;
  valid: number | null;
  flavio: number | null;
  lula: number | null;
}[];
// Replay time = generation time written by the TSE in each file (dg/hg), not our capture time:
// after the collector resumed at 19:20 it swept the queue UF by UF, which is not how the TSE
// published. Capture time stays the tiebreak; a segment's versions never go back in time.
const body = db.prepare('SELECT compressed FROM collector_body WHERE digest=?');
const lastBySegment = new Map<string, string>();
for (const r of rows) {
  const j = JSON.parse(
    gunzipSync((body.get(r.source_digest) as { compressed: Buffer }).compressed).toString('utf8'),
  );
  const key = `${r.uf}:${r.municipality}:${r.zone}`;
  const generated = tseTimestamp(j.dg, j.hg);
  const previous = lastBySegment.get(key);
  r.generated = previous && previous > generated ? previous : generated;
  // Electorate (all / of counted sections), turnout and turnout − valid, for the race target.
  r.counts = {
    te: Number(j.e.te),
    est: Number(j.e.est),
    c: Number(j.e.c),
    notValid: Number(j.v.tv) - Number(j.v.vv),
  };
  lastBySegment.set(key, r.generated);
}
rows.sort(
  (a, b) => a.generated!.localeCompare(b.generated!) || a.captured_at.localeCompare(b.captured_at),
);
db.close();
const index = new Map(municipalities.map((m, i) => [m.id, i]));
const segments: [number, string, number, number][] = [];
const segmentIndex = new Map<string, number>();
const base = Date.parse(rows[0].generated!);
// [seconds since base, segment, sections totalized, valid, flavio, lula, electorate of counted
// sections, turnout, turnout − valid]; null when unpublished.
const events: (number | null)[][] = [];
for (const r of rows) {
  const key = `${r.uf}:${r.municipality}:${r.zone}`;
  let s = segmentIndex.get(key);
  if (s === undefined) {
    s = segments.length;
    segmentIndex.set(key, s);
    segments.push([index.get(`${r.uf}:${r.municipality}`)!, r.zone, r.total, r.counts!.te]);
  }
  events.push([
    Math.round((Date.parse(r.generated!) - base) / 1000),
    s,
    r.totalized,
    r.valid,
    r.flavio,
    r.lula,
    r.counts!.est,
    r.counts!.c,
    r.counts!.notValid,
  ]);
}
writeFileSync(
  `${out}/replay-round1.json`,
  JSON.stringify({
    label: 'Replay do 1º turno (oficial TSE, 04–05/10/2026) — dados reais, horário de geração TSE',
    base: new Date(base).toISOString(),
    municipalities: municipalities.map((m) => [m.id, m.name]),
    segments,
    events,
  }),
);
console.log(
  `${features.length} geometrias · sem geometria: ${missing.map((m) => `${m.id} ${m.name}`).join(', ') || 'nenhum'} · ` +
    `${segments.length} segmentos · ${events.length} versões`,
);
