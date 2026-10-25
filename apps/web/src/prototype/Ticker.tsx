import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** A municipality that just closed: final shares and margin change vs the 1st round (p.p.). */
export type TickerItem = {
  id: number;
  name: string;
  uf: string;
  flavio: number;
  lula: number;
  valid: number;
  /** (Flávio − Lula) / válidos now minus the same in the 1st round, in p.p.; null if unknown. */
  /** Who gained more share of the valid votes vs the 1st round, and by how much (p.p.). */
  gain: { who: 'f' | 'l' | 't'; points: number } | null;
};

const pct = (v: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    v * 100,
  );
const pp = (v: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
    Math.abs(v),
  );

/**
 * Horizontal news ticker. Items enter from the right and scroll at constant speed; `pull` is asked
 * for the next item only when the tail is about to enter the screen, so the queue upstream decides
 * what is shown and nothing piles up off screen.
 */
export default function Ticker({
  pull,
  speed = 70,
  label,
  note,
}: {
  pull: () => TickerItem | null;
  /** Pixels per second, constant. */
  speed?: number;
  label: string;
  note?: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLOListElement>(null);
  const [items, setItems] = useState<TickerItem[]>([]);
  const pullRef = useRef(pull);
  pullRef.current = pull;
  // Scroll offset and the item asked to leave. When React removes that item, the offset must be
  // corrected in the same frame, before paint (layout effect below); otherwise the strip jumps
  // by one item width for a frame (flicker).
  const motion = useRef({ offset: 0, leaving: null as { el: Element; width: number } | null });
  useLayoutEffect(() => {
    const m = motion.current,
      list = track.current;
    if (!m.leaving || !list || list.children[0] === m.leaving.el) return;
    m.offset -= m.leaving.width;
    m.leaving = null;
    list.style.transform = `translateX(${-m.offset}px)`;
  }, [items]);

  useEffect(() => {
    let frame = 0,
      last = performance.now(),
      waiting = false;
    const m = motion.current;
    const step = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      const view = viewport.current,
        list = track.current;
      if (view && list) {
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (list.children.length) m.offset += (speed * dt) / 1000 / (reduce ? 4 : 1);
        // The track starts one screen to the right (padding-left: 100%); drop the first item
        // once it has fully left on the left.
        const first = list.children[0] as HTMLElement | undefined;
        if (!m.leaving && first && m.offset > first.offsetLeft + first.offsetWidth) {
          m.leaving = { el: first, width: first.offsetWidth };
          setItems((xs) => xs.slice(1));
        }
        // Ask for more when the tail is near the right edge.
        if (!waiting && list.scrollWidth - m.offset < view.clientWidth + 200) {
          const next = pullRef.current();
          if (next) {
            waiting = true;
            setItems((xs) => [...xs, next]);
            requestAnimationFrame(() => (waiting = false));
          }
        }
        list.style.transform = `translateX(${-m.offset}px)`;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [speed]);

  return (
    <section className="ticker" aria-label={label}>
      <header>
        <strong>{label}</strong>
        {note && <small>{note}</small>}
      </header>
      <div className="ticker-view" ref={viewport}>
        <ol ref={track}>
          {items.map((t) => {
            // Two lines: the city (white), then the split and the larger gain vs the 1st round.
            return (
              <li key={t.id}>
                <span className="name">
                  {t.name} <small>{t.uf}</small>
                </span>
                <span className="line">
                  <span className="f">{t.valid ? pct(t.flavio / t.valid) : '—'}</span>
                  <span className="vs">vs</span>
                  <span className="l">{t.valid ? pct(t.lula / t.valid) : '—'}</span>
                  {t.gain && (
                    // ΔT1: change vs the 1st round (T1) of whoever gained more share, in p.p.
                    <span className={`gain ${t.gain.who}`}>
                      <small>ΔT1</small> {t.gain.points >= 0 ? '+' : '−'}
                      {pp(t.gain.points)}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
