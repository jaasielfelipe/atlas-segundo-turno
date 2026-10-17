import { useEffect, useRef, useState } from 'react';

/** A municipality that just closed: final shares and margin change vs the 1st round (p.p.). */
export type TickerItem = {
  id: number;
  name: string;
  uf: string;
  flavio: number;
  lula: number;
  valid: number;
  /** (Flávio − Lula) / válidos now minus the same in the 1st round, in p.p.; null if unknown. */
  swing: number | null;
};

const pct = (v: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
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

  useEffect(() => {
    let frame = 0,
      last = performance.now(),
      offset = 0,
      waiting = false;
    const step = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      const view = viewport.current,
        list = track.current;
      if (view && list) {
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (list.children.length) offset += (speed * dt) / 1000 / (reduce ? 4 : 1);
        // The track starts one screen to the right (padding-left: 100%); drop the first item
        // once it has fully left on the left.
        const first = list.children[0] as HTMLElement | undefined;
        if (first && offset > first.offsetLeft + first.offsetWidth) {
          offset -= first.offsetWidth;
          setItems((xs) => xs.slice(1));
        }
        // Ask for more when the tail is near the right edge.
        if (!waiting && list.scrollWidth - offset < view.clientWidth + 200) {
          const next = pullRef.current();
          if (next) {
            waiting = true;
            setItems((xs) => [...xs, next]);
            requestAnimationFrame(() => (waiting = false));
          }
        }
        list.style.transform = `translateX(${-offset}px)`;
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
            const lead = t.flavio > t.lula ? 'f' : t.flavio < t.lula ? 'l' : 't';
            const toward = t.swing === null ? null : t.swing > 0 ? 'f' : t.swing < 0 ? 'l' : 't';
            return (
              <li key={t.id}>
                <span className={`name ${lead}`}>
                  {t.name} <small>{t.uf}</small>
                </span>
                <span className="f">{t.valid ? pct(t.flavio / t.valid) : '—'}</span>
                <span className="l">{t.valid ? pct(t.lula / t.valid) : '—'}</span>
                <span className={`swing ${toward ?? ''}`} title="variação da margem vs 1º turno">
                  {t.swing === null ? '—' : toward === 't' ? '±0' : `▲${pp(t.swing)}`}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
