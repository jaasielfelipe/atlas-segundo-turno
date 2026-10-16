import { useEffect, useRef, useState } from 'react';
import maplibregl, { type ExpressionSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  height,
  margin,
  ReplayState,
  type Arrival,
  type HeightMode,
  type ReplayFile,
} from './replay';
import { FeedQueue } from './feed';
import './prototype.css';

// Colors follow the candidate (user decision): Flávio green, Lula red; dim while counting.
const C = {
  background: '#0d1014',
  land: '#171c22',
  border: '#262d36',
  uf: '#4a5361',
  flavio: '#33ab64',
  flavioDim: '#1f4f33',
  lula: '#be2b2b',
  lulaDim: '#5a2121',
  tie: '#9a8f5a',
  flavioFlash: '#9ff0bf',
  lulaFlash: '#ff9d94',
};
/** Brazil (without the exterior), framed by the map on load. */
const BRAZIL: [[number, number], [number, number]] = [
  [-74.2, -33.9],
  [-34.6, 5.4],
];
const STATUS = { none: 0, counting: 1, closed: 2 } as const;
const SPEEDS = [30, 60, 120, 300];
/** Real milliseconds between closed-municipality cards; the queue picks what to show. */
const CLOSED_PACE_MS = 1800;
/** The zone stream shows every bulletin, flushed in small batches. */
const STREAM_FLUSH_MS = 200;
const STREAM_SIZE = 90;

const int = (v: number) => new Intl.NumberFormat('pt-BR').format(Math.round(v));
const pct = (v: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
    v * 100,
  ) + '%';
const clock = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

const leader: ExpressionSpecification = ['coalesce', ['feature-state', 'lead'], 0];
const status: ExpressionSpecification = ['coalesce', ['feature-state', 'status'], 0];
const color: ExpressionSpecification = [
  'case',
  ['==', status, STATUS.none],
  C.land,
  ['==', leader, 0],
  C.tie,
  ['==', status, STATUS.closed],
  ['case', ['>', leader, 0], C.flavio, C.lula],
  ['case', ['>', leader, 0], C.flavioDim, C.lulaDim],
];

type Side = 'f' | 'l' | 't';
const sideOf = (diff: number): Side => (diff > 0 ? 'f' : diff < 0 ? 'l' : 't');
/** One zone bulletin in the fast stream (colour: who got more votes in this bulletin). */
type Chip = { id: number; uf: string; name: string; zone: string; diff: number; side: Side };
/** Final numbers of a municipality at the bulletin that closed it. */
type Totals = { flavio: number; lula: number; valid: number; sections: number };
type Closed = Totals & { id: number; uf: string; name: string };

/**
 * Map prototype: municipalities rise and paint as the real 1st-round night replays (TSE
 * generation time). Height is the leader's margin, colour the leader, dim while counting, full
 * when every section is counted; a flash marks each bulletin. Two feeds: every zone bulletin as a
 * fast stream, and municipalities that closed as slower, larger cards.
 */
