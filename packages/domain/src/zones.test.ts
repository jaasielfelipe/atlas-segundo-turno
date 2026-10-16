import { describe, expect, it } from 'vitest';
import {
  compareRounds,
  validResult,
  type Finalists,
  type RoundData,
  type ZoneResult,
  type ZoneSegment,
} from './zones';

// Synthetic examples only (labelled fixture environment); never official numbers.
const F: Finalists = { flavio: 'f', lula: 'l' };
let n = 0;
function result(
  round: '1' | '2',
  s: ZoneSegment,
  votes: Record<string, number>,
  extra: Partial<ZoneResult> & { blank?: number; nul?: number; abstention?: number } = {},
): ZoneResult {
  const valid = Object.values(votes).reduce((a, b) => a + b, 0);
  const blank = extra.blank ?? 10,
    nul = extra.nul ?? 20,
    abstention = extra.abstention ?? 100;
  const turnout = valid + blank + nul;
  const { blank: _b, nul: _n, abstention: _a, ...rest } = extra;
  return {
    ...s,
    id: `r${++n}`,
    environment: 'fixture',
    election: round === '1' ? 'e1' : 'e2',
    round,
    capturedAt: '2026-10-25T20:00:00.000Z',
    sourceUrl: 'fixture:zone.json',
    sourceDigest: `d${n}`,
    status: 'complete',
    total: 10,
    totalized: 10,
    notTotalized: 0,
    counts: { electorate: turnout + abstention, turnout, valid, blank, null: nul, annulled: 0 },
    candidates: Object.entries(votes).map(([id, v]) => ({ id, votes: v })),
    ...rest,
  };
}
const seg = (uf: string, municipality: string, zone: string) => ({ uf, municipality, zone });
const A = seg('ac', '01120', '0008'),
  B = seg('ac', '01392', '0008'), // same zone 0008, second municipality
  C = seg('ac', '01120', '0009'),
  D = seg('am', '02550', '0001');
const round = (r: '1' | '2', segments: ZoneSegment[], results: ZoneResult[]): RoundData => ({
  environment: 'fixture',
  round: r,
  election: r === '1' ? 'e1' : 'e2',
  registryDigest: 'reg',
  segments,
  results,
});
const at = '2026-10-25T23:00:00.000Z';

