import { readFileSync, writeFileSync } from 'node:fs';
import { Store } from '../apps/api/src/db/store';
import { ZoneStore } from '../apps/api/src/db/zones';
import { baselineReport, refreshBaseline } from '../apps/api/src/services/baseline';

/**
 * One-off: re-fetches (≤ 2 req/s) the official 1st-round zone files of baseline segments that were
 * not complete when the night's collector stopped, and appends their current versions.
 *   pnpm baseline:refresh
 */
const store = new Store('data/baseline/round1.sqlite');
try {
  const outcome = await refreshBaseline(store);
  const finalists = JSON.parse(readFileSync('packages/fixtures/round2/finalists.json', 'utf8'));
  const evidence = JSON.parse(readFileSync('docs/evidence/baseline-round1.json', 'utf8'));
  const data = new ZoneStore(store).load('official', '1', new Date().toISOString())!;
  // Latest version per segment only (what the comparison uses).
  const latest = new Map(data.results.map((r) => [`${r.uf}:${r.municipality}:${r.zone}`, r]));
  const report = baselineReport(
    { ...data, results: [...latest.values()] },
    evidence.national && {
      capturedAt: evidence.national.capturedAt,
      sourceGeneratedAt: evidence.national.sourceGeneratedAt,
      sections: { total: 0, totalized: evidence.national.sections },
      electorate: { total: evidence.national.electorate, turnout: evidence.national.turnout },
      votes: {
        valid: evidence.national.valid,
        blank: evidence.national.blank,
        null: evidence.national.null,
      },
      candidates: [
        { id: finalists.flavio.id, number: '22', countedVotes: evidence.national.flavio },
        { id: finalists.lula.id, number: '13', countedVotes: evidence.national.lula },
      ],
    },
    { flavio: finalists.flavio.id, lula: finalists.lula.id },
  );
  evidence.refresh = { at: new Date().toISOString(), requests: outcome.length, outcome, ...report };
  writeFileSync('docs/evidence/baseline-round1.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, outcome: undefined }, null, 2));
  console.log(
    outcome.reduce<Record<string, number>>((t, o) => {
      const k = `${o.before}→${o.after}`;
      t[k] = (t[k] ?? 0) + 1;
      return t;
    }, {}),
  );
} finally {
  store.close();
}
