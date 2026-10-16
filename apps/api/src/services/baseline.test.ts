import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { Store } from '../db/store';
import { ZoneStore } from '../db/zones';
import { buildBaseline } from './baseline';
import { rawDigest } from '../../../../packages/tse/src/index';
import { parseZoneRegistry } from '../../../../packages/tse/src/zones';

const read = (p: string) => readFileSync(`packages/fixtures/${p}`, 'utf8');

/** Minimal database in the previous project's format with one real official zone capture. */
function source(path: string, tamper = false) {
  const db = new Database(path);
  db.exec(`CREATE TABLE zone_registry(id TEXT, environment TEXT, captured_at TEXT, complete INTEGER, digest TEXT);
    CREATE TABLE zone_segment(registry_id TEXT, uf TEXT, municipality TEXT, zone TEXT);
    CREATE TABLE zone_result(id TEXT, environment TEXT, year INTEGER, election TEXT, round TEXT, uf TEXT, municipality TEXT, zone TEXT, captured_at TEXT, source_url TEXT, source_digest TEXT, status TEXT, total INTEGER, totalized INTEGER, not_totalized INTEGER, valid INTEGER);
    CREATE TABLE collector_body(digest TEXT PRIMARY KEY, compressed BLOB);
    CREATE TABLE snapshot(environment TEXT, office TEXT, territory_id TEXT, captured_at TEXT, payload TEXT);`);
  const registry = parseZoneRegistry(JSON.parse(read('zonal/official-ea12.json')), 'official');
  db.prepare('INSERT INTO zone_registry VALUES(?,?,?,?,?)').run(
    'r',
    'official',
    '2026-10-03T21:30:37.650Z',
    1,
    registry.digest,
  );
  const segment = db.prepare('INSERT INTO zone_segment VALUES(?,?,?,?)');
  db.transaction(() => {
    for (const s of registry.segments) segment.run('r', s.uf, s.municipality, s.zone);
  })();
  const observation = JSON.parse(read('zonal/observation.json')).find(
    (o: { file: string }) => o.file === 'official-ac01120-z0008.json',
  );
  const raw = read('zonal/official-ac01120-z0008.json');
  const stored = tamper ? raw.replace('"45"', '"46"') : raw;
  db.prepare('INSERT INTO collector_body VALUES(?,?)').run(rawDigest(raw), gzipSync(stored));
  db.prepare('INSERT INTO zone_result VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
    'z',
    'official',
    2026,
    '6257',
    '1',
    'ac',
    '01120',
    '0008',
    observation.capturedAt,
    observation.url,
    rawDigest(raw),
    'partial',
    45,
    0,
    45,
    0,
  );
  db.close();
}

it('base do 1º turno: corpo verificado por hash, revalidado e armazenado com seus bytes', () => {
  const folder = mkdtempSync(join(tmpdir(), 'atlas-baseline-'));
  try {
    source(join(folder, 'old.sqlite'));
    const store = new Store(join(folder, 'round1.sqlite'));
    const { data, national } = buildBaseline(join(folder, 'old.sqlite'), store);
    expect(national).toBeNull();
    expect(data.segments).toHaveLength(6292);
    expect(data.results).toHaveLength(1);
    // Pre-count capture: partial, counts published as zero sections totalized (not complete).
    expect(data.results[0]).toMatchObject({ round: '1', election: '6257', status: 'partial' });
    const loaded = new ZoneStore(store).load('official', '1', '2026-10-10T00:00:00.000Z')!;
    expect(loaded.results).toEqual(data.results);
    expect(
      store.db
        .prepare('SELECT COUNT(*) n FROM raw_artifact WHERE digest=?')
        .get(data.results[0].sourceDigest),
    ).toEqual({ n: 1 });
    store.close();
    source(join(folder, 'tampered.sqlite'), true);
    const other = new Store(join(folder, 'other.sqlite'));
    expect(() => buildBaseline(join(folder, 'tampered.sqlite'), other)).toThrow(/Hash/);
    other.close();
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