export default function MapPrototype() {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [speed, setSpeed] = useState(120);
  const [mode, setMode] = useState<HeightMode>('votes');
  const [scale, setScale] = useState(1);
  const [pitch, setPitch] = useState(true);
  const [hud, setHud] = useState({
    at: '',
    counted: 0,
    closed: 0,
    counting: 0,
    total: 0,
    perMinute: 0,
    waiting: 0,
    tally: { f: 0, l: 0, t: 0 },
  });
  const [stream, setStream] = useState<Chip[]>([]);
  const [closed, setClosed] = useState<Closed[]>([]);
  const control = useRef({ speed, mode, scale, restart: () => {} });
  control.current.speed = speed;
  control.current.mode = mode;
  control.current.scale = scale;
  const map = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    let disposed = false;
    let frame = 0;
    const m = new maplibregl.Map({
      container: container.current!,
      style: {
        version: 8,
        sources: {},
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': C.background } }],
      },
      center: [-53.5, -15],
      zoom: 3.55,
      attributionControl: false,
      maxPitch: 70,
    });
    map.current = m;
    m.on('load', async () => {
      try {
        const [geo, ufGeo, file] = await Promise.all([
          fetch('/dev/municipios.geojson').then((r) => r.json()),
          fetch('/dev/ufs.geojson').then((r) => r.json()),
          fetch('/dev/replay-round1.json').then((r) => r.json() as Promise<ReplayFile>),
        ]);
        if (disposed) return;
        m.addSource('mun', { type: 'geojson', data: geo });
        m.addSource('uf', { type: 'geojson', data: ufGeo });
        m.addLayer({ id: 'land', type: 'fill', source: 'mun', paint: { 'fill-color': C.land } });
        m.addLayer({
          id: 'mun-lines',
          type: 'line',
          source: 'mun',
          paint: { 'line-color': C.border, 'line-width': 0.3 },
        });
        m.addLayer({
          id: 'uf-lines',
          type: 'line',
          source: 'uf',
          paint: { 'line-color': C.uf, 'line-width': 0.8 },
        });
        m.addLayer({
          id: 'prisms',
          type: 'fill-extrusion',
          source: 'mun',
          paint: {
            'fill-extrusion-color': [
              'interpolate',
              ['linear'],
              ['coalesce', ['feature-state', 'flash'], 0],
              0,
              color,
              1,
              ['case', ['>', leader, 0], C.flavioFlash, C.lulaFlash],
            ],
            'fill-extrusion-height': ['coalesce', ['feature-state', 'h'], 0],
            'fill-extrusion-opacity': 0.94,
            'fill-extrusion-vertical-gradient': true,
          },
        });
        // Frame Brazil flat, then tilt (fitBounds resets the camera).
        const framed = m.cameraForBounds(BRAZIL, {
          padding: { top: 150, bottom: 110, left: 30, right: 30 },
        })!;
        m.jumpTo({ ...framed, pitch: 48, bearing: -8 });

        const replay = new ReplayState(file);
        const names = file.municipalities.map(([, name]) => name);
        const ufs = file.municipalities.map(([key]) => key.slice(0, 2).toUpperCase());
        const featureOf = new Map<string, number>();
        for (const f of geo.features) featureOf.set(f.properties.id, f.id);
        const feature = file.municipalities.map(([id]) => featureOf.get(id));
        const n = file.municipalities.length;
        const mapped = geo.features.length;
        const current = new Float64Array(n),
          target = new Float64Array(n),
          flash = new Float64Array(n);
        const active = new Set<number>();
        const totalSections = replay.municipalities.reduce((s, x) => s + x.sections, 0);
        // Closed municipalities: paced queue (biggest and newest first). Zone stream: all, batched.
        const queue = new FeedQueue();
        const snapshots = new Map<Arrival, Totals>();
        const recent: { at: number; side: Side }[] = [];
        let pending: Chip[] = [];
        const start = replay.firstCount() - 120,
          end = replay.lastEvent();
        let simulated = start,
          last = performance.now(),
          lastHud = 0,
          lastCard = 0,
          lastFlush = 0,
          lastMode = control.current.mode,
          lastScale = control.current.scale,
          id = 0;
        const retarget = (i: number) => {
          target[i] =
            height(replay.municipalities[i], control.current.mode) * control.current.scale;
          if (feature[i] !== undefined) active.add(i);
        };
        control.current.restart = () => {
          simulated = start;
          replay.reset();
          for (let i = 0; i < n; i++) {
            target[i] = 0;
            current[i] = 0;
            flash[i] = 0;
            if (feature[i] !== undefined)
              m.setFeatureState(
                { source: 'mun', id: feature[i]! },
                { h: 0, status: 0, lead: 0, flash: 0 },
              );
          }
          active.clear();
          queue.clear();
          snapshots.clear();
          recent.length = 0;
          pending = [];
          setStream([]);
          setClosed([]);
        };
        const tick = (now: number) => {
          if (disposed) return;
          const dt = Math.min(100, now - last);
          last = now;
          simulated += (dt / 1000) * control.current.speed;
          if (simulated > end + 600) control.current.restart();
          for (const a of replay.advanceTo(simulated)) {
            const i = a.municipality,
              s = replay.municipalities[i];
            if (feature[i] === undefined) continue; // exterior / no geometry
            m.setFeatureState(
              { source: 'mun', id: feature[i]! },
              { status: STATUS[s.status], lead: margin(s).leader },
            );
            flash[i] = 1;
            retarget(i);
            const diff = a.addedFlavio - a.addedLula;
            pending.push({
              id: id++,
              uf: ufs[i],
              name: names[i],
              zone: a.zone,
              diff,
              side: sideOf(diff),
            });
            recent.push({ at: a.at, side: sideOf(diff) });
            if (a.closes) {
              snapshots.set(a, {
                flavio: s.flavio,
                lula: s.lula,
                valid: s.valid,
                sections: s.sections,
              });
              queue.push([a]);
            }
          }
          while (recent.length && recent[0].at < simulated - 60) recent.shift();
          if (now - lastFlush >= STREAM_FLUSH_MS && pending.length) {
            lastFlush = now;
            const batch = pending.slice(-STREAM_SIZE).reverse();
            pending = [];
            setStream((items) => [...batch, ...items].slice(0, STREAM_SIZE));
          }
          if (now - lastCard >= CLOSED_PACE_MS) {
            const card = queue.next();
            if (card) {
              lastCard = now;
              const shown: Closed = {
                ...snapshots.get(card)!,
                id: id++,
                uf: ufs[card.municipality],
                name: names[card.municipality],
              };
              snapshots.delete(card);
              setClosed((items) => [shown, ...items].slice(0, 14));
            }
          }
          if (control.current.mode !== lastMode || control.current.scale !== lastScale) {
            lastMode = control.current.mode;
            lastScale = control.current.scale;
            for (let i = 0; i < n; i++) retarget(i);
          }
          // Ease every changed prism toward its target (~0.6 s), flash fades in ~1.2 s.
          const k = 1 - Math.exp(-dt / 220);
          for (const i of active) {
            current[i] += (target[i] - current[i]) * k;
            flash[i] = Math.max(0, flash[i] - dt / 1200);
            m.setFeatureState(
              { source: 'mun', id: feature[i]! },
              { h: current[i], flash: flash[i] },
            );
            if (Math.abs(target[i] - current[i]) < 50 && flash[i] === 0) {
              current[i] = target[i];
              m.setFeatureState({ source: 'mun', id: feature[i]! }, { h: current[i] });
              active.delete(i);
            }
          }
          // Slow camera sway: motion even between bulletins.
          if (!m.isMoving()) m.setBearing(-8 + 10 * Math.sin(now / 24000));
          if (now - lastHud > 250) {
            lastHud = now;
            let counted = 0,
              closedCount = 0,
              counting = 0;
            for (const s of replay.municipalities) {
              counted += s.totalized;
              if (s.status === 'closed') closedCount++;
              else if (s.status === 'counting') counting++;
            }
            const tally = { f: 0, l: 0, t: 0 };
            for (const r of recent) tally[r.side]++;
            setHud({
              at: new Date(Date.parse(file.base) + simulated * 1000).toISOString(),
              counted: counted / totalSections,
              closed: closedCount,
              counting,
              total: mapped,
              perMinute: recent.length,
              waiting: queue.waiting,
              tally,
            });
          }
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      } catch (e) {
        setError(
          `${(e as Error).message}. Gere os dados com: pnpm prototype:data (usa o acervo do 1º turno).`,
        );
      }
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      m.remove();
    };
  }, []);

  useEffect(() => {
    map.current?.easeTo({ pitch: pitch ? 48 : 0, duration: 1200 });
  }, [pitch]);

  return (
    <div className="proto">
      <div ref={container} className="proto-map" />
      <header className="proto-head">
        <h1>Protótipo · mapa por município</h1>
        <p>
          <strong>Replay real do 1º turno</strong> (TSE, noite de 04/10/2026, horário de geração dos
          arquivos) para avaliar movimento e escala. Não é o 2º turno.
        </p>
        <div className="proto-clock">
          <span>{hud.at ? clock(hud.at) : '—'}</span>
          <span>{pct(hud.counted)} das seções</span>
          <span>
            {int(hud.closed)} encerrados · {int(hud.counting)} em apuração · de {int(hud.total)}
          </span>
        </div>
      </header>
      <aside className="proto-controls">
        <label>
          Altura
          <select value={mode} onChange={(e) => setMode(e.target.value as HeightMode)}>
            <option value="votes">vantagem em votos (√)</option>
            <option value="points">vantagem em p.p. dos válidos</option>
            <option value="weighted">p.p. × fração apurada</option>
          </select>
        </label>
        <label>
          Exagero {scale.toFixed(1)}×
          <input
            type="range"
            min={0.2}
            max={3}
            step={0.1}
            value={scale}
            onChange={(e) => setScale(Number(e.target.value))}
          />
        </label>
        <label>
          Velocidade
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}× (1 h em {Math.round(3600 / s)} s)
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => setPitch((p) => !p)}>{pitch ? 'Ver 2D' : 'Ver 3D'}</button>
        <button onClick={() => control.current.restart()}>Recomeçar</button>
        <ul className="proto-legend">
          <li>
            <i style={{ background: C.flavio }} /> Flávio lidera ·{' '}
            <i style={{ background: C.lula }} /> Lula lidera
          </li>
          <li>
            <i style={{ background: C.flavioDim }} />
            <i style={{ background: C.lulaDim }} /> cor escura: em apuração
          </li>
          <li>
            <i style={{ background: C.land }} /> sem seções apuradas
          </li>
          <li>altura: vantagem do líder no município</li>
        </ul>
      </aside>

      <section className="proto-stream" aria-label="Boletins por zona">
        <header>
          <strong>Boletins por zona</strong>
          <span>{int(hud.perMinute)} no último minuto da apuração</span>
          <div className="tally" aria-label="Boletins do último minuto por quem teve mais votos">
            {(['f', 'l', 't'] as const).map((k) =>
              hud.tally[k] ? (
                <i key={k} className={k} style={{ flexGrow: hud.tally[k] }}>
                  {hud.tally[k] > 6 ? int(hud.tally[k]) : ''}
                </i>
              ) : null,
            )}
          </div>
          <small>cor: quem teve mais votos no boletim</small>
        </header>
        <ol>
          {stream.map((c) => (
            <li key={c.id} className={c.side}>
              <span className="place">
                {c.uf} · {c.name} <small>z{Number(c.zone)}</small>
              </span>
              <span className="n">
                {c.diff === 0 ? '±0' : `${c.side === 'f' ? 'F' : 'L'} +${int(Math.abs(c.diff))}`}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="proto-closed" aria-label="Municípios encerrados">
        <header>
          <strong>Municípios encerrados</strong>
          <span>
            {int(hud.closed)} de {int(hud.total)} · {int(hud.waiting)} aguardando vez na tela
          </span>
        </header>
        <ol>
          {closed.map((c) => {
            const lead = sideOf(c.flavio - c.lula);
            return (
              <li key={c.id}>
                <div className="where">
                  {c.name} <small>{c.uf}</small>
                </div>
                <div className="split" aria-hidden="true">
                  <i className="f" style={{ flexGrow: c.flavio }} />
                  <i className="o" style={{ flexGrow: Math.max(0, c.valid - c.flavio - c.lula) }} />
                  <i className="l" style={{ flexGrow: c.lula }} />
                </div>
                <div className="shares">
                  <span className="f">Flávio {c.valid ? pct(c.flavio / c.valid) : '—'}</span>
                  <span className="lead">
                    {lead === 't'
                      ? 'empate'
                      : `${lead === 'f' ? 'Flávio' : 'Lula'} à frente por ${int(Math.abs(c.flavio - c.lula))} votos`}
                  </span>
                  <span className="l">Lula {c.valid ? pct(c.lula / c.valid) : '—'}</span>
                </div>
                <div className="meta">
                  {int(c.sections)} seções · % dos válidos · cinza: demais candidaturas (só no 1º
                  turno)
                </div>
              </li>
            );
          })}
        </ol>
      </section>
      {error && <p className="proto-error">{error}</p>}
    </div>
  );
}
