import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Ticker, { type TickerItem } from '../prototype/Ticker';
import { Serpentine, VictoryBanner, zoomBump, type TrackView } from '../prototype/Serpentine';
import { makeTrack } from '../prototype/track';
import { marginPoints, mosaic, REGIONS } from '../prototype/mosaic';
import type { Arrival } from '../prototype/replay';
import MapView from './MapView';
import { adjustedTarget, TelaoEngine, winner, type Mode, type Official } from './engine';
import '../prototype/prototype.css';
import '../prototype/mosaic.css';
import '../prototype/race.css';
import './telao.css';

const STAGE = { width: 1920, height: 1080 };
const NAMES = { f: 'Flávio Bolsonaro', l: 'Lula' } as const;
/** Track length in votes: 55% of registered voters. */
const TRACK_SHARE = 0.55;
/** Highlighted increment on the track: votes gained in the last 5 minutes of bulletins. */
const INCREMENT_MS = 5 * 60_000;

const int = (v: number) => new Intl.NumberFormat('pt-BR').format(Math.round(v));
const pct = (v: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
    v * 100,
  ) + '%';
const pp1 = (v: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
    Math.abs(v),
  );
const mi = (v: number) =>
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(v / 1e6) + ' mi';
const time = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(new Date(iso))
    : '—';

function useEngine(engine: TelaoEngine) {
  useSyncExternalStore(engine.subscribe, engine.getVersion);
  return engine;
}

/** Fixed 1920×1080 stage scaled to the window (no scrolling at any size). */
function useStageScale() {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const fit = () =>
      setScale(Math.min(window.innerWidth / STAGE.width, window.innerHeight / STAGE.height));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return scale;
}

/**
 * Telão of the presidential 2nd round (25/10/2026). `/telao`: official TSE data from the local
 * API; `/telao?demo`: the real 1st-round replay turned into a SYNTHETIC 2nd round, labelled.
 */
export default function Telao() {
  const mode: Mode = new URLSearchParams(location.search).has('demo') ? 'demo' : 'live';
  const engine = useMemo(() => new TelaoEngine(mode), [mode]);
  useEffect(() => engine.start(), [engine]);
  useEngine(engine);
  const scale = useStageScale();
  return (
    <div className="t-viewport">
      <div
        className="t-stage"
        style={{
          width: STAGE.width,
          height: STAGE.height,
          transform: `translate(-50%, -50%) scale(${scale})`,
        }}
      >
        <Header engine={engine} />
        <main className="t-main">
          <section className="t-left">
            <MapView engine={engine} />
            <ZoneStream engine={engine} />
          </section>
          <section className="t-right">
            <RacePanel engine={engine} />
            <MosaicPanel engine={engine} />
          </section>
        </main>
        <Ticker
          label="Municípios encerrados"
          note={engine.mode === 'demo' ? '2º turno sintético' : '▲ margem vs 1º turno'}
          pull={() => {
            const c = engine.closed.next();
            if (!c || !engine.file) return null;
            const [id, name] = engine.file.municipalities[c.municipality];
            return {
              id: closedId++,
              name,
              uf: id.slice(0, 2).toUpperCase(),
              flavio: c.flavio,
              lula: c.lula,
              valid: c.valid,
              swing: c.swing,
            } satisfies TickerItem;
          }}
          backlog={() => engine.closed.waiting}
        />
        {engine.error && <p className="t-error">{engine.error}</p>}
      </div>
    </div>
  );
}
let closedId = 0;

