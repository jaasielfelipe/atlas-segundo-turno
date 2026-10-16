import type { Arrival } from './replay';

export type FeedItem = Arrival & { closes: boolean };

/**
 * Paced feed: bulletins arrive far faster than a screen can show at the peak (~22/s on the 1st
 * round night), so cards leave a bounded queue at a readable pace. Next card: a bulletin that
 * closed its municipality first, then the one with most new sections, newest on ties. Every
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
        Number(a.closes) - Number(b.closes) || a.addedSections - b.addedSections || a.at - b.at;
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
