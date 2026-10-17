import { useEffect, useMemo, useRef, useState } from 'react';
import {
  finalVotes,
  ReplayState,
  synthetic2T,
  victor,
  type NationalState,
  type Pair,
  type ReplayFile,
} from './replay';
import { makeTrack } from './track';
import { Serpentine, VictoryBanner, zoomBump } from './Serpentine';
import './race.css';

const SPEEDS = [30, 60, 120, 300];
/** Track length in votes: 55% of registered voters (as in the 1st round). */
const TRACK_SHARE = 0.55;
/** Highlighted increment: votes gained in the last 5 minutes of counting. */
const INCREMENT_SECONDS = 300;
type GhostMode = 'exchange' | 'complete' | 'proportional';

const int = (v: number) => new Intl.NumberFormat('pt-BR').format(Math.round(v));
const mi = (v: number) =>
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(v / 1e6) + ' mi';
const pct = (v: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
    v * 100,
  ) + '%';
const clock = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

type View = {
  at: string;
  nat: NationalState;
  /** Eased values for drawing (votes). */
  flavio: number;
  lula: number;
  target: number;
  /** Eased 1st-round position of each finalist on the same units (ghost). */
  ghost: Pair;
  /** Votes 5 minutes earlier (increment start). */
  before: Pair;
  /** Mathematical victory: who and how long ago (ms of real time) it was first observed. */
  victory: { winner: 'f' | 'l'; elapsed: number } | null;
};

/** First replay instant (seconds) with a mathematical victory, or null. */
function victoryTime(replay: ReplayState) {
  replay.reset();
  for (const e of replay.file.events) {
    replay.advanceTo(e[0]);
    if (victor(replay.national)) {
      const at = e[0];
      replay.reset();
      return at;
    }
  }
  replay.reset();
  return null;
}

/**
 * Race prototype: a race camera that follows the leader (main piece) and the whole track beside
 * it, both with a ghost per lane — where the same candidate would be with the 1st-round votes of
 * the same município–zona units counted so far (not chronological). The 2nd round here is
 * SYNTHETIC (derived from the real 1st-round replay); the ghosts are the real 1st round.
 */
