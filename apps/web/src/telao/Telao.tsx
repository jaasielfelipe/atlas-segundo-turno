import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Ticker, { type TickerItem } from '../prototype/Ticker';
import { Serpentine, VictoryBanner, type TrackView } from '../prototype/Serpentine';
import { makeTrack } from '../prototype/track';
import { mosaic, REGIONS } from '../prototype/mosaic';
import type { Arrival } from '../prototype/replay';
import MapView from './MapView';
import { adjustedTarget, TelaoEngine, winner, type Mode, type Official } from './engine';
import '../prototype/prototype.css';
import '../prototype/mosaic.css';
import '../prototype/race.css';
import './telao.css';

const STAGE = { width: 1920, height: 1080 };
const NAMES = { f: 'Flávio Bolsonaro', l: 'Lula' } as const;
/** Synthetic numbers never sit next to real names: neutral labels in the demonstration. */
const DEMO_NAMES = { f: 'Candidatura verde', l: 'Candidatura vermelha' } as const;
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
  const params = new URLSearchParams(location.search);
  const mode: Mode = params.has('demo') ? 'demo' : 'live';
  // ?demo&vitoria: demonstration starting just before the (synthetic) mathematical victory.
  const engine = useMemo(() => new TelaoEngine(mode, params.has('vitoria')), [mode]);
  useEffect(() => engine.start(), [engine]);
  useEngine(engine);
  const scale = useStageScale();
  // ?fundo: the map is the background of the whole stage. Its canvas is centred on the old map
  // column (not offset by camera padding, which skews the globe), larger than the stage and
  // clipped by it, so Brazil keeps the framing, pitch and zoom of the column version.
  const background = params.has('fundo');
  return (
    <div className="t-viewport">
      <div
        className={`t-stage ${background ? 'bg-map' : ''}`}
        style={{
          width: STAGE.width,
          height: STAGE.height,
          transform: `translate(-50%, -50%) scale(${scale})`,
        }}
      >
        {background && (
          <MapView
            engine={engine}
            className="t-map t-map-bg"
            framing={{ top: 128, right: 740, bottom: 118, left: 740 }}
            zoomBoost={0.18}
          />
        )}
        <Header engine={engine} />
        <main className="t-main">
          <ZoneStream engine={engine} />
          <section className="t-center">{!background && <MapView engine={engine} />}</section>
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
        />
        {engine.error && <p className="t-error">{engine.error}</p>}
        <VictoryOverlay engine={engine} />
      </div>
    </div>
  );
}
let closedId = 0;
/** Signed vote difference in millions, e.g. “+4,2 mi”. */
const gap = (v: number) => `${v >= 0 ? '+' : '−'}${mi(Math.abs(v))}`;