describe('1º × 2º turno nas mesmas zonas', () => {
  const first = round(
    '1',
    [A, B, C, D],
    [
      result('1', A, { f: 300, l: 200, x: 100 }),
      result('1', B, { f: 100, l: 150, x: 50 }),
      result('1', C, { f: 50, l: 60, x: 70 }),
      result('1', D, { f: 10, l: 90, x: 0 }),
    ],
  );
  const second = round(
    '2',
    [A, B, C, D],
    [
      result('2', A, { f: 380, l: 240 }, { blank: 15, nul: 25, abstention: 60 }),
      result('2', B, { f: 150, l: 160 }),
      // Zone 0009 still counting: not in the cohort.
      result('2', C, { f: 10, l: 10 }, { totalized: 3, notTotalized: 7, status: 'partial' }),
      // am:0001 changes leader between rounds (lula → flavio).
      result('2', D, { f: 60, l: 40 }),
    ],
  );
  it('coorte: zona inteira (todos os segmentos) concluída no 2º e no 1º turno', () => {
    const c = compareRounds(first, second, F, at);
    expect(c.coverage).toEqual({ expected: 3, completed: 2, comparable: 2 });
    expect(c.excluded.pending).toBe(1);
    expect(c.rows.find((r) => r.key === 'ac:0008')!.first!.flavio).toBe(400);
    // Sums of votes over the cohort (ac:0008 = A+B, am:0001 = D), never averages of percentages.
    expect(c.first.totals).toMatchObject({ flavio: 410, lula: 440, others: 150, valid: 1000 });
    expect(c.second.totals).toMatchObject({ flavio: 590, lula: 440, others: 0, valid: 1030 });
    expect(c.second.shares.flavio).toBeCloseTo(590 / 1030);
    expect(c.difference.flavio).toBe(180);
    expect(c.difference.others).toBe(-150);
  });
  it('categorias fecham no eleitorado; diferenças somam a variação do eleitorado', () => {
    const c = compareRounds(first, second, F, at);
    for (const t of [c.first.totals, c.second.totals])
      expect(t.flavio + t.lula + t.others + t.notValid + t.abstention).toBe(t.electorate);
    const d = c.difference;
    expect(d.flavio + d.lula + d.others + d.notValid + d.abstention).toBe(d.electorate);
  });
  it('liderança por unidade e matriz 1º→2º turno somam a coorte', () => {
    const c = compareRounds(first, second, F, at);
    expect(c.first.leaders).toEqual({ flavio: 1, lula: 1, outros: 0, empate: 0 });
    expect(c.second.leaders).toEqual({ flavio: 2, lula: 0, outros: 0, empate: 0 });
    expect(c.transitions.matrix.flat().reduce((a, b) => a + b, 0)).toBe(c.coverage.comparable);
    expect(c.transitions.matrix[1][0]).toBe(1); // lula → flavio (am:0001)
    expect(c.transitions.matrix[0][0]).toBe(1); // flavio → flavio (ac:0008)
  });
  it('município conta unidades município–zona', () => {
    const c = compareRounds(first, second, F, at, { uf: 'ac', municipality: '01120' });
    expect(c.unitKind).toBe('municipality_zone');
    expect(c.coverage).toEqual({ expected: 2, completed: 1, comparable: 1 });
  });
  it('sem informação futura: versão capturada depois do instante não entra', () => {
    const late = round('2', second.segments, [
      ...second.results,
      result('2', C, { f: 90, l: 90 }, { capturedAt: '2026-10-26T01:00:00.000Z' }),
    ]);
    expect(compareRounds(first, late, F, at).coverage.comparable).toBe(2);
    expect(compareRounds(first, late, F, '2026-10-26T02:00:00.000Z').coverage.comparable).toBe(3);
    expect(compareRounds(first, late, F, '2026-10-25T19:00:00.000Z').coverage.comparable).toBe(0);
  });
  it('exclusões explícitas: cadastro diferente, 1º turno incompleto, revisão', () => {
    const changed = round(
      '1',
      [A, C, D],
      first.results.filter((r) => r.municipality !== '01392'),
    );
    expect(compareRounds(changed, second, F, at).excluded.registry_changed).toBe(1);
    const incomplete = round('1', first.segments, [
      ...first.results.filter((r) => r.uf !== 'am'),
      result('1', D, { f: 10, l: 90 }, { status: 'needs_review' }),
    ]);
    expect(compareRounds(incomplete, second, F, at).excluded.first_round_incomplete).toBe(1);
    const review = round('2', second.segments, [
      ...second.results.filter((r) => r.uf !== 'am'),
      result('2', D, { f: 15, l: 85 }, { status: 'needs_review' }),
    ]);
    expect(compareRounds(first, review, F, at).excluded.needs_review).toBe(1);
  });
  it('2º turno exige exatamente os dois finalistas; contagens ausentes não viram zero', () => {
    expect(validResult(result('2', A, { f: 1, l: 1, x: 1 }), F)).toBe(false);
    expect(validResult(result('2', A, { f: 1, z: 1 }), F)).toBe(false);
    const missing = result('2', A, { f: 1, l: 1 });
    missing.counts.blank = null;
    expect(validResult(missing, F)).toBe(false);
    expect(validResult(result('2', A, { f: 0, l: 0 }), F)).toBe(false);
    const inconsistent = result('2', A, { f: 5, l: 5 });
    inconsistent.counts.valid = 11;
    expect(validResult(inconsistent, F)).toBe(false);
  });
  it('rejeita turnos invertidos, finalistas não resolvidos, instante inválido e mistura', () => {
    expect(() => compareRounds(second, first, F, at)).toThrow(/Turnos/);
    expect(() => compareRounds(first, second, { flavio: 'f', lula: 'f' }, at)).toThrow();
    expect(() => compareRounds(first, second, F, '2026-10-25')).toThrow(/Instante/);
    const mixed = round('2', second.segments, [...second.results, result('1', A, { f: 1, l: 1 })]);
    expect(() => compareRounds(first, mixed, F, at)).toThrow(/misturados/);
  });
  it('coorte vazia: participações indefinidas (null), não zero', () => {
    const c = compareRounds(first, round('2', second.segments, []), F, at);
    expect(c.coverage.comparable).toBe(0);
    expect(c.second.shares.flavio).toBeNull();
  });
});
