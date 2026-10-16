import { mkdirSync, openSync, closeSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Store } from '../apps/api/src/db/store';
import { PersistentCollector } from '../apps/api/src/services/collector';
import { tseTransport } from '../packages/tse/src/http';
import { discoverElection, resolveTsePath } from '../packages/tse/src/index';
import type { Round } from '../packages/domain/src/index';
import { parseZoneRegistry } from '../packages/tse/src/zones';

export type Environment = 'official' | 'simulated';
// In the user's home, not the repository: one lock shared by every checkout on this machine.
const LOCK_DIR = join(homedir(), '.atlas-tse');
const LOCK = join(LOCK_DIR, 'active.lock');

/**
 * One TSE collector per machine/IP, across environments and databases. A lock left by a dead
 * process is reclaimed; a live owner is never displaced.
 */
export function acquireIpLock(label: string) {
  mkdirSync(LOCK_DIR, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(LOCK, 'wx');
      writeSync(fd, JSON.stringify({ pid: process.pid, label, at: new Date().toISOString() }));
      closeSync(fd);
      return () => {
        try {
          const owner = JSON.parse(readFileSync(LOCK, 'utf8'));
          if (owner.pid === process.pid) unlinkSync(LOCK);
        } catch {
          /* already released */
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let pid: number | undefined;
      try {
        pid = JSON.parse(readFileSync(LOCK, 'utf8')).pid;
      } catch {
        pid = undefined; // legacy empty lock from the rehearsal script
      }
      if (pid !== undefined && alive(pid))
        throw Error(`Outro coletor TSE ativo nesta máquina (pid ${pid}); não compartilhar o IP`);
      if (pid === undefined && attempt === 0)
        throw Error(
          `Lock sem dono em ${LOCK}; confirme que nenhum coletor roda e remova o arquivo`,
        );
      unlinkSync(LOCK);
    }
  }
  throw Error('Não foi possível adquirir o lock de coleta');
}
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export const configUrl = (environment: Environment) =>
  environment === 'official'
    ? 'https://resultados.tse.jus.br/oficial/comum/config/ele-c.json'
    : 'https://resultados-sim.tse.jus.br/simulado/simulado2026/comum/config/ele-c.json';

/** EA11 → EA12 discovery under the same persisted budget; both bodies validated before use. */
export async function bootstrapSources(
  store: Store,
  environment: Environment,
  round: Round,
  signal: AbortSignal,
) {
  const bootstrap = new PersistentCollector(store);
  async function capture(key: string, url: string, validate: (raw: string) => void) {
    bootstrap.queue.add({ key, url, kind: 'tracking', priority: 100 });
    const job = bootstrap.queue.jobs.get(key)!;
    bootstrap.queue.suspend(key, false);
    bootstrap.queue.hint(key, Date.now());
    const transport = tseTransport({
      validate: (raw, j) => {
        if (j.key !== key) throw Error('Bootstrap inesperado');
        validate(raw);
      },
    });
    while (!signal.aborted) {
      const result = await bootstrap.tick(
        async (j, h) => {
          const response = await transport(j, h);
          job.suspended = true;
          return response;
        },
        undefined,
        (j) => j.key === key,
      );
      if (result) {
        if (![200, 304].includes(result.status))
          throw Error(`Bootstrap ${key} indisponível (HTTP ${result.status})`);
        const saved = store.db
          .prepare('SELECT captured_at FROM collector_cache WHERE job_key=?')
          .get(key) as { captured_at: string };
        return { url, raw: bootstrap.cached(key)!, capturedAt: saved.captured_at };
      }
      await sleep(25);
    }
    throw Error('Coleta interrompida no bootstrap');
  }
  const config = await capture('bootstrap:ea11', configUrl(environment), (raw) => {
    discoverElection(JSON.parse(raw), environment, round);
  });
  const context = discoverElection(JSON.parse(config.raw), environment, round);
  const catalog = await capture('bootstrap:ea12', resolveTsePath('EA12', context), (raw) => {
    parseZoneRegistry(JSON.parse(raw), environment);
  });
  return { config, catalog };
}