function Header({ engine }: { engine: TelaoEngine }) {
  const br = engine.official.br;
  const valid = br ? br.flavio + br.lula : 0;
  const won = winner(br);
  const collecting = engine.status?.collecting ?? false;
  return (
    <header className="t-head">
      <div className="t-title">
        <strong>Atlas · 2º turno</strong>
        <span>Presidente · Brasil · 25/10/2026</span>
        {engine.mode === 'demo' ? (
          <em className="badge demo">Demonstração · 2º turno sintético</em>
        ) : (
          <em className="badge official">Oficial TSE</em>
        )}
      </div>
      <div className="t-score">
        <div className={`cand f ${won === 'f' ? 'won' : ''}`}>
          <span className="name">{NAMES.f}</span>
          <span className="share">{valid ? pct(br!.flavio / valid) : '—'}</span>
          <span className="votes">{br ? int(br.flavio) : '—'}</span>
        </div>
        <div className={`cand l ${won === 'l' ? 'won' : ''}`}>
          <span className="name">{NAMES.l}</span>
          <span className="share">{valid ? pct(br!.lula / valid) : '—'}</span>
          <span className="votes">{br ? int(br.lula) : '—'}</span>
        </div>
      </div>
      <div className="t-progress">
        <span className="big">{br && br.sections ? pct(br.totalized / br.sections) : '—'}</span>
        <span>das seções apuradas</span>
        <small>
          <i className={`dot ${collecting ? 'on' : ''}`} />
          {engine.mode === 'demo'
            ? `relógio do replay ${time(engine.at())}`
            : `${collecting ? 'coletando' : 'coletor parado'} · boletim TSE ${time(br?.generatedAt ?? null)}`}
        </small>
      </div>
    </header>
  );
}

type Chip = {
  id: number;
  uf: string;
  name: string;
  zone: string;
  text: string;
  side: 'f' | 'l' | 't';
};
const sideOf = (v: number): Chip['side'] => (v > 0 ? 'f' : v < 0 ? 'l' : 't');

/**
 * Every município–zona bulletin, small and fast. With the 1st-round baseline, the number is the
 * margin change (p.p.) vs the 1st round in that same zone, coloured by direction; without it, the
 * bulletin's own margin in votes, coloured by who got more.
 */
function ZoneStream({ engine }: { engine: TelaoEngine }) {
  const [chips, setChips] = useState<Chip[]>([]);
  const [tally, setTally] = useState({ f: 0, l: 0, t: 0, n: 0 });
  useEffect(() => {
    let pending: Chip[] = [],
      id = 0;
    const recent: { at: number; side: Chip['side'] }[] = [];
    let generation = engine.generation;
    const off = engine.onArrivals((arrivals: Arrival[]) => {
      if (generation !== engine.generation) {
        generation = engine.generation;
        pending = [];
        recent.length = 0;
        setChips([]);
      }
      const first = engine.firstRoundSegments;
      for (const a of arrivals) {
        if (!engine.file || !engine.replay) continue;
        const [key, name] = engine.file.municipalities[a.municipality];
        let value: number, text: string;
        const now = engine.replay.segment(a.segment);
        const before = first?.[a.segment];
        if (before && before.valid > 0 && now.valid > 0) {
          value =
            ((now.flavio - now.lula) / now.valid - (before.flavio - before.lula) / before.valid) *
            100;
          text = value === 0 ? '±0' : `▲${pp1(value)}`;
        } else {
          value = a.addedFlavio - a.addedLula;
          text = value === 0 ? '±0' : `+${int(Math.abs(value))}`;
        }
        const side = sideOf(value);
        pending.push({
          id: id++,
          uf: key.slice(0, 2).toUpperCase(),
          name,
          zone: a.zone,
          text,
          side,
        });
        recent.push({ at: a.at, side });
      }
      const latest = recent.at(-1)?.at ?? 0;
      while (recent.length && recent[0].at < latest - 60) recent.shift();
    });
    const flush = window.setInterval(() => {
      if (pending.length) {
        const batch = pending.slice(-60).reverse();
        pending = [];
        setChips((xs) => [...batch, ...xs].slice(0, 60));
      }
      const t = { f: 0, l: 0, t: 0, n: recent.length };
      for (const r of recent) t[r.side]++;
      setTally(t);
    }, 250);
    return () => {
      off();
      window.clearInterval(flush);
    };
  }, [engine]);
  return (
    <aside className="t-stream" aria-label="Boletins por zona">
      <header>
        <strong>Boletins por zona</strong>
        <span>{int(tally.n)} no último minuto</span>
        <div className="tally">
          {(['f', 'l', 't'] as const).map((k) =>
            tally[k] ? (
              <i key={k} className={k} style={{ flexGrow: tally[k] }}>
                {tally[k] > 9 ? int(tally[k]) : ''}
              </i>
            ) : null,
          )}
        </div>
        <small>
          {engine.firstRoundSegments
            ? 'número: margem vs 1º turno na mesma zona (p.p.)'
            : 'número: margem do boletim em votos'}
        </small>
      </header>
      <ol>
        {chips.map((c) => (
          <li key={c.id} className={c.side}>
            <span className="place">
              {c.uf} · {c.name} <small>z{Number(c.zone)}</small>
            </span>
            <span className="n">{c.text}</span>
          </li>
        ))}
      </ol>
    </aside>
  );
}

