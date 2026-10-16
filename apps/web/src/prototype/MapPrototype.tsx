import { useEffect, useRef, useState } from 'react';
import maplibregl, { type ExpressionSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { height, margin, ReplayState, type HeightMode, type ReplayFile } from './replay';
import { FeedQueue, type FeedItem } from './feed';
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
/** Real milliseconds between feed cards: readable at the peak, the queue picks what to show. */
const FEED_PACE_MS = 900;
const STATUS = { none: 0, counting: 1, closed: 2 } as const;
const SPEEDS = [30, 60, 120, 300];
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

type Feed = (FeedItem & { id: number; name: string })[];

/**
 * Map prototype: municipalities rise and paint as the real 1st-round night replays. Height is the
 * leader's margin (three scales to compare), colour the leader, dim while counting, full when
 * every section is counted; a brief flash marks the municipality that just received a bulletin.
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
  });
  const [feed, setFeed] = useState<Feed>([]);
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
      pitch: 48,
      bearing: -8,
      attributionControl: false,
      maxPitch: 70,
    });
    map.current = m;
    m.on('load', async () => {
      try {
        const [geo, ufs, file] = await Promise.all([
          fetch('/dev/municipios.geojson').then((r) => r.json()),
          fetch('/dev/ufs.geojson').then((r) => r.json()),
          fetch('/dev/replay-round1.json').then((r) => r.json() as Promise<ReplayFile>),
        ]);
        if (disposed) return;
        m.addSource('mun', { type: 'geojson', data: geo });
        m.addSource('uf', { type: 'geojson', data: ufs });
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

        m.fitBounds(BRAZIL, {
          padding: { top: 150, bottom: 110, left: 30, right: 30 },
          duration: 0,
        });
        m.setPitch(48);
        const replay = new ReplayState(file);
        const queue = new FeedQueue();
        let lastCard = 0;
        const names = file.municipalities.map(([, name]) => name);
        const featureOf = new Map<string, number>();
        for (const f of geo.features) featureOf.set(f.properties.id, f.id);
        const feature = file.municipalities.map(([id]) => featureOf.get(id));
        const n = file.municipalities.length;
        const current = new Float64Array(n),
          target = new Float64Array(n),
          flash = new Float64Array(n);
        const active = new Set<number>();
        const totalSections = replay.municipalities.reduce((s, x) => s + x.sections, 0);
        const start = replay.firstCount() - 120,
          end = replay.lastEvent();
        let simulated = start,
          last = performance.now(),
          lastHud = 0,
          lastMode = control.current.mode,
          lastScale = control.current.scale,
          id = 0;
        const mapped = geo.features.length;
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
          setFeed([]);
        };
        const tick = (now: number) => {
          if (disposed) return;
          const dt = Math.min(100, now - last);
          last = now;
          simulated += (dt / 1000) * control.current.speed;
          if (simulated > end + 600) control.current.restart();
          const arrivals = replay.advanceTo(simulated);
          for (const a of arrivals) {
            const i = a.municipality,
              s = replay.municipalities[i];
            if (feature[i] === undefined) continue;
            m.setFeatureState(
              { source: 'mun', id: feature[i]! },
              { status: STATUS[s.status], lead: margin(s).leader },
            );
            flash[i] = 1;
            retarget(i);
          }
          queue.push(
            arrivals
              .filter((a) => feature[a.municipality] !== undefined)
              .map((a) => ({
                ...a,
                closes: replay.municipalities[a.municipality].status === 'closed',
              })),
          );
          if (now - lastCard >= FEED_PACE_MS) {
            const card = queue.next();
            if (card) {
              lastCard = now;
              const shown = { ...card, id: id++, name: names[card.municipality] };
              setFeed((items) => [shown, ...items].slice(0, 30));
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
              closed = 0,
              counting = 0;
            for (const s of replay.municipalities) {
              counted += s.totalized;
              if (s.status === 'closed') closed++;
              else if (s.status === 'counting') counting++;
            }
            setHud({
              at: new Date(Date.parse(file.base) + simulated * 1000).toISOString(),
              counted: counted / totalSections,
              closed,
              counting,
              total: mapped,
              perMinute: queue.lastMinute(simulated),
              waiting: queue.waiting,
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
          <strong>Replay real do 1º turno</strong> (TSE, noite de 04/10/2026) para avaliar movimento
          e escala. Não é o 2º turno.
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
      <div className="proto-feed-head">
        <strong>Chegando agora</strong>
        <span>
          {int(hud.perMinute)} boletins no último minuto da apuração · {int(hud.waiting)} na fila
        </span>
      </div>
      <ol className="proto-feed" aria-label="Chegando agora">
        {feed.map((a) => (
          <li key={a.id}>
            <div className="where">
              {a.name} <small>zona {Number(a.zone)}</small>
            </div>
            <div className="what">
              +{a.addedSections} {a.addedSections === 1 ? 'seção' : 'seções'}{' '}
              <small>
                ({a.totalized}/{a.sections})
              </small>
              {a.closes && <span className="closed">município encerrado</span>}
            </div>
            <div className="votes">
              <span className="f">Flávio +{int(a.addedFlavio)}</span>
              <span className="l">Lula +{int(a.addedLula)}</span>
            </div>
          </li>
        ))}
      </ol>
      {error && <p className="proto-error">{error}</p>}
    </div>
  );
}
