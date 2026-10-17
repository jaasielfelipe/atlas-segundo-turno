/** Replay file written by scripts/build-prototype-data.ts. */
export type ReplayFile = {
  label: string;
  base: string;
  municipalities: [id: string, name: string][];
  segments: [municipality: number, zone: string, sections: number, electorate?: number][];
  /**
   * [seconds since base, segment, sections totalized, valid, flavio, lula, electorate of counted
   * sections, turnout, turnout − valid]
   */
  events: [
    number,
    number,
    number,
    number | null,
    number | null,
    number | null,
    number?,
    number?,
    number?,
  ][];
};

/** National sums of every segment's latest version (replay only; the telão uses EA20 BR). */
export type NationalState = {
  sections: number;
  totalized: number;
  electorate: number;
  countedElectorate: number;
  turnout: number;
  notValid: number;
  valid: number;
  flavio: number;
  lula: number;
  /**
   * Where each finalist would be with the 1st-round votes of the same units (only with a
   * baseline): `complete` counts município–zona segments fully counted now; `proportional`
   * also counts partial segments in proportion to the sections counted (an estimate);
   * `exchange` is the current count with every fully counted segment replaced by its 1st-round
   * votes — exact, and its gap to the runner is the change on closed units only.
   */
  ghost: { complete: Pair; proportional: Pair; exchange: Pair };
};
export type Pair = { flavio: number; lula: number };

export type MunicipalityState = {
  sections: number;
  totalized: number;
  valid: number;
  flavio: number;
  lula: number;
  /** Electorate of the counted sections, turnout and turnout − valid (absent, blank/null). */
  countedElectorate: number;
  turnout: number;
  notValid: number;
  /** none: no section counted; counting: some; closed: every segment fully counted. */
  status: 'none' | 'counting' | 'closed';
};

/** One município–zona file that brought newly counted sections (a feed card). */
export type Arrival = {
  at: number;
  /** Segment index in `file.segments`. */
  segment: number;
  municipality: number;
  zone: string;
  addedSections: number;
  sections: number;
  totalized: number;
  addedValid: number;
  addedFlavio: number;
  addedLula: number;
  /** This bulletin completed the last open segment of its municipality. */
  closes: boolean;
};

/**
 * Municipal totals at any replay instant, as the sum of the latest version of each of the
 * municipality's segments (an exact partition). Moves forward incrementally; `reset` rewinds.
 */