/**
 * Race on the official national aggregate: camera on the leader, the whole track beside it,
 * ghosts = official count with the closed município–zona units swapped for their 1st-round votes
 * (exact; distance to the runner is the change on those units), mathematical victory effect.
 */
function RacePanel({ engine }: { engine: TelaoEngine }) {
  const camera = useMemo(() => makeTrack({ n: 8, width: 1880, radius: 28 }), []);
  const whole = useMemo(() => makeTrack({ n: 10, width: 640, radius: 22, top: 40, side: 16 }), []);
  const [view, setView] = useState<TrackView | null>(null);
  const state = useRef({
    shown: { flavio: 0, lula: 0, target: 0, gf: 0, gl: 0 },
    history: [] as { t: number; flavio: number; lula: number }[],
    victory: null as { winner: 'f' | 'l'; at: number } | null,
    generation: -1,
  });
  useEffect(() => {
    let frame = 0,
      last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      const s = state.current;
      const br = engine.official.br;
      if (s.generation !== engine.generation) {
        s.generation = engine.generation;
        s.history = [];
        s.victory = null;
        s.shown = { flavio: 0, lula: 0, target: 0, gf: 0, gl: 0 };
      }
      if (br) {
        const target = adjustedTarget(br);
        // Ghost: official minus the exact change on closed units (zone data vs 1st round).
        const n = engine.replay?.national;
        const swap = engine.replay?.baseline && n ? n.ghost.exchange : null;
        const gf = swap && n ? br.flavio - (n.flavio - swap.flavio) : 0;
        const gl = swap && n ? br.lula - (n.lula - swap.lula) : 0;
        const k = 1 - Math.exp(-dt / 350);
        const ease = (a: number, b: number) => (a ? a + (b - a) * k : b);
        s.shown = {
          flavio: ease(s.shown.flavio, br.flavio),
          lula: ease(s.shown.lula, br.lula),
          target: ease(s.shown.target, target),
          gf: ease(s.shown.gf, gf),
          gl: ease(s.shown.gl, gl),
        };
        const t = Date.parse(br.capturedAt);
        if (!s.history.length || t - s.history.at(-1)!.t >= 30_000)
          s.history.push({ t, flavio: br.flavio, lula: br.lula });
        while (s.history.length > 2 && s.history[1].t < t - INCREMENT_MS) s.history.shift();
        const w = winner(br);
        if (w && !s.victory) s.victory = { winner: w, at: now };
        if (!w) s.victory = null;
        setView({
          flavio: s.shown.flavio,
          lula: s.shown.lula,
          target: s.shown.target,
          ghost: swap ? { flavio: s.shown.gf, lula: s.shown.gl } : null,
          before: s.history[0] ?? { flavio: 0, lula: 0 },
          victory: s.victory ? { winner: s.victory.winner, elapsed: now - s.victory.at } : null,
        });
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [engine]);
  const br = engine.official.br;
  if (!view || !br)
    return <section className="t-race empty">Aguardando o agregado oficial…</section>;
  const total = br.electorate * TRACK_SHARE;
  const gap = (now: number, then: number) =>
    then > 0 ? `${now >= then ? '+' : '−'}${mi(Math.abs(now - then))}` : '—';
  return (
    <section className={`t-race ${view.victory ? `won ${view.victory.winner}` : ''}`}>
      <div className="t-camera race-camera">
        <Serpentine
          track={camera}
          view={view}
          total={total}
          fixed={br.electorate / 2}
          camera={{ zoom: 4 + 2 * zoomBump(view.victory?.elapsed ?? null), aspect: 600 / 470 }}
        />
        {view.victory && (
          <VictoryBanner
            {...view.victory}
            name={
              engine.mode === 'demo'
                ? `${view.victory.winner === 'f' ? 'candidatura verde' : 'candidatura vermelha'} · 2º turno sintético`
                : NAMES[view.victory.winner]
            }
          />
        )}
      </div>
      <div className="t-whole">
        <Serpentine track={whole} view={view} total={total} fixed={br.electorate / 2} compact />
        {view.ghost && (
          <dl className="race-ghost">
            <div>
              <dt>
                <i className="ring f" /> vs 1º turno nas mesmas zonas
              </dt>
              <dd className="f">{gap(br.flavio, view.ghost.flavio)}</dd>
            </div>
            <div>
              <dt>
                <i className="ring l" /> vs 1º turno nas mesmas zonas
              </dt>
              <dd className="l">{gap(br.lula, view.ghost.lula)}</dd>
            </div>
          </dl>
        )}
        <p className="race-note">
          Pista: 0–55% dos aptos · linha amarela: meta ajustada (metade dos válidos ainda possíveis)
          · anel: zonas encerradas com os votos do 1º turno
        </p>
      </div>
    </section>
  );
}

/** States by region: area = registered voters (fixed); Flávio and Lula as shares of it. */
function MosaicPanel({ engine }: { engine: TelaoEngine }) {
  const board = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = board.current;
    if (!el) return;
    const observer = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const ufs = engine.official.ufs;
  const groups = REGIONS.map((g) => ({
    name: g.name === 'Exterior' ? 'Ext.' : g.name,
    rows: g.ufs
      .map((uf) => [uf, ufs.get(uf)] as const)
      .filter((x): x is readonly [string, Official] => !!x[1])
      .sort((a, b) => b[1].electorate - a[1].electorate || a[0].localeCompare(b[0])),
  }));
  const ordered = groups.flatMap((g) => g.rows);
  const GAP = 3,
    REGION_GAP = 12;
  const widths = mosaic(
    ordered.map(([, o]) => o.electorate),
    Math.max(0, width - REGION_GAP * (groups.length - 1)),
    GAP,
    18,
  );
  const widthOf = new Map(ordered.map(([uf], i) => [uf, widths[i]]));
  const side = (m: number | null) => (m === null ? '' : m > 0 ? 'f' : m < 0 ? 'l' : 't');
  return (
    <section className="t-mosaic" aria-label="Apuração por UF">
      <div className="t-mosaic-board" ref={board}>
        {groups.map((g) => {
          const sum = (k: keyof Official) => g.rows.reduce((a, [, o]) => a + (o[k] as number), 0);
          const m = marginPoints({ valid: sum('valid'), flavio: sum('flavio'), lula: sum('lula') });
          const regionWidth =
            g.rows.reduce((a, [uf]) => a + (widthOf.get(uf) ?? 0), 0) +
            GAP * Math.max(0, g.rows.length - 1);
          return (
            <div key={g.name} className="mos-region" style={{ width: `${regionWidth}px` }}>
              <h2>
                <span>
                  {g.name}{' '}
                  <span className={`margin ${side(m)}`}>
                    {m === null ? '' : `+${Math.round(Math.abs(m))}`}
                  </span>
                </span>
                <small>
                  {sum('sections')
                    ? `${Math.round((sum('totalized') / sum('sections')) * 100)}%`
                    : '—'}
                </small>
              </h2>
              <div className="mos-cols">
                {g.rows.map(([uf, o]) => {
                  const w = widthOf.get(uf) ?? 0;
                  const mu = marginPoints(o);
                  return (
                    <div key={uf} className="mos-col" style={{ width: `${w}px` }}>
                      <span
                        className={`margin ${side(mu)}`}
                        style={{ fontSize: `${Math.max(9, Math.min(15, w * 0.32))}px` }}
                      >
                        {mu === null ? '' : `+${Math.round(Math.abs(mu))}`}
                      </span>
                      <div className="glass">
                        <i
                          className="band flavio"
                          style={{ height: `${(o.flavio / o.electorate) * 100}%` }}
                        />
                        <i
                          className="band lula"
                          style={{ height: `${(o.lula / o.electorate) * 100}%` }}
                        />
                      </div>
                      <span className="uf">{uf === 'zz' ? 'EXT' : uf.toUpperCase()}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mos-legend">
        área: eleitores aptos · cores: votos de cada um · vazio: demais aptos e não apurado ·
        número: vantagem do líder (p.p. dos válidos)
      </p>
    </section>
  );
}
