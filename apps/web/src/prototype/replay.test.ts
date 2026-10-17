import { expect, it } from 'vitest';
import { finalVotes, height, margin, ReplayState, synthetic2T, type ReplayFile } from './replay';

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
  expect(first.map((a) => [a.zone, a.addedSections, a.addedFlavio, a.closes])).toEqual([
    ['0001', 4, 60, false],
    ['0002', 5, 10, false], // zone 0001 still open
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
  expect(r.advanceTo(200)).toEqual([]);
  expect(r.advanceTo(240).map((a) => a.closes)).toEqual([true]);
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

it('soma nacional acompanha versões substituídas e volta a zero ao rebobinar', () => {
  const r = new ReplayState({
    ...file,
    segments: file.segments.map(([m, z, sections]) => [m, z, sections, 100]),
    events: file.events.map((e) => [e[0], e[1], e[2], e[3], e[4], e[5], e[2] * 10, e[2] * 8, e[2]]),
  });
  r.advanceTo(240);
  expect(r.national).toMatchObject({
    sections: 19,
    electorate: 300,
    totalized: 19,
    valid: 340,
    flavio: 170,
    lula: 145,
    countedElectorate: 190,
    turnout: 152,
    notValid: 19,
  });
  r.advanceTo(0);
  expect(r.national.totalized).toBe(0);
});

it('fantasma: 1º turno nas mesmas unidades — só encerradas ou proporcional às seções', () => {
  const baseline = [
    { flavio: 100, lula: 50 },
    { flavio: 10, lula: 40 },
    { flavio: 20, lula: 20 },
  ];
  const r = new ReplayState(file, baseline);
  r.advanceTo(120); // segment 0: 4/10 sections; segment 1: 5/5 (complete)
  expect(r.national.ghost.complete).toEqual({ flavio: 10, lula: 40 });
  expect(r.national.ghost.proportional.flavio).toBeCloseTo(100 * 0.4 + 10);
  // Exchange: open segment 0 as counted (60), closed segment 1 swapped for its 1st round (10).
  expect(r.national.ghost.exchange).toEqual({ flavio: 60 + 10, lula: 30 + 40 });
  r.advanceTo(240); // everything complete: both modes equal the whole baseline
  expect(r.national.ghost.complete).toEqual({ flavio: 130, lula: 110 });
  expect(r.national.ghost.exchange).toEqual({ flavio: 130, lula: 110 });
  expect(r.national.ghost.proportional.flavio).toBeCloseTo(130);
  r.advanceTo(0);
  expect(r.national.ghost.complete).toEqual({ flavio: 0, lula: 0 });
});

it('2º turno sintético: só redistribui os demais entre os finalistas; válidos intactos', () => {
  const real: ReplayFile = {
    ...file,
    events: [[60, 0, 4, 100, 60, 30, 0, 0, 0]],
  };
  const fake = synthetic2T(real);
  const [, , , valid, f, l] = fake.events[0];
  expect(valid).toBe(100);
  expect(f! + l!).toBe(100);
  expect(f!).toBeGreaterThanOrEqual(60 + 3);
  expect(fake.label).toMatch(/SINTÉTICO/);
  expect(finalVotes(real)[0]).toEqual({ flavio: 60, lula: 30 });
});
