import type { Official } from '../../../api/src/telao';
import {
  finalVotes,
  ReplayState,
  synthetic2T,
  type Arrival,
  type NationalState,
  type Pair,
  type ReplayFile,
} from '../prototype/replay';
import { OnceQueue } from '../prototype/feed';
import { electorateByUf, ufTotals } from '../prototype/mosaic';

export type { Official };
export type Mode = 'live' | 'demo';
export type Closed = Arrival & Pair & { valid: number; swing: number | null };
type Bootstrap = {
  version: string;
  base: string;
  municipalities: [string, string][];
  segments: [number, string, number, number][];
  baseline: (FirstRound | null)[] | null;
};
type FirstRound = Pair & { valid: number };

const POLL_EVENTS_MS = 3_000,
  POLL_OFFICIAL_MS = 5_000,
  POLL_STATUS_MS = 10_000;

/**
 * Data engine of the telão. Zone versions (município–zona) feed the same incremental
 * `ReplayState` used by the prototypes: map, zone stream, closed-municipality ticker and the
 * exact 1st-round ghost difference. The scoreboard, race and mosaic use the official EA20
 * aggregates (Brazil and UFs), never sums of zones.
 *
 * live: polls the local API (`/api/telao/*`); demo: the real 1st-round replay turned into a
 * SYNTHETIC 2nd round on a fast clock, labelled as such on screen.
 */
export class TelaoEngine {
  file: ReplayFile | null = null;
  replay: ReplayState | null = null;
  official: { br: Official | null; ufs: Map<string, Official> } = { br: null, ufs: new Map() };
  status: { collecting: boolean; collector: unknown } | null = null;
  error = '';
  readonly closed = new OnceQueue<Closed>();
  /** Bumped on every change; React subscribes through `subscribe`/`version`. */
  version = 0;
  /** Bumped when the zone state starts over (bootstrap, demo restart): views rebuild. */
  generation = 0;
  /** 1st-round final votes per segment (finalists, valid); null without a baseline. */
  firstRoundSegments: FirstRound[] | null = null;
  private listeners = new Set<() => void>();
  private arrivalListeners = new Set<(a: Arrival[]) => void>();
  private timers: number[] = [];
  private frame = 0;
  private cursor = 0;
  private bootVersion = '';
  /** Each start() is a run; work from an older run (e.g. StrictMode remount) stops itself. */
  private run = 0;
  /** Demo clock (seconds since base) and speed (simulated seconds per real second). */
  demo = { simulated: 0, speed: 60, start: 0, end: 0 };

