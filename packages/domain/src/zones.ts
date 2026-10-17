import type { Environment, Round } from './index';

export type ZoneSegment = { uf: string; municipality: string; zone: string };
export const segmentId = (s: ZoneSegment) => `${s.uf}:${s.municipality}:${s.zone}`;
export const wholeZoneId = (s: ZoneSegment) => `${s.uf}:${s.zone}`;

/** Electorate and vote categories of one segment version; null when not published. */
export type ZoneCounts = {
  electorate: number | null;
  turnout: number | null;
  valid: number | null;
  blank: number | null;
  null: number | null;
  annulled: number | null;
  /** Electorate of the counted sections (absent = this − turnout); not stored by old versions. */
  countedElectorate?: number | null;
};
export type ZoneResult = ZoneSegment & {
  id: string;
  environment: Environment;
  election: string;
  round: Round;
  capturedAt: string;
  sourceUrl: string;
  sourceDigest: string;
  status: 'complete' | 'partial' | 'needs_review';
  total: number;
  totalized: number;
  notTotalized: number;
  counts: ZoneCounts;
  candidates: { id: string; votes: number }[];
};
/** One round as stored: its registry (segments) and every captured segment version. */
export type RoundData = {
  environment: Environment;
  round: Round;
  election: string;
  registryDigest: string;
  segments: ZoneSegment[];
  results: ZoneResult[];
};
/** Official candidate identifiers (sqcand) of the two finalists, the same in both rounds. */
export type Finalists = { flavio: string; lula: string };

/**
 * Leader of a unit: `flavio`, `lula`, `outros` (another candidate, 1st round only) or `empate`.
 * Highest valid vote among all candidates; no absolute majority required.
 */
export const leaders = ['flavio', 'lula', 'outros', 'empate'] as const;
export type Leader = (typeof leaders)[number];

const safe = (n: number | null): n is number => n !== null && Number.isSafeInteger(n) && n >= 0;

/**
 * A segment version usable in the cohort: whole segment totalized (`ts>0`, `snt=0`, `st=ts`),
 * status complete, all counts published and consistent, candidates summing to the valid votes.
 * In the 2nd round the candidates must be exactly the two finalists.
 */
export function validResult(r: ZoneResult, finalists: Finalists) {
  const c = r.counts;
  if (
    r.status !== 'complete' ||
    !(r.total > 0 && r.totalized === r.total && r.notTotalized === 0) ||
    !safe(c.electorate) ||
    !safe(c.turnout) ||
    !safe(c.valid) ||
    !safe(c.blank) ||
    !safe(c.null) ||
    !safe(c.annulled) ||
    c.valid === 0 ||
    c.turnout > c.electorate ||
    c.valid + c.blank + c.null + c.annulled > c.turnout ||
    !r.candidates.length ||
    new Set(r.candidates.map((x) => x.id)).size !== r.candidates.length ||
    !r.candidates.every((x) => x.id.length > 0 && safe(x.votes)) ||
    r.candidates.reduce((n, x) => n + x.votes, 0) !== c.valid
  )
    return false;
  if (r.round === '2')
    return (
      r.candidates.length === 2 &&
      r.candidates.some((x) => x.id === finalists.flavio) &&
      r.candidates.some((x) => x.id === finalists.lula)
    );
  return true;
}

