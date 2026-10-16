import { gzipSync, gunzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Store } from '../db/store';
import { ConservativeCollector, type CollectJob } from '../../../../packages/tse/src/collector';
import { rawDigest } from '../../../../packages/tse/src/index';
import type { HttpResult } from '../../../../packages/tse/src/http';
import type { RateController } from '../../../../packages/tse/src/rate';
export type AcceptCapture = (raw: string, job: Readonly<CollectJob>, capturedAt: string) => void;

/** Explicitly driven service, no background timer and no activation from the fixture application. */
export class PersistentCollector {
  readonly queue: ConservativeCollector;
  private readonly owner = randomUUID();
  private running = false;
  constructor(
    readonly store: Store,
    readonly now = () => Date.now(),
    options: {
      intervalMs?: number;
      maxInFlight?: number;
      pollMs?: number;
      auditMs?: number;
      burst?: number;
    } = {},
  ) {
    this.queue = new ConservativeCollector(
      options.intervalMs ?? 500,
      options.pollMs ?? 60_000,
      now,
      options.maxInFlight ?? 2,
      options.auditMs ?? 600_000,
      options.burst ?? 1,
    );
    const db = store.db;
    const state = db
      .prepare(
        "SELECT next_request AS nextRequest,turn,requests,bytes,unchanged,errors FROM collector_state WHERE id='global'",
      )
      .get() as
      | {
          nextRequest: number;
          turn: number;
          requests: number;
          bytes: number;
          unchanged: number;
          errors: number;
        }
      | undefined;
    if (state) {
      const rows = db.prepare('SELECT key,payload,missing FROM collector_job').all() as {
        key: string;
        payload: string;
        missing: number;
      }[];
      this.queue.restore({
        jobs: rows.map((r) => JSON.parse(r.payload)),
        missing: rows.filter((r) => r.missing).map((r) => r.key),
        nextRequest: state.nextRequest,
        turn: state.turn,
        stats: {
          requests: state.requests,
          bytes: state.bytes,
          unchanged: state.unchanged,
          errors: state.errors,
        },
      });
    }
  }
  save() {
    const state = this.queue.snapshot(true),
      db = this.store.db;
    db.transaction(() => {
      this.assertOwner();
      db.prepare(
        `INSERT INTO collector_state VALUES('global',?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET next_request=excluded.next_request,turn=excluded.turn,requests=excluded.requests,bytes=excluded.bytes,unchanged=excluded.unchanged,errors=excluded.errors`,
      ).run(
        state.nextRequest,
        state.turn,
        state.stats.requests,
        state.stats.bytes,
        state.stats.unchanged,
        state.stats.errors,
      );
      const upsert = db.prepare(
        'INSERT INTO collector_job VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,missing=excluded.missing',
      );
      for (const job of state.jobs)
        upsert.run(job.key, JSON.stringify(job), Number(state.missing.includes(job.key)));
    })();
    this.queue.persisted();
  }
  private assertOwner() {
    const lease = this.store.db
      .prepare('SELECT owner,expires FROM collector_owner WHERE id=1')
      .get() as { owner: string; expires: number } | undefined;
    // An expired lease (owner crashed without releasing it) does not own the budget.
    if (lease && lease.owner !== this.owner && lease.expires > this.now())
      throw Error('Outro coletor possui o orçamento deste banco');
  }
  cached(key: string) {
    const r = this.store.db
      .prepare(
        'SELECT b.compressed FROM collector_cache c JOIN collector_body b ON b.digest=c.body_digest WHERE c.job_key=?',
      )
      .get(key) as { compressed: Buffer } | undefined;
    return r ? gunzipSync(r.compressed).toString('utf8') : null;
  }
  /** Last accepted body known at the requested instant; failed/304 checks never erase it. */
  captured(key: string, at: string) {
    const row = this.store.db
      .prepare(
        `SELECT b.compressed FROM collector_observation o JOIN collector_body b ON b.digest=o.digest WHERE o.job_key=? AND o.completed_at<=? AND o.status=200 ORDER BY o.completed_at DESC,o.id DESC LIMIT 1`,
      )
      .get(key, at) as { compressed: Buffer } | undefined;
    return row ? gunzipSync(row.compressed).toString('utf8') : null;
  }
  /** One production loop per database. All feeds MUST be registered in this same service. */
  async run(
    transport: Parameters<PersistentCollector['tick']>[0],
    signal: AbortSignal,
    accept?: AcceptCapture,
    rate?: RateController,
    onResult?: (result: { key: string; status: number }) => void,
  ) {
    if (this.running) throw Error('Coletor já em execução');
    const acquire = () => {
      this.store.db
        .transaction(() => {
          const state = this.store.db
            .prepare("SELECT requests FROM collector_state WHERE id='global'")
            .get() as { requests: number } | undefined;
          if (state && state.requests !== this.queue.stats.requests)
            throw Error('Estado desatualizado; reconstruir coletor antes de adquirir orçamento');
          const result = this.store.db
            .prepare(
              `INSERT INTO collector_owner VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE collector_owner.owner=excluded.owner OR collector_owner.expires<=?`,
            )
            .run(this.owner, this.now() + 60_000, this.now());
          if (!result.changes) throw Error('Outro coletor possui o orçamento deste banco');
        })
        .immediate();
    };
    acquire();
    this.running = true;
    const active = new Set<Promise<unknown>>();
    let failure: unknown;
    let renewed = this.now();
    try {
      this.save();
      while (!signal.aborted && !failure) {
        if (this.now() - renewed >= 5000) {
          acquire();
          renewed = this.now();
        }
        if (rate) {
          rate.update(this.now());
          if (rate.current !== 1000 / this.queue.intervalMs) this.queue.setRate(rate.current);
        }
        // Several starts per wake: the gate (not the timer) bounds the rate.
        for (let n = 0; n < 16 && !signal.aborted; n++) {
          if (this.queue.inFlight >= this.queue.maxInFlight || this.now() < this.queue.readyAt)
            break;
          const before = this.queue.stats.requests;
          const pending: Promise<unknown> = this.tick(transport, accept)
            .then((result) => {
              if (!result) return;
              rate?.observe(result.status, this.now());
              onResult?.(result);
            })
            .catch((error) => {
              failure = error;
            })
            .finally(() => active.delete(pending));
          active.add(pending);
          if (this.queue.stats.requests === before) break; // nothing eligible now
        }
        const wait = this.queue.readyAt - this.now();
        await sleep(Math.max(2, Math.min(25, wait)));
      }
      await Promise.all(active);
      if (failure) throw failure;
    } finally {
      await Promise.allSettled(active);
      this.store.db.prepare('DELETE FROM collector_owner WHERE id=1 AND owner=?').run(this.owner);
      this.running = false;
    }
  }
  async tick(
    transport: (job: Readonly<CollectJob>, headers: Record<string, string>) => Promise<HttpResult>,
    accept?: AcceptCapture,
    eligible?: (job: Readonly<CollectJob>) => boolean,
  ) {
    const lease = this.store.db
      .prepare('SELECT owner,expires FROM collector_owner WHERE id=1')
      .get() as { owner: string; expires: number } | undefined;
    if (lease && lease.owner !== this.owner && lease.expires > this.now())
      throw Error('Outro coletor possui o orçamento deste banco');
    const started = this.now();
    const result = await this.queue.tick(
      started,
      async (job, headers) => {
        // Persist consumed budget before issuing HTTP; a crash must not reset request allowance.
        this.save();
        let response: HttpResult;
        try {
          response = await transport(job, headers);
          if (response.status === 200 && response.raw === undefined)
            throw Error('Resposta 200 sem corpo validado');
          if (response.status === 304 && this.cached(job.key) === null)
            throw Error('304 sem cache validado');
        } catch (error) {
          this.store.db
            .prepare(
              'INSERT INTO collector_observation(job_key,started_at,completed_at,status,bytes,error) VALUES(?,?,?,0,0,?)',
            )
            .run(
              job.key,
              new Date(started).toISOString(),
              new Date(this.now()).toISOString(),
              error instanceof Error ? error.message : 'Falha de transporte',
            );
          throw error;
        }
        const completed = new Date(this.now()).toISOString(),
          digest = response.raw === undefined ? null : rawDigest(response.raw);
        try {
          this.store.db.transaction(() => {
            this.assertOwner();
            if (digest && response.raw !== undefined) {
              accept?.(response.raw, job, completed);
              this.store.db
                .prepare('INSERT OR IGNORE INTO collector_body VALUES(?,?)')
                .run(digest, gzipSync(response.raw));
              this.store.db
                .prepare(
                  `INSERT INTO collector_cache VALUES(?,?,?,?) ON CONFLICT(job_key) DO UPDATE SET body_digest=excluded.body_digest,captured_at=CASE WHEN body_digest=excluded.body_digest THEN captured_at ELSE excluded.captured_at END,validated_at=excluded.validated_at`,
                )
                .run(job.key, digest, completed, completed);
            } else if (response.status === 304)
              this.store.db
                .prepare('UPDATE collector_cache SET validated_at=? WHERE job_key=?')
                .run(completed, job.key);
            this.store.db
              .prepare(
                'INSERT INTO collector_observation(job_key,started_at,completed_at,status,bytes,digest) VALUES(?,?,?,?,?,?)',
              )
              .run(
                job.key,
                new Date(started).toISOString(),
                completed,
                response.status,
                response.bytes,
                digest,
              );
          })();
        } catch (error) {
          // Rejected body: nothing cached or ingested, but the failed check stays auditable.
          this.store.db
            .prepare(
              'INSERT INTO collector_observation(job_key,started_at,completed_at,status,bytes,error) VALUES(?,?,?,0,?,?)',
            )
            .run(
              job.key,
              new Date(started).toISOString(),
              completed,
              response.bytes,
              error instanceof Error ? error.message : 'Falha de ingestão',
            );
          throw error;
        }
        return response;
      },
      eligible,
    );
    if (result) this.save();
    return result;
  }
}
