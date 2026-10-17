import { expect, it } from 'vitest';
import { Store } from './store';
import { ZoneStore } from './zones';
import type { RoundData } from '../../../../packages/domain/src/zones';

it('armazena turnos separados, preserva nulos e recarrega até o instante', () => {
  const store = new Store(':memory:');
  try {
    const zones = new ZoneStore(store);
    const base = {
      environment: 'fixture' as const,
      registryDigest: 'reg',
      segments: [{ uf: 'ac', municipality: '01120', zone: '0008' }],
    };
    const version = (round: '1' | '2', id: string, capturedAt: string, blank: number | null) => ({
      ...base.segments[0],
      id,
      environment: 'fixture' as const,
      election: round === '1' ? 'e1' : 'e2',
      round,
      capturedAt,
      sourceUrl: 'fixture:z.json',
      sourceDigest: id,
      status: 'complete' as const,
      total: 1,
      totalized: 1,
      notTotalized: 0,
      counts: {
        electorate: 10,
        turnout: 8,
        valid: 7,
        blank,
        null: 1,
        annulled: 0,
        countedElectorate: 10,
      },
      candidates: [
        { id: 'f', votes: 4 },
        { id: 'l', votes: 3 },
      ],
    });
    const first: RoundData = {
      ...base,
      round: '1',
      election: 'e1',
      results: [version('1', 'a', '2026-10-04T22:00:00.000Z', 0)],
    };
    const second: RoundData = {
      ...base,
      round: '2',
      election: 'e2',
      results: [
        version('2', 'b', '2026-10-25T21:00:00.000Z', null),
        version('2', 'c', '2026-10-25T22:00:00.000Z', 0),
      ],
    };
    zones.insert(first, '2026-10-04T12:00:00.000Z');
    zones.insert(second, '2026-10-25T12:00:00.000Z');
    expect(zones.load('fixture', '1', '2026-10-30T00:00:00.000Z')).toEqual(first);
    const early = zones.load('fixture', '2', '2026-10-25T21:30:00.000Z')!;
    expect(early.results).toHaveLength(1);
    expect(early.results[0].counts.blank).toBeNull();
    expect(zones.load('fixture', '2', '2026-10-25T11:00:00.000Z')).toBeNull();
    expect(() =>
      zones.insert(
        { ...second, results: [version('1', 'd', '2026-10-25T23:00:00.000Z', 0)] },
        '2026-10-25T12:00:00.000Z',
      ),
    ).toThrow(/misturados/);
    expect(() => store.db.prepare("DELETE FROM zone_result WHERE id='a'").run()).toThrow(
      /imutáveis/,
    );
  } finally {
    store.close();
  }
});
