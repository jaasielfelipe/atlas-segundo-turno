import { expect, it } from 'vitest';
import { FeedQueue, OnceQueue, type FeedItem } from './feed';

const item = (at: number, addedSections: number, closes = false): FeedItem => ({
  at,
  municipality: at,
  zone: '0001',
  addedSections,
  sections: 10,
  totalized: addedSections,
  addedValid: 0,
  addedFlavio: 0,
  addedLula: 0,
  closes,
});

it('fila do feed: encerramentos primeiro, depois mais seções, depois mais recente; limitada', () => {
  const q = new FeedQueue(3);
  q.push([item(1, 5), item(2, 1, true), item(3, 5), item(4, 2)]);
  expect(q.waiting).toBe(3); // oldest dropped
  expect(q.next()!.at).toBe(2);
  expect(q.next()!.at).toBe(3);
  expect(q.next()!.at).toBe(4);
  expect(q.next()).toBeNull();
  expect(q.lastMinute(30)).toBe(4);
  expect(q.lastMinute(62)).toBe(3); // window [2, 62]
  q.push([{ ...item(5, 1), weight: 900 }, item(6, 50)]);
  expect(q.next()!.at).toBe(5); // weight (municipality size) beats bulletin size
});

it('faixa: todos entram, em ordem de encerramento, uma vez por município', () => {
  const q = new OnceQueue<number>();
  expect(q.push('ac:00001', 1)).toBe(true);
  expect(q.push('sp:71072', 2)).toBe(true);
  expect(q.push('ac:00001', 3)).toBe(false); // reclosed after a correction: not repeated
  expect(q.waiting).toBe(2);
  expect([q.next(), q.next(), q.next()]).toEqual([1, 2, null]);
});
