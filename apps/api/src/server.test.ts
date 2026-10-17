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

/**
 * Real pre-count files of the official 2nd round with SYNTHETIC counts filled in (no real 2nd-round
 * count exists before 25/10): the path with votes, from ingestion to the telão API.
 */
type Ea20 = {
  dg: string;
  hg: string;
  s: Record<string, string>;
  e: Record<string, string>;
  v: Record<string, string>;
  carg: { agr: { par: { cand: { sqcand: string; vap: string; dvt?: string }[] }[] }[] }[];
};
function counted(
  file: string,
  s: Record<string, string>,
  e: Record<string, string>,
  v: Record<string, string>,
  votes: Record<string, number>,
  destination: Record<string, string> = {},
) {
  const j = JSON.parse(read(file)) as Ea20;
  j.dg = '25/10/2026';
  j.hg = '18:30:00';
  Object.assign(j.s, s);
  Object.assign(j.e, e);
  Object.assign(j.v, v);
  for (const c of j.carg[0].agr.flatMap((a) => a.par.flatMap((p) => p.cand))) {
    c.vap = String(votes[c.sqcand]);
    c.dvt = destination[c.sqcand] ?? 'Válido';
  }
  return JSON.stringify(j);
}
const FLAVIO = '280002551544',
  LULA = '280002542548';

it('API do telão com votos (contagens sintéticas em arquivos reais do 2º turno)', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'atlas-telao-'));
  const livePath = join(folder, 'collection.sqlite');
  const store = new Store(livePath);
  const observations = JSON.parse(read('round2/observation.json'));
  const at = (file: string) => observations.find((o: { file: string }) => o.file === file);
  const ea12 = at('round2/ea12.json');
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
  const job = (file: string) =>
    [...collection.collector.queue.jobs.values()].find((j) => j.url === at(file).url)!;
  const ZONE = 'round2/ea20-president-ac01120-z0008.json',
    BR = 'round2/ea20-president-br.json';
  // Zone fully counted: 45 sections, 10 208 registered, 8 000 voted, 7 600 valid.
  const zone = (destination?: Record<string, string>) =>
    counted(
      ZONE,
      { st: '45', snt: '0', si: '45', sni: '0' },
      { est: '10208', esnt: '0', esi: '10208', c: '8000', a: '2208' },
      { tv: '8000', vvc: '7600', vv: '7600', vb: '150', tvn: '250', vn: '250' },
      { [FLAVIO]: 4000, [LULA]: 3600 },
      destination,
    );
  // Brazil, partial: 423 registered voters in sections not installed (est − esi), as in the
  // exterior of the 1st round; they count as absent for the largest valid total still possible.
  const br = (destination?: Record<string, string>) =>
    counted(
      BR,
      { st: '1000', snt: '498248', si: '1000', sni: '0' },
      { est: '300000', esnt: '158445502', esi: '299577', c: '240000', a: '59577' },
      { tv: '240000', vvc: '230000', vv: '230000', vb: '4000', tvn: '6000', vn: '6000' },
      { [FLAVIO]: 120000, [LULA]: 110000 },
      destination,
    );
  collection.accept(zone(), job(ZONE), '2026-10-25T21:30:05.000Z');
  collection.accept(br(), job(BR), '2026-10-25T21:30:06.000Z');
  // Newer versions without Lula's destination: the finalists no longer add up to the valid.
  collection.accept(zone({ [LULA]: '' }), job(ZONE), '2026-10-25T21:31:05.000Z');
  collection.accept(br({ [LULA]: '' }), job(BR), '2026-10-25T21:31:06.000Z');
  store.close();
  const app = await createServer({
    livePath,
    baselinePath: join(folder, 'missing.sqlite'),
    web: join(folder, 'no-web'),
  });
  try {
    const boot = (await app.inject('/api/telao/bootstrap')).json();
    const i = boot.municipalities.findIndex(([id]: [string]) => id === 'ac:01120');
    const s = boot.segments.findIndex(([m, z]: [number, string]) => m === i && z === '0008');
    const page = (await app.inject('/api/telao/events')).json();
    // Only the consistent version: counted electorate, turnout and turnout − valid travel along.
    expect(page.events).toEqual([[expect.any(Number), s, 45, 7600, 4000, 3600, 10208, 8000, 400]]);
    expect(page.more).toBe(false);
    const official = (await app.inject('/api/telao/official')).json();
    // The newer inconsistent Brazil file is not drawn; the last consistent one stays.
    expect(official.br).toMatchObject({
      totalized: 1000,
      electorate: 158745502,
      abstention: 60000, // counted electorate − turnout, including sections not installed
      notValid: 10000,
      valid: 230000,
      flavio: 120000,
      lula: 110000,
    });
    expect((await app.inject('/api/telao/status')).json()).toMatchObject({ inconsistent: 2 });
  } finally {
    await app.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