function Header({ engine }: { engine: TelaoEngine }) {
  const br = engine.official.br;
  const valid = br ? br.flavio + br.lula : 0;
  const won = winner(br);
  const collecting = engine.status?.collecting ?? false;
  const names = engine.mode === 'demo' ? DEMO_NAMES : NAMES;
  // Exact change vs the 1st round on the closed município–zona units (runner − ghost).
  const n = engine.replay?.national;
  const delta =
    engine.replay?.baseline && n
      ? {
          flavio: n.flavio - n.ghost.exchange.flavio,
          lula: n.lula - n.ghost.exchange.lula,
        }
      : null;
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
          <span className="name">{names.f}</span>
          <span className="share">{valid ? pct(br!.flavio / valid) : '—'}</span>
          <span className="votes">
            {br ? int(br.flavio) : '—'}
            {delta && <em className="delta">{gap(delta.flavio)} vs 1º turno</em>}
          </span>
        </div>
        <div className={`cand l ${won === 'l' ? 'won' : ''}`}>
          <span className="name">{names.l}</span>
          <span className="share">{valid ? pct(br!.lula / valid) : '—'}</span>
          <span className="votes">
            {br ? int(br.lula) : '—'}
            {delta && <em className="delta">{gap(delta.lula)} vs 1º turno</em>}
          </span>
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
        {chips.map((c, i) => (
          // Only the newest lines slide in; a big batch must not blank the list.
          <li key={c.id} className={`${c.side} ${i < 8 ? 'new' : ''}`}>
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
 * Race on the official national aggregate: the whole track as main piece, the camera on the
 * leader as picture-in-picture over the part of the track no runner can reach (beyond ~45% of
 * the registered voters),
 * ghosts = official count with the closed município–zona units swapped for their 1st-round votes
 * (exact; distance to the runner is the change on those units), mathematical victory effect.
 */
function RacePanel({ engine }: { engine: TelaoEngine }) {
  const whole = useMemo(() => makeTrack({ n: 10, width: 780, radius: 25, top: 46, side: 18 }), []);
  const [view, setView] = useState<TrackView | null>(null);
  const state = useRef({
    shown: { flavio: 0, lula: 0, target: 0, gf: 0, gl: 0 },
    history: [] as { t: number; flavio: number; lula: number }[],
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
        const v = engine.victory;
        setView({
          flavio: s.shown.flavio,
          lula: s.shown.lula,
          target: s.shown.target,
          ghost: swap ? { flavio: s.shown.gf, lula: s.shown.gl } : null,
          before: s.history[0] ?? { flavio: 0, lula: 0 },
          victory: v ? { winner: v.winner, elapsed: now - v.at } : null,
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
  // ?chegada: the whole track is the race to the adjusted target (half of the valid votes still
  // possible); otherwise 0–55% of the registered voters with the fixed 50% line.
  const finish = new URLSearchParams(location.search).has('chegada');
  const total = finish ? view.target : br.electorate * TRACK_SHARE;
  return (
    <section className={`t-race ${view.victory ? `won ${view.victory.winner}` : ''}`}>
      <div className="t-track">
        <Serpentine
          track={whole}
          view={view}
          total={total}
          fixed={finish ? null : br.electorate / 2}
        />
      </div>
      <p className="t-race-legend">
        <i className="ring f" />
        <i className="ring l" /> mesmo candidato com os votos do 1º turno nas zonas já encerradas
      </p>
    </section>
  );
}

/**
 * States by region: area = registered voters (fixed). Lula's votes hang from the top, Flávio's
 * rise from the bottom, both as shares of the UF's registered voters; the gap between them is
 * everything else (other votes, absent, not counted yet) and closes as the count advances.
 */
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
    8, // minimum px: only the smallest states are widened (see mosaic())
  );
  const widthOf = new Map(ordered.map(([uf], i) => [uf, widths[i]]));
  return (
    <section className="t-mosaic" aria-label="Apuração por UF">
      <div className="t-mosaic-board" ref={board}>
        {groups.map((g) => {
          const regionWidth =
            g.rows.reduce((a, [uf]) => a + (widthOf.get(uf) ?? 0), 0) +
            GAP * Math.max(0, g.rows.length - 1);
          return (
            <div key={g.name} className="mos-region" style={{ width: `${regionWidth}px` }}>
              <h2>{g.name}</h2>
              <div className="mos-cols">
                {g.rows.map(([uf, o]) => {
                  const w = widthOf.get(uf) ?? 0;
                  return (
                    <div key={uf} className="mos-col" style={{ width: `${w}px` }}>
                      <div className="glass">
                        <i
                          className="band lula"
                          style={{ height: `${(o.lula / o.electorate) * 100}%` }}
                        />
                        <i
                          className="band flavio"
                          style={{ height: `${(o.flavio / o.electorate) * 100}%` }}
                        />
                      </div>
                      <span className={w < 16 ? 'uf narrow' : 'uf'}>
                        {uf === 'zz' ? 'EX' : uf.toUpperCase()}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mos-legend">
        área: eleitores aptos · vermelho desce do topo, verde sobe da base · vazio entre eles:
        demais aptos e ainda não apurado
      </p>
    </section>
  );
}

/**
 * Mathematical victory over the whole telão: edge glow in the winner's colour, fireworks across
 * the stage and the banner in the middle for 8 s; afterwards only the header keeps the mark.
 * Shown only when guaranteed by the published numbers; nothing animated under reduced motion.
 */
function VictoryOverlay({ engine }: { engine: TelaoEngine }) {
  const [elapsed, setElapsed] = useState<number | null>(null);
  useEffect(() => {
    let frame = 0;
    const step = () => {
      const v = engine.victory;
      setElapsed(v ? performance.now() - v.at : null);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [engine]);
  const v = engine.victory;
  if (!v || elapsed === null || elapsed > 9000) return null;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const name =
    engine.mode === 'demo'
      ? `${v.winner === 'f' ? 'candidatura verde' : 'candidatura vermelha'} · 2º turno sintético`
      : NAMES[v.winner];
  return (
    <div className={`t-victory ${v.winner} ${elapsed > 8000 ? 'leaving' : ''}`}>
      {!reduced && <StageBursts elapsed={elapsed} winner={v.winner} />}
      <VictoryBanner winner={v.winner} elapsed={Math.min(elapsed, 6999)} name={name} />
    </div>
  );
}

/** Five deterministic fireworks across the stage, each 2 s, staggered over the first 3.5 s. */
function StageBursts({ elapsed, winner }: { elapsed: number; winner: 'f' | 'l' }) {
  const origins = [
    [960, 430, 0],
    [520, 300, 500],
    [1400, 320, 900],
    [700, 700, 1400],
    [1250, 680, 1900],
  ];
  const parts = [];
  for (const [x, y, delay] of origins) {
    const t = (elapsed - delay) / 2000;
    if (t < 0 || t > 1) continue;
    for (let i = 0; i < 40; i++) {
      const angle = (i / 40) * Math.PI * 2 + delay;
      const speed = 160 + ((i * 53 + delay) % 120);
      const d = speed * (1 - (1 - t) ** 2);
      parts.push(
        <circle
          key={`${delay}-${i}`}
          cx={x + Math.cos(angle) * d}
          cy={y + Math.sin(angle) * d + 80 * t * t}
          r={5 * (1 - t) + 1}
          className={`burst ${winner} ${i % 3 === 0 ? 'light' : ''}`}
          style={{ opacity: 1 - t }}
        />,
      );
    }
  }
  return (
    <svg className="t-bursts" viewBox="0 0 1920 1080" aria-hidden="true">
      {parts}
    </svg>
  );
}
