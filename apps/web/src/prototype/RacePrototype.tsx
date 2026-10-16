import { useEffect, useMemo, useRef, useState } from 'react';
import { ReplayState, type NationalState, type ReplayFile } from './replay';
import { along, makeTrack, path, point, tick, type Track } from './track';
import './race.css';

const SPEEDS = [30, 60, 120, 300];
/** Track length in votes: 55% of registered voters (as in the 1st round). */
const TRACK_SHARE = 0.55;
/** Highlighted increment: votes gained in the last 5 minutes of counting. */
const INCREMENT_SECONDS = 300;
/** Tug-of-war scale: two-way share from 50% ± 15 p.p. */
const ROPE_RANGE = 0.15;

const int = (v: number) => new Intl.NumberFormat('pt-BR').format(Math.round(v));
const mi = (v: number) =>
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(v / 1e6) + ' mi';
const pct = (v: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
    v * 100,
  ) + '%';
const clock = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

type View = {
  at: string;
  nat: NationalState;
  /** Eased values for drawing (votes). */
  flavio: number;
  lula: number;
  target: number;
  /** Votes 5 minutes earlier (increment start). */
  before: { flavio: number; lula: number };
  /** Two-way share of Flávio sampled once per counting minute (tug-of-war trail). */
  trail: number[];
};

/**
 * Race experiments on the real 1st-round replay (Flávio × Lula, other candidates exist): a
 * longer serpentine, the same track through a race camera that follows the leaders, and a
 * tug-of-war of the two-way share. Same clock for all three.
 */
export default function RacePrototype() {
  const [view, setView] = useState<View | null>(null);
  const [speed, setSpeed] = useState(120);
  const [error, setError] = useState('');
  const control = useRef({ speed, restart: () => {} });
  control.current.speed = speed;

  useEffect(() => {
    let frame = 0,
      disposed = false;
    fetch('/dev/replay-round1.json')
      .then((r) => r.json() as Promise<ReplayFile>)
      .then((file) => {
        if (disposed) return;
        const replay = new ReplayState(file);
        const start = replay.firstCount() - 60,
          end = replay.lastEvent();
        let simulated = start,
          last = performance.now(),
          shown = { flavio: 0, lula: 0, target: 0 };
        let history: { at: number; flavio: number; lula: number }[] = [];
        let trail: number[] = [];
        control.current.restart = () => {
          simulated = start;
          replay.reset();
          shown = { flavio: 0, lula: 0, target: 0 };
          history = [];
          trail = [];
        };
        const step = (now: number) => {
          if (disposed) return;
          const dt = Math.min(100, now - last);
          last = now;
          simulated += (dt / 1000) * control.current.speed;
          if (simulated > end + 300) control.current.restart();
          replay.advanceTo(simulated);
          const nat = replay.national;
          // Half of the valid votes still possible: registered − abstentions − non-valid so far.
          const abstentions = nat.countedElectorate - nat.turnout;
          const target = Math.max(0, (nat.electorate - abstentions - nat.notValid) / 2);
          // Ease toward the counted values (the live telão receives steps every few seconds).
          const k = 1 - Math.exp(-dt / 350);
          shown = {
            flavio: shown.flavio + (nat.flavio - shown.flavio) * k,
            lula: shown.lula + (nat.lula - shown.lula) * k,
            target: shown.target ? shown.target + (target - shown.target) * k : target,
          };
          if (!history.length || simulated - history.at(-1)!.at >= 30) {
            history.push({ at: simulated, flavio: nat.flavio, lula: nat.lula });
            while (history.length > 2 && history[1].at < simulated - INCREMENT_SECONDS)
              history.shift();
            if (nat.flavio + nat.lula > 0 && history.length % 2 === 0)
              trail = [...trail, nat.flavio / (nat.flavio + nat.lula)].slice(-40);
          }
          setView({
            at: new Date(Date.parse(file.base) + simulated * 1000).toISOString(),
            nat: { ...nat },
            ...shown,
            before: history[0] ?? { flavio: 0, lula: 0 },
            trail,
          });
          frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
      })
      .catch((e) => setError(`${e.message}. Gere os dados com: pnpm prototype:data`));
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
    };
  }, []);

  const long = useMemo(() => makeTrack({ n: 8, width: 1880, radius: 28 }), []);

  if (error) return <p className="race-error">{error}</p>;
  if (!view) return <p className="race-error">Carregando replay…</p>;
  const nat = view.nat;
  const total = nat.electorate * TRACK_SHARE;
  return (
    <div className="race">
      <header className="race-top">
        <div>
          <h1>Protótipo · corrida</h1>
          <p>
            <strong>Replay real do 1º turno</strong> (Flávio × Lula entre 12 candidaturas; no 2º
            turno só os dois). Três experimentos no mesmo relógio.
          </p>
        </div>
        <div className="race-hud">
          <span>{clock(view.at)}</span>
          <span>{pct(nat.totalized / nat.sections)} das seções</span>
          <span className="f">{int(nat.flavio)}</span>
          <span className="l">{int(nat.lula)}</span>
        </div>
        <label>
          Velocidade{' '}
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => control.current.restart()}>Recomeçar</button>
      </header>

      <section className="race-a">
        <h2>
          A · serpentina longa <small>8 retas, ~2,7× a pista do 1º turno · 0 a 55% dos aptos</small>
        </h2>
        <Serpentine track={long} view={view} total={total} fixed={nat.electorate / 2} />
      </section>

      <section className="race-b">
        <h2>
          B · câmera de corrida{' '}
          <small>mesma pista, 3× mais perto, seguindo o líder; o outro na borda</small>
        </h2>
        <Serpentine
          track={long}
          view={view}
          total={total}
          fixed={nat.electorate / 2}
          camera={{ zoom: 3, aspect: 940 / 400 }}
        />
      </section>

      <section className="race-c">
        <h2>
          C · cabo de guerra <small>divisão dos votos entre os dois · 50% ± 15 p.p.</small>
        </h2>
        <Rope view={view} />
      </section>
    </div>
  );
}

