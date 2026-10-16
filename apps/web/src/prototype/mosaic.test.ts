import { expect, it } from 'vitest';
import { electorateByUf, marginPoints, mosaic, REGIONS, ufTotals } from './mosaic';
import { ReplayState, type ReplayFile } from './replay';

it('larguras proporcionais preenchem o total, com mínimo para UFs pequenas', () => {
  const w = mosaic([900, 90, 9, 1], 1000, 4, 30);
  expect(w.reduce((a, b) => a + b, 0) + 3 * 4).toBeCloseTo(1000);
  expect(w[2]).toBe(30);
  expect(w[3]).toBe(30);
  expect(w[0] / w[1]).toBeCloseTo(10);
});

it('totais por UF somam os municípios; margem indefinida sem votos', () => {
  const file: ReplayFile = {
    label: 'sintético',
    base: '2026-10-04T20:00:00.000Z',
    municipalities: [
      ['ac:00001', 'A'],
      ['ac:00002', 'B'],
      ['sp:00003', 'C'],
    ],
    segments: [
      [0, '0001', 10, 1000],
      [1, '0001', 5, 400],
      [2, '0001', 20, 3000],
    ],
    events: [
      [10, 0, 10, 100, 60, 30],
      [20, 1, 5, 50, 10, 35],
    ],
  };
  const r = new ReplayState(file);
  r.advanceTo(30);
  const t = ufTotals(file, r.municipalities, electorateByUf(file));
  expect(t.get('ac')).toMatchObject({
    electorate: 1400,
    sections: 15,
    totalized: 15,
    flavio: 70,
    lula: 65,
  });
  expect(marginPoints(t.get('ac')!)).toBeCloseTo((5 / 150) * 100);
  expect(marginPoints(t.get('sp')!)).toBeNull();
  // Every UF and the exterior belong to exactly one region.
  const ufs = REGIONS.flatMap((g) => g.ufs);
  expect(new Set(ufs).size).toBe(28);
});