export class ReplayState {
  readonly municipalities: MunicipalityState[];
  private readonly latest: {
    totalized: number;
    valid: number;
    flavio: number;
    lula: number;
    est: number;
    turnout: number;
    notValid: number;
  }[];
  readonly national: NationalState;
  private readonly closedSegments: number[];
  private readonly segmentCount: number[];
  private readonly sectionCount: number[];
  private cursor = 0;
  time = -Infinity;
  /** `baseline`: 1st-round final votes of each segment (same order as `file.segments`). */
  constructor(
    readonly file: ReplayFile,
    readonly baseline?: Pair[],
  ) {
    this.segmentCount = file.municipalities.map(() => 0);
    this.sectionCount = file.municipalities.map(() => 0);
    for (const [m, , sections] of file.segments) {
      this.segmentCount[m]++;
      this.sectionCount[m] += sections;
    }
    this.municipalities = [];
    this.latest = [];
    this.national = {
      sections: file.segments.reduce((n, s) => n + s[2], 0),
      electorate: file.segments.reduce((n, s) => n + (s[3] ?? 0), 0),
      totalized: 0,
      countedElectorate: 0,
      turnout: 0,
      notValid: 0,
      valid: 0,
      flavio: 0,
      lula: 0,
      ghost: {
        complete: { flavio: 0, lula: 0 },
        proportional: { flavio: 0, lula: 0 },
        exchange: { flavio: 0, lula: 0 },
      },
    };
    this.closedSegments = [];
    this.reset();
  }
  reset() {
    this.cursor = 0;
    this.time = -Infinity;
    this.municipalities.length = 0;
    this.file.municipalities.forEach((_, i) =>
      this.municipalities.push({
        sections: this.sectionCount[i],
        totalized: 0,
        valid: 0,
        flavio: 0,
        lula: 0,
        countedElectorate: 0,
        turnout: 0,
        notValid: 0,
        status: 'none',
      }),
    );
    this.latest.length = 0;
    this.file.segments.forEach(() =>
      this.latest.push({
        totalized: 0,
        valid: 0,
        flavio: 0,
        lula: 0,
        est: 0,
        turnout: 0,
        notValid: 0,
      }),
    );
    if (this.national)
      Object.assign(this.national, {
        totalized: 0,
        countedElectorate: 0,
        turnout: 0,
        notValid: 0,
        valid: 0,
        flavio: 0,
        lula: 0,
        ghost: {
          complete: { flavio: 0, lula: 0 },
          proportional: { flavio: 0, lula: 0 },
          exchange: { flavio: 0, lula: 0 },
        },
      });
    this.closedSegments.length = 0;
    this.file.municipalities.forEach(() => this.closedSegments.push(0));
  }
  /** Applies every event up to `t` (seconds since base); returns the arrivals in order. */
  advanceTo(t: number): Arrival[] {
    if (t < this.time) this.reset();
    this.time = t;
    const arrivals: Arrival[] = [];
    const events = this.file.events;
    while (this.cursor < events.length && events[this.cursor][0] <= t) {
      const [at, s, totalized, valid, flavio, lula, est, turnout, notValid] = events[this.cursor++];
      const [m, zone, sections] = this.file.segments[s];
      const before = this.latest[s];
      const after = {
        totalized,
        valid: valid ?? 0,
        flavio: flavio ?? 0,
        lula: lula ?? 0,
        est: est ?? 0,
        turnout: turnout ?? 0,
        notValid: notValid ?? 0,
      };
      const nat = this.national;
      nat.totalized += after.totalized - before.totalized;
      nat.countedElectorate += after.est - before.est;
      nat.turnout += after.turnout - before.turnout;
      nat.notValid += after.notValid - before.notValid;
      nat.valid += after.valid - before.valid;
      nat.flavio += after.flavio - before.flavio;
      nat.lula += after.lula - before.lula;
      const mun = this.municipalities[m];
      mun.totalized += after.totalized - before.totalized;
      mun.valid += after.valid - before.valid;
      mun.flavio += after.flavio - before.flavio;
      mun.lula += after.lula - before.lula;
      mun.countedElectorate += after.est - before.est;
      mun.turnout += after.turnout - before.turnout;
      mun.notValid += after.notValid - before.notValid;
      if (this.baseline) {
        const b = this.baseline[s],
          g = nat.ghost;
        const whole = (x: { totalized: number }) => (x.totalized === sections ? 1 : 0);
        const part = (x: { totalized: number }) => (sections ? x.totalized / sections : 0);
        g.complete.flavio += b.flavio * (whole(after) - whole(before));
        g.complete.lula += b.lula * (whole(after) - whole(before));
        g.proportional.flavio += b.flavio * (part(after) - part(before));
        g.proportional.lula += b.lula * (part(after) - part(before));
        const swap = (x: { totalized: number; flavio: number; lula: number }) => (whole(x) ? b : x);
        g.exchange.flavio += swap(after).flavio - swap(before).flavio;
        g.exchange.lula += swap(after).lula - swap(before).lula;
      }
      this.closedSegments[m] +=
        Number(after.totalized === sections) - Number(before.totalized === sections);
      this.latest[s] = after;
      const was = mun.status;
      mun.status =
        this.closedSegments[m] === this.segmentCount[m]
          ? 'closed'
          : mun.totalized > 0
            ? 'counting'
            : 'none';
      if (after.totalized > before.totalized)
        arrivals.push({
          at,
          segment: s,
          municipality: m,
          zone,
          addedSections: after.totalized - before.totalized,
          sections,
          totalized: after.totalized,
          addedValid: after.valid - before.valid,
          addedFlavio: after.flavio - before.flavio,
          addedLula: after.lula - before.lula,
          closes: was !== 'closed' && mun.status === 'closed',
        });
    }
    return arrivals;
  }
  /** Latest version of segment `s` (votes and sections counted). */
  segment(s: number) {
    const x = this.latest[s];
    return { totalized: x.totalized, valid: x.valid, flavio: x.flavio, lula: x.lula };
  }
  /** First instant with a counted section (seconds since base). */
  firstCount() {
    return this.file.events.find((e) => e[2] > 0)?.[0] ?? 0;
  }
  lastEvent() {
    return this.file.events.at(-1)?.[0] ?? 0;
  }
}

