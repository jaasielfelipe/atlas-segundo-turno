import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Store } from '../apps/api/src/db/store';
import { baselineReport, buildBaseline } from '../apps/api/src/services/baseline';

/**
 * Builds the frozen 1st-round baseline (data/baseline/round1.sqlite) from the official collection
 * database of 04/10/2026, read only, without network:
 *   pnpm baseline:round1 [caminho/para/collection.sqlite]
 * Writes the reconciliation report to docs/evidence/baseline-round1.json.
 */
const source = process.argv[2] ?? '../ele2026/data/official/collection.sqlite';
const target = 'data/baseline/round1.sqlite';
if (existsSync(target)) throw Error(`${target} já existe; a base é imutável (apague para refazer)`);
mkdirSync('data/baseline', { recursive: true });
const finalists = JSON.parse(readFileSync('packages/fixtures/round2/finalists.json', 'utf8'));
const store = new Store(target);
try {
  const started = Date.now();
  const { data, national } = buildBaseline(source, store);
  const report = {
    builtAt: new Date().toISOString(),
    seconds: (Date.now() - started) / 1000,
    registryDigest: data.registryDigest,
    election: data.election,
    ...baselineReport(data, national, { flavio: finalists.flavio.id, lula: finalists.lula.id }),
  };
  mkdirSync('docs/evidence', { recursive: true });
  writeFileSync('docs/evidence/baseline-round1.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  store.close();
}