function Serpentine({
  track,
  view,
  total,
  fixed,
  camera,
}: {
  track: Track;
  view: View;
  total: number;
  fixed: number;
  camera?: { zoom: number; aspect: number };
}) {
  const statics = useMemo(() => {
    const ticks: { key: number; line: ReturnType<typeof tick>; major: boolean }[] = [];
    const labels: { key: number; x: number; y: number }[] = [];
    if (total > 0)
      for (let v = 1e6; v < total; v += 1e6) {
        const u = along(track, v, total),
          major = v % 5e6 === 0;
        ticks.push({ key: v, major, line: tick(track, u, major ? -16 : -16, major ? 16 : -11) });
        const p = point(track, u, 0);
        if (major && p.straight) labels.push({ key: v, x: p.x, y: p.y - 20 });
      }
    return {
      ticks,
      labels,
      asphalt: total > 0 ? path(track, 0, total, 0, total, 6) : '',
    };
  }, [track, total]);
  if (total <= 0) return null;
  const runners = [
    { key: 'f', votes: view.flavio, before: view.before.flavio, lane: -7 },
    { key: 'l', votes: view.lula, before: view.before.lula, lane: 7 },
  ];
  let viewBox = `0 0 ${track.width} ${track.height}`;
  let frameRect: { x: number; y: number; w: number; h: number } | null = null;
  // Off-frame runner (camera only): a marker on the frame edge with the gap in votes.
  let behind: { x: number; y: number; key: string; gap: number } | null = null;
  if (camera) {
    // Follow the leader closely; the other runner may be far behind on the same straight.
    const leader = runners[0].votes >= runners[1].votes ? runners[0] : runners[1],
      other = leader === runners[0] ? runners[1] : runners[0];
    const w = track.width / camera.zoom,
      h = w / camera.aspect;
    const c = point(track, Math.max(0, along(track, leader.votes, total) - w * 0.1), leader.lane);
    const x = Math.max(0, Math.min(track.width - w, c.x - w / 2)),
      y = Math.max(0, Math.min(Math.max(0, track.height - h), c.y - h / 2));
    viewBox = `${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`;
    frameRect = { x, y, w, h };
    const o = point(track, along(track, other.votes, total), other.lane);
    const m = 26;
    if (o.x < x || o.x > x + w || o.y < y || o.y > y + h)
      behind = {
        x: Math.max(x + m, Math.min(x + w - m, o.x)),
        y: Math.max(y + m, Math.min(y + h - m, o.y)),
        key: other.key,
        gap: leader.votes - other.votes,
      };
  }
  const targetU = along(track, view.target, total),
    fixedU = along(track, fixed, total);
  const svg = (box: string, mini = false) => (
    <svg viewBox={box} className={mini ? 'serp mini' : 'serp'} preserveAspectRatio="xMidYMid meet">
      <path d={statics.asphalt} className="serp-asphalt" />
      {!mini &&
        statics.ticks.map((t) => (
          <line key={t.key} {...t.line} className={t.major ? 'serp-tick major' : 'serp-tick'} />
        ))}
      {!mini &&
        statics.labels.map((l) => (
          <text key={l.key} x={l.x} y={l.y} className="serp-scale" textAnchor="middle">
            {mi(l.key)}
          </text>
        ))}
      {runners.map((r) => (
        <g key={r.key} className={r.key}>
          {r.before > 0 && (
            <path d={path(track, 0, r.before, r.lane, total)} className="serp-progress" />
          )}
          {r.votes > r.before && (
            <path d={path(track, r.before, r.votes, r.lane, total)} className="serp-increment" />
          )}
        </g>
      ))}
      <line {...tick(track, fixedU, -20, 20)} className="serp-fixed" />
      <line {...tick(track, targetU, -20, 20)} className="serp-target" />
      {!mini && (
        <>
          <text
            {...(({ x, y }) => ({ x, y: y - 26 }))(point(track, fixedU, 0))}
            className="serp-finish"
            textAnchor="middle"
          >
            50% dos aptos
          </text>
          <text
            {...(({ x, y }) => ({ x, y: y + 36 }))(point(track, targetU, 0))}
            className="serp-finish target"
            textAnchor="middle"
          >
            meta ajustada
          </text>
        </>
      )}
      {runners.map((r) => {
        const p = point(track, along(track, r.votes, total), r.lane);
        return (
          <circle
            key={r.key}
            cx={p.x}
            cy={p.y}
            r={mini ? 12 : 7}
            className={`serp-head ${r.key}`}
          />
        );
      })}
      {!mini && behind && (
        <g className={`serp-behind ${behind.key}`}>
          <circle cx={behind.x} cy={behind.y} r={9} />
          <text x={behind.x} y={behind.y - 16} textAnchor="middle">
            −{mi(behind.gap)}
          </text>
        </g>
      )}
      {mini && frameRect && (
        <rect
          {...{ ...frameRect, width: frameRect.w, height: frameRect.h }}
          className="serp-frame"
        />
      )}
    </svg>
  );
  return (
    <div className="serp-wrap">
      {svg(viewBox)}
      {camera && (
        <div className="serp-minimap">{svg(`0 0 ${track.width} ${track.height}`, true)}</div>
      )}
    </div>
  );
}

