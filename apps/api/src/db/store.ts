import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import type {
  Environment,
  Office,
  Snapshot,
  WatchEntry,
} from '../../../../packages/domain/src/index';
import {
  digest,
  rawDigest,
  validateOrigin,
  validatePhase,
} from '../../../../packages/tse/src/index';

export class Store {
  readonly db: Database.Database;
  constructor(
    path: string,
    readonly root = process.cwd(),
  ) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    // Sequential, transactional migrations; user_version = last applied.
    const migrations = ['001_initial.sql', '002_zones.sql', '003_collector.sql'];
    const version = Number(this.db.pragma('user_version', { simple: true }));
    if (!Number.isInteger(version) || version < 0 || version > migrations.length)
      throw Error('Versão do banco não suportada');
    migrations.slice(version).forEach((file, k) =>
      this.db.transaction(() => {
        this.db.exec(readFileSync(resolve(root, 'apps/api/src/db/migrations', file), 'utf8'));
        this.db
          .prepare('INSERT INTO migration VALUES(?, ?)')
          .run(version + k + 1, new Date().toISOString());
        this.db.pragma(`user_version = ${version + k + 1}`);
      })(),
    );
  }
  insert(snapshot: Snapshot, raw: string) {
    validatePhase(snapshot.phase, snapshot.environment);
    validateOrigin(snapshot.sourceUrl, snapshot.environment);
    if (rawDigest(raw) !== snapshot.rawDigest || digest(JSON.parse(raw)) !== snapshot.digest)
      throw Error('Digest do artefato inconsistente');
    return this.db.transaction(() => {
      this.db
        .prepare('INSERT OR IGNORE INTO raw_artifact VALUES(?, ?)')
        .run(snapshot.rawDigest, gzipSync(raw));
      return (
        this.db
          .prepare(
            `INSERT OR IGNORE INTO snapshot VALUES(@id, @environment, @electionId, @office, @territoryId,
        @phase, @capturedAt, @sourceGeneratedAt, @sourceTotalizedAt, @sourceIdg, @sourceUrl, @digest, @rawDigest, @payload)`,
          )
          .run({ ...snapshot, payload: JSON.stringify(snapshot) }).changes > 0
      );
    })();
  }
  snapshots(environment: Environment, office: Office, territory: string, at?: string): Snapshot[] {
    const rows = this.db
      .prepare(
        `SELECT payload FROM snapshot WHERE environment=? AND office=? AND territory_id=?
      AND captured_at <= ? ORDER BY captured_at, rowid`,
      )
      .all(environment, office, territory, at ?? '9999') as { payload: string }[];
    return rows.map((row) => JSON.parse(row.payload));
  }
  latest(
    environment: Environment,
    office: Office,
    territory: string,
    at?: string,
  ): Snapshot | null {
    const row = this.db
      .prepare(
        `SELECT payload FROM snapshot WHERE environment=? AND office=? AND territory_id=?
      AND captured_at <= ? ORDER BY captured_at DESC, rowid DESC LIMIT 1`,
      )
      .get(environment, office, territory, at ?? '9999') as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) : null;
  }
  byId(environment: Environment, id: string): Snapshot | null {
    const row = this.db
      .prepare('SELECT payload FROM snapshot WHERE environment=? AND id=?')
      .get(environment, id) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) : null;
  }
  raw(digest: string) {
    const row = this.db
      .prepare('SELECT compressed FROM raw_artifact WHERE digest=?')
      .get(digest) as { compressed: Buffer } | undefined;
    return row ? gunzipSync(row.compressed).toString('utf8') : null;
  }
  watchlist(environment: Environment): WatchEntry[] {
    return (
      this.db
        .prepare('SELECT * FROM watchlist WHERE environment=? ORDER BY created_at')
        .all(environment) as { territory_id: string; enabled: number; created_at: string }[]
    ).map((w) => ({
      territoryId: w.territory_id,
      enabled: Boolean(w.enabled),
      createdAt: w.created_at,
      collectBu: false,
    }));
  }
  setWatch(environment: Environment, territory: string, enabled: boolean) {
    this.db
      .prepare(
        `INSERT INTO watchlist(environment,territory_id,enabled,created_at) VALUES(?,?,?,?)
      ON CONFLICT(environment,territory_id) DO UPDATE SET enabled=excluded.enabled`,
      )
      .run(environment, territory, Number(enabled), new Date().toISOString());
  }
  getState(key: string) {
    return (
      this.db.prepare('SELECT value FROM app_state WHERE key=?').get(key) as
        | { value: string }
        | undefined
    )?.value;
  }
  setState(key: string, value: string) {
    this.db
      .prepare(
        'INSERT INTO app_state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, value);
  }
  captures(environment: Environment): string[] {
    return (
      this.db
        .prepare(
          'SELECT DISTINCT captured_at FROM snapshot WHERE environment=? ORDER BY captured_at',
        )
        .all(environment) as { captured_at: string }[]
    ).map((r) => r.captured_at);
  }
  close() {
    this.db.close();
  }
}
