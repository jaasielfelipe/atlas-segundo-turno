export const summarize = (values: number[]) => {
  const a = [...values].sort((a, b) => a - b);
  const q = (p: number) => (a.length ? a[Math.max(0, Math.ceil(p * a.length) - 1)] : null);
  return {
    n: a.length,
    p50: q(0.5),
    p95: q(0.95),
    p99: q(0.99),
    max: a.at(-1) ?? null,
    mean: a.length ? a.reduce((n, v) => n + v, 0) / a.length : null,
  };
};
export type ModelUnit = {
  key: string;
  municipality: string;
  zone: string;
  multi: boolean;
  favorite: boolean;
};
export type ModelOptions = {
  rps: number;
  concurrency: number;
  httpMs: number[];
  processingMs: number;
  queueSaveMs: number;
  duration?: number;
  burst: boolean;
  failures: boolean;
  priority: boolean;
  hints: boolean;
  pendingSweepSeconds?: number;
};
/** Discrete event experiment, not an election forecast. Timestamps are synthetic seconds. */
export function simulateNational(units: ModelUnit[], o: ModelOptions) {
  if (
    !Number.isFinite(o.rps) ||
    o.rps <= 0 ||
    o.rps > 20 ||
    !Number.isInteger(o.concurrency) ||
    o.concurrency < 1 ||
    !o.httpMs.length ||
    o.httpMs.some((v) => !Number.isFinite(v) || v < 0)
  )
    throw Error('Parâmetros de simulação inválidos');
  const duration = o.duration ?? 7200;
  const events = new Map<
    number,
    { id: number; complete: boolean; revision: number; hint: number }[]
  >();
  const hints = new Map<number, Set<number>>();
  const append = (t: number, id: number, complete: boolean, revision: number) => {
    const hinted = Math.ceil(t / 30) * 30;
    const visible = t + (o.failures && id % 10 === 0 ? 45 : 0);
    events.set(visible, [...(events.get(visible) ?? []), { id, complete, revision, hint: hinted }]);
    // Early hint can precede CDN visibility. No second hint is assumed.
    if (units[id].multi || complete || revision > 4) {
      const a = hints.get(hinted) ?? new Set();
      a.add(id);
      hints.set(hinted, a);
    }
  };
  units.forEach((_, i) => {
    const end = o.burst ? 1200 + (i % 61) : 600 + ((i * 37) % 3001);
    [end - 450, end - 300, end - 150, end].forEach((t, j) => append(t, i, j === 3, j + 1));
    if (o.failures && i % 20 === 0) {
      append(4200 + (i % 60), i, false, 5);
      append(4500 + (i % 60), i, true, 6);
    }
  });
  const source = units.map(() => ({ complete: false, revision: 0, hint: 0, available: 0 }));
  const observed = units.map(() => ({ complete: false, revision: 0, available: 0 }));
  const queued = new Set<number>(),
    dueAt = new Map<number, number>();
  const normal: number[] = [],
    favorite: number[] = [];
  let ni = 0,
    fi = 0;
  const inflight: {
    id: number;
    done: number;
    body: { complete: boolean; revision: number; hint: number; available: number };
    failed: boolean;
    status: number;
    detected: number;
  }[] = [];
  const retries = new Map<number, number[]>(),
    suspended = new Set<number>();
  const calls = new Map<number, number>();
  let sent = 0,
    granular = 0,
    avoided = 0,
    unchanged = 0,
    errors = 0,
    pauseUntil = 0,
    blocked = false,
    nextStart = 0,
    turn = 0;
  const delay: number[] = [],
    completeDelay: number[] = [],
    favoriteDelay: number[] = [],
    normalDelay: number[] = [],
    zoneDelay: number[] = [],
    aggregateDelay: number[] = [];
  let maxQueue = 0,
    queueArea = 0,
    cohortRemovals = 0,
    rectifications = 0;
  const zones = new Map<string, number[]>();
  units.forEach((u, i) => zones.set(u.zone, [...(zones.get(u.zone) ?? []), i]));
  const municipalities = new Map<string, number[]>();
  units.forEach((u, i) =>
    municipalities.set(u.municipality, [...(municipalities.get(u.municipality) ?? []), i]),
  );
  const zoneComplete = new Map<string, boolean>();
  const control: { due: number; kind: string }[] = [];
  let ci = 0;
  // Independent official results: BR+27 UF+ZZ each 60s; EA14 15s and 28 EA15 each 30s.
  for (let t = 0; t < duration; t++) {
    if (t % 60 === 0)
      for (let i = 0; i < 29; i++)
        control.push({ due: t + Math.floor((i * 60) / 29), kind: 'aggregate' });
    if (t % 30 === 0) for (let i = 0; i < 28; i++) control.push({ due: t + i, kind: 'EA15' });
    if (t % 15 === 0) control.push({ due: t, kind: 'EA14' });
  }
  control.sort((a, b) => a.due - b.due);
  const controlQueue: { due: number; kind: string }[] = [];
  let cqi = 0;
  const enqueue = (id: number, t: number) => {
    if (suspended.has(id) || queued.has(id) || inflight.some((r) => r.id === id)) return;
    queued.add(id);
    dueAt.set(id, t);
    (o.priority && units[id].favorite ? favorite : normal).push(id);
  };
  let granularTurn = 0;
  const pick = () => {
    let id: number | undefined;
    if (o.priority && granularTurn++ % 4 !== 3 && fi < favorite.length) id = favorite[fi++];
    else if (ni < normal.length) id = normal[ni++];
    else if (fi < favorite.length) id = favorite[fi++];
    if (id !== undefined) queued.delete(id);
    return id;
  };
  const latency = () =>
    o.httpMs[sent % o.httpMs.length] / 1000 + o.processingMs / 1000 + (2 * o.queueSaveMs) / 1000;
  const stepSize = 0.05;
  for (let step = 0; step < duration / stepSize; step++) {
    const t = step * stepSize;
    if (step % 20 === 0) {
      for (const e of events.get(t) ?? [])
        source[e.id] = { complete: e.complete, revision: e.revision, hint: e.hint, available: t };
      while (ci < control.length && control[ci].due <= t) controlQueue.push(control[ci++]);
      // Hints here are available at the nominal EA15 cadence, not delayed by its queue: optimistic bound, explicitly reported.
      if (o.hints)
        for (const id of hints.get(t) ?? []) {
          const members = municipalities.get(units[id].municipality)!;
          const allComplete = members.every((i) => observed[i].complete);
          for (const member of members)
            if (allComplete || !observed[member].complete) enqueue(member, t);
        }
      if ((!o.hints || t > 0) && t % (o.pendingSweepSeconds ?? (o.hints ? 900 : 60)) === 0)
        units.forEach((_, id) => {
          if (!observed[id].complete) enqueue(id, t);
        });
      if (t > 0 && t % 600 === 0)
        units.forEach((_, id) => {
          if (observed[id].complete) enqueue(id, t);
        });
      for (const id of retries.get(t) ?? []) enqueue(id, t);
    }
    for (let i = inflight.length - 1; i >= 0; i--)
      if (inflight[i].done <= t) {
        const r = inflight.splice(i, 1)[0];
        if (r.id < 0) continue;
        if (r.failed) {
          errors++;
          if (r.status === 404) suspended.add(r.id);
          else {
            const retry = Math.ceil(t + 30);
            retries.set(retry, [...(retries.get(retry) ?? []), r.id]);
          }
          continue;
        }
        const prior = observed[r.id];
        if (prior.revision === r.body.revision) {
          unchanged++;
          continue;
        }
        const d = Math.max(0, r.done - r.body.hint);
        delay.push(d);
        (units[r.id].favorite ? favoriteDelay : normalDelay).push(d);
        if (r.body.complete) completeDelay.push(r.done - r.body.available);
        if (prior.complete && !r.body.complete) cohortRemovals++;
        if (r.body.revision >= 5) rectifications++;
        observed[r.id] = {
          complete: r.body.complete,
          revision: r.body.revision,
          available: r.body.available,
        };
        const members = zones.get(units[r.id].zone)!;
        const complete = members.every((id) => observed[id].complete);
        if (complete && !zoneComplete.get(units[r.id].zone))
          zoneDelay.push(r.done - Math.max(...members.map((id) => observed[id].available)));
        zoneComplete.set(units[r.id].zone, complete);
      }
    maxQueue = Math.max(maxQueue, queued.size + controlQueue.length - cqi);
    queueArea += queued.size + controlQueue.length - cqi;
    // Subsecond dispatch allows 20 rps without rounding away configured throughput.
    let clock = Math.max(t, nextStart);
    while (
      clock < t + stepSize - 1e-8 &&
      clock < duration &&
      clock >= pauseUntil &&
      inflight.length < o.concurrency
    ) {
      const hasControl = cqi < controlQueue.length;
      const serveControl = hasControl && (turn % 4 !== 3 || queued.size === 0);
      let id: number | undefined,
        detected = clock;
      if (serveControl) {
        const control = controlQueue[cqi++];
        id = -1;
        detected = control.due;
        if (control.kind === 'aggregate') aggregateDelay.push(clock - control.due);
      } else id = pick();
      if (id === undefined) break;
      turn++;
      sent++;
      const done = clock + latency();
      if (id < 0)
        inflight.push({
          id,
          done,
          body: { complete: false, revision: 0, hint: 0, available: 0 },
          failed: false,
          status: 200,
          detected,
        });
      else {
        granular++;
        const count = (calls.get(id) ?? 0) + 1;
        calls.set(id, count);
        const status =
          o.failures && count === 1 && id % 1000 === 0
            ? 404
            : o.failures && count === 1 && id % 20 === 0
              ? 503
              : 200;
        if (o.failures && !blocked && granular >= 1000) {
          blocked = true;
          pauseUntil = done + 600;
          retries.set(Math.ceil(pauseUntil), [...(retries.get(Math.ceil(pauseUntil)) ?? []), id]);
          errors++;
        } else
          inflight.push({
            id,
            done,
            body: { ...source[id] },
            failed: status !== 200,
            status,
            detected: dueAt.get(id) ?? clock,
          });
      }
      nextStart = clock + 1 / o.rps;
      clock = nextStart;
    }
  }
  avoided = Math.max(0, Math.ceil(duration / 60) * units.length - granular);
  return {
    sent,
    granular,
    avoidedAgainst60s: avoided,
    unchanged,
    errors,
    suspended: suspended.size,
    remaining: queued.size + controlQueue.length - cqi + inflight.length,
    maxQueue,
    meanQueue: queueArea / (duration / stepSize + 1),
    detectedToPersistence: summarize(delay),
    completeToPersistence: summarize(completeDelay),
    favorite: summarize(favoriteDelay),
    nonFavorite: summarize(normalDelay),
    wholeZoneTimeline: summarize(zoneDelay),
    aggregateQueueDelay: summarize(aggregateDelay),
    completeSegments: observed.filter((s) => s.complete).length,
    wholeZones: [...zoneComplete.values()].filter(Boolean).length,
    cohortRemovals,
    rectifications,
    duration,
  };
}
