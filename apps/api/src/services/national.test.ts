import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Store } from '../db/store';
import { NationalCollection } from './national';
import { discoverElection, resolveTsePath } from '../../../../packages/tse/src/index';
const raw = (file: string) => readFileSync(`packages/fixtures/${file}`, 'utf8');
const context = discoverElection(JSON.parse(raw('simulado/ea11.json')), 'simulated', '1');
const config = {
  raw: raw('simulado/ea11.json'),
  url: 'https://resultados-sim.tse.jus.br/simulado/simulado2026/comum/config/ele-c.json',
  capturedAt: '2026-10-03T18:00:00.000Z',
};
const catalog = {
  raw: raw('simulado/ea12.json'),
  url: resolveTsePath('EA12', context),
  capturedAt: config.capturedAt,
};
it('registra universo nacional, prioriza favoritos sem excluir zonas e rejeita mistura de ambiente', () => {
  const db = new Store(':memory:');
  try {
    db.setWatch('simulated', 'ac:01120', true);
    const n = new NationalCollection(db, 'simulated', '1', config, catalog);
    expect(n.status()).toMatchObject({
      expectedSegments: 6289,
      expectedZones: 2639,
    });
    expect([...n.feeds.values()].filter((f) => f.type === 'zone')).toHaveLength(6289);
    expect([...n.feeds.values()].filter((f) => f.type === 'aggregate')).toHaveLength(30);
    expect(
      [...n.collector.queue.jobs.values()].find(
        (j) => j.kind === 'zone' && j.municipality === 'ac:01120',
      )?.priority,
    ).toBe(20);
    db.setWatch('simulated', 'ac:01120', false);
    const restarted = new NationalCollection(db, 'simulated', '1', config, catalog);
    expect(
      [...restarted.collector.queue.jobs.values()].filter((j) => j.kind === 'zone' && !j.suspended),
    ).toHaveLength(6289);
    expect(
      [...restarted.collector.queue.jobs.values()].filter(
        (j) => j.kind === 'aggregate' && j.municipality && !j.suspended,
      ),
    ).toHaveLength(0);
    expect(() => new NationalCollection(db, 'official', '1', config, catalog)).toThrow();
  } finally {
    db.close();
  }
});
it('ingere captura real zonal atomicamente, deduplica e preserva retificação A→B→A', async () => {
  const db = new Store(':memory:');
  let now = Date.parse(config.capturedAt) + 1000;
  try {
    const n = new NationalCollection(db, 'simulated', '1', config, catalog, () => now);
    const key = [...n.feeds].find(
      ([, f]) =>
        f.type === 'zone' &&
        f.context.uf === 'ac' &&
        f.context.municipality === '01120' &&
        f.context.zone === '0008',
    )![0];
    // Isolated transport test: scheduler's national catalog remains, other jobs wait.
    for (const j of n.collector.queue.jobs.values()) j.due = now + 999999;
    n.collector.queue.hint(key, now);
    const original = raw('zonal/sim-ac01120-z0008.json');
    let body = original;
    const transport = n.transport(async () => new Response(body));
    const collect = async () => {
      now += 1000;
      n.collector.queue.hint(key, now);
      return n.collector.tick(transport, n.accept);
    };
    expect(await collect()).toMatchObject({ status: 200 });
    await collect();
    expect(db.db.prepare('SELECT COUNT(*) n FROM zone_result').get()).toEqual({ n: 1 });
    const changed = JSON.parse(original);
    changed.s.sni = '1';
    body = JSON.stringify(changed);
    expect(await collect()).toMatchObject({ status: 200 });
    expect(
      db.db.prepare('SELECT status FROM zone_result ORDER BY captured_at DESC LIMIT 1').get(),
    ).toEqual({ status: 'needs_review' });
    expect(n.collector.queue.jobs.get(key)?.complete).toBe(false);
    body = original;
    await collect();
    expect(db.db.prepare('SELECT COUNT(*) n FROM zone_result').get()).toEqual({ n: 3 });
    expect(n.status()).toMatchObject({
      observedSegments: 1,
      completeSegments: 1,
      completeZones: 0,
    });
    expect(db.db.prepare('SELECT COUNT(*) n FROM zone_candidate_vote').get()).not.toEqual({ n: 0 });
    // If normalized ingestion fails, accepted cache and domain snapshot both roll back.
    now += 1000;
    n.collector.queue.hint(key, now);
    const prior = n.collector.cached(key);
    await n.collector.tick(
      async () => ({ status: 200, bytes: 2, raw: '{}' }),
      () => {
        throw Error('falha de ingestão');
      },
    );
    expect(n.collector.cached(key)).toBe(prior);
    expect(db.db.prepare('SELECT COUNT(*) n FROM collector_body').get()).toEqual({ n: 2 });
    expect(db.db.prepare('SELECT COUNT(*) n FROM snapshot').get()).toEqual({ n: 0 }); // no disguised municipal aggregate
  } finally {
    db.close();
  }
});