/** Votes of a set of segments in one round. Categories add up to the electorate exactly. */
export type RoundTotals = {
  electorate: number;
  turnout: number;
  abstention: number;
  valid: number;
  flavio: number;
  lula: number;
  /** Other candidates' valid votes (always 0 in the 2nd round). */
  others: number;
  /** Turnout minus valid: blank, null, annulled and sub judice. */
  notValid: number;
  blank: number;
  null: number;
};
function totals(rows: ZoneResult[], finalists: Finalists): RoundTotals {
  const t: RoundTotals = {
    electorate: 0,
    turnout: 0,
    abstention: 0,
    valid: 0,
    flavio: 0,
    lula: 0,
    others: 0,
    notValid: 0,
    blank: 0,
    null: 0,
  };
  for (const r of rows) {
    const c = r.counts;
    t.electorate += c.electorate!;
    t.turnout += c.turnout!;
    t.valid += c.valid!;
    t.blank += c.blank!;
    t.null += c.null!;
    for (const x of r.candidates)
      if (x.id === finalists.flavio) t.flavio += x.votes;
      else if (x.id === finalists.lula) t.lula += x.votes;
      else t.others += x.votes;
  }
  t.abstention = t.electorate - t.turnout;
  t.notValid = t.turnout - t.valid;
  return t;
}
/** Leader of valid rows (valid > 0 guaranteed by validResult). */
export function leader(rows: ZoneResult[], finalists: Finalists): Leader {
  const votes = new Map<string, number>();
  for (const r of rows)
    for (const x of r.candidates) votes.set(x.id, (votes.get(x.id) ?? 0) + x.votes);
  const max = Math.max(...votes.values());
  const top = [...votes].filter(([, v]) => v === max);
  if (top.length > 1) return 'empate';
  return top[0][0] === finalists.flavio
    ? 'flavio'
    : top[0][0] === finalists.lula
      ? 'lula'
      : 'outros';
}
/** Share of `part` in `whole`; null when the denominator is zero (never 0 by default). */
export const share = (part: number, whole: number) => (whole > 0 ? part / whole : null);

/** Latest version of each segment captured up to `at` (no future information). */
function latestBySegment(results: ZoneResult[], round: Round, election: string, at: string) {
  const latest = new Map<string, ZoneResult>();
  for (const r of results) {
    if (r.capturedAt > at) continue;
    if (r.round !== round || r.election !== election) throw Error('Turno/eleição misturados');
    const key = segmentId(r),
      prev = latest.get(key);
    if (prev?.capturedAt === r.capturedAt && prev.id !== r.id)
      throw Error('Versões simultâneas ambíguas');
    if (!prev || prev.capturedAt < r.capturedAt) latest.set(key, r);
  }
  return latest;
}
function unitsOf(data: RoundData, scope: { uf?: string; municipality?: string }) {
  const units = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const s of data.segments) {
    if (!/^[a-z]{2}$/.test(s.uf) || !/^\d{5}$/.test(s.municipality) || !/^\d{4}$/.test(s.zone))
      throw Error('Identificador territorial inválido');
    const id = segmentId(s);
    if (seen.has(id)) throw Error('Cadastro duplicado');
    seen.add(id);
    if (
      (scope.uf && s.uf !== scope.uf) ||
      (scope.municipality && s.municipality !== scope.municipality)
    )
      continue;
    const key = scope.municipality ? id : wholeZoneId(s);
    units.set(key, [...(units.get(key) ?? []), id]);
  }
  return units;
}

export type RowStatus =
  | 'included'
  | 'pending'
  | 'needs_review'
  | 'registry_changed'
  | 'first_round_incomplete';

/**
 * 1st × 2nd round on the same units: whole electoral zones (Brazil/UF) or município–zona units
 * (municipality) complete in the 2nd round up to `at`, complete in the 1st round, with the same
 * segments in both registries. Sums of votes, never averages of zone percentages.
 */
