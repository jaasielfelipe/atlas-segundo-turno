import { useEffect, useRef } from 'react';
import maplibregl, { type ExpressionSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { height, margin } from '../prototype/replay';
import type { TelaoEngine } from './engine';

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
const BRAZIL: [[number, number], [number, number]] = [
  [-74.2, -33.9],
  [-34.6, 5.4],
];
const STATUS = { none: 0, counting: 1, closed: 2 } as const;
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

/**
 * Municipalities in 3D: colour = leader (dim while counting, full when closed), height = the
 * leader's margin in votes (√), animated; a flash on each bulletin; slow camera sway. Driven by
 * the engine's zone versions (sums of each municipality's município–zona segments).
 */
export default function MapView({ engine }: { engine: TelaoEngine }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false,
      frame = 0,
      unsubscribe = () => {};
    const m = new maplibregl.Map({
      container: container.current!,
      style: {
        version: 8,
        sources: {},
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': C.background } }],
      },
      center: [-53.5, -15],
      zoom: 3.5,
      attributionControl: false,
      interactive: false,
      maxPitch: 70,
    });
    m.on('load', async () => {
      const [geo, ufGeo] = await Promise.all([
        fetch('/geo/municipios.geojson').then((r) => r.json()),
        fetch('/geo/ufs.geojson').then((r) => r.json()),
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
      const framed = m.cameraForBounds(BRAZIL, {
        padding: { top: 60, bottom: 40, left: 20, right: 250 }, // zone stream on the right
      })!;
      m.jumpTo({ ...framed, zoom: (framed.zoom ?? 3.5) + 0.1, pitch: 46, bearing: -8 });

      // Feature state needs the GeoJSON source parsed: wait for the first idle frame.
      await new Promise<void>((done) => m.once('idle', () => done()));
      if (disposed) return;
      const featureOf = new Map<string, number>();
      for (const f of geo.features) featureOf.set(f.properties.id, f.id);
      let feature: (number | undefined)[] = [];
      let current = new Float64Array(0),
        target = new Float64Array(0),
        flash = new Float64Array(0);
      let generation = -1;
      const active = new Set<number>();
      // (Re)bind to the engine's current file: all states from scratch (bootstrap or restart).
      const bind = () => {
        if (!engine.file || !engine.replay) return false;
        generation = engine.generation;
        feature = engine.file.municipalities.map(([id]) => featureOf.get(id));
        const n = feature.length;
        current = new Float64Array(n);
        target = new Float64Array(n);
        flash = new Float64Array(n);
        m.removeFeatureState({ source: 'mun' });
        engine.replay.municipalities.forEach((_, i) => update(i, false));
        return true;
      };
      const update = (i: number, bulletin: boolean) => {
        const id = feature[i],
          s = engine.replay!.municipalities[i];
        if (id === undefined) return; // exterior / no geometry
        m.setFeatureState(
          { source: 'mun', id },
          { status: STATUS[s.status], lead: margin(s).leader },
        );
        target[i] = height(s, 'votes');
        if (bulletin) flash[i] = 1;
        active.add(i);
      };
      unsubscribe = engine.onArrivals((arrivals) => {
        if (generation !== engine.generation) bind();
        for (const a of arrivals) update(a.municipality, true);
      });
      let last = performance.now();
      const tick = (now: number) => {
        if (disposed) return;
        const dt = Math.min(100, now - last);
        last = now;
        if (generation !== engine.generation) bind();
        const k = 1 - Math.exp(-dt / 220);
        for (const i of active) {
          current[i] += (target[i] - current[i]) * k;
          flash[i] = Math.max(0, flash[i] - dt / 1200);
          m.setFeatureState({ source: 'mun', id: feature[i]! }, { h: current[i], flash: flash[i] });
          if (Math.abs(target[i] - current[i]) < 50 && flash[i] === 0) {
            current[i] = target[i];
            m.setFeatureState({ source: 'mun', id: feature[i]! }, { h: current[i] });
            active.delete(i);
          }
        }
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
          m.setBearing(-8 + 10 * Math.sin(now / 24000));
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    });
    return () => {
      disposed = true;
      unsubscribe();
      cancelAnimationFrame(frame);
      m.remove();
    };
  }, [engine]);
  return (
    <div className="t-map">
      <div ref={container} className="t-map-canvas" />
      <ul className="t-map-legend">
        <li>
          <i style={{ background: C.flavio }} />
          <i style={{ background: C.lula }} /> lidera no município ·{' '}
          <i style={{ background: C.flavioDim }} />
          <i style={{ background: C.lulaDim }} /> em apuração
        </li>
        <li>altura: vantagem do líder em votos</li>
      </ul>
    </div>
  );
}
