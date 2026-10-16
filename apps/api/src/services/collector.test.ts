import { expect, it } from 'vitest';
import { Store } from '../db/store';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { PersistentCollector } from './collector';
import { MAX_RPS } from '../../../../packages/tse/src/collector';
import { RateController } from '../../../../packages/tse/src/rate';
it('reinício preserva ETag, corpo deduplicado, cota, observações e suspensão 404', async () => {
  const store = new Store(':memory:');
  let now = 1000000;
  try {
    let collector = new PersistentCollector(store, () => now);
    collector.queue.add({ key: 'a', url: 'fixture:a', kind: 'zone', priority: 0 });
    await collector.tick(async () => ({ status: 200, bytes: 2, raw: '{}', etag: 'e1' }));
    collector = new PersistentCollector(store, () => now);
    expect(collector.cached('a')).toBe('{}');
    expect(collector.queue.stats.requests).toBe(1);
    expect(
      await collector.tick(async () => {
        throw Error('Não deve chamar antes da cota');
      }),
    ).toBeNull();
    now += 60000;
    await collector.tick(async (_, headers) => {
      expect(headers).toEqual({ 'If-None-Match': 'e1' });
      return { status: 304, bytes: 0 };
    });
    now += 60000;
    await collector.tick(async () => ({ status: 200, bytes: 2, raw: '{}', etag: 'e1' }));
    expect(store.db.prepare('SELECT COUNT(*) n FROM collector_body').get()).toEqual({ n: 1 });
    expect(store.db.prepare('SELECT COUNT(*) n FROM collector_observation').get()).toEqual({
      n: 3,
    });
    now += 60000;
    await collector.tick(async () => ({ status: 404, bytes: 0 }));
    collector = new PersistentCollector(store, () => now);
    collector.queue.setFavorites(new Set(['a']));
    now += 900000;
    expect(await collector.tick(async () => ({ status: 200, bytes: 2, raw: '{}' }))).toBeNull();
    expect(collector.queue.stats.requests).toBe(4);
  } finally {
    store.close();
  }
});
it('pausa global por 429 sobrevive reinício e 304 sem corpo anterior falha fechado', async () => {
  const store = new Store(':memory:');
  let now = 1000000;
  try {
    let collector = new PersistentCollector(store, () => now);
    for (const key of ['a', 'b'])
      collector.queue.add({ key, url: `fixture:${key}`, kind: 'zone', priority: 0 });
    await collector.tick(async () => ({ status: 429, bytes: 0 }));
    collector = new PersistentCollector(store, () => now);
    now += 599999;
    expect(await collector.tick(async () => ({ status: 200, bytes: 2, raw: '{}' }))).toBeNull();
    now += 1;
    expect(await collector.tick(async () => ({ status: 304, bytes: 0 }))).toMatchObject({
      status: 0,
    });
    expect(store.db.prepare('SELECT COUNT(*) n FROM collector_cache').get()).toEqual({ n: 0 });
    expect(
      store.db.prepare('SELECT error FROM collector_observation ORDER BY id DESC LIMIT 1').get(),
    ).toEqual({ error: '304 sem cache validado' });
  } finally {
    store.close();
  }
});

