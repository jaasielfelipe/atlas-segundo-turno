import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './db/store';
import { NationalCollection } from './services/national';
import { cacheBootstrapCatalog } from './services/test-helpers';
import { createServer } from './server';

const read = (p: string) => readFileSync(`packages/fixtures/${p}`, 'utf8');

it('API do telão: cadastro do 2º turno, boletins incrementais e agregado oficial', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'atlas-telao-'));
  const livePath = join(folder, 'collection.sqlite');
  const store = new Store(livePath);
  const observations = JSON.parse(read('round2/observation.json'));
  const at = (file: string) => observations.find((o: { file: string }) => o.file === file);
  const ea12 = at('round2/ea12.json');
  // Real pre-count captures of the official 2nd round, through the real ingestion path.
  const collection = new NationalCollection(
    store,
    'official',
    '2',
    {
      raw: read('round2/ea11.json'),
      url: 'https://resultados.tse.jus.br/oficial/comum/config/ele-c.json',
      capturedAt: ea12.capturedAt,
    },
    { raw: read('round2/ea12.json'), url: ea12.url, capturedAt: ea12.capturedAt },
  );
  cacheBootstrapCatalog(store, ea12.url, read('round2/ea12.json'), ea12.capturedAt);
  for (const file of [
    'round2/ea20-president-ac01120-z0008.json',
    'round2/ea20-president-br.json',
  ]) {
    const o = at(file);
    const job = [...collection.collector.queue.jobs.values()].find((j) => j.url === o.url)!;
    collection.accept(read(file), job, o.capturedAt);
  }
  store.close();
  const app = await createServer({
    livePath,
    baselinePath: join(folder, 'missing.sqlite'),
    web: join(folder, 'no-web'),
  });
  try {
    const boot = (await app.inject('/api/telao/bootstrap')).json();
    expect(boot).toMatchObject({ environment: 'official', round: '2', election: '6258' });
    expect(boot.segments).toHaveLength(6292);
    expect(boot.baseline).toBeNull(); // no 1st-round baseline in this test
    const i = boot.municipalities.findIndex(([id]: [string]) => id === 'ac:01120');
    expect(boot.municipalities[i][1]).toBe('ACRELÂNDIA');
    const s = boot.segments.findIndex(([m, zone]: [number, string]) => m === i && zone === '0008');
    expect(boot.segments[s][2]).toBe(45); // sections from the 2nd-round capture
    const first = (await app.inject('/api/telao/events')).json();
    expect(first.events).toEqual([[expect.any(Number), s, 0, 0, 0, 0, 0, 0, 0]]);
    expect(first.version).toBe(boot.version);
    // Incremental: nothing after the last rowid.
    expect((await app.inject(`/api/telao/events?after=${first.last}`)).json().events).toEqual([]);
    const official = (await app.inject('/api/telao/official')).json();
    expect(official.br).toMatchObject({ sections: 499248, totalized: 0, flavio: 0, lula: 0 });
    expect((await app.inject('/api/telao/status')).json()).toMatchObject({ collecting: false });
    expect((await app.inject('/api/telao/events?after=-1')).statusCode).toBe(500);
  } finally {
    await app.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

it('sem acervo do 2º turno: 503 explícito, nunca dados de outro turno', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'atlas-telao-'));
  const app = await createServer({
    livePath: join(folder, 'none.sqlite'),
    baselinePath: join(folder, 'none-baseline.sqlite'),
    web: join(folder, 'no-web'),
  });
  try {
    expect((await app.inject('/api/telao/bootstrap')).statusCode).toBe(503);
    expect((await app.inject('/api/telao/official')).statusCode).toBe(503);
  } finally {
    await app.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
