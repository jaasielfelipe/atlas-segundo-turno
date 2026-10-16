import { expect, it } from 'vitest';
import { ConservativeCollector, MAX_RPS } from './collector';
import { RateController } from './rate';

it('teto de 80 req/s: rejeita intervalo menor e setRate acima do teto', () => {
  expect(() => new ConservativeCollector(1000 / 100, 1000)).toThrow();
  const c = new ConservativeCollector(1000 / MAX_RPS, 1000, undefined, 64, 1000, 4);
  expect(() => c.setRate(81)).toThrow();
  expect(() => new ConservativeCollector(500, 1000, undefined, 129)).toThrow();
  c.setRate(40);
  expect(c.intervalMs).toBe(25);
});

it('nenhuma janela de 1s excede taxa + rajada, mesmo com relógio irregular', async () => {
  const c = new ConservativeCollector(1000 / MAX_RPS, 1000, undefined, 128, 1000, 4);
  for (let i = 0; i < 400; i++)
    c.add({ key: `z${i}`, url: `fixture:${i}`, kind: 'zone', priority: 0 });
  const starts: number[] = [];
  let now = 0;
  // Late, irregular wake-ups (Windows timer granularity) try to catch up with bursts.
  while (now < 4000) {
    for (let k = 0; k < 10; k++) {
      const before = c.stats.requests;
      await c.tick(now, async () => ({ status: 200, bytes: 0 }));
      if (c.stats.requests > before) starts.push(now);
    }
    now += 1 + ((now * 7) % 31);
  }
  let worst = 0;
  for (let i = 0; i < starts.length; i++) {
    let j = i;
    while (j < starts.length && starts[j] < starts[i] + 1000) j++;
    worst = Math.max(worst, j - i);
  }
  expect(worst).toBeLessThanOrEqual(MAX_RPS + 4);
  expect(worst).toBeGreaterThanOrEqual(MAX_RPS - 5); // jitter does not waste the budget
});

it('429 pausa globalmente 10 min mesmo com rajada configurada', async () => {
  const c = new ConservativeCollector(1000 / MAX_RPS, 1000, () => 100, 8, 1000, 4);
  c.add({ key: 'a', url: 'fixture:a', kind: 'zone', priority: 0 });
  c.add({ key: 'b', url: 'fixture:b', kind: 'zone', priority: 0 });
  await c.tick(100, async () => ({ status: 429, bytes: 0 }));
  expect(c.readyAt).toBe(600_100);
  expect(await c.tick(600_099, async () => ({ status: 200, bytes: 0 }))).toBeNull();
  expect(await c.tick(600_100, async () => ({ status: 200, bytes: 0 }))).not.toBeNull();
});

it('controlador: rampa gradual, metade com erros, piso com 403/429, nunca acima do alvo', () => {
  const r = new RateController({ target: 80, start: 10, step: 10, stepMs: 15_000 }, 0);
  expect(r.current).toBe(10);
  let t = 0;
  for (let w = 0; w < 10; w++) {
    for (let i = 0; i < 50; i++) r.observe(200, t);
    t += 15_000;
    r.update(t);
  }
  expect(r.current).toBe(80);
  for (let i = 0; i < 18; i++) r.observe(200, t);
  r.observe(503, t);
  r.observe(0, t);
  r.update(t + 1);
  expect(r.current).toBe(40);
  r.observe(404, t + 2); // missing unit is not stress
  r.update(t + 2);
  expect(r.current).toBe(40);
  r.observe(429, t + 3);
  expect(r.current).toBe(2);
  expect(() => new RateController({ target: 81 }, 0)).toThrow();
  expect(r.events.map((e) => e.reason)).toContain('throttle_429');
});

it('controlador: janela ociosa não sobe a taxa', () => {
  const r = new RateController({ target: 80, start: 10 }, 0);
  r.update(60_000);
  expect(r.current).toBe(10);
});
