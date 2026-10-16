import { expect, it } from 'vitest';
import { ConservativeCollector } from './collector';
it('não sobrepõe HTTP e inicia pausa de 429 na conclusão da resposta', async () => {
  let now = 0;
  const c = new ConservativeCollector(500, 1000, () => now);
  c.add({ key: 'a', url: 'fixture:a', kind: 'zone', priority: 0 });
  let resolveResponse!: (r: { status: number; bytes: number }) => void;
  const pending = c.tick(
    0,
    () =>
      new Promise((resolve) => {
        resolveResponse = resolve;
      }),
  );
  now = 20000;
  expect(await c.tick(now, async () => ({ status: 200, bytes: 0 }))).toBeNull();
  resolveResponse({ status: 429, bytes: 0 });
  await pending;
  expect(c.snapshot().nextRequest).toBe(620000);
});
it('orçamento único inclui 304, cache condicional e suspensão 404', async () => {
  const c = new ConservativeCollector(500, 1000);
  c.add({ key: 'a', url: 'fixture:a', kind: 'zone', priority: 0 });
  const calls: Record<string, string>[] = [];
  await c.tick(0, async (_, h) => {
    calls.push(h);
    return { status: 200, bytes: 20, etag: '"a"' };
  });
  expect(await c.tick(499, async () => ({ status: 200, bytes: 0 }))).toBeNull();
  await c.tick(1000, async (_, h) => {
    calls.push(h);
    return { status: 304, bytes: 0 };
  });
  expect(calls[1]).toEqual({ 'If-None-Match': '"a"' });
  expect(c.stats.requests).toBe(2);
  await c.tick(2000, async () => ({ status: 404, bytes: 0 }));
  expect(await c.tick(900000, async () => ({ status: 200, bytes: 0 }))).toBeNull();
  expect(c.stats.requests).toBe(3);
});
it('favoritos não limitam expansão; remover interrompe apenas agregado municipal', async () => {
  const c = new ConservativeCollector(500, 1000);
  for (let i = 0; i < 10; i++)
    c.add({
      key: `z${i}`,
      url: `fixture:z${i}`,
      kind: 'zone',
      municipality: `ac:${i}`,
      priority: 0,
    });
  c.add({
    key: 'municipal',
    url: 'fixture:municipal',
    kind: 'aggregate',
    municipality: 'ac:0',
    priority: 30,
  });
  c.setFavorites(new Set(['ac:0']));
  const served = new Set<string>();
  for (let t = 0; t < 20000; t += 500)
    await c.tick(t, async (j) => {
      served.add(j.key);
      return { status: 200, bytes: 1 };
    });
  expect(served.size).toBe(11);
  c.setFavorites(new Set());
  expect(c.jobs.get('municipal')?.suspended).toBe(true);
  expect(c.jobs.get('z0')?.suspended).toBe(false);
});
it('429 suspende o orçamento global e falha de rede aplica backoff', async () => {
  const c = new ConservativeCollector();
  c.add({ key: 'a', url: 'fixture:a', kind: 'zone', priority: 0 });
  c.add({ key: 'b', url: 'fixture:b', kind: 'zone', priority: 0 });
  await c.tick(0, async () => ({ status: 429, bytes: 0 }));
  expect(await c.tick(599999, async () => ({ status: 200, bytes: 0 }))).toBeNull();
  await c.tick(600000, async () => {
    throw Error('offline');
  });
  expect(c.stats.errors).toBe(2);
  expect([...c.jobs.values()].some((j) => j.due > 600000)).toBe(true);
});

