import type { Arrival } from './replay';

/** `weight` overrides the bulletin size in the ordering (e.g. municipality sections). */
export type FeedItem = Arrival & { weight?: number };

/**
 * Paced feed: bulletins arrive far faster than a screen can show at the peak (~22/s on the 1st
 * round night), so cards leave a bounded queue at a readable pace. Next card: a bulletin that
 * closed its municipality first, then the heaviest (`weight`, else new sections), newest on ties. Every
 * arrival still counts in `lastMinute` (simulation seconds), shown or not.
 */
export class FeedQueue {
  private queue: FeedItem[] = [];
  private recent: number[] = [];
  constructor(
    readonly capacity = 200,
    readonly window = 60,
  ) {}
  push(items: FeedItem[]) {
    for (const item of items) {
      this.queue.push(item);
      this.recent.push(item.at);
    }
    if (this.queue.length > this.capacity) this.queue.splice(0, this.queue.length - this.capacity);
  }
  next(): FeedItem | null {
    if (!this.queue.length) return null;
    let best = 0;
    for (let i = 1; i < this.queue.length; i++) {
      const a = this.queue[i],
        b = this.queue[best];
      const order =
        Number(a.closes) - Number(b.closes) ||
        (a.weight ?? a.addedSections) - (b.weight ?? b.addedSections) ||
        a.at - b.at;
      if (order > 0) best = i;
    }
    return this.queue.splice(best, 1)[0];
  }
  /** Bulletins in the last `window` simulated seconds up to `now`. */
  lastMinute(now: number) {
    while (this.recent.length && this.recent[0] < now - this.window) this.recent.shift();
    return this.recent.length;
  }
  get waiting() {
    return this.queue.length;
  }
  clear() {
    this.queue = [];
    this.recent = [];
  }
}

/**
 * Closed-municipality queue for the ticker: everything that closes is shown, in closing order,
 * once per municipality (a correction that reopens and closes it again is not repeated).
 */
export class OnceQueue<T> {
  private items: T[] = [];
  private head = 0;
  private seen = new Set<string>();
  push(key: string, item: T) {
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    this.items.push(item);
    return true;
  }
  next(): T | null {
    if (this.head >= this.items.length) return null;
    const item = this.items[this.head++];
    if (this.head > 1024) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    }
    return item;
  }
  get waiting() {
    return this.items.length - this.head;
  }
  clear() {
    this.items = [];
    this.head = 0;
    this.seen.clear();
  }
}