it('pistas EA15 deduplicadas sobrevivem reinício e agregados independem de histórico', async () => {
  const db = new Store(':memory:');
  let now = Date.parse(config.capturedAt) + 1000;
  try {
    const n = new NationalCollection(db, 'simulated', '1', config, catalog, () => now);
    const [trackingKey] = [...n.feeds].find(([, f]) => f.type === 'EA15' && f.context.uf === 'ac')!;
    const trackingJob = n.collector.queue.jobs.get(trackingKey)!;
    const aggregateAc = [...n.collector.queue.jobs.values()].find(
      (j) => j.kind === 'aggregate' && j.url.includes('/ac/ac-c0001'),
    )!;
    aggregateAc.lastSuccess = now - 1000;
    aggregateAc.due = now + 60000;
    const zone = [...n.collector.queue.jobs.values()].find(
      (j) => j.kind === 'zone' && j.municipality === 'ac:01120',
    )!;
    zone.due = now + 100000;
    db.db.transaction(() =>
      n.accept(raw('simulado/ea15-ac.json'), trackingJob, new Date(now).toISOString()),
    )();
    expect(zone.due).toBe(now);
    expect(aggregateAc.due).toBe(now + 60000);
    const changedHint = JSON.parse(raw('simulado/ea15-ac.json'));
    const ufRow = changedHint.abr.find((a: { cdabr: string }) => a.cdabr === 'ac');
    ufRow.s.st = String(Number(ufRow.s.st) + 1);
    n.accept(JSON.stringify(changedHint), trackingJob, new Date(now).toISOString());
    expect(aggregateAc.due).toBe(now);
    zone.due = now + 100000;
    n.accept(raw('simulado/ea15-ac.json'), trackingJob, new Date(now).toISOString());
    expect(zone.due).toBe(now + 100000);
    n.collector.save();
    const restarted = new NationalCollection(db, 'simulated', '1', config, catalog, () => now);
    const restartedZone = restarted.collector.queue.jobs.get(zone.key)!;
    restartedZone.due = now + 100000;
    restarted.accept(
      raw('simulado/ea15-ac.json'),
      restarted.collector.queue.jobs.get(trackingKey)!,
      new Date(now).toISOString(),
    );
    expect(restartedZone.due).toBe(now + 100000);
    const [aggregateKey] = [...restarted.feeds].find(
      ([, f]) => f.type === 'aggregate' && f.context.uf === 'br',
    )!;
    for (const j of restarted.collector.queue.jobs.values()) j.due = now + 100000;
    restarted.collector.queue.hint(aggregateKey, now);
    await restarted.collector.tick(
      restarted.transport(async () => new Response(raw('simulado/ea20-president-br.json'))),
      restarted.accept,
    );
    expect(db.latest('simulated', 'president', 'br')?.votes.valid).toBeGreaterThan(0);
    expect(restarted.status()).toMatchObject({
      completeZones: 0,
      observedSegments: 0,
    });
  } finally {
    db.close();
  }
});
