export type CollectJob = {
  key: string;
  url: string;
  kind: 'aggregate' | 'zone' | 'tracking';
  complete?: boolean;
  hinted?: boolean;
  pollMs?: number;
  municipality?: string;
  priority: number;
  due: number;
  failures: number;
  suspended: boolean;
  etag?: string;
  lastModified?: string;
  lastAttempt?: number;
  lastSuccess?: number;
  requests: number;
  bytes: number;
};
export type CollectResponse = {
  status: number;
  bytes: number;
  etag?: string;
  lastModified?: string;
  retryAfterMs?: number;
  complete?: boolean;
};
export type CollectorState = {
  jobs: CollectJob[];
  missing: string[];
  nextRequest: number;
  turn: number;
  stats: { requests: number; bytes: number; unchanged: number; errors: number };
};
/** TSE announces 100 req/s per IP (10 min block). Operator decision 03/10/2026: hard ceiling 80 req/s. */
export const MAX_RPS = 80;
export const MAX_IN_FLIGHT = 128;
/** One budget across all feeds, including conditional requests. Caller supplies clock and audited transport. */
export class ConservativeCollector {
  private readonly missing = new Set<string>();
  readonly jobs = new Map<string, CollectJob>();
  readonly stats = { requests: 0, bytes: 0, unchanged: 0, errors: 0 };
  private nextRequest = 0;
  private readonly active = new Set<string>();
  private readonly dirty = new Set<string>();
  private turn = 0;
  private interval: number;
  /**
   * `nextRequest` is a GCRA theoretical arrival time: a start is allowed when
   * now >= nextRequest - (burst - 1) * interval. Any 1 s window holds at most
   * rate + burst starts; burst = 1 is strict spacing.
   */
  constructor(
    intervalMs = 500,
    readonly pollMs = 60_000,
    readonly clock?: () => number,
    readonly maxInFlight = 1,
    readonly auditMs = 600_000,
    readonly burst = 1,
  ) {
    if (
      !Number.isFinite(pollMs) ||
      pollMs < 1000 ||
      !Number.isInteger(maxInFlight) ||
      maxInFlight < 1 ||
      maxInFlight > MAX_IN_FLIGHT ||
      !Number.isFinite(auditMs) ||
      auditMs < 1000 ||
      !Number.isInteger(burst) ||
      burst < 1 ||
      burst > 8
    )
      throw Error('Orçamento excede limite configurado');
    this.interval = this.checkInterval(intervalMs);
  }
  private checkInterval(intervalMs: number) {
    if (!Number.isFinite(intervalMs) || intervalMs < 1000 / MAX_RPS || intervalMs > 60_000)
      throw Error('Orçamento excede limite configurado');
    return intervalMs;
  }
  get intervalMs() {
    return this.interval;
  }
  /** Change the start rate at runtime (rate controller); never above MAX_RPS. */
  setRate(rps: number) {
    this.interval = this.checkInterval(1000 / rps);
  }
  /** Earliest instant at which another start may be allowed by the gate. */
  get readyAt() {
    return this.nextRequest - (this.burst - 1) * this.interval;
  }
  snapshot(incremental = false): CollectorState {
    return {
      jobs: (incremental
        ? [...this.dirty].map((k) => this.jobs.get(k)!)
        : [...this.jobs.values()]
      ).map((j) => ({ ...j })),
      missing: incremental ? [...this.dirty].filter((k) => this.missing.has(k)) : [...this.missing],
      nextRequest: this.nextRequest,
      turn: this.turn,
      stats: { ...this.stats },
    };
  }
  persisted() {
    this.dirty.clear();
  }
  get inFlight() {
    return this.active.size;
  }
  suspend(key: string, value = true) {
    const job = this.jobs.get(key);
    if (!job) return;
    job.suspended = value || this.missing.has(key);
    this.dirty.add(key);
  }
  /** Coalesce hints. A hint during HTTP schedules one additional check, never overlaps itself. */
  hint(key: string, now: number) {
    const job = this.jobs.get(key);
    if (!job || job.suspended) return;
    if (this.active.has(key)) job.hinted = true;
    else job.due = Math.max(job.failures ? job.due : 0, Math.min(job.due, now));
    this.dirty.add(key);
  }
  restore(state: CollectorState) {
    if (this.active.size) throw Error('Coleta em andamento');
    this.dirty.clear();
    this.jobs.clear();
    this.missing.clear();
    for (const job of state.jobs) this.jobs.set(job.key, { ...job });
    for (const key of state.missing) this.missing.add(key);
    this.nextRequest = state.nextRequest;
    this.turn = state.turn;
    Object.assign(this.stats, state.stats);
  }
  add(job: Pick<CollectJob, 'key' | 'url' | 'kind' | 'municipality' | 'priority' | 'pollMs'>) {
    if (job.pollMs !== undefined && (!Number.isFinite(job.pollMs) || job.pollMs < 1000))
      throw Error('Cadência inválida');
    const existing = this.jobs.get(job.key);
    if (existing) {
      if (existing.url !== job.url || existing.kind !== job.kind)
        throw Error('Chave de coleta com origem/contrato conflitante');
      // Restored plan under a new cadence profile: adopt it without waiting out the old one.
      if (job.pollMs !== undefined && existing.pollMs !== job.pollMs) {
        existing.pollMs = job.pollMs;
        if (!existing.failures && !existing.complete && existing.lastSuccess !== undefined)
          existing.due = Math.min(existing.due, existing.lastSuccess + job.pollMs);
        this.dirty.add(job.key);
      }
      return;
    }
    this.jobs.set(job.key, {
      ...job,
      due: 0,
      failures: 0,
      suspended: false,
      requests: 0,
      bytes: 0,
    });
    this.dirty.add(job.key);
  }
  setFavorites(ids: Set<string>) {
    for (const job of this.jobs.values()) {
      const before = `${job.priority}:${job.suspended}`;
      if (job.kind === 'aggregate' && job.municipality)
        job.suspended = this.missing.has(job.key) || !ids.has(job.municipality);
      if (job.kind === 'zone')
        job.priority = job.municipality && ids.has(job.municipality) ? 20 : 0;
      if (before !== `${job.priority}:${job.suspended}`) this.dirty.add(job.key);
    }
  }
  async tick(
    now: number,
    transport: (
      job: Readonly<CollectJob>,
      headers: Record<string, string>,
    ) => Promise<CollectResponse>,
    eligible: (job: Readonly<CollectJob>) => boolean = () => true,
  ) {
    if (this.active.size >= this.maxInFlight || now < this.readyAt) return null;
    // Every fourth slot serves oldest-due territory regardless of favorites: no starvation.
    const fairness = this.turn % 4 === 3;
    const compare = (a: CollectJob, b: CollectJob) =>
      (fairness ? 0 : b.priority - a.priority) ||
      a.due - b.due ||
      (a.lastAttempt ?? -1) - (b.lastAttempt ?? -1) ||
      a.key.localeCompare(b.key);
    let job: CollectJob | undefined;
    let aggregate: CollectJob | undefined;
    let protectedFeed = false;
    let granularActive = 0;
    for (const j of this.jobs.values()) {
      if (!eligible(j)) continue;
      if (j.kind === 'aggregate' && !j.municipality && !j.suspended) protectedFeed = true;
      if (this.active.has(j.key)) {
        if (j.kind !== 'aggregate' || j.municipality) granularActive++;
        continue;
      }
      if (j.suspended || j.due > now) continue;
      if (j.kind === 'aggregate' && !j.municipality && (!aggregate || compare(j, aggregate) < 0))
        aggregate = j;
      if (!job || compare(j, job) < 0) job = j;
    }
    // Dedicated capacity for BR/UF even while slow granular HTTP occupies the pool.
    if (aggregate) job = aggregate;
    else if (protectedFeed && this.maxInFlight > 1 && granularActive >= this.maxInFlight - 1)
      return null;
    if (!job) return null;
    this.active.add(job.key);
    job.hinted = false;
    this.dirty.add(job.key);
    this.turn++;
    this.nextRequest = Math.max(this.nextRequest, now) + this.interval;
    job.lastAttempt = now;
    job.due = now + 30_000; // recovery delay if the process dies after reserving HTTP
    job.requests++;
    this.stats.requests++;
    const headers: Record<string, string> = {};
    if (job.etag) headers['If-None-Match'] = job.etag;
    else if (job.lastModified) headers['If-Modified-Since'] = job.lastModified;
    try {
      const response = await transport({ ...job }, headers);
      const completed = Math.max(now, this.clock?.() ?? now);
      job.bytes += response.bytes;
      this.stats.bytes += response.bytes;
      if (response.status === 200 || response.status === 304) {
        if (response.status === 304) this.stats.unchanged++;
        job.etag = response.status === 200 ? response.etag : (response.etag ?? job.etag);
        job.lastModified =
          response.status === 200
            ? response.lastModified
            : (response.lastModified ?? job.lastModified);
        job.lastSuccess = completed;
        job.failures = 0;
        if (response.status === 200 && job.kind === 'zone')
          job.complete = response.complete === true;
        const cadence =
          job.kind === 'zone' && job.complete ? this.auditMs : (job.pollMs ?? this.pollMs);
        // Stable phase spreads audits across the window without postponing beyond one cadence.
        let hash = 0;
        for (const c of job.key) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) >>> 0;
        const phase = hash % cadence;
        job.due =
          job.kind === 'zone' && job.complete
            ? (Math.floor((completed + this.intervalMs - phase) / cadence) + 1) * cadence + phase
            : completed + cadence;
        if (job.hinted) job.due = Math.min(job.due, completed + this.intervalMs);
      } else {
        this.stats.errors++;
        job.failures++;
        if (response.status === 404) {
          job.suspended = true;
          this.missing.add(job.key);
        }
        const backoff = Math.min(600_000, 1000 * 2 ** Math.min(job.failures, 10));
        job.due = completed + Math.max(backoff, response.retryAfterMs ?? 0);
        if (response.status === 429 || response.status === 403)
          this.nextRequest = Math.max(
            this.nextRequest,
            completed +
              Math.max(600_000, response.retryAfterMs ?? 0) +
              (this.burst - 1) * this.interval,
          );
      }
      return { key: job.key, status: response.status };
    } catch {
      this.stats.errors++;
      job.failures++;
      job.due =
        Math.max(now, this.clock?.() ?? now) +
        Math.min(600_000, 1000 * 2 ** Math.min(job.failures, 10));
      return { key: job.key, status: 0 };
    } finally {
      this.active.delete(job.key);
      this.dirty.add(job.key);
    }
  }
}
