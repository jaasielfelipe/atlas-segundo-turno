import { expect, it } from 'vitest';
import { along, makeTrack, point } from './track';

it('pista paramétrica: comprimento, extremos e faixas lado a lado nas curvas', () => {
  const t = makeTrack({ n: 3, width: 500, radius: 30 });
  expect(t.straight).toBe(500 - 2 * 40 - 2 * 30);
  expect(t.length).toBeCloseTo(3 * t.straight + 2 * Math.PI * 30);
  expect(point(t, 0, 0)).toMatchObject({ x: t.x0, y: t.y0, straight: true });
  // End of the 3rd straight (runs left to right again).
  expect(point(t, t.length, 0)).toMatchObject({ x: t.x1, y: t.y0 + 4 * 30 });
  expect(point(t, t.length * 2, 0)).toEqual(point(t, t.length, 0)); // never past the end
  // Mid-curve: inner and outer lanes on the same radius line, 16 px apart.
  const u = t.straight + t.arc / 2;
  const inner = point(t, u, 8),
    outer = point(t, u, -8);
  expect(Math.hypot(inner.x - outer.x, inner.y - outer.y)).toBeCloseTo(16);
  expect(along(t, 50, 100)).toBeCloseTo(t.length / 2);
  expect(along(t, -5, 100)).toBe(0);
});
