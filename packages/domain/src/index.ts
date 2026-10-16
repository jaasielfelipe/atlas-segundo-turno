export type Environment = 'official' | 'simulated' | 'fixture';
export type Office = 'president' | 'governor';
/** Round of the 2026 general election ("turno"). */
export type Round = '1' | '2';
export type Layer = 'result' | 'coverage' | 'comparison';
export interface Territory {
  id: string;
  kind: 'br' | 'uf' | 'municipality' | 'exterior';
  name: string;
  uf: string | null;
  tseCode: string | null;
  ibgeCode: string | null;
  parentId: string | null;
}
export interface CandidateResult {
  id: string;
  number: string;
  name: string;
  party: string;
  destination: string | null;
  countedVotes: number | null;
  validShare: number | null;
}
export interface Snapshot {
  id: string;
  environment: Environment;
  electionId: string;
  office: Office;
  territoryId: string;
  round: Round;
  phase: 's' | 'o';
  basis: 'ea20' | 'synthetic';
  capturedAt: string;
  sourceGeneratedAt: string;
  sourceTotalizedAt: string | null;
  sourceIdg: string;
  sourceUrl: string;
  digest: string;
  rawDigest: string;
  status: 'updated' | 'not_published';
  progress: 'n' | 'p' | 'f';
  finalTotalization: boolean;
  sections: { total: number; totalized: number; share: number | null };
  electorate: {
    total: number;
    totalized: number;
    installed: number;
    turnout: number;
    share: number | null;
    turnoutShare: number | null;
  };
  votes: {
    total: number | null;
    valid: number | null;
    toCandidates: number | null;
    blank: number | null;
    null: number | null;
    annulled: number | null;
    subJudice: number | null;
  };
  candidates: CandidateResult[];
  warnings: string[];
}
export interface WatchEntry {
  territoryId: string;
  enabled: boolean;
  createdAt: string;
  collectBu: false;
}
export interface Bootstrap {
  environment: Environment;
  dataset: string;
  capabilities: { officialCollection: boolean; cohort: boolean; historical: false };
  territories: Territory[];
  watchlist: WatchEntry[];
  captures: string[];
  fixtureStep: number;
  fixtureSteps: number;
}

export function ratio(numerator: number | null, denominator: number | null): number | null {
  if (
    numerator === null ||
    denominator === null ||
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(denominator) ||
    denominator <= 0 ||
    numerator < 0 ||
    numerator > denominator
  )
    return null;
  return numerator / denominator;
}
export function deltaPp(current: number | null, historical: number | null): number | null {
  if (
    current === null ||
    historical === null ||
    !Number.isFinite(current) ||
    !Number.isFinite(historical) ||
    current < 0 ||
    current > 1 ||
    historical < 0 ||
    historical > 1
  )
    return null;
  return 100 * (current - historical);
}
// These adapters support the 2026 cycle. Brasília is UTC-03:00 throughout 2026.
// A future historical adapter must resolve the IANA offset for its own date.
export function tseTimestamp(date: string, time: string): string {
  if (!/^\d{2}\/\d{2}\/2026$/.test(date) || !/^\d{2}:\d{2}:\d{2}$/.test(time))
    throw Error('Data/hora TSE 2026 inválida');
  const [d, m, y] = date.split('/');
  const local = `${y}-${m}-${d}T${time}`;
  const ms = Date.parse(`${local}-03:00`);
  if (!Number.isFinite(ms) || new Date(ms - 3 * 3600_000).toISOString().slice(0, 19) !== local)
    throw Error('Data/hora TSE inválida');
  return new Date(ms).toISOString();
}
export function asOf<T extends { capturedAt: string }>(snapshots: T[], at: string): T | null {
  return (
    snapshots
      .filter((s) => s.capturedAt <= at)
      .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
      .at(-1) ?? null
  );
}
export const analyticalSeries = {
  bolsonaro: { '2018': 'Jair Bolsonaro', '2022': 'Jair Bolsonaro', '2026': 'Flávio Bolsonaro' },
  lula_haddad: {
    '2018': 'Fernando Haddad',
    '2022': 'Luiz Inácio Lula da Silva',
    '2026': 'Luiz Inácio Lula da Silva',
  },
} as const; // Labels only. No candidate identities resolved by name.
