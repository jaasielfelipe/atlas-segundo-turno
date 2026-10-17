import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * Map geometry for the telão, from committed fixtures only (no network, no collection):
 * IBGE municipal meshes keyed by the TSE id `uf:00000` (via the official 2nd-round EA12 `cdi`)
 * and the UF outlines. Written to apps/web/public/geo/ (generated, not committed).
 *   pnpm geo
 */
const out = 'apps/web/public/geo';
mkdirSync(out, { recursive: true });
const catalog = JSON.parse(readFileSync('packages/fixtures/round2/ea12.json', 'utf8'));
const byIbge = new Map<string, { id: string; uf: string; name: string }>();
const all: { id: string; name: string }[] = [];
for (const uf of catalog.abr)
  for (const m of uf.mu) {
    all.push({ id: `${uf.cd}:${m.cd}`, name: m.nm });
    if (m.cdi) byIbge.set(m.cdi, { id: `${uf.cd}:${m.cd}`, uf: uf.cd, name: m.nm });
  }
const features: unknown[] = [];
const mapped = new Set<string>();
for (const file of readdirSync('packages/fixtures/maps').filter((f) =>
  f.endsWith('-municipalities.geojson'),
)) {
  const g = JSON.parse(readFileSync(`packages/fixtures/maps/${file}`, 'utf8'));
  for (const f of g.features) {
    const m = byIbge.get(f.properties.codarea);
    if (!m) throw Error(`Município IBGE sem correspondência TSE: ${f.properties.codarea}`);
    mapped.add(m.id);
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
const missing = all.filter((m) => !m.id.startsWith('zz:') && !mapped.has(m.id));
console.log(
  `${features.length} municípios com geometria · sem geometria: ${missing.map((m) => `${m.id} ${m.name}`).join(', ') || 'nenhum'}`,
);
