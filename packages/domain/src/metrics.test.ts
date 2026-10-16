import { expect, it } from 'vitest';
import { asOf, deltaPp, ratio, tseTimestamp } from './index';
it('zero não é ausência e denominador zero não define proporção', () => {
  expect(ratio(0, 10)).toBe(0);
  expect(ratio(0, 0)).toBeNull();
  expect(ratio(null, 10)).toBeNull();
  expect(ratio(11, 10)).toBeNull();
  expect(ratio(-1, 10)).toBeNull();
  expect(ratio(NaN, 10)).toBeNull();
  expect(deltaPp(0.44, 0.4)).toBeCloseTo(4);
  expect(deltaPp(null, 0.4)).toBeNull();
});
it('converte Brasília para UTC com validação de calendário', () => {
  expect(tseTimestamp('04/10/2026', '17:00:00')).toBe('2026-10-04T20:00:00.000Z');
  expect(() => tseTimestamp('31/02/2026', '17:00:00')).toThrow();
  expect(() => tseTimestamp('04/10/2026', '25:00:00')).toThrow();
});
it('seleciona por captura sem interpolação e não ordena por IDG', () => {
  const snapshots = [
    { capturedAt: '2026-10-04T20:00:00.000Z', votes: 100, idg: '900' },
    { capturedAt: '2026-10-04T20:10:00.000Z', votes: 90, idg: '1' },
  ];
  expect(asOf(snapshots, '2026-10-04T20:05:00.000Z')?.votes).toBe(100);
  expect(asOf(snapshots, '2026-10-04T20:10:00.000Z')?.votes).toBe(90);
  expect(asOf(snapshots, '2026-10-04T19:59:00.000Z')).toBeNull();
});
