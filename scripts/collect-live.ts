import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { Store } from '../apps/api/src/db/store';
import { LIVE_PROFILE, NationalCollection } from '../apps/api/src/services/national';
import { MAX_RPS } from '../packages/tse/src/collector';
import { RateController } from '../packages/tse/src/rate';
import { acquireIpLock, bootstrapSources, type Environment } from './collect-bootstrap';
import type { Round } from '../packages/domain/src/index';

/**
 * Continuous national presidential collection of one round. One process per machine/IP.
 *   pnpm collect:official:live (2nd round)   |   tsx scripts/collect-live.ts simulated 1
 * TSE_RPS (≤80, default 80), TSE_RPS_START (default 10), TSE_MAX_IN_FLIGHT (≤128, default 64),
 * COLLECT_SECONDS (0 = until Ctrl+C). Data and status (every 10 s) in data/<env>/round<n>/.
 */
const environment = process.argv[2] as Environment;
const round = process.argv[3] as Round;
if ((environment !== 'official' && environment !== 'simulated') || !['1', '2'].includes(round))
  throw Error('Uso: collect-live.ts official|simulated 1|2');
const folder = `data/${environment}/round${round}`;
const env = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) throw Error(`${name} inválido`);
  return value;
};
const target = env('TSE_RPS', MAX_RPS),
  start = env('TSE_RPS_START', 10),
  maxInFlight = env('TSE_MAX_IN_FLIGHT', LIVE_PROFILE.maxInFlight),
  seconds = env('COLLECT_SECONDS', 0);
if (target <= 0 || target > MAX_RPS) throw Error(`TSE_RPS deve estar entre 0 e ${MAX_RPS}`);

const release = acquireIpLock(`live:${environment}:${round}`);
mkdirSync(folder, { recursive: true });
const store = new Store(`${folder}/collection.sqlite`);
const stop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    log('parada solicitada; drenando requisições em voo');
    stop.abort();
  });
const timer = seconds > 0 ? setTimeout(() => stop.abort(), seconds * 1000) : undefined;
const statusPath = `${folder}/collector-status.json`;
function log(message: string) {
  console.log(`${new Date().toISOString()} [${environment} ${round}º turno] ${message}`);
}

let exitCode = 0;
let heartbeat: NodeJS.Timeout | undefined;
try {
  // After a crash the previous owner's lease (60 s) may still be held. We already own the machine
  // lock, so no other collector here uses it: wait for expiry instead of failing or breaking it.
  for (;;) {
    const lease = store.db.prepare('SELECT expires FROM collector_owner WHERE id=1').get() as
      | { expires: number }
      | undefined;
    if (!lease || lease.expires <= Date.now() || stop.signal.aborted) break;
    log(`lease anterior ainda válido até ${new Date(lease.expires).toISOString()}; aguardando`);
    await new Promise((r) => setTimeout(r, Math.min(5_000, lease.expires - Date.now() + 50)));
  }
  const { config, catalog } = await bootstrapSources(store, environment, round, stop.signal);
  const profile = { ...LIVE_PROFILE, intervalMs: 1000 / target, maxInFlight };
  const collection = new NationalCollection(
    store,
    environment,
    round,
    config,
    catalog,
    Date.now,
    profile,
  );
  const rate = new RateController({ target, start }, Date.now());
  const startedAt = new Date().toISOString();
  const byStatus: Record<string, number> = {};
  const recent: number[] = [];
  let lastThrottle: string | null = null;
  const onResult = (result: { key: string; status: number }) => {
    byStatus[result.status] = (byStatus[result.status] ?? 0) + 1;
    recent.push(Date.now());
    if (result.status === 403 || result.status === 429) {
      lastThrottle = new Date().toISOString();
      log(`HTTP ${result.status} em ${result.key}: pausa global ≥10 min e taxa no piso`);
    }
  };
  let coverage = collection.status();
  let coverageAt = Date.now();
  const writeStatus = () => {
    const now = Date.now();
    while (recent.length && recent[0] < now - 10_000) recent.shift();
    if (now - coverageAt >= 30_000) {
      coverage = collection.status();
      coverageAt = now;
    }
    const queue = collection.collector.queue;
    const errors = store.db
      .prepare(
        'SELECT job_key,completed_at,error FROM collector_observation WHERE error IS NOT NULL AND completed_at>=? ORDER BY id DESC LIMIT 5',
      )
      .all(startedAt);
    const status = {
      environment,
      round,
      pid: process.pid,
      startedAt,
      updatedAt: new Date(now).toISOString(),
      rate: {
        targetRps: target,
        currentRps: rate.current,
        observedRps10s: recent.length / 10,
        inFlight: queue.inFlight,
        maxInFlight: queue.maxInFlight,
        pausedUntil: queue.readyAt > now + 1000 ? new Date(queue.readyAt).toISOString() : null,
        lastThrottle,
        events: rate.events.slice(-10).map((e) => ({ ...e, at: new Date(e.at).toISOString() })),
      },
      responsesSinceStart: byStatus,
      lifetime: { ...queue.stats },
      coverage: {
        expectedSegments: coverage.expectedSegments,
        observedSegments: coverage.observedSegments,
        completeSegments: coverage.completeSegments,
        expectedZones: coverage.expectedZones,
        completeZones: coverage.completeZones,
        at: new Date(coverageAt).toISOString(),
      },
      recentErrors: errors,
    };
    writeFileSync(`${statusPath}.tmp`, JSON.stringify(status, null, 2));
    renameSync(`${statusPath}.tmp`, statusPath);
    log(
      `${status.rate.observedRps10s.toFixed(1)} req/s (alvo ${rate.current}) · em voo ${queue.inFlight} · ` +
        `req ${queue.stats.requests} · 304 ${queue.stats.unchanged} · erros ${queue.stats.errors} · ` +
        `segmentos ${coverage.observedSegments}/${coverage.expectedSegments} obs, ` +
        `${coverage.completeSegments} completos · ZEs completas ${coverage.completeZones}/${coverage.expectedZones}` +
        (status.rate.pausedUntil ? ` · PAUSADO até ${status.rate.pausedUntil}` : ''),
    );
  };
  log(
    `cadastro ${collection.registry.digest.slice(0, 12)} · ${collection.collector.queue.jobs.size} jobs · ` +
      `alvo ${target} req/s (início ${rate.current}) · até ${maxInFlight} em voo`,
  );
  heartbeat = setInterval(() => {
    try {
      // Favorites saved in the dashboard start/stop municipal aggregates without a restart.
      if (collection.syncWatchlist()) log('favoritos atualizados a partir do painel');
    } catch (error) {
      log(`falha ao ler favoritos: ${error instanceof Error ? error.message : error}`);
    }
    writeStatus();
  }, 10_000);
  await collection.run(stop.signal, undefined, rate, onResult);
  writeStatus();
  log('coleta encerrada');
} catch (error) {
  exitCode = 1;
  log(`FALHA: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  if (heartbeat) clearInterval(heartbeat);
  if (timer) clearTimeout(timer);
  store.close();
  release();
}
process.exit(exitCode);
