import { expect, it } from 'vitest';
import { adjustedTarget, largestGain, winner } from './engine';

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

it('vitória matemática só quando nenhum resultado das seções restantes a desfaz', () => {
  // 1000 registered; counted sections hold 800 (600 voted, 20 non-valid): 200 still to count.
  const o = (flavio: number, lula: number) => ({
    capturedAt: '',
    generatedAt: '',
    sections: 10,
    totalized: 8,
    electorate: 1000,
    abstention: 200, // counted electorate − turnout
    turnout: 600,
    notValid: 20,
    valid: flavio + lula,
    flavio,
    lula,
  });
  expect(adjustedTarget(o(390, 190))).toBe(390); // half of 580 valid + 200 still possible
  expect(winner(o(390, 190))).toBeNull(); // 190 + 200 can still tie
  expect(winner(o(391, 189))).toBe('f');
  expect(winner(o(100, 480))).toBe('l');
  expect(winner(null)).toBeNull();
});