it('grava só o job alterado em fila nacional e mantém versões imutáveis no replay', async () => {
  const store = new Store(':memory:');
  let now = 1000000;
  try {
    const c = new PersistentCollector(store, () => now);
    for (let i = 0; i < 6292; i++)
      c.queue.add({ key: String(i), url: `fixture:${i}`, kind: 'zone', priority: 0 });
    c.save();
    store.db.exec(
      'CREATE TABLE writes(key TEXT); CREATE TRIGGER log_job_update AFTER UPDATE ON collector_job BEGIN INSERT INTO writes VALUES(new.key); END;',
    );
    await c.tick(async () => ({ status: 200, bytes: 1, raw: 'A' }));
    expect(store.db.prepare('SELECT COUNT(*) n FROM writes').get()).toEqual({ n: 2 });
    const key = (store.db.prepare('SELECT key FROM writes LIMIT 1').get() as { key: string }).key;
    now += 500;
    c.queue.hint(key, now);
    c.queue.jobs.get(key)!.priority = 100;
    await c.tick(async () => ({ status: 200, bytes: 1, raw: 'B' }));
    expect(c.captured(key, new Date(now - 1).toISOString())).toBe('A');
    expect(c.captured(key, new Date(now).toISOString())).toBe('B');
    now += 500;
    c.queue.hint(key, now);
    await c.tick(async () => ({ status: 503, bytes: 0 }));
    expect(c.cached(key)).toBe('B');
    expect(() => store.db.exec('DELETE FROM collector_observation')).toThrow('imutável');
  } finally {
    store.close();
  }
});
it('loop usa lease único e drena HTTP antes de liberar proprietário', async () => {
  const store = new Store(':memory:');
  const stop = new AbortController();
  try {
    const a = new PersistentCollector(store);
    const b = new PersistentCollector(store);
    a.queue.add({ key: 'br', url: 'fixture:br', kind: 'aggregate', priority: 0 });
    let finish!: () => void;
    const running = a.run(async () => {
      await new Promise<void>((r) => (finish = r));
      return { status: 200, bytes: 2, raw: '{}' };
    }, stop.signal);
    await expect(b.tick(async () => ({ status: 200, bytes: 0 }))).rejects.toThrow('Outro coletor');
    expect(() => b.save()).toThrow('Outro coletor');
    stop.abort();
    finish();
    await running;
    expect(store.db.prepare('SELECT COUNT(*) n FROM collector_owner').get()).toEqual({ n: 0 });
  } finally {
    store.close();
  }
});
it('run() sustenta ~80 req/s em tempo real sem exceder taxa + rajada e registra ingestão rejeitada', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'atlas-rate-'));
  const store = new Store(join(folder, 'rate.sqlite'));
  try {
    const collector = new PersistentCollector(store, Date.now, {
      intervalMs: 1000 / MAX_RPS,
      maxInFlight: 64,
      burst: 4,
      pollMs: 600_000,
    });
    for (let i = 0; i < 600; i++)
      collector.queue.add({ key: `z${i}`, url: `fixture:${i}`, kind: 'zone', priority: 0 });
    const starts: number[] = [];
    const stop = new AbortController();
    const rate = new RateController({ target: MAX_RPS, start: MAX_RPS }, Date.now());
    setTimeout(() => stop.abort(), 3000);
    await collector.run(
      async (job) => {
        starts.push(Date.now());
        await sleep(50 + (Number(job.key.slice(1)) % 7) * 60);
        return { status: 200, bytes: 2, raw: `{"k":"${job.key}"}` };
      },
      stop.signal,
      (_raw, job) => {
        if (job.key === 'z3') throw Error('corpo rejeitado');
      },
      rate,
    );
    let worst = 0;
    for (let i = 0; i < starts.length; i++) {
      let j = i;
      while (j < starts.length && starts[j] < starts[i] + 1000) j++;
      worst = Math.max(worst, j - i);
    }
    expect(worst).toBeLessThanOrEqual(MAX_RPS + 4);
    expect(starts.length).toBeGreaterThanOrEqual(MAX_RPS * 3 * 0.85);
    expect(
      store.db.prepare("SELECT error FROM collector_observation WHERE job_key='z3'").get(),
    ).toEqual({ error: 'corpo rejeitado' });
    expect(collector.cached('z3')).toBeNull();
  } finally {
    store.close();
    rmSync(folder, { recursive: true, force: true });
  }
}, 15_000);
it('lease expirado de coletor que caiu não bloqueia o próximo; lease válido bloqueia', async () => {
  const store = new Store(':memory:');
  let now = 1_000_000;
  try {
    const crashed = new PersistentCollector(store, () => now);
    crashed.queue.add({ key: 'a', url: 'fixture:a', kind: 'zone', priority: 0 });
    crashed.save();
    store.db.prepare("INSERT INTO collector_owner VALUES(1,'dead-owner',?)").run(now + 60_000);
    const next = new PersistentCollector(store, () => now);
    await expect(next.tick(async () => ({ status: 200, bytes: 2, raw: '{}' }))).rejects.toThrow(
      'Outro coletor',
    );
    now += 60_001;
    const result = await next.tick(async () => ({ status: 200, bytes: 2, raw: '{}' }));
    expect(result?.status).toBe(200);
    expect(next.cached('a')).toBe('{}');
  } finally {
    store.close();
  }
});
it('indisponibilidade 5xx/rede: run() não cai, taxa cai à metade e unidades voltam após backoff', async () => {
  const store = new Store(':memory:');
  try {
    const collector = new PersistentCollector(store, Date.now, {
      intervalMs: 1000 / MAX_RPS,
      maxInFlight: 32,
      burst: 4,
      pollMs: 600_000,
    });
    for (let i = 0; i < 200; i++)
      collector.queue.add({ key: `z${i}`, url: `fixture:${i}`, kind: 'zone', priority: 0 });
    const rate = new RateController({ target: MAX_RPS, start: MAX_RPS }, Date.now());
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 1500);
    let calls = 0;
    await collector.run(
      async (job) => {
        calls++;
        if (Number(job.key.slice(1)) % 2) throw Error('ECONNRESET');
        return { status: 503, bytes: 0 };
      },
      stop.signal,
      undefined,
      rate,
    );
    expect(calls).toBeGreaterThan(20);
    expect(rate.current).toBeLessThan(MAX_RPS);
    expect(rate.events.some((e) => e.reason === 'errors')).toBe(true);
    const failed = [...collector.queue.jobs.values()].filter((j) => j.failures > 0);
    expect(failed.length).toBe(calls);
    expect(failed.every((j) => !j.suspended)).toBe(true); // backoff, never a 404-style suspension
  } finally {
    store.close();
  }
}, 15_000);
