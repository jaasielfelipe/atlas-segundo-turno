import { useEffect, useRef, useState } from 'react';
import { ReplayState, type ReplayFile } from './replay';
import { electorateByUf, marginPoints, mosaic, REGIONS, ufTotals, type UfTotals } from './mosaic';
import './mosaic.css';

const SPEEDS = [30, 60, 120, 300];
const WIDTH = 1840,
  GAP = 6,
  REGION_GAP = 26,
  MIN = 30;

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
 * State mosaic, reworked: each UF is a glass whose width is its registered voters and whose
 * filled height is the share of sections counted; inside the fill, the split of the valid votes
 * counted (Flávio, others in the 1st round, Lula). One number per UF: the leader's margin in
 * percentage points, in the leader's colour. Real 1st-round replay.
 */
export default function MosaicPrototype() {
  const [state, setState] = useState<{ at: string; ufs: Map<string, UfTotals> } | null>(null);
  const [speed, setSpeed] = useState(120);
  const [error, setError] = useState('');
  const control = useRef({ speed, restart: () => {} });
  control.current.speed = speed;

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
  // Region by region (fixed order), largest electorate first inside each region.
  const groups = REGIONS.map((g) => ({
    name: g.name,
    rows: g.ufs
      .map((uf) => state.ufs.get(uf))
      .filter((t): t is UfTotals => !!t)
      .sort((a, b) => b.electorate - a.electorate),
  }));
  const ordered = groups.flatMap((g) => g.rows);
  const widths = mosaic(
    ordered.map((t) => t.electorate),
    WIDTH - REGION_GAP * (groups.length - 1),
    GAP,
    MIN,
  );
  const widthOf = new Map(ordered.map((t, i) => [t.uf, widths[i]]));
  const sum = (rows: UfTotals[], k: keyof Omit<UfTotals, 'uf'>) =>
    rows.reduce((a, t) => a + t[k], 0);
  return (
    <div className="mos">
      <header className="mos-top">
        <div>
          <h1>Protótipo · apuração por região</h1>
          <p>
            <strong>Replay real do 1º turno</strong> · cinza entre as cores: demais candidaturas
            (não existe no 2º turno).
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

      <section className="mos-board" aria-label="Apuração por UF">
        {groups.map((g) => {
          const m = marginPoints({
            valid: sum(g.rows, 'valid'),
            flavio: sum(g.rows, 'flavio'),
            lula: sum(g.rows, 'lula'),
          });
          const sections = sum(g.rows, 'sections');
          return (
            <div key={g.name} className="mos-region">
              <h2>
                <span>
                  {g.name} <span className={`margin ${side(m)}`}>{m === null ? '' : pp(m)}</span>
                </span>
                <small>{sections ? pct0(sum(g.rows, 'totalized') / sections) : '—'} apurado</small>
              </h2>
              <div className="mos-cols">
                {g.rows.map((t) => {
                  const w = widthOf.get(t.uf)!;
                  const counted = t.sections ? t.totalized / t.sections : 0;
                  const others = Math.max(0, t.valid - t.flavio - t.lula);
                  const mu = marginPoints(t);
                  return (
                    <div key={t.uf} className="mos-col" style={{ width: `${w}px` }}>
                      {/* Number scales with the column so narrow states never overlap. */}
                      <span
                        className={`margin ${side(mu)}`}
                        style={{ fontSize: `${Math.max(11, Math.min(22, w * 0.36))}px` }}
                      >
                        {mu === null ? '' : pp(mu)}
                      </span>
                      <div
                        className="glass"
                        title={`${t.uf.toUpperCase()}: ${pct0(counted)} apurado`}
                      >
                        <div className="fill" style={{ height: `${counted * 100}%` }}>
                          <i className="f" style={{ flexGrow: t.flavio }} />
                          <i className="o" style={{ flexGrow: others }} />
                          <i className="l" style={{ flexGrow: t.lula }} />
                        </div>
                        <span className="half" />
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
        largura: eleitores aptos · altura preenchida: seções apuradas · cores: votos válidos
        apurados · traço: metade dos válidos · número: vantagem do líder, em pontos percentuais
      </p>
    </div>
  );
}
