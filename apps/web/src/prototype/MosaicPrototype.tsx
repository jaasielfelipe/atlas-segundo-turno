import { useEffect, useRef, useState } from 'react';
import { ReplayState, type ReplayFile } from './replay';
import {
  composition,
  electorateByUf,
  marginPoints,
  mosaic,
  REGIONS,
  ufTotals,
  type UfTotals,
} from './mosaic';
import './mosaic.css';

const SPEEDS = [30, 60, 120, 300];
const GAP = 4,
  REGION_GAP = 18,
  MIN = 24;
/** Only the two finalists; everything else of the electorate is the empty remainder. */
const BANDS = ['flavio', 'lula'] as const;

const pct0 = (v: number) => `${Math.round(v * 100)}%`;
const pp = (v: number) => `+${Math.round(Math.abs(v))}`;
const clock = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
const side = (m: number | null) => (m === null ? '' : m > 0 ? 'f' : m < 0 ? 'l' : 't');

/**
 * State mosaic: one fixed box per UF, width proportional to registered voters, all the same
 * height, so area is voters. Inside, only Flávio and Lula as shares of the UF's registered
 * voters, stacked from the bottom; the rest of the box is the remainder of the electorate
 * (others, blank/null, absent and not counted yet). Widths come from the measured board, so the
 * whole country fits any screen.
 * One number per UF: the leader's margin in percentage points of the valid votes, in the
 * leader's colour. Sizes never change during the count. Real 1st-round replay.
 */
export default function MosaicPrototype() {
  const [state, setState] = useState<{ at: string; ufs: Map<string, UfTotals> } | null>(null);
  const [speed, setSpeed] = useState(120);
  const [error, setError] = useState('');
  const control = useRef({ speed, restart: () => {} });
  control.current.speed = speed;
  const board = useRef<HTMLElement>(null);
  const [boardWidth, setBoardWidth] = useState(0);
  useEffect(() => {
    const el = board.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setBoardWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [state === null]);

  useEffect(() => {
    let frame = 0,
      disposed = false;
    fetch('/dev/replay-round1.json')
      .then((r) => r.json() as Promise<ReplayFile>)
      .then((file) => {
        if (disposed) return;
        const replay = new ReplayState(file);
        const electorate = electorateByUf(file);
        const start = replay.firstCount() - 60,
          end = replay.lastEvent();
        let simulated = start,
          last = performance.now(),
          lastPaint = 0;
        control.current.restart = () => {
          simulated = start;
          replay.reset();
        };
        const step = (now: number) => {
          if (disposed) return;
          const dt = Math.min(100, now - last);
          last = now;
          simulated += (dt / 1000) * control.current.speed;
          if (simulated > end + 300) control.current.restart();
          replay.advanceTo(simulated);
          // The live telão receives UF bulletins every few seconds; 2 updates/s is plenty here.
          if (now - lastPaint > 500) {
            lastPaint = now;
            setState({
              at: new Date(Date.parse(file.base) + simulated * 1000).toISOString(),
              ufs: ufTotals(file, replay.municipalities, electorate),
            });
          }
          frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
      })
      .catch((e) => setError(`${e.message}. Gere os dados com: pnpm prototype:data`));
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
    };
  }, []);

  if (error) return <p className="mos-error">{error}</p>;
  if (!state) return <p className="mos-error">Carregando replay…</p>;
  // Region by region (fixed order), largest electorate first inside each region. Widths depend
  // only on registered voters, fixed for the whole count.
  const groups = REGIONS.map((g) => ({
    name: g.name,
    rows: g.ufs
      .map((uf) => state.ufs.get(uf))
      .filter((t): t is UfTotals => !!t)
      .sort((a, b) => b.electorate - a.electorate || a.uf.localeCompare(b.uf)),
  }));
  const ordered = groups.flatMap((g) => g.rows);
  const widths = mosaic(
    ordered.map((t) => t.electorate),
    Math.max(0, boardWidth - REGION_GAP * (groups.length - 1)),
    GAP,
    MIN,
  );
  const widthOf = new Map(ordered.map((t, i) => [t.uf, widths[i]]));
  // Each region is exactly as wide as its columns: headers never push the layout.
  const regionWidth = (rows: UfTotals[]) =>
    rows.reduce((a, t) => a + widthOf.get(t.uf)!, 0) + GAP * Math.max(0, rows.length - 1);
  const sum = (rows: UfTotals[], k: keyof Omit<UfTotals, 'uf'>) =>
    rows.reduce((a, t) => a + t[k], 0);
  return (
    <div className="mos">
      <header className="mos-top">
        <div>
          <h1>Protótipo · apuração por região</h1>
          <p>
            <strong>Replay real do 1º turno</strong> · área de cada UF: eleitores aptos (fixa)
          </p>
        </div>
        <span className="mos-clock">{clock(state.at)}</span>
        <label>
          Velocidade{' '}
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => control.current.restart()}>Recomeçar</button>
      </header>

      <section className="mos-board" aria-label="Apuração por UF" ref={board}>
        {groups.map((g) => {
          const m = marginPoints({
            valid: sum(g.rows, 'valid'),
            flavio: sum(g.rows, 'flavio'),
            lula: sum(g.rows, 'lula'),
          });
          const sections = sum(g.rows, 'sections');
          return (
            <div key={g.name} className="mos-region" style={{ width: `${regionWidth(g.rows)}px` }}>
              <h2>
                <span>
                  {g.name} <span className={`margin ${side(m)}`}>{m === null ? '' : pp(m)}</span>
                </span>
                <small>{sections ? pct0(sum(g.rows, 'totalized') / sections) : '—'} apurado</small>
              </h2>
              <div className="mos-cols">
                {g.rows.map((t) => {
                  const w = widthOf.get(t.uf)!;
                  const c = composition(t);
                  const mu = marginPoints(t);
                  return (
                    <div key={t.uf} className="mos-col" style={{ width: `${w}px` }}>
                      {/* Number scales with the column so narrow states never overlap. */}
                      <span
                        className={`margin ${side(mu)}`}
                        style={{ fontSize: `${Math.max(9, Math.min(18, w * 0.34))}px` }}
                      >
                        {mu === null ? '' : pp(mu)}
                      </span>
                      <div
                        className="glass"
                        title={`${t.uf.toUpperCase()}: ${pct0(t.sections ? t.totalized / t.sections : 0)} das seções apuradas`}
                      >
                        {BANDS.map((k) => (
                          <i key={k} className={`band ${k}`} style={{ height: `${c[k] * 100}%` }} />
                        ))}
                      </div>
                      <span className="uf">{t.uf === 'zz' ? 'EXT' : t.uf.toUpperCase()}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>
      <p className="mos-legend">
        <i className="key flavio" /> <i className="key lula" /> votos de cada um · vazio: restante
        dos eleitores aptos (demais, brancos, nulos, ausentes, não apurado) · área: eleitores aptos
        · número: vantagem do líder (p.p. dos válidos)
      </p>
    </div>
  );
}