export function compareRounds(
  first: RoundData,
  second: RoundData,
  finalists: Finalists,
  at: string,
  scope: { uf?: string; municipality?: string } = {},
) {
  if (!Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at)
    throw Error('Instante inválido');
  if (scope.municipality && !scope.uf) throw Error('Município exige UF');
  if (first.round !== '1' || second.round !== '2') throw Error('Turnos invertidos');
  if (first.environment !== second.environment) throw Error('Ambientes misturados');
  if (!finalists.flavio || !finalists.lula || finalists.flavio === finalists.lula)
    throw Error('Finalistas não resolvidos');
  const unitKind = scope.municipality ? ('municipality_zone' as const) : ('whole_zone' as const);
  const before = unitsOf(first, scope),
    now = unitsOf(second, scope);
  const latest1 = latestBySegment(first.results, '1', first.election, at),
    latest2 = latestBySegment(second.results, '2', second.election, at);
  type Side = RoundTotals & { leader: Leader };
  const rows: {
    key: string;
    status: RowStatus;
    observedAt: string | null;
    first: Side | null;
    second: Side | null;
  }[] = [];
  let completed = 0;
  const pack = (rs: ZoneResult[]): Side => ({
    ...totals(rs, finalists),
    leader: leader(rs, finalists),
  });
  for (const [key, segments] of now) {
    const current = segments.map((s) => latest2.get(s));
    const complete = current.every((r) => r && validResult(r, finalists));
    if (complete) completed++;
    const earlier = before.get(key) ?? [];
    const previous = earlier.map((s) => latest1.get(s));
    const sameRegistry =
      earlier.length === segments.length && segments.every((s) => earlier.includes(s));
    const status: RowStatus = !complete
      ? current.some((r) => r?.status === 'needs_review')
        ? 'needs_review'
        : 'pending'
      : !sameRegistry
        ? 'registry_changed'
        : !previous.every((r) => r && validResult(r, finalists))
          ? 'first_round_incomplete'
          : 'included';
    rows.push({
      key,
      status,
      observedAt: current.every((r) => r)
        ? current
            .map((r) => r!.capturedAt)
            .sort()
            .at(-1)!
        : null,
      first: status === 'included' ? pack(previous as ZoneResult[]) : null,
      second: status === 'included' ? pack(current as ZoneResult[]) : null,
    });
  }
  const cohort = rows.filter((r) => r.status === 'included');
  const sum = (side: 'first' | 'second') => {
    const t = totals([], finalists);
    for (const r of cohort)
      for (const k of Object.keys(t) as (keyof RoundTotals)[]) t[k] += r[side]![k];
    return t;
  };
  const a = sum('first'),
    b = sum('second');
  const shares = (t: RoundTotals) => ({
    flavio: share(t.flavio, t.valid),
    lula: share(t.lula, t.valid),
    others: share(t.others, t.valid),
    ofElectorate: {
      flavio: share(t.flavio, t.electorate),
      lula: share(t.lula, t.electorate),
      others: share(t.others, t.electorate),
      notValid: share(t.notValid, t.electorate),
      abstention: share(t.abstention, t.electorate),
    },
  });
  // Leadership transitions (territorial counts, not vote transfers): rows 1st round, cols 2nd.
  const matrix = leaders.map(() => leaders.map(() => 0));
  for (const r of cohort)
    matrix[leaders.indexOf(r.first!.leader)][leaders.indexOf(r.second!.leader)]++;
  const count = (side: 'first' | 'second') =>
    Object.fromEntries(
      leaders.map((l) => [l, cohort.filter((r) => r[side]!.leader === l).length]),
    ) as Record<Leader, number>;
  const difference = Object.fromEntries(
    (Object.keys(a) as (keyof RoundTotals)[]).map((k) => [k, b[k] - a[k]]),
  ) as RoundTotals;
  const excludedStatuses = [
    'pending',
    'needs_review',
    'registry_changed',
    'first_round_incomplete',
  ] as const;
  return {
    environment: second.environment,
    basis: 'same_units_both_rounds' as const,
    at,
    unitKind,
    coverage: { expected: now.size, completed, comparable: cohort.length },
    excluded: Object.fromEntries(
      excludedStatuses.map((s) => [s, rows.filter((r) => r.status === s).length]),
    ) as Record<(typeof excludedStatuses)[number], number>,
    first: { totals: a, shares: shares(a), leaders: count('first') },
    second: { totals: b, shares: shares(b), leaders: count('second') },
    /** 2nd minus 1st round in the same units, per category (adds up to the electorate change). */
    difference,
    transitions: { classes: leaders, matrix },
    rows,
  };
}
export type RoundComparison = ReturnType<typeof compareRounds>;