function Rope({ view }: { view: View }) {
  const W = 940,
    H = 400,
    cx = W / 2,
    half = 400,
    y = 190;
  const sum = view.flavio + view.lula;
  const share = sum > 0 ? view.flavio / sum : 0.5;
  // Flávio pulls left, Lula right (same order as the ticker).
  const x = (s: number) =>
    cx - (Math.max(-ROPE_RANGE, Math.min(ROPE_RANGE, s - 0.5)) / ROPE_RANGE) * half;
  const knot = x(share);
  const lead = share > 0.5 ? 'f' : share < 0.5 ? 'l' : 't';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="rope" role="img" aria-label="Cabo de guerra">
      {[-0.15, -0.1, -0.05, 0, 0.05, 0.1, 0.15].map((d) => (
        <g key={d}>
          <line
            x1={x(0.5 + d)}
            x2={x(0.5 + d)}
            y1={y - 40}
            y2={y + 40}
            className={d ? 'rope-grid' : 'rope-mid'}
          />
          {/* Each side shows the share of whoever pulls toward it (Flávio left, Lula right). */}
          <text
            x={x(0.5 + d)}
            y={y + 64}
            className={`rope-scale ${d > 0 ? 'f' : d < 0 ? 'l' : ''}`}
            textAnchor="middle"
          >
            {`${Math.round((0.5 + Math.abs(d)) * 100)}%`}
          </text>
        </g>
      ))}
      <line x1={cx - half} x2={cx + half} y1={y} y2={y} className="rope-line" />
      <line x1={cx} x2={knot} y1={y} y2={y} className={`rope-pull ${lead}`} />
      {view.trail.map((s, i) => (
        <circle
          key={i}
          cx={x(s)}
          cy={y}
          r={4}
          className={`rope-trail ${s > 0.5 ? 'f' : 'l'}`}
          style={{ opacity: ((i + 1) / view.trail.length) * 0.5 }}
        />
      ))}
      <circle cx={knot} cy={y} r={17} className={`rope-knot ${lead}`} />
      <text x={30} y={y - 80} className="rope-end f">
        {sum ? pct(share) : '—'}
      </text>
      <text x={W - 30} y={y - 80} className="rope-end l" textAnchor="end">
        {sum ? pct(1 - share) : '—'}
      </text>
      <text x={knot} y={y - 34} className={`rope-margin ${lead}`} textAnchor="middle">
        {sum ? `+${int(Math.abs(view.flavio - view.lula))}` : ''}
      </text>
    </svg>
  );
}
