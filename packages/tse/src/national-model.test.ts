import { expect, it } from 'vitest';
import { simulateNational, summarize, type ModelOptions } from './national-model';
const options: ModelOptions = {
  rps: 20,
  concurrency: 16,
  httpMs: [100],
  processingMs: 1,
  queueSaveMs: 0,
  burst: true,
  failures: false,
  priority: true,
  hints: true,
  duration: 1800,
};
it('quantis por ordem não alteram a amostra', () => {
  const a = [3, 1, 2];
  expect(summarize(a)).toMatchObject({ n: 3, p50: 2, p95: 3, p99: 3, mean: 2 });
  expect(a).toEqual([3, 1, 2]);
});
it('coleta toda a topologia, conta ZE inteira e respeita orçamento compartilhado', () => {
  const units = [0, 1, 2].map((i) => ({
    key: `ac:0${i}:0001`,
    municipality: `ac:0${i}`,
    zone: 'ac:0001',
    multi: false,
    favorite: i === 0,
  }));
  const result = simulateNational(units, options);
  expect(result.completeSegments).toBe(3);
  expect(result.wholeZones).toBe(1);
  expect(result.sent).toBeLessThanOrEqual(1800 * 20);
  expect(result.completeToPersistence.p50).toBeGreaterThanOrEqual(0);
  expect(result.wholeZoneTimeline.n).toBe(1);
  const early = simulateNational(units, { ...options, duration: 1100 });
  expect(early.completeSegments).toBe(0);
  expect(early.wholeZones).toBe(0);
});
it('falhas/retificações não criam dados retroativos nem eliminam definitivamente unidades saudáveis', () => {
  const units = Array.from({ length: 25 }, (_, i) => ({
    key: String(i),
    municipality: String(i),
    zone: String(i),
    multi: false,
    favorite: i === 1,
  }));
  const result = simulateNational(units, { ...options, failures: true, duration: 7200 });
  expect(result.suspended).toBe(1);
  expect(result.completeSegments).toBe(24);
  expect(result.cohortRemovals).toBeGreaterThan(0);
  expect(result.rectifications).toBeGreaterThan(0);
});
