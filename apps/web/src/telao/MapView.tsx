import { useEffect, useRef } from 'react';
import maplibregl, { type ExpressionSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { height, margin } from '../prototype/replay';
import type { TelaoEngine } from './engine';
import { telaoLayout } from './layout';

// Colors follow the candidate (user decision): Flávio green, Lula red; dim once closed.
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
/**
 * Prisms never share a plane with the land: only municipalities with counted sections are
 * extruded, and at least this high (metres). A zero-height prism over the land fill z-fights
 * (flickering dark patches, strongest on the globe).
 */
const MIN_HEIGHT = 1500;

/**
 * Map surface (see telaoLayout): globe projection with a soft sky and atmosphere, graticule every
 * 5°, the other continents muted (Natural Earth 1:50m land), optional stronger light on prisms.
 */
const surfaceOptions = telaoLayout;

/** Meridians and parallels every `step` degrees, densely sampled so they curve on the globe. */
function graticule(step = 5) {
  const lines: [number, number][][] = [];
  for (let lon = -180; lon <= 180; lon += step) {
    const line: [number, number][] = [];
    for (let lat = -80; lat <= 80; lat += 2) line.push([lon, lat]);
    lines.push(line);
  }
  for (let lat = -80; lat <= 80; lat += step) {
    const line: [number, number][] = [];
    for (let lon = -180; lon <= 180; lon += 2) line.push([lon, lat]);
    lines.push(line);
  }
  return {
    type: 'FeatureCollection' as const,
    features: lines.map((coordinates, i) => ({
      type: 'Feature' as const,
      id: i,
      properties: { equator: coordinates.every(([, lat]) => lat === 0) },
      geometry: { type: 'LineString' as const, coordinates },
    })),
  };
}
const leader: ExpressionSpecification = ['coalesce', ['feature-state', 'lead'], 0];
const status: ExpressionSpecification = ['coalesce', ['feature-state', 'status'], 0];
const color: ExpressionSpecification = [
  'case',
  ['==', status, STATUS.none],
  C.land,
  ['==', leader, 0],
  C.tie,
  // Bright while counting (alive), darker once every section is counted.
  ['==', status, STATUS.closed],
  ['case', ['>', leader, 0], C.flavioDim, C.lulaDim],
  ['case', ['>', leader, 0], C.flavio, C.lula],
];

/**
 * Municipalities in 3D: colour = leader (dim while counting, full when closed), height = the
 * leader's margin in votes (√), animated; a flash on each bulletin; slow camera sway. Driven by
 * the engine's zone versions (sums of each municipality's município–zona segments).
 */
/** Screen area (px from each edge of the map canvas) where Brazil must be framed. */
export type Framing = { top: number; right: number; bottom: number; left: number };

export default function MapView({
  engine,
  framing = { top: 40, bottom: 30, left: 20, right: 20 },
  zoomBoost = 0.1,
  className = 't-map',
}: {
  engine: TelaoEngine;
  framing?: Framing;
  /** Extra zoom over the fitted frame (off-axis framing on the globe looks smaller). */
  zoomBoost?: number;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false,
      frame = 0,
      unsubscribe = () => {};
    const surface = surfaceOptions();
    const m = new maplibregl.Map({
      container: container.current!,
      style: {
        version: 8,
        ...(surface.globe
          ? {
              projection: { type: 'globe' },
              sky: {
                // Soft: a thin halo on the horizon, not a glow.
                'sky-color': '#0d1218',
                'horizon-color': '#18263a',
                'fog-color': '#0d1014',
                'sky-horizon-blend': 0.4,
                'horizon-fog-blend': 0.6,
                'fog-ground-blend': 0.7,
                'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.55, 6, 0.3, 9, 0],
              },
            }
          : {}),
        ...(surface.light
          ? {
              light: { anchor: 'map', color: '#fff8ec', intensity: 0.55, position: [1.4, 215, 35] },
            }
          : {}),
        sources: {
          ...(surface.grid ? { grid: { type: 'geojson' as const, data: graticule() } } : {}),
          ...(surface.continents
            ? { world: { type: 'geojson' as const, data: '/geo/land.geojson' } }
            : {}),
        },
        layers: [
          {
            id: 'bg',
            type: 'background',
            paint: { 'background-color': surface.globe ? '#121821' : C.background },
          },
          ...(surface.grid
            ? [
                {
                  id: 'grid',
                  type: 'line' as const,
                  source: 'grid',
                  paint: {
                    'line-color': [
                      'case',
                      ['get', 'equator'],
                      surface.globe ? '#3a4c60' : '#2d3b4b',
                      surface.globe ? '#28323f' : '#1e2733',
                    ] as ExpressionSpecification,
                    'line-width': ['case', ['get', 'equator'], 1, 0.6] as ExpressionSpecification,
                  },
                },
              ]
            : []),
          // Other continents just above the ocean tone, under Brazil: no more island effect.
          ...(surface.continents
            ? [
                {
                  id: 'world',
                  type: 'fill' as const,
                  source: 'world',
                  // The globe ocean is lighter than the flat background: land follows it.
                  paint: {
                    'fill-color': surface.globe ? '#1c242f' : '#161c24',
                    'fill-antialias': true,
                  },
                },
                {
                  id: 'world-coast',
                  type: 'line' as const,
                  source: 'world',
                  paint: {
                    'line-color': surface.globe ? '#26303c' : '#1f2731',
                    'line-width': 0.6,
                  },
                },
              ]
            : []),
        ],
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
        filter: ['in', ['id'], ['literal', []]],
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
        padding: framing,
      })!;
      m.jumpTo({ ...framed, zoom: (framed.zoom ?? 3.5) + zoomBoost, pitch: 46, bearing: -8 });

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
      // Feature ids of municipalities with counted sections (the only ones extruded).
      const extruded = new Set<number>();
      let filterDirty = true,
        lastFilter = 0;
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
        extruded.clear();
        filterDirty = true;
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
        if (s.status !== 'none' && !extruded.has(id)) {
          extruded.add(id);
          filterDirty = true;
          current[i] = Math.max(current[i], MIN_HEIGHT);
        }
        target[i] = s.status === 'none' ? 0 : Math.max(height(s, 'votes'), MIN_HEIGHT);
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
        if (filterDirty && now - lastFilter > 400) {
          filterDirty = false;
          lastFilter = now;
          m.setFilter('prisms', ['in', ['id'], ['literal', [...extruded]]]);
        }
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
    <div className={className}>
      <div ref={container} className="t-map-canvas" />
      <ul className="t-map-legend">
        <li>
          <i style={{ background: C.flavio }} />
          <i style={{ background: C.lula }} /> em apuração ·{' '}
          <i style={{ background: C.flavioDim }} />
          <i style={{ background: C.lulaDim }} /> encerrado · cor: quem lidera
        </li>
        <li>altura: vantagem do líder em votos</li>
      </ul>
    </div>
  );
}
