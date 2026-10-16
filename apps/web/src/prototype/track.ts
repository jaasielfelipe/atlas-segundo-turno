/**
 * Parametric serpentine race track (boustrophedon): `n` horizontal straights joined by n − 1
 * semicircles. Position is linear in votes along the centre line, then offset sideways per lane,
 * so equal votes sit side by side even in curves. Ported from the 1st-round telão, with the
 * number of straights, width and radius as parameters to test longer tracks.
 */
export type Track = {
  n: number;
  x0: number;
  x1: number;
  straight: number;
  radius: number;
  y0: number;
  arc: number;
  /** Centre-line length in px. */
  length: number;
  width: number;
  height: number;
};

export function makeTrack({
  n,
  width,
  radius,
  top = 45,
  side = 40,
}: {
  n: number;
  width: number;
  radius: number;
  top?: number;
  side?: number;
}): Track {
  const x0 = side + radius,
    x1 = width - side - radius;
  const straight = x1 - x0,
    arc = Math.PI * radius;
  return {
    n,
    x0,
    x1,
    straight,
    radius,
    y0: top,
    arc,
    length: n * straight + (n - 1) * arc,
    width,
    height: top + (n - 1) * 2 * radius + top,
  };
}

export type Point = { x: number; y: number; straight: boolean };

/** Distance along the centre line (px) for `votes` on a track worth `total` votes. */
export const along = (t: Track, votes: number, total: number) =>
  (Math.max(0, Math.min(total, votes)) / total) * t.length;

/** Screen point at distance `u` along the centre line, offset `lane` px to the side. */
export function point(t: Track, u: number, lane: number): Point {
  u = Math.max(0, Math.min(t.length, u));
  for (let i = 0; i < t.n; i++) {
    const d = i % 2 ? -1 : 1,
      y = t.y0 + i * 2 * t.radius;
    // The last straight absorbs float residue: no fall-through past the end.
    if (u <= t.straight || i === t.n - 1) {
      const v = Math.min(u, t.straight);
      return { x: d > 0 ? t.x0 + v : t.x1 - v, y: y + lane * d, straight: true };
    }
    u -= t.straight;
    if (u <= t.arc) {
      const f = u / t.radius;
      if (d > 0) {
        const a = -Math.PI / 2 + f,
          r = t.radius - lane;
        return { x: t.x1 + r * Math.cos(a), y: y + t.radius + r * Math.sin(a), straight: false };
      }
      const a = -Math.PI / 2 - f,
        r = t.radius + lane;
      return { x: t.x0 + r * Math.cos(a), y: y + t.radius + r * Math.sin(a), straight: false };
    }
    u -= t.arc;
  }
  /* c8 ignore next */
  throw Error('unreachable');
}

/** SVG path between two vote counts on one lane, sampled every `step` px of centre line. */
export function path(t: Track, v0: number, v1: number, lane: number, total: number, step = 4) {
  const a = along(t, Math.min(v0, v1), total),
    b = along(t, Math.max(v0, v1), total);
  let d = '';
  for (let k = a; ; k = Math.min(b, k + step)) {
    const p = point(t, k, lane);
    d += (d ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1);
    if (k >= b) break;
  }
  return d;
}

/** Perpendicular tick across the track at distance `u`, from offset `from` to `to`. */
export function tick(t: Track, u: number, from: number, to: number) {
  const a = point(t, u, from),
    b = point(t, u, to);
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
}