it('sobrepõe HTTP com gate único e reserva vaga e precedência para BR/UF', async () => {
  let now = 0;
  const c = new ConservativeCollector(500, 60000, () => now, 3);
  c.add({ key: 'br', url: 'fixture:br', kind: 'aggregate', priority: 0 });
  for (const key of ['a', 'b', 'c'])
    c.add({ key, url: `fixture:${key}`, kind: 'zone', priority: 100 });
  const finishes: (() => void)[] = [];
  const started: string[] = [];
  const transport = async (j: { key: string }) => {
    started.push(j.key);
    await new Promise<void>((resolve) => finishes.push(resolve));
    return { status: 200, bytes: 1 };
  };
  const br = c.tick(now, transport);
  expect(started).toEqual(['br']);
  expect(await c.tick(499, transport)).toBeNull();
  now = 500;
  const a = c.tick(now, transport);
  now = 1000;
  const b = c.tick(now, transport);
  now = 1500;
  expect(await c.tick(now, transport)).toBeNull();
  finishes[0]();
  await br;
  expect(await c.tick(now, transport)).toBeNull(); // free slot reserved, zones still in flight
  c.hint('br', now);
  const again = c.tick(now, transport);
  // Two distinct zones (scattered order, not alphabetical), then BR again in the free slot.
  expect(started).toHaveLength(4);
  expect([started[0], started[3]]).toEqual(['br', 'br']);
  expect(new Set(started.slice(1, 3)).size).toBe(2);
  expect(started.slice(1, 3).every((k) => ['a', 'b', 'c'].includes(k))).toBe(true);
  finishes.slice(1).forEach((f) => f());
  await Promise.all([a, b, again]);
});
it('deduplica pistas em voo, distribui auditorias e retificação volta ao fallback', async () => {
  let now = 0;
  const c = new ConservativeCollector(500, 900000, () => now, 2, 600000);
  for (const key of ['a', 'b']) c.add({ key, url: `fixture:${key}`, kind: 'zone', priority: 0 });
  await c.tick(now, async (j) => {
    c.hint(j.key, now);
    c.hint(j.key, now);
    return { status: 200, bytes: 1, complete: true };
  });
  expect(c.jobs.get('a')?.due).toBe(500);
  now = 500;
  await c.tick(now, async () => ({ status: 200, bytes: 1, complete: true }));
  now = 1000;
  await c.tick(now, async () => ({ status: 200, bytes: 1, complete: true }));
  expect(c.jobs.get('a')?.due).not.toBe(c.jobs.get('b')?.due);
  c.hint('a', 1500);
  now = 1500;
  await c.tick(now, async () => ({ status: 200, bytes: 1, complete: false }));
  expect(c.jobs.get('a')).toMatchObject({ complete: false, due: 901500 });
  c.hint('a', 2000);
  now = 2000;
  await c.tick(now, async () => ({ status: 503, bytes: 0 }));
  c.hint('a', 2001);
  expect(c.jobs.get('a')?.due).toBe(4000); // hints cannot bypass backoff
});
it('resposta concorrente não remove pausa global nem reutiliza ETag de versão antiga', async () => {
  let now = 0;
  const c = new ConservativeCollector(500, 1000, () => now, 2);
  for (const key of ['a', 'b']) c.add({ key, url: `fixture:${key}`, kind: 'zone', priority: 0 });
  let finish!: () => void;
  const pending = c.tick(now, async () => {
    await new Promise<void>((r) => (finish = r));
    return { status: 200, bytes: 1 };
  });
  now = 500;
  await c.tick(now, async () => ({ status: 429, bytes: 0 }));
  now = 1000;
  finish();
  await pending;
  expect(c.snapshot().nextRequest).toBe(600500);
  expect(await c.tick(600499, async () => ({ status: 200, bytes: 0 }))).toBeNull();
});

it('bootstrap direcionado compartilha orçamento sem suspender a fila nacional', async () => {
  const c = new ConservativeCollector(500, 1000);
  c.add({ key: 'br', url: 'fixture:br', kind: 'aggregate', priority: 100 });
  c.add({ key: 'config', url: 'fixture:config', kind: 'tracking', priority: 0 });
  const transport = async () => ({ status: 200, bytes: 1 });
  expect(await c.tick(0, transport, (j) => j.key === 'config')).toMatchObject({ key: 'config' });
  expect(c.jobs.get('br')?.suspended).toBe(false);
  expect(await c.tick(499, transport)).toBeNull();
  expect(await c.tick(500, transport)).toMatchObject({ key: 'br' });
});
it('ordem de varredura espalhada e estável: sem ordem alfabética de UF', async () => {
  const c = new ConservativeCollector(500, 60000, undefined, 1);
  const ufs = ['ac', 'al', 'am', 'ap', 'ba', 'ce', 'df', 'es', 'go', 'ma', 'mg', 'ms'];
  for (const uf of ufs)
    c.add({
      key: `official:6258:2:zone:${uf}:00001:0001`,
      url: `fixture:${uf}`,
      kind: 'zone',
      priority: 0,
    });
  const order: string[] = [];
  for (let i = 0; i < ufs.length; i++)
    await c.tick(i * 500, async (j) => {
      order.push(j.key.split(':')[4]);
      return { status: 200, bytes: 1 };
    });
  expect(order).toHaveLength(ufs.length);
  expect(order).not.toEqual(ufs);
  expect(new Set(order).size).toBe(ufs.length);
});