  constructor(readonly mode: Mode) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getVersion = () => this.version;
  onArrivals(listener: (a: Arrival[]) => void) {
    this.arrivalListeners.add(listener);
    return () => this.arrivalListeners.delete(listener);
  }
  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }
  private deliver(arrivals: Arrival[]) {
    if (!arrivals.length || !this.replay || !this.file) return;
    for (const a of arrivals) {
      if (!a.closes) continue;
      const m = this.replay.municipalities[a.municipality];
      // Margin change (p.p. of valid) vs the 1st round in the same municipality, all closed.
      const first = this.firstRound?.[a.municipality];
      const swing =
        first && first.valid > 0 && m.valid > 0
          ? ((m.flavio - m.lula) / m.valid - (first.flavio - first.lula) / first.valid) * 100
          : null;
      this.closed.push(this.file.municipalities[a.municipality][0], {
        ...a,
        flavio: m.flavio,
        lula: m.lula,
        valid: m.valid,
        swing,
      });
    }
    for (const l of this.arrivalListeners) l(arrivals);
  }
  /** 1st-round final votes per municipality (finalists, valid), from the baseline. */
  private firstRound: FirstRound[] | null = null;
  private setFirstRound(file: ReplayFile, perSegment: (FirstRound | null)[] | null) {
    this.firstRoundSegments = perSegment?.every((b) => b !== null)
      ? (perSegment as FirstRound[])
      : null;
    if (!perSegment) return (this.firstRound = null);
    const out = file.municipalities.map(() => ({ flavio: 0, lula: 0, valid: 0 }));
    perSegment.forEach((b, s) => {
      if (!b) return;
      const m = out[file.segments[s][0]];
      m.flavio += b.flavio;
      m.lula += b.lula;
      m.valid += b.valid;
    });
    this.firstRound = out;
  }

  start() {
    this.stop();
    const run = ++this.run;
    if (this.mode === 'demo') this.startDemo(run);
    else this.startLive();
    return () => {
      if (run === this.run) this.stop();
    };
  }
  stop() {
    this.run++;
    this.timers.forEach((t) => window.clearInterval(t));
    this.timers = [];
    cancelAnimationFrame(this.frame);
  }

  // ---- live ----
  private async api<T>(path: string): Promise<T> {
    const response = await fetch(path);
    const body = await response.json();
    if (!response.ok) throw Error(body.error ?? `HTTP ${response.status}`);
    return body as T;
  }
  private async bootstrap() {
    const boot = await this.api<Bootstrap>('/api/telao/bootstrap');
    const file: ReplayFile = {
      label: 'Oficial TSE · 2º turno',
      base: boot.base,
      municipalities: boot.municipalities,
      segments: boot.segments,
      events: [],
    };
    // Ghosts only with a complete baseline (every segment has its 1st-round result).
    const baseline = boot.baseline?.every((b) => b !== null) ? (boot.baseline as Pair[]) : null;
    this.setFirstRound(file, boot.baseline);
    this.file = file;
    this.replay = new ReplayState(file, baseline ?? undefined);
    this.cursor = 0;
    this.bootVersion = boot.version;
    this.closed.clear();
    this.generation++;
  }
  private async pollEvents(): Promise<void> {
    try {
      if (!this.replay) await this.bootstrap();
      const batch = await this.api<{ events: ReplayFile['events']; last: number; version: string }>(
        `/api/telao/events?after=${this.cursor}`,
      );
      if (batch.version && batch.version !== this.bootVersion) {
        await this.bootstrap(); // registry or segment sizes changed: rebuild from scratch
        return this.pollEvents();
      }
      if (batch.events.length) {
        this.file!.events.push(...batch.events);
        this.cursor = batch.last;
        this.deliver(this.replay!.advanceTo(Number.MAX_SAFE_INTEGER));
      }
      this.error = '';
    } catch (e) {
      this.error = (e as Error).message;
    }
    this.emit();
  }
  private async pollOfficial() {
    try {
      const all = await this.api<Record<string, Official>>('/api/telao/official');
      this.official = {
        br: all.br ?? null,
        ufs: new Map(Object.entries(all).filter(([k]) => k !== 'br')),
      };
    } catch (e) {
      this.error = (e as Error).message;
    }
    this.emit();
  }
  private async pollStatus() {
    try {
      this.status = await this.api('/api/telao/status');
    } catch {
      this.status = null;
    }
    this.emit();
  }
  private startLive() {
    void this.pollEvents();
    void this.pollOfficial();
    void this.pollStatus();
    this.timers.push(
      window.setInterval(() => void this.pollEvents(), POLL_EVENTS_MS),
      window.setInterval(() => void this.pollOfficial(), POLL_OFFICIAL_MS),
      window.setInterval(() => void this.pollStatus(), POLL_STATUS_MS),
    );
  }

  // ---- demo ----
  private startDemo(run: number) {
    fetch('/dev/replay-round1.json')
      .then((r) => {
        if (!r.ok) throw Error('Dados da demonstração ausentes: pnpm prototype:data');
        return r.json() as Promise<ReplayFile>;
      })
      .then((real) => {
        if (run !== this.run) return;
        const file = synthetic2T(real);
        this.file = file;
        const finals = finalVotes(real);
        this.replay = new ReplayState(file, finals);
        const valid = real.segments.map(() => 0);
        for (const e of real.events) valid[e[1]] = e[3] ?? 0;
        this.setFirstRound(
          file,
          finals.map((f, s) => ({ ...f, valid: valid[s] })),
        );
        const electorate = electorateByUf(file);
        this.demo.start = this.replay.firstCount() - 60;
        this.demo.end = this.replay.lastEvent();
        this.demo.simulated = this.demo.start;
        this.generation++;
        let lastFrame = performance.now(),
          lastEmit = 0;
        const step = (now: number) => {
          if (run !== this.run) return;
          const dt = Math.min(100, now - lastFrame);
          lastFrame = now;
          this.demo.simulated += (dt / 1000) * this.demo.speed;
          if (this.demo.simulated > this.demo.end + 600) this.restartDemo();
          this.deliver(this.replay!.advanceTo(this.demo.simulated));
          if (now - lastEmit > 250) {
            lastEmit = now;
            // Demo "official" aggregates: the synthetic replay itself (labelled on screen).
            this.official = {
              br: fromNational(this.replay!.national, this.at()),
              ufs: new Map(
                [...ufTotals(file, this.replay!.municipalities, electorate)].map(([uf, t]) => [
                  uf,
                  {
                    capturedAt: this.at(),
                    generatedAt: this.at(),
                    sections: t.sections,
                    totalized: t.totalized,
                    electorate: t.electorate,
                    abstention: Math.max(0, t.countedElectorate - t.turnout),
                    turnout: t.turnout,
                    notValid: t.notValid,
                    valid: t.valid,
                    flavio: t.flavio,
                    lula: t.lula,
                  },
                ]),
              ),
            };
            this.status = { collecting: true, collector: null };
            this.emit();
          }
          this.frame = requestAnimationFrame(step);
        };
        this.frame = requestAnimationFrame(step);
      })
      .catch((e) => {
        this.error = (e as Error).message;
        this.emit();
      });
  }
  restartDemo() {
    if (!this.replay) return;
    this.demo.simulated = this.demo.start;
    this.replay.reset();
    this.closed.clear();
    this.generation++;
  }
  /** Current instant: demo clock, or the latest official capture in live mode. */
  at() {
    if (this.mode === 'demo' && this.file)
      return new Date(Date.parse(this.file.base) + this.demo.simulated * 1000).toISOString();
    return this.official.br?.capturedAt ?? null!;
  }
}

/** Official-shaped summary of the replay's national sums (demo only). */
export function fromNational(n: NationalState, at: string): Official {
  return {
    capturedAt: at,
    generatedAt: at,
    sections: n.sections,
    totalized: n.totalized,
    electorate: n.electorate,
    abstention: Math.max(0, n.countedElectorate - n.turnout),
    turnout: n.turnout,
    notValid: n.notValid,
    valid: n.valid,
    flavio: n.flavio,
    lula: n.lula,
  };
}

/**
 * Mathematical victory from an official aggregate: more than half of the largest valid total
 * still possible (registered − abstentions − non-valid counted so far).
 */
export function winner(o: Official | null): 'f' | 'l' | null {
  if (!o) return null;
  const target = (o.electorate - o.abstention - o.notValid) / 2;
  return o.flavio > target ? 'f' : o.lula > target ? 'l' : null;
}
export const adjustedTarget = (o: Official) =>
  Math.max(0, (o.electorate - o.abstention - o.notValid) / 2);
