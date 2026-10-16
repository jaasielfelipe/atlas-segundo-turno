/** Replay file written by scripts/build-prototype-data.ts. */
export type ReplayFile = {
  label: string;
  base: string;
  municipalities: [id: string, name: string][];
  segments: [municipality: number, zone: string, sections: number][];
  /** [seconds since base, segment, sections totalized, valid, flavio, lula] */
  events: [number, number, number, number | null, number | null, number | null][];
};

export type MunicipalityState = {
  sections: number;
  totalized: number;
  valid: number;
  flavio: number;
  lula: number;
  /** none: no section counted; counting: some; closed: every segment fully counted. */
  status: 'none' | 'counting' | 'closed';
};

/** One município–zona file that brought newly counted sections (a feed card). */
export type Arrival = {
  at: number;
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
  private readonly latest: { totalized: number; valid: number; flavio: number; lula: number }[];
  private readonly closedSegments: number[];
  private readonly segmentCount: number[];
  private readonly sectionCount: number[];
  private cursor = 0;
  time = -Infinity;
  constructor(readonly file: ReplayFile) {
    this.segmentCount = file.municipalities.map(() => 0);
    this.sectionCount = file.municipalities.map(() => 0);
    for (const [m, , sections] of file.segments) {
      this.segmentCount[m]++;
      this.sectionCount[m] += sections;
    }
    this.municipalities = [];
    this.latest = [];
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
        status: 'none',
      }),
    );
    this.latest.length = 0;
    this.file.segments.forEach(() =>
      this.latest.push({ totalized: 0, valid: 0, flavio: 0, lula: 0 }),
    );
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
      const [at, s, totalized, valid, flavio, lula] = events[this.cursor++];
      const [m, zone, sections] = this.file.segments[s];
      const before = this.latest[s];
      const after = { totalized, valid: valid ?? 0, flavio: flavio ?? 0, lula: lula ?? 0 };
      const mun = this.municipalities[m];
      mun.totalized += after.totalized - before.totalized;
      mun.valid += after.valid - before.valid;
      mun.flavio += after.flavio - before.flavio;
      mun.lula += after.lula - before.lula;
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
