import type { MunicipalityState, ReplayFile } from './replay';

/** Regions in the order chosen for the big screen (1st round); exterior last. */
export const REGIONS: { name: string; ufs: string[] }[] = [
  { name: 'Sul', ufs: ['pr', 'rs', 'sc'] },
  { name: 'Sudeste', ufs: ['sp', 'mg', 'rj', 'es'] },
  { name: 'Centro-Oeste', ufs: ['go', 'mt', 'ms', 'df'] },
  { name: 'Norte', ufs: ['pa', 'am', 'ro', 'to', 'ac', 'ap', 'rr'] },
  { name: 'Nordeste', ufs: ['ba', 'pe', 'ce', 'ma', 'pb', 'rn', 'al', 'pi', 'se'] },
  { name: 'Exterior', ufs: ['zz'] },
];

/**
 * Widths proportional to `weights` filling `total` px with `gap` between items. Items that would
 * be narrower than `minWidth` get exactly `minWidth`; the others share the rest proportionally.
 * Repeated until stable: shrinking the others to make room can push more items below the
 * minimum (a single pass let larger items end up narrower than smaller ones).
 */
export function mosaic(weights: number[], total: number, gap: number, minWidth: number) {
  const usable = total - gap * Math.max(0, weights.length - 1);
  const pinned = weights.map(() => false);
  for (;;) {
    const free = weights.reduce((a, w, i) => (pinned[i] ? a : a + w), 0);
    const room = usable - pinned.filter(Boolean).length * minWidth;
    if (free <= 0 || room <= 0) return weights.map(() => usable / Math.max(1, weights.length));
    const scale = room / free;
    let changed = false;
    weights.forEach((w, i) => {
      if (!pinned[i] && w * scale < minWidth) {
        pinned[i] = true;
        changed = true;
      }
    });
    if (!changed) return weights.map((w, i) => (pinned[i] ? minWidth : w * scale));
  }
}

export type UfTotals = {
  uf: string;
  electorate: number;
  sections: number;
  totalized: number;
  valid: number;
  flavio: number;
  lula: number;
  countedElectorate: number;
  turnout: number;
  notValid: number;
};

/**
 * Composition of a UF's whole electorate, as shares stacked bottom to top: Flávio, Lula, other
 * candidates, blank/null (turnout − valid), absent (counted electorate − turnout); the rest is
 * not counted yet. Sums to 1 when everything is counted.
 */
export function composition(t: UfTotals) {
  const e = t.electorate || 1;
  return {
    flavio: t.flavio / e,
    lula: t.lula / e,
    others: Math.max(0, t.valid - t.flavio - t.lula) / e,
    notValid: t.notValid / e,
    absent: Math.max(0, t.countedElectorate - t.turnout) / e,
  };
}

/** Registered voters per UF from the replay segments (fixed for the whole count). */
export function electorateByUf(file: ReplayFile) {
  const out = new Map<string, number>();
  for (const [m, , , electorate] of file.segments) {
    const uf = file.municipalities[m][0].slice(0, 2);
    out.set(uf, (out.get(uf) ?? 0) + (electorate ?? 0));
  }
  return out;
}

/** Sums of the municipalities of each UF (municipality ids are `uf:00000`). */
export function ufTotals(
  file: ReplayFile,
  municipalities: MunicipalityState[],
  electorate: Map<string, number>,
) {
  const out = new Map<string, UfTotals>();
  file.municipalities.forEach(([id], i) => {
    const uf = id.slice(0, 2),
      m = municipalities[i];
    const t = out.get(uf) ?? {
      uf,
      electorate: electorate.get(uf) ?? 0,
      sections: 0,
      totalized: 0,
      valid: 0,
      flavio: 0,
      lula: 0,
      countedElectorate: 0,
      turnout: 0,
      notValid: 0,
    };
    t.sections += m.sections;
    t.totalized += m.totalized;
    t.valid += m.valid;
    t.flavio += m.flavio;
    t.lula += m.lula;
    t.countedElectorate += m.countedElectorate;
    t.turnout += m.turnout;
    t.notValid += m.notValid;
    out.set(uf, t);
  });
  return out;
}

/** Leader's margin in percentage points of the valid votes counted; null before any vote. */
export const marginPoints = (t: Pick<UfTotals, 'valid' | 'flavio' | 'lula'>) =>
  t.valid > 0 ? ((t.flavio - t.lula) / t.valid) * 100 : null;