/** Height of a municipality's prism for each candidate scale (metres in map units). */
export type HeightMode = 'votes' | 'points' | 'weighted';
export function margin(m: MunicipalityState) {
  const votes = m.flavio - m.lula;
  return {
    leader: votes > 0 ? 1 : votes < 0 ? -1 : 0,
    votes: Math.abs(votes),
    points: m.valid > 0 ? (Math.abs(votes) / m.valid) * 100 : 0,
    counted: m.sections > 0 ? m.totalized / m.sections : 0,
  };
}
export function height(m: MunicipalityState, mode: HeightMode) {
  const g = margin(m);
  if (m.status === 'none') return 0;
  // √ keeps São Paulo from flattening everything else; points ignore size; weighted grows with
  // the share already counted, so one early section cannot raise a full tower.
  if (mode === 'votes') return Math.sqrt(g.votes) * 900;
  if (mode === 'points') return g.points * 2500;
  return g.points * g.counted * 2500;
}

/** Final votes of each segment in a replay (its last version): the 1st-round baseline. */
export function finalVotes(file: ReplayFile): Pair[] {
  const out: Pair[] = file.segments.map(() => ({ flavio: 0, lula: 0 }));
  for (const e of file.events) out[e[1]] = { flavio: e[4] ?? 0, lula: e[5] ?? 0 };
  return out;
}

/**
 * SYNTHETIC 2nd round for visual tests only: the real 1st-round timing and turnout, with every
 * other candidate's valid votes split between the finalists by a fixed per-municipality share
 * (deterministic, 30–70%). Not a model of anything; always labelled as synthetic on screen.
 */
export function synthetic2T(file: ReplayFile): ReplayFile {
  const share = file.municipalities.map(([id]) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
    return 0.3 + (((h >>> 0) % 1000) / 1000) * 0.4;
  });
  return {
    ...file,
    label: '2º turno SINTÉTICO derivado do replay do 1º turno — apenas para teste visual',
    events: file.events.map((e) => {
      const [at, s, totalized, valid, flavio, lula, ...rest] = e;
      if (valid === null || flavio === null || lula === null) return e;
      const others = valid - flavio - lula,
        a = share[file.segments[s][0]];
      const toFlavio = Math.round(others * a);
      return [
        at,
        s,
        totalized,
        valid,
        flavio + toFlavio,
        lula + others - toFlavio,
        ...rest,
      ] as ReplayFile['events'][number];
    }),
  };
}

/**
 * Mathematical victory in a two-candidate round: a finalist has more than half of the largest
 * valid total still possible (registered − abstentions − non-valid counted so far), i.e. crossed
 * the adjusted target. No result of the remaining sections can change it.
 */
export function victor(nat: NationalState): 'f' | 'l' | null {
  const abstentions = nat.countedElectorate - nat.turnout;
  const target = (nat.electorate - abstentions - nat.notValid) / 2;
  return nat.flavio > target ? 'f' : nat.lula > target ? 'l' : null;
}