export default function RacePrototype() {
  const [view, setView] = useState<View | null>(null);
  const [speed, setSpeed] = useState(120);
  const [mode, setMode] = useState<GhostMode>('exchange');
  const [error, setError] = useState('');
  const control = useRef({
    speed,
    mode,
    restart: () => {},
    /** Jump to a few seconds before the mathematical victory. */
    toVictory: () => {},
    /** Replay the effect without moving the clock. */
    replayEffect: () => {},
  });
  control.current.speed = speed;
  control.current.mode = mode;

  useEffect(() => {
    let frame = 0,
      disposed = false;
    fetch('/dev/replay-round1.json')
      .then((r) => r.json() as Promise<ReplayFile>)
      .then((file) => {
        if (disposed) return;
        const replay = new ReplayState(synthetic2T(file), finalVotes(file));
        const start = replay.firstCount() - 60,
          end = replay.lastEvent();
        const crossing = victoryTime(replay);
        let simulated = start,
          last = performance.now();
        let victoryAt: { winner: 'f' | 'l'; at: number } | null = null;
        let shown = { flavio: 0, lula: 0, target: 0, ghost: { flavio: 0, lula: 0 } };
        let history: { at: number; flavio: number; lula: number }[] = [];
        control.current.restart = () => {
          simulated = start;
          replay.reset();
          shown = { flavio: 0, lula: 0, target: 0, ghost: { flavio: 0, lula: 0 } };
          history = [];
          victoryAt = null;
        };
        control.current.toVictory = () => {
          if (crossing === null) return;
          control.current.restart();
          simulated = crossing - 40;
          victoryAt = null;
        };
        control.current.replayEffect = () => {
          if (victoryAt) victoryAt = { ...victoryAt, at: performance.now() };
        };
        const step = (now: number) => {
          if (disposed) return;
          const dt = Math.min(100, now - last);
          last = now;
          simulated += (dt / 1000) * control.current.speed;
          if (simulated > end + 300) control.current.restart();
          replay.advanceTo(simulated);
          const nat = replay.national;
          const winner = victor(nat);
          if (winner && !victoryAt) victoryAt = { winner, at: now };
          if (!winner) victoryAt = null; // only a rewind can undo it
          // Half of the valid votes still possible: registered − abstentions − non-valid so far.
          const abstentions = nat.countedElectorate - nat.turnout;
          const target = Math.max(0, (nat.electorate - abstentions - nat.notValid) / 2);
          const ghost = nat.ghost[control.current.mode];
          // Ease toward the counted values (the live telão receives steps every few seconds).
          const k = 1 - Math.exp(-dt / 350);
          const ease = (a: number, b: number) => a + (b - a) * k;
          shown = {
            flavio: ease(shown.flavio, nat.flavio),
            lula: ease(shown.lula, nat.lula),
            target: shown.target ? ease(shown.target, target) : target,
            ghost: {
              flavio: ease(shown.ghost.flavio, ghost.flavio),
              lula: ease(shown.ghost.lula, ghost.lula),
            },
          };
          if (!history.length || simulated - history.at(-1)!.at >= 30) {
            history.push({ at: simulated, flavio: nat.flavio, lula: nat.lula });
            while (history.length > 2 && history[1].at < simulated - INCREMENT_SECONDS)
              history.shift();
          }
          setView({
            at: new Date(Date.parse(file.base) + simulated * 1000).toISOString(),
            nat: { ...nat, ghost: { ...nat.ghost } },
            ...shown,
            before: history[0] ?? { flavio: 0, lula: 0 },
            victory: victoryAt ? { winner: victoryAt.winner, elapsed: now - victoryAt.at } : null,
          });
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

  // Camera track: long straights seen up close. Whole-track panel: its own, taller geometry.
  const long = useMemo(() => makeTrack({ n: 8, width: 1880, radius: 28 }), []);
  const whole = useMemo(() => makeTrack({ n: 10, width: 640, radius: 22, top: 40, side: 16 }), []);

  if (error) return <p className="race-error">{error}</p>;
  if (!view) return <p className="race-error">Carregando replay…</p>;
  const nat = view.nat;
  const total = nat.electorate * TRACK_SHARE;
  const valid = nat.flavio + nat.lula;
  const gap = (now: number, then: number) =>
    then > 0 ? `${now >= then ? '+' : '−'}${mi(Math.abs(now - then))}` : '—';
  return (
    <div className="race race2">
      <header className="race-top">
        <div>
          <h1>Protótipo · corrida</h1>
          <p>
            <strong className="synthetic">2º turno SINTÉTICO</strong> derivado do replay real do 1º
            turno (só para teste visual) · fantasmas: <strong>1º turno real</strong> nas mesmas
            zonas
          </p>
        </div>
        <div className="race-hud">
          <span>{clock(view.at)}</span>
          <span>{pct(nat.totalized / nat.sections)} das seções</span>
          <span className="f">{valid ? pct(nat.flavio / valid) : '—'}</span>
          <span className="l">{valid ? pct(nat.lula / valid) : '—'}</span>
        </div>
        <label>
          Fantasma{' '}
          <select value={mode} onChange={(e) => setMode(e.target.value as GhostMode)}>
            <option value="exchange">zonas encerradas trocadas pelo 1º turno (exato)</option>
            <option value="complete">só zonas encerradas</option>
            <option value="proportional">proporcional às seções (estimativa)</option>
          </select>
        </label>
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
        <button onClick={() => control.current.toVictory()}>Ir para a vitória</button>
        <button onClick={() => control.current.replayEffect()} disabled={!view.victory}>
          Repetir efeito
        </button>
      </header>

      <section className={`race-camera ${view.victory ? `won ${view.victory.winner}` : ''}`}>
        <Serpentine
          track={long}
          view={view}
          total={total}
          fixed={nat.electorate / 2}
          camera={{ zoom: 4 + 2 * zoomBump(view.victory?.elapsed ?? null), aspect: 1240 / 880 }}
        />
        {view.victory && (
          <VictoryBanner
            {...view.victory}
            name={`${view.victory.winner === 'f' ? 'candidatura verde' : 'candidatura vermelha'} · demonstração com 2º turno sintético`}
          />
        )}
      </section>

      <aside className="race-whole">
        <h2>Pista inteira</h2>
        <Serpentine track={whole} view={view} total={total} fixed={nat.electorate / 2} compact />
        <dl className="race-ghost">
          <div>
            <dt>
              <i className="ring f" /> vs 1º turno nas mesmas zonas
            </dt>
            <dd className="f">{gap(nat.flavio, nat.ghost[mode].flavio)}</dd>
          </div>
          <div>
            <dt>
              <i className="ring l" /> vs 1º turno nas mesmas zonas
            </dt>
            <dd className="l">{gap(nat.lula, nat.ghost[mode].lula)}</dd>
          </div>
        </dl>
        <p className="race-note">
          Anel: onde o mesmo candidato estaria com os votos do 1º turno nas zonas já apuradas (
          {mode === 'exchange'
            ? 'apuração atual com as município–zonas já encerradas trocadas pelo seu resultado no 1º turno; a distância ao corredor é a diferença exata nessas zonas'
            : mode === 'complete'
              ? 'só município–zonas encerradas'
              : 'zonas parciais na proporção das seções apuradas — estimativa'}
          ). Não é cronológico.
        </p>
      </aside>
    </div>
  );
}
