import { useEffect, useMemo, useRef, useState } from 'react';
import {
  finalVotes,
  ReplayState,
  synthetic2T,
  victor,
  type NationalState,
  type Pair,
  type ReplayFile,
} from './replay';
import { along, makeTrack, path, point, tick, type Track } from './track';
import './race.css';

const SPEEDS = [30, 60, 120, 300];
/** Track length in votes: 55% of registered voters (as in the 1st round). */
const TRACK_SHARE = 0.55;
/** Highlighted increment: votes gained in the last 5 minutes of counting. */
const INCREMENT_SECONDS = 300;
type GhostMode = 'exchange' | 'complete' | 'proportional';

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
  /** Eased 1st-round position of each finalist on the same units (ghost). */
  ghost: Pair;
  /** Votes 5 minutes earlier (increment start). */
  before: Pair;
  /** Mathematical victory: who and how long ago (ms of real time) it was first observed. */
  victory: { winner: 'f' | 'l'; elapsed: number } | null;
};

/** First replay instant (seconds) with a mathematical victory, or null. */
function victoryTime(replay: ReplayState) {
  replay.reset();
  for (const e of replay.file.events) {
    replay.advanceTo(e[0]);
    if (victor(replay.national)) {
      const at = e[0];
      replay.reset();
      return at;
    }
  }
  replay.reset();
  return null;
}

/**
 * Race prototype: a race camera that follows the leader (main piece) and the whole track beside
 * it, both with a ghost per lane — where the same candidate would be with the 1st-round votes of
 * the same município–zona units counted so far (not chronological). The 2nd round here is
 * SYNTHETIC (derived from the real 1st-round replay); the ghosts are the real 1st round.
 */
