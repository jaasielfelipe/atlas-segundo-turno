import { expect, it } from 'vitest';
import { largestGain } from './engine';

it('ΔT1: maior ganho de participação, mesmo quando o líder não muda', () => {
  // Flávio leads in both rounds (45%→52%), but Lula gains more (40%→48%): Δ goes to Lula.
  expect(
    largestGain({ flavio: 52, lula: 48, valid: 100 }, { flavio: 45, lula: 40, valid: 100 }),
  ).toEqual({ who: 'l', points: expect.closeTo(8, 6) });
  expect(
    largestGain({ flavio: 60, lula: 40, valid: 100 }, { flavio: 50, lula: 35, valid: 100 }),
  ).toEqual({ who: 'f', points: expect.closeTo(10, 6) });
  expect(
    largestGain({ flavio: 1, lula: 1, valid: 0 }, { flavio: 1, lula: 1, valid: 2 }),
  ).toBeNull();
});
