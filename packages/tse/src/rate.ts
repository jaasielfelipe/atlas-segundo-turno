import { MAX_RPS } from './collector';

export type RateOptions = {
  /** Operator target, capped at MAX_RPS. */
  target: number;
  /** First rate after start or after a throttle response. */
  start?: number;
  floor?: number;
  step?: number;
  /** Minimum observation window before increasing. */
  stepMs?: number;
  /** Error share (status 0 / 5xx) in the window that halves the rate. */
  errorRatio?: number;
};

/**
 * Additive increase / multiplicative decrease over observed responses. Pure: caller supplies the clock.
 * 403/429 drop straight to the floor (the queue already pauses globally); 5xx/network errors above
 * the ratio halve; a clean window steps up. Never exceeds MAX_RPS.
 */
export class RateController {
  readonly target: number;
  readonly floor: number;
  private readonly start: number;
  private readonly step: number;
  private readonly stepMs: number;
  private readonly errorRatio: number;
  current: number;
  private windowStart: number;
  private ok = 0;
  private failed = 0;
  readonly events: { at: number; rps: number; reason: string }[] = [];
  constructor(options: RateOptions, now: number) {
    const target = options.target;
    if (!Number.isFinite(target) || target <= 0 || target > MAX_RPS)
      throw Error(`Taxa alvo deve estar entre 0 e ${MAX_RPS} req/s`);
    this.target = target;
    this.floor = Math.min(target, options.floor ?? 2);
    this.start = Math.min(target, Math.max(this.floor, options.start ?? 10));
    this.step = options.step ?? 10;
    this.stepMs = options.stepMs ?? 15_000;
    this.errorRatio = options.errorRatio ?? 0.05;
    this.current = this.start;
    this.windowStart = now;
    this.events.push({ at: now, rps: this.current, reason: 'start' });
  }
  private set(rps: number, now: number, reason: string) {
    this.current = Math.max(this.floor, Math.min(this.target, rps));
    this.windowStart = now;
    this.ok = 0;
    this.failed = 0;
    this.events.push({ at: now, rps: this.current, reason });
    if (this.events.length > 200) this.events.shift();
  }
  observe(status: number, now: number) {
    if (status === 429 || status === 403) return this.set(this.floor, now, `throttle_${status}`);
    // 404 is a missing unit, not server stress; 200/304 are healthy.
    if (status === 0 || status >= 500) this.failed++;
    else this.ok++;
  }
  update(now: number) {
    const total = this.ok + this.failed;
    if (total >= 20 && this.failed / total > this.errorRatio)
      return this.set(this.current / 2, now, 'errors');
    if (now - this.windowStart < this.stepMs) return;
    if (this.failed === 0 && total > 0 && this.current < this.target)
      return this.set(this.current + this.step, now, 'ramp');
    // Idle or slightly noisy window: start a fresh one without changing the rate.
    this.windowStart = now;
    this.ok = 0;
    this.failed = 0;
  }
}