export default function RacePrototype() {
  const [view, setView] = useState<View | null>(null);
  const [speed, setSpeed] = useState(120);
  const [mode, setMode] = useState<GhostMode>('exchange');
  const [error, setError] = useState('');
  const control = useRef({
    speed,
    mode,
    restart: () => {},
    /** Jump to a few seconds before the mathematical victory. */
    toVictory: () => {},
    /** Replay the effect without moving the clock. */
    replayEffect: () => {},
  });
  control.current.speed = speed;
  control.current.mode = mode;

  useEffect(() => {
    let frame = 0,
      disposed = false;
    fetch('/dev/replay-round1.json')
      .then((r) => r.json() as Promise<ReplayFile>)
      .then((file) => {
        if (disposed) return;
        const replay = new ReplayState(synthetic2T(file), finalVotes(file));
        const start = replay.firstCount() - 60,
          end = replay.lastEvent();
        const crossing = victoryTime(replay);
        let simulated = start,
          last = performance.now();
        let victoryAt: { winner: 'f' | 'l'; at: number } | null = null;
        let shown = { flavio: 0, lula: 0, target: 0, ghost: { flavio: 0, lula: 0 } };
        let history: { at: number; flavio: number; lula: number }[] = [];
        control.current.restart = () => {
          simulated = start;
          replay.reset();
          shown = { flavio: 0, lula: 0, target: 0, ghost: { flavio: 0, lula: 0 } };
          history = [];
          victoryAt = null;
        };
        control.current.toVictory = () => {
          if (crossing === null) return;
          control.current.restart();
          simulated = crossing - 40;
          victoryAt = null;
        };
        control.current.replayEffect = () => {
          if (victoryAt) victoryAt = { ...victoryAt, at: performance.now() };
        };
        const step = (now: number) => {
          if (disposed) return;
          const dt = Math.min(100, now - last);
          last = now;
          simulated += (dt / 1000) * control.current.speed;
          if (simulated > end + 300) control.current.restart();
          replay.advanceTo(simulated);
          const nat = replay.national;
          const winner = victor(nat);
          if (winner && !victoryAt) victoryAt = { winner, at: now };
          if (!winner) victoryAt = null; // only a rewind can undo it
          // Half of the valid votes still possible: registered − abstentions − non-valid so far.
          const abstentions = nat.countedElectorate - nat.turnout;
          const target = Math.max(0, (nat.electorate - abstentions - nat.notValid) / 2);
          const ghost = nat.ghost[control.current.mode];
          // Ease toward the counted values (the live telão receives steps every few seconds).
          const k = 1 - Math.exp(-dt / 350);
          const ease = (a: number, b: number) => a + (b - a) * k;
          shown = {
            flavio: ease(shown.flavio, nat.flavio),
            lula: ease(shown.lula, nat.lula),
            target: shown.target ? ease(shown.target, target) : target,
            ghost: {
              flavio: ease(shown.ghost.flavio, ghost.flavio),
              lula: ease(shown.ghost.lula, ghost.lula),
            },
          };
          if (!history.length || simulated - history.at(-1)!.at >= 30) {
            history.push({ at: simulated, flavio: nat.flavio, lula: nat.lula });
            while (history.length > 2 && history[1].at < simulated - INCREMENT_SECONDS)
              history.shift();
          }
          setView({
            at: new Date(Date.parse(file.base) + simulated * 1000).toISOString(),
            nat: { ...nat, ghost: { ...nat.ghost } },
            ...shown,
            before: history[0] ?? { flavio: 0, lula: 0 },
            victory: victoryAt ? { winner: victoryAt.winner, elapsed: now - victoryAt.at } : null,
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

  // Camera track: long straights seen up close. Whole-track panel: its own, taller geometry.
  const long = useMemo(() => makeTrack({ n: 8, width: 1880, radius: 28 }), []);
  const whole = useMemo(() => makeTrack({ n: 10, width: 640, radius: 22, top: 40, side: 16 }), []);

  if (error) return <p className="race-error">{error}</p>;
  if (!view) return <p className="race-error">Carregando replay…</p>;
  const nat = view.nat;
  const total = nat.electorate * TRACK_SHARE;
  const valid = nat.flavio + nat.lula;
  const gap = (now: number, then: number) =>
    then > 0 ? `${now >= then ? '+' : '−'}${mi(Math.abs(now - then))}` : '—';
  return (
    <div className="race race2">
      <header className="race-top">
        <div>
          <h1>Protótipo · corrida</h1>
          <p>
            <strong className="synthetic">2º turno SINTÉTICO</strong> derivado do replay real do 1º
            turno (só para teste visual) · fantasmas: <strong>1º turno real</strong> nas mesmas
            zonas
          </p>
        </div>
        <div className="race-hud">
          <span>{clock(view.at)}</span>
          <span>{pct(nat.totalized / nat.sections)} das seções</span>
          <span className="f">{valid ? pct(nat.flavio / valid) : '—'}</span>
          <span className="l">{valid ? pct(nat.lula / valid) : '—'}</span>
        </div>
        <label>
          Fantasma{' '}
          <select value={mode} onChange={(e) => setMode(e.target.value as GhostMode)}>
            <option value="exchange">zonas encerradas trocadas pelo 1º turno (exato)</option>
            <option value="complete">só zonas encerradas</option>
            <option value="proportional">proporcional às seções (estimativa)</option>
          </select>
        </label>
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
        <button onClick={() => control.current.toVictory()}>Ir para a vitória</button>
        <button onClick={() => control.current.replayEffect()} disabled={!view.victory}>
          Repetir efeito
        </button>
      </header>

      <section className={`race-camera ${view.victory ? `won ${view.victory.winner}` : ''}`}>
        <Serpentine
          track={long}
          view={view}
          total={total}
          fixed={nat.electorate / 2}
          camera={{ zoom: 4 + 2 * zoomBump(view.victory?.elapsed ?? null), aspect: 1240 / 880 }}
        />
        {view.victory && <VictoryBanner {...view.victory} />}
      </section>

      <aside className="race-whole">
        <h2>Pista inteira</h2>
        <Serpentine track={whole} view={view} total={total} fixed={nat.electorate / 2} compact />
        <dl className="race-ghost">
          <div>
            <dt>
              <i className="ring f" /> vs 1º turno nas mesmas zonas
            </dt>
            <dd className="f">{gap(nat.flavio, nat.ghost[mode].flavio)}</dd>
          </div>
          <div>
            <dt>
              <i className="ring l" /> vs 1º turno nas mesmas zonas
            </dt>
            <dd className="l">{gap(nat.lula, nat.ghost[mode].lula)}</dd>
          </div>
        </dl>
        <p className="race-note">
          Anel: onde o mesmo candidato estaria com os votos do 1º turno nas zonas já apuradas (
          {mode === 'exchange'
            ? 'apuração atual com as município–zonas já encerradas trocadas pelo seu resultado no 1º turno; a distância ao corredor é a diferença exata nessas zonas'
            : mode === 'complete'
              ? 'só município–zonas encerradas'
              : 'zonas parciais na proporção das seções apuradas — estimativa'}
          ). Não é cronológico.
        </p>
      </aside>
    </div>
  );
}

function Serpentine({
  track,
  view,
  total,
  fixed,
  camera,
  compact = false,
}: {
  track: Track;
  view: View;
  total: number;
  fixed: number;
  camera?: { zoom: number; aspect: number };
  /** Whole-track panel: thinner marks, fewer labels. */
  compact?: boolean;
}) {
  const lane = compact ? 4 : 7;
  const statics = useMemo(() => {
    const ticks: { key: number; line: ReturnType<typeof tick>; major: boolean }[] = [];
    const labels: { key: number; x: number; y: number }[] = [];
    const every = compact ? 10e6 : 5e6;
    if (total > 0)
      for (let v = 1e6; v < total; v += 1e6) {
        const u = along(track, v, total),
          major = v % every === 0;
        if (compact && !major) continue;
        ticks.push({ key: v, major, line: tick(track, u, -16, major ? 16 : -11) });
        const p = point(track, u, 0);
        if (major && p.straight) labels.push({ key: v, x: p.x, y: p.y - (compact ? 14 : 20) });
      }
    return { ticks, labels, asphalt: total > 0 ? path(track, 0, total, 0, total, 6) : '' };
  }, [track, total, compact]);
  if (total <= 0) return null;
  const won = view.victory?.winner ?? null;
  const runners = [
    {
      key: 'f',
      votes: view.flavio,
      before: view.before.flavio,
      ghost: view.ghost.flavio,
      lane: -lane,
    },
    { key: 'l', votes: view.lula, before: view.before.lula, ghost: view.ghost.lula, lane },
  ];
  let viewBox = `0 0 ${track.width} ${track.height}`;
  // Camera only: markers on the frame edge for what is outside it (the other runner with the
  // gap in votes; ghosts as dashed rings).
  const edge: { x: number; y: number; key: string; label: string; ghost: boolean }[] = [];
  if (camera) {
    // Follow the leader closely, keeping its own ghost in frame while the gap fits.
    const leader = runners[0].votes >= runners[1].votes ? runners[0] : runners[1],
      other = leader === runners[0] ? runners[1] : runners[0];
    const w = track.width / camera.zoom,
      h = w / camera.aspect;
    const u = along(track, leader.votes, total),
      back = Math.min(Math.max(0, u - along(track, leader.ghost, total)), w * 0.7);
    const c = point(track, Math.max(0, u - back / 2 - w * 0.05), leader.lane);
    const x = Math.max(0, Math.min(track.width - w, c.x - w / 2)),
      y = Math.max(-h / 4, Math.min(Math.max(0, track.height - h * 0.75), c.y - h / 2));
    viewBox = `${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`;
    const m = 26;
    const outside = (votes: number, lane: number, key: string, label: string, ghost: boolean) => {
      const o = point(track, along(track, votes, total), lane);
      if (votes > 0 && (o.x < x || o.x > x + w || o.y < y || o.y > y + h))
        edge.push({
          x: Math.max(x + m, Math.min(x + w - m, o.x)),
          y: Math.max(y + m, Math.min(y + h - m, o.y)),
          key,
          label,
          ghost,
        });
    };
    outside(other.votes, other.lane, other.key, `−${mi(leader.votes - other.votes)}`, false);
    for (const r of runners) outside(r.ghost, r.lane, r.key, '1º', true);
    // Markers clamped to the same edge spot are stacked instead of overlapping.
    edge.forEach((e, i) => {
      for (const f of edge.slice(0, i))
        if (Math.hypot(e.x - f.x, e.y - f.y) < 40) e.y = Math.min(y + h - 26, f.y + 44);
    });
  }
  const targetU = along(track, view.target, total),
    fixedU = along(track, fixed, total);
  const at = (u: number, dy: number) => {
    const p = point(track, u, 0);
    return { x: p.x, y: p.y + dy };
  };
  return (
    <svg
      viewBox={viewBox}
      className={compact ? 'serp compact' : 'serp'}
      preserveAspectRatio="xMidYMid meet"
    >
      <path d={statics.asphalt} className="serp-asphalt" />
      {statics.ticks.map((t) => (
        <line key={t.key} {...t.line} className={t.major ? 'serp-tick major' : 'serp-tick'} />
      ))}
      {statics.labels.map((l) => (
        <text key={l.key} x={l.x} y={l.y} className="serp-scale" textAnchor="middle">
          {mi(l.key)}
        </text>
      ))}
      {runners.map((r) => (
        <g key={r.key} className={`${r.key} ${won === r.key ? 'won' : ''}`}>
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
      {!compact && (
        <>
          <text {...at(fixedU, -26)} className="serp-finish" textAnchor="middle">
            50% dos aptos
          </text>
          <text {...at(targetU, 36)} className="serp-finish target" textAnchor="middle">
            meta ajustada
          </text>
        </>
      )}
      {/* Ghosts: same lane, 1st-round votes of the same units. */}
      {runners.map((r) => {
        if (r.ghost <= 0) return null;
        const p = point(track, along(track, r.ghost, total), r.lane);
        return (
          <g key={`g${r.key}`} className={`serp-ghost ${r.key}`}>
            <circle cx={p.x} cy={p.y} r={compact ? 6 : 10} />
            {!compact && (
              <text x={p.x} y={p.y + (r.lane < 0 ? -16 : 26)} textAnchor="middle">
                1º turno
              </text>
            )}
          </g>
        );
      })}
      {runners.map((r) => {
        const p = point(track, along(track, r.votes, total), r.lane);
        return (
          <circle
            key={r.key}
            cx={p.x}
            cy={p.y}
            r={compact ? 5 : 8}
            className={`serp-head ${r.key} ${won === r.key ? 'won' : ''}`}
          />
        );
      })}
      {camera &&
        won &&
        view.victory &&
        (() => {
          const r = runners.find((x) => x.key === won)!;
          const p = point(track, along(track, r.votes, total), r.lane);
          return <Bursts x={p.x} y={p.y} elapsed={view.victory.elapsed} winner={won} />;
        })()}
      {edge.map((e, i) => (
        <g key={i} className={`serp-behind ${e.key} ${e.ghost ? 'ghost' : ''}`}>
          <circle cx={e.x} cy={e.y} r={e.ghost ? 7 : 9} />
          <text x={e.x} y={e.y - 16} textAnchor="middle">
            {e.label}
          </text>
        </g>
      ))}
      {!camera && compact && (
        <text x={track.width / 2} y={track.height - 8} className="serp-scale" textAnchor="middle">
          {int(view.flavio + view.lula)} votos válidos apurados
        </text>
      )}
    </svg>
  );
}

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Camera push-in on the winner: rises in 1 s, holds 3 s, eases back in 1.5 s. */
function zoomBump(elapsed: number | null) {
  if (elapsed === null || reduced()) return 0;
  const t = elapsed / 1000;
  if (t < 1) return 1 - (1 - t) ** 3;
  if (t < 4) return 1;
  if (t < 5.5) return 1 - (t - 4) / 1.5;
  return 0;
}

/**
 * Three bursts of particles in the winner's colour from the runner's head (0, 0.7 and 1.4 s),
 * each 1.8 s long. Deterministic angles and speeds; nothing under reduced motion.
 */
function Bursts({
  x,
  y,
  elapsed,
  winner,
}: {
  x: number;
  y: number;
  elapsed: number;
  winner: 'f' | 'l';
}) {
  if (reduced() || elapsed > 3400) return null;
  const parts = [];
  for (let b = 0; b < 3; b++) {
    const t = (elapsed - b * 700) / 1800;
    if (t < 0 || t > 1) continue;
    for (let i = 0; i < 28; i++) {
      const angle = (i / 28) * Math.PI * 2 + b * 0.37;
      const speed = 70 + ((i * 37 + b * 11) % 50);
      const d = speed * (1 - (1 - t) ** 2);
      parts.push(
        <circle
          key={`${b}-${i}`}
          cx={x + Math.cos(angle) * d}
          cy={y + Math.sin(angle) * d + 30 * t * t}
          r={3.2 * (1 - t) + 0.8}
          className={`burst ${winner} ${i % 3 === 0 ? 'light' : ''}`}
          style={{ opacity: 1 - t }}
        />,
      );
    }
  }
  return <g aria-hidden="true">{parts}</g>;
}

/**
 * Victory banner: enters large over the camera, then settles into a corner badge after 7 s.
 * Names the winner only in the live telão; this prototype runs on synthetic data.
 */
function VictoryBanner({ winner, elapsed }: { winner: 'f' | 'l'; elapsed: number }) {
  const settled = elapsed > 7000;
  return (
    <div className={`victory ${winner} ${settled ? 'settled' : ''}`} role="status">
      <strong>Vitória matemática</strong>
      <span>
        {winner === 'f' ? 'candidatura verde' : 'candidatura vermelha'} · demonstração com 2º turno
        sintético
      </span>
      {!settled && (
        <small>
          garantida pelos números publicados, qualquer que seja o resultado das seções restantes ·
          sujeita a retificação · resultado oficial: TSE
        </small>
      )}
    </div>
  );
}
