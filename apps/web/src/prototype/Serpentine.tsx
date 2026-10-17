import { useMemo } from 'react';
import type { Pair } from './replay';
import { along, path, point, tick, type Track } from './track';

/** What a track needs to draw: eased votes, target, ghosts, last increment and victory. */
export type TrackView = {
  flavio: number;
  lula: number;
  /** Adjusted target: half of the valid votes still possible. */
  target: number;
  /** 1st-round position of each finalist on the same units; null without a baseline. */
  ghost: Pair | null;
  /** Votes some minutes earlier (increment start). */
  before: Pair;
  /** Mathematical victory: who and how long ago (ms) it was first observed. */
  victory: { winner: 'f' | 'l'; elapsed: number } | null;
};

const int = (v: number) => new Intl.NumberFormat('pt-BR').format(Math.round(v));
const mi = (v: number) =>
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(v / 1e6) + ' mi';

export function Serpentine({
  track,
  view,
  total,
  fixed,
  camera,
  compact = false,
}: {
  track: Track;
  view: TrackView;
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
      ghost: view.ghost?.flavio ?? 0,
      lane: -lane,
    },
    { key: 'l', votes: view.lula, before: view.before.lula, ghost: view.ghost?.lula ?? 0, lane },
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
        const size = compact ? 5 : 8;
        const className = `serp-head ${r.key} ${won === r.key ? 'won' : ''}`;
        // Lula's head is a small star: a subtle second cue besides colour.
        return r.key === 'l' ? (
          <path key={r.key} d={star(p.x, p.y, size * 1.45)} className={className} />
        ) : (
          <circle key={r.key} cx={p.x} cy={p.y} r={size} className={className} />
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
export function zoomBump(elapsed: number | null) {
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
export function Bursts({
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
 * `name`: the winner in the live telão; a neutral label on synthetic data.
 */
export function VictoryBanner({
  winner,
  elapsed,
  name,
}: {
  winner: 'f' | 'l';
  elapsed: number;
  name: string;
}) {
  const settled = elapsed > 7000;
  return (
    <div className={`victory ${winner} ${settled ? 'settled' : ''}`} role="status">
      <strong>Vitória matemática</strong>
      <span>{name}</span>
      {!settled && (
        <small>
          garantida pelos números publicados, qualquer que seja o resultado das seções restantes ·
          sujeita a retificação · resultado oficial: TSE
        </small>
      )}
    </div>
  );
}

/** Five-pointed star centred on (x, y), outer radius `r`, point up. */
export function star(x: number, y: number, r: number) {
  const inner = r * 0.45;
  let d = '';
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 ? inner : r,
      a = -Math.PI / 2 + (i * Math.PI) / 5;
    d += `${i ? 'L' : 'M'}${(x + radius * Math.cos(a)).toFixed(1)} ${(y + radius * Math.sin(a)).toFixed(1)}`;
  }
  return d + 'Z';
}
