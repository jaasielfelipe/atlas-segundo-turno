import { gzipSync } from 'node:zlib';
import type { Store } from '../db/store';
import { rawDigest } from '../../../../packages/tse/src/index';

/** What `bootstrapSources` leaves in a collector database: the validated EA12 body in cache. */
export function cacheBootstrapCatalog(store: Store, url: string, raw: string, capturedAt: string) {
  const digest = rawDigest(raw);
  store.db.transaction(() => {
    store.db
      .prepare(
        'INSERT INTO collector_job VALUES(?,?,0) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload',
      )
      .run(
        'bootstrap:ea12',
        JSON.stringify({
          key: 'bootstrap:ea12',
          url,
          kind: 'tracking',
          priority: 100,
          due: 0,
          failures: 0,
          suspended: true,
          requests: 1,
          bytes: raw.length,
        }),
      );
    store.db.prepare('INSERT OR IGNORE INTO collector_body VALUES(?,?)').run(digest, gzipSync(raw));
    store.db
      .prepare(
        'INSERT INTO collector_cache VALUES(?,?,?,?) ON CONFLICT(job_key) DO UPDATE SET body_digest=excluded.body_digest',
      )
      .run('bootstrap:ea12', digest, capturedAt, capturedAt);
  })();
}
