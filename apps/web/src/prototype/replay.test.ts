import { expect, it } from 'vitest';
import { height, margin, ReplayState, type ReplayFile } from './replay';

// Synthetic: municipality 0 has two segments (zones 0001 and 0002), municipality 1 has one.
const file: ReplayFile = {
  label: 'sintético',
  base: '2026-10-04T20:00:00.000Z',
  municipalities: [
    ['ac:00001', 'A'],
    ['ac:00002', 'B'],
  ],
  segments: [
    [0, '0001', 10],
    [0, '0002', 5],
    [1, '0001', 4],
  ],
  events: [
    [0, 0, 0, 0, 0, 0],
    [60, 0, 4, 100, 60, 30],
    [120, 1, 5, 50, 10, 35],
    [180, 0, 10, 250, 140, 90],
    [240, 2, 4, 40, 20, 20],
  ],
};

it('município = soma das versões mais recentes de seus segmentos; status por encerramento', () => {
  const r = new ReplayState(file);
  expect(r.advanceTo(0)).toEqual([]);
  expect(r.municipalities[0]).toMatchObject({ sections: 15, totalized: 0, status: 'none' });
  const first = r.advanceTo(120);
  expect(first.map((a) => [a.zone, a.addedSections, a.addedFlavio])).toEqual([
    ['0001', 4, 60],
    ['0002', 5, 10],
  ]);
  expect(r.municipalities[0]).toMatchObject({
    totalized: 9,
    flavio: 70,
    lula: 65,
    status: 'counting',
  });
  r.advanceTo(180);
  // Replaces (not adds) the segment's previous version.
  expect(r.municipalities[0]).toMatchObject({ totalized: 15, valid: 300, flavio: 150, lula: 125 });
  expect(r.municipalities[0].status).toBe('closed');
  r.advanceTo(240);
  expect(r.municipalities[1]).toMatchObject({ status: 'closed', flavio: 20, lula: 20 });
  expect(margin(r.municipalities[1]).leader).toBe(0);
  // Rewinding replays from the start without future information.
  r.advanceTo(60);
  expect(r.municipalities[0]).toMatchObject({ totalized: 4, flavio: 60, status: 'counting' });
  expect(r.municipalities[1].status).toBe('none');
});

it('alturas: zero antes de apurar; ponderada cresce com a fração apurada', () => {
  const r = new ReplayState(file);
  r.advanceTo(60);
  const m = r.municipalities[0];
  expect(height(r.municipalities[1], 'votes')).toBe(0);
  expect(margin(m)).toMatchObject({ leader: 1, votes: 30, counted: 4 / 15 });
  expect(height(m, 'weighted')).toBeCloseTo(height(m, 'points') * (4 / 15));
});
