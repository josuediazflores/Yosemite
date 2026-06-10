import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { FmFeature, Site } from './model';
import { freshnessOf, PARK_CENTER } from './model';
import { relativeTime } from './format';
import { allFires, allSightings, selectSite, state, on } from './state';

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// USGS National Map topo — public domain raster, no usage-policy friction,
// and natively the quad-sheet look the design direction asks for.
const TOPO_TILES =
  'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}';

// 3D site view: the same keyless sources ode-to-yosemite bakes offline —
// Terrarium-encoded DEM (Mapzen/AWS Open Data) and Esri World Imagery —
// consumed live through MapLibre's native terrain instead of three.js.
const TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const SAT_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

let map: maplibregl.Map;
const siteMarkers = new Map<string, { marker: maplibregl.Marker; el: HTMLButtonElement }>();
let terrainOn = false;
let terrainChip: HTMLButtonElement | null = null;
let camWrap: HTMLDivElement | null = null;
let orbitOn = false;
let orbitRAF = 0;

// WASD camera: A/D rotate, W/S tilt — continuous while held, 3D only.
const KEY_ACTIONS: Record<string, 'rotL' | 'rotR' | 'tiltUp' | 'tiltDown'> = {
  a: 'rotL',
  d: 'rotR',
  w: 'tiltUp',
  s: 'tiltDown',
};
const keysDown = new Set<string>();
let keyRAF = 0;

function startKeyLoop(): void {
  if (keyRAF) return;
  let last = performance.now();
  let guardAcc = 0;
  const step = (now: number) => {
    if (!keysDown.size || !terrainOn) {
      keyRAF = 0;
      ensureCameraClear();
      return;
    }
    const dt = Math.min(now - last, 100);
    last = now;
    const rot = (keysDown.has('d') ? 1 : 0) - (keysDown.has('a') ? 1 : 0);
    const tilt = (keysDown.has('w') ? 1 : 0) - (keysDown.has('s') ? 1 : 0);
    if (rot) map.setBearing(map.getBearing() + rot * dt * 0.07); // ~70°/s
    if (tilt) map.setPitch(Math.min(70, Math.max(20, map.getPitch() + tilt * dt * 0.045)));
    guardAcc += dt;
    if (guardAcc > 1200) {
      guardAcc = 0;
      const t = (map as unknown as { transform: { getCameraLngLat(): maplibregl.LngLat; getCameraAltitude(): number } }).transform;
      const ground = map.queryTerrainElevation(t.getCameraLngLat());
      if (ground != null && t.getCameraAltitude() - ground < 60) {
        map.setPitch(Math.max(42, map.getPitch() - 8));
      }
    }
    keyRAF = requestAnimationFrame(step);
  };
  keyRAF = requestAnimationFrame(step);
}

function initWasd(): void {
  document.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (!(key in KEY_ACTIONS) || !terrainOn || e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
    e.preventDefault();
    if (!keysDown.has(key)) {
      stopOrbit();
      keysDown.add(key);
      startKeyLoop();
    }
  });
  document.addEventListener('keyup', (e) => keysDown.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keysDown.clear());
}

function stopOrbit(): void {
  if (!orbitOn && !orbitRAF) return;
  orbitOn = false;
  if (orbitRAF) cancelAnimationFrame(orbitRAF);
  orbitRAF = 0;
  camWrap?.querySelector('[data-cam="orbit"]')?.setAttribute('aria-pressed', 'false');
}

// Slow cinematic spin around the framed site (~4°/s). Any direct input,
// a new selection, or leaving 3D stops it; reduced-motion never starts it.
function startOrbit(): void {
  if (REDUCED_MOTION || !terrainOn) return;
  orbitOn = true;
  camWrap?.querySelector('[data-cam="orbit"]')?.setAttribute('aria-pressed', 'true');
  let last = performance.now();
  let guardAcc = 0;
  const step = (now: number) => {
    if (!orbitOn) return;
    const dt = Math.min(now - last, 100);
    last = now;
    map.setBearing(map.getBearing() + dt * 0.004);
    guardAcc += dt;
    if (guardAcc > 1500) {
      guardAcc = 0;
      // Orbiting at a fixed pitch can swing the eye toward a wall — dip
      // flatter when clearance shrinks instead of clipping in.
      const t = (map as unknown as { transform: { getCameraLngLat(): maplibregl.LngLat; getCameraAltitude(): number } }).transform;
      const ground = map.queryTerrainElevation(t.getCameraLngLat());
      if (ground != null && t.getCameraAltitude() - ground < 60) {
        map.setPitch(Math.max(42, map.getPitch() - 8));
      }
    }
    orbitRAF = requestAnimationFrame(step);
  };
  orbitRAF = requestAnimationFrame(step);
}

// Auto-swap drape: satellite over real relief in 3D, the quad sheet in 2D.
function applyTerrain(on: boolean): void {
  if (on === terrainOn) return;
  // setTerrain demands a loaded style; deep links select a site mid-boot,
  // so defer until the map settles and re-apply.
  if (!map.isStyleLoaded()) {
    map.once('idle', () => applyTerrain(on));
    return;
  }
  terrainOn = on;
  if (on) {
    map.setTerrain({ source: 'terrain-dem', exaggeration: 1.15 });
    if (map.getLayer('satellite')) map.setLayoutProperty('satellite', 'visibility', 'visible');
    map.setSky({
      'sky-color': '#b8c7d4',
      'horizon-color': '#eae6da',
      'fog-color': '#ddd8c8',
      'sky-horizon-blend': 0.6,
      'horizon-fog-blend': 0.55,
      'fog-ground-blend': 0.85,
    });
  } else {
    map.setTerrain(null);
    if (map.getLayer('satellite')) map.setLayoutProperty('satellite', 'visibility', 'none');
    map.setSky({} as never);
  }
  terrainChip?.setAttribute('aria-pressed', String(on));
  if (terrainChip) terrainChip.textContent = on ? '2D' : '3D';
  document.body.classList.toggle('terrain-on', on);
  if (!on) stopOrbit();
}

// The fly-in aims a camera, not a drone with collision sensors: at cliff-base
// sites (Camp 4 under the Yosemite Falls wall) the eye can end up inside
// granite. After each site flight, verify the camera sits above the DEM and
// back it off — flatter and farther — until it's clear.
function ensureCameraClear(attempt = 0): void {
  if (!terrainOn || attempt > 3) return;
  // Camera position lives on the transform (typed, semi-internal in v5).
  const transform = (map as unknown as { transform: { getCameraLngLat(): maplibregl.LngLat; getCameraAltitude(): number } }).transform;
  const camLngLat = transform.getCameraLngLat();
  const camAlt = transform.getCameraAltitude();
  const ground = map.queryTerrainElevation(camLngLat);
  if (ground == null) {
    // DEM tile under the camera not loaded yet — re-check when the map settles.
    if (attempt <= 3) map.once('idle', () => ensureCameraClear(attempt + 1));
    return;
  }
  if (camAlt > ground + 60) return; // clear with margin
  const opts = {
    pitch: Math.max(42, map.getPitch() - 14),
    zoom: map.getZoom() - 0.7,
    duration: 500,
  };
  map.once('moveend', () => ensureCameraClear(attempt + 1));
  if (REDUCED_MOTION) map.jumpTo(opts);
  else map.easeTo(opts);
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

function toCollection(features: FmFeature[]): GeoJSON.FeatureCollection {
  const now = Date.now();
  return {
    type: 'FeatureCollection',
    features: features.map((f) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: f.lngLat },
      properties: { ...f.props, id: f.id, observedAt: f.observedAt, freshness: freshnessOf(f.observedAt, now), license: f.license, attribution: f.attribution },
    })),
  };
}

export function initMap(container: HTMLElement): maplibregl.Map {
  map = new maplibregl.Map({
    container,
    center: PARK_CENTER,
    zoom: 9.6,
    minZoom: 7.5,
    maxZoom: 15.8,
    maxPitch: 70,
    attributionControl: false,
    style: {
      version: 8,
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: {
        topo: {
          type: 'raster',
          tiles: [TOPO_TILES],
          tileSize: 256,
          maxzoom: 16,
          attribution: 'Basemap: USGS The National Map (public domain)',
        },
        satellite: {
          type: 'raster',
          tiles: [SAT_TILES],
          tileSize: 256,
          maxzoom: 17,
          attribution: 'Imagery: Esri World Imagery',
        },
        'terrain-dem': {
          type: 'raster-dem',
          tiles: [TERRAIN_TILES],
          tileSize: 256,
          maxzoom: 14,
          encoding: 'terrarium',
          attribution: 'Terrain: Mapzen/AWS Open Data (NASA/USGS DEMs)',
        },
      },
      layers: [
        { id: 'topo', type: 'raster', source: 'topo' },
        {
          id: 'satellite',
          type: 'raster',
          source: 'satellite',
          layout: { visibility: 'none' },
          paint: { 'raster-fade-duration': 300 },
        },
      ],
    },
  });

  map.addControl(
    new maplibregl.AttributionControl({
      compact: true,
      customAttribution:
        'Sightings: iNaturalist · River: USGS NWIS · AQI: Open-Meteo · Alerts: NWS · Fire: NASA EONET · Quakes: USGS',
    }),
    'bottom-right',
  );
  map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'bottom-right');

  // Camera cluster — rotate / tilt / orbit, shown only in 3D (body.terrain-on).
  const camEl = document.createElement('div');
  map.addControl(
    {
      onAdd: () => {
        camEl.className = 'maplibregl-ctrl yfm-cam';
        camEl.innerHTML = `
          <button type="button" data-cam="rot-l" aria-label="Rotate left (A)" title="Rotate left · A">⟲</button>
          <button type="button" data-cam="rot-r" aria-label="Rotate right (D)" title="Rotate right · D">⟳</button>
          <button type="button" data-cam="flatter" aria-label="Tilt flatter (S)" title="Tilt flatter · S">↥</button>
          <button type="button" data-cam="steeper" aria-label="Tilt steeper (W)" title="Tilt steeper · W">↧</button>
          <button type="button" data-cam="orbit" aria-label="Orbit the site" aria-pressed="false" title="Slow spin around the site">ORBIT</button>`;
        camEl.addEventListener('click', (e) => {
          const btn = (e.target as HTMLElement).closest('button');
          if (!btn) return;
          const action = btn.dataset.cam;
          if (action === 'orbit') {
            orbitOn ? stopOrbit() : startOrbit();
            return;
          }
          stopOrbit();
          if (action === 'rot-l' || action === 'rot-r') {
            const opts = { bearing: map.getBearing() + (action === 'rot-l' ? -30 : 30), duration: 600 };
            REDUCED_MOTION ? map.jumpTo(opts) : map.easeTo(opts);
          } else {
            const pitch = Math.min(70, Math.max(20, map.getPitch() + (action === 'steeper' ? 10 : -10)));
            map.once('moveend', () => ensureCameraClear());
            const opts = { pitch, duration: 500 };
            REDUCED_MOTION ? map.jumpTo(opts) : map.easeTo(opts);
          }
        });
        return camEl;
      },
      onRemove: () => camEl.remove(),
    },
    'bottom-right',
  );
  camWrap = camEl;

  // Hands on the map dismiss the autopilot.
  for (const ev of ['mousedown', 'touchstart', 'wheel'] as const) {
    map.on(ev, () => stopOrbit());
  }
  initWasd();

  // 2D/3D toggle chip — manual terrain mode without needing a selection.
  const tdEl = document.createElement('button');
  map.addControl(
    {
      onAdd: () => {
        tdEl.className = 'maplibregl-ctrl yfm-3d';
        tdEl.type = 'button';
        tdEl.textContent = '3D';
        tdEl.setAttribute('aria-pressed', 'false');
        tdEl.setAttribute('aria-label', 'Toggle 3D terrain');
        tdEl.addEventListener('click', () => {
          if (terrainOn) {
            applyTerrain(false);
            const opts = { pitch: 0, bearing: 0, duration: 900 };
            REDUCED_MOTION ? map.jumpTo(opts) : map.easeTo(opts);
          } else {
            applyTerrain(true);
            const opts = { pitch: 58, duration: 900 };
            REDUCED_MOTION ? map.jumpTo(opts) : map.easeTo(opts);
          }
        });
        return tdEl;
      },
      onRemove: () => tdEl.remove(),
    },
    'bottom-right',
  );
  terrainChip = tdEl;

  // Survey fixture (design system map furniture): north arrow + live scale,
  // bottom-left, styled as one paper chip.
  const northEl = document.createElement('div');
  map.addControl(
    {
      onAdd: () => {
        northEl.className = 'maplibregl-ctrl yfm-north';
        northEl.setAttribute('aria-hidden', 'true');
        northEl.innerHTML =
          `<svg width="9" height="22" viewBox="0 0 9 22"><polygon points="4.5,0 9,11 4.5,8.5 0,11" fill="#20231C"></polygon>` +
          `<line x1="4.5" y1="9" x2="4.5" y2="22" stroke="#20231C" stroke-width="1"></line></svg><span>N</span>`;
        return northEl;
      },
      onRemove: () => northEl.remove(),
    },
    'bottom-left',
  );
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 90, unit: 'imperial' }), 'bottom-left');

  // Marker labels are survey annotations for the valley scale — they
  // declutter automatically when zoomed out to the whole park.
  const syncLabels = () => {
    map.getContainer().classList.toggle('labels-on', map.getZoom() >= 10.8);
  };
  map.on('zoom', syncLabels);
  syncLabels();

  map.on('load', () => {
    addStaticLayers();
    addDataLayers();
    wireInteractions();
    syncLayerVisibility();
    syncSightings();
    syncQuakes();
    syncFires();
  });

  on('layers', syncLayerVisibility);
  on('sightings', syncSightings);
  on('quakes', syncQuakes);
  on('fires', syncFires);
  on('selection', syncSelection);

  // Dev-console handle for verification and poking at paint/camera state.
  (window as unknown as Record<string, unknown>).yfmMap = map;

  return map;
}

async function addStaticLayers(): Promise<void> {
  map.addSource('boundary', { type: 'geojson', data: '/data/boundary.geojson' });
  map.addLayer({
    id: 'boundary-line',
    type: 'line',
    source: 'boundary',
    paint: {
      'line-color': '#2E4636',
      'line-width': 2,
      'line-dasharray': [3, 2],
      'line-opacity': 0.85,
    },
  });

  map.addSource('trails', { type: 'geojson', data: '/data/trails.geojson' });
  map.addLayer(
    {
      id: 'trail-lines',
      type: 'line',
      source: 'trails',
      paint: {
        'line-color': '#2E4636',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 14, 1.8],
        'line-dasharray': [2, 2],
        'line-opacity': 0.45,
      },
    },
    'boundary-line',
  );
}

function addDataLayers(): void {
  // Sightings heatmap: same data, unclustered, drawn under everything else.
  // Archive records weigh less so the heat reflects recency, not just volume.
  map.addSource('sightings-heat', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  map.addLayer({
    id: 'sighting-heat',
    type: 'heatmap',
    source: 'sightings-heat',
    maxzoom: 15,
    layout: { visibility: 'none' },
    paint: {
      'heatmap-weight': ['match', ['get', 'freshness'], 'historical', 0.4, 1],
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 8, 0.7, 14, 2.2],
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 8, 14, 14, 34],
      'heatmap-opacity': 0.75,
      'heatmap-color': [
        'interpolate', ['linear'], ['heatmap-density'],
        0, 'rgba(147, 168, 98, 0)',
        0.25, 'rgba(147, 168, 98, 0.45)',
        0.5, 'rgba(147, 168, 98, 0.8)',
        0.75, 'rgba(46, 70, 54, 0.85)',
        1, 'rgba(180, 85, 44, 0.9)',
      ],
    },
  });

  // Sightings: clustered. Freshness drives the paint — recent is solid sage,
  // archive records render hollow and faded so age is legible at a glance.
  map.addSource('sightings', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
    cluster: true,
    clusterMaxZoom: 12,
    clusterRadius: 44,
  });
  map.addLayer({
    id: 'sighting-clusters',
    type: 'circle',
    source: 'sightings',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#93A862',
      'circle-opacity': 0.9,
      'circle-radius': ['step', ['get', 'point_count'], 13, 10, 17, 40, 22],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#20231C',
    },
  });
  map.addLayer({
    id: 'sighting-cluster-count',
    type: 'symbol',
    source: 'sightings',
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 11,
      'text-allow-overlap': true,
    },
    paint: { 'text-color': '#20231C' },
  });
  map.addLayer({
    id: 'sighting-points',
    type: 'circle',
    source: 'sightings',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': [
        'match', ['get', 'freshness'],
        'historical', 'rgba(147, 168, 98, 0.15)',
        '#93A862',
      ],
      'circle-stroke-color': [
        'match', ['get', 'freshness'],
        'historical', 'rgba(46, 70, 54, 0.5)',
        '#20231C',
      ],
      'circle-stroke-width': 1.5,
      'circle-radius': ['match', ['get', 'freshness'], 'historical', 4, 5.5],
    },
  });

  // Quakes: hollow rust rings sized by magnitude.
  map.addSource('quakes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'quake-rings',
    type: 'circle',
    source: 'quakes',
    paint: {
      'circle-color': 'rgba(180, 85, 44, 0.12)',
      'circle-stroke-color': '#B4552C',
      'circle-stroke-width': 1.5,
      'circle-radius': ['interpolate', ['linear'], ['coalesce', ['get', 'mag'], 1], 0, 4, 3, 9, 5, 16],
    },
  });

  // NIFC perimeters: the actual fire footprint when one exists.
  map.addSource('nifc-perims', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'nifc-perim-fill',
    type: 'fill',
    source: 'nifc-perims',
    paint: { 'fill-color': 'rgba(180, 85, 44, 0.14)' },
  });
  map.addLayer({
    id: 'nifc-perim-line',
    type: 'line',
    source: 'nifc-perims',
    paint: { 'line-color': '#B4552C', 'line-width': 1.6, 'line-dasharray': [3, 2] },
  });

  // Fire points: NIFC/EONET incidents are full rust markers; FIRMS thermal
  // detections are smaller pixels so a satellite pass reads as a scatter.
  map.addSource('fires', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'fire-points',
    type: 'circle',
    source: 'fires',
    paint: {
      'circle-color': '#B4552C',
      'circle-opacity': ['match', ['get', 'kind'], 'detection', 0.8, 1],
      'circle-stroke-color': '#EAE6DA',
      'circle-stroke-width': ['match', ['get', 'kind'], 'detection', 1, 2],
      'circle-radius': ['match', ['get', 'kind'], 'detection', 4, 7],
    },
  });
}

function wireInteractions(): void {
  map.on('click', 'sighting-clusters', async (e) => {
    const feature = e.features?.[0];
    if (!feature) return;
    const clusterId = feature.properties?.cluster_id;
    const source = map.getSource('sightings') as maplibregl.GeoJSONSource;
    const zoom = await source.getClusterExpansionZoom(clusterId);
    const center = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
    if (REDUCED_MOTION) map.jumpTo({ center, zoom });
    else map.easeTo({ center, zoom });
  });

  map.on('click', 'sighting-points', (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const p = f.properties!;
    const coords = ((f.geometry as GeoJSON.Point).coordinates as [number, number]).slice() as [number, number];
    const photo = p.photo
      ? `<img src="${esc(p.photo)}" alt="Photo of ${esc(p.commonName)}" loading="lazy" />`
      : '';
    new maplibregl.Popup({ offset: 10, className: 'yfm-popup', maxWidth: '260px' })
      .setLngLat(coords)
      .setHTML(
        `<article>
          ${photo}
          <h3>${esc(p.commonName)}</h3>
          <p class="yfm-popup__meta"><span class="chip chip--${esc(p.freshness)}">${esc(String(p.freshness).toUpperCase() === 'HISTORICAL' ? 'ARCHIVE' : String(p.freshness).toUpperCase())}</span> ${esc(p.group)} · ${esc(relativeTime(p.observedAt as string))}</p>
          <p class="yfm-popup__credit">${esc(p.attribution)} · ${esc(p.license)}</p>
        </article>`,
      )
      .addTo(map);
  });

  map.on('click', 'quake-rings', (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const p = f.properties!;
    const coords = ((f.geometry as GeoJSON.Point).coordinates as [number, number]).slice() as [number, number];
    new maplibregl.Popup({ offset: 10, className: 'yfm-popup', maxWidth: '260px' })
      .setLngLat(coords)
      .setHTML(
        `<article>
          <h3>M ${esc(Number(p.mag).toFixed(1))} earthquake</h3>
          <p class="yfm-popup__meta">${esc(p.place)} · ${esc(relativeTime(p.observedAt as string))}</p>
          <p class="yfm-popup__credit">USGS Earthquake Hazards Program</p>
        </article>`,
      )
      .addTo(map);
  });

  map.on('click', 'fire-points', (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const p = f.properties!;
    const coords = ((f.geometry as GeoJSON.Point).coordinates as [number, number]).slice() as [number, number];
    let title: string;
    let meta: string;
    if (p.kind === 'detection') {
      title = 'Thermal detection · VIIRS';
      const frp = p.frp != null ? `FRP ${Number(p.frp).toFixed(1)} MW · ` : '';
      meta = `${frp}confidence ${esc(p.confidence ?? '?')} · ${esc(relativeTime(p.observedAt as string))}`;
    } else if (p.kind === 'incident') {
      title = String(p.title);
      const acres = p.sizeAcres != null ? ` · ${Math.round(Number(p.sizeAcres))} ac` : '';
      const contained = p.contained != null ? ` · ${p.contained}% contained` : '';
      meta = `${esc(p.typeLabel)}${acres}${contained} · discovered ${esc(relativeTime(p.observedAt as string))}`;
    } else {
      title = String(p.title);
      meta = `Open wildfire event · reported ${esc(relativeTime(p.observedAt as string))}`;
    }
    new maplibregl.Popup({ offset: 10, className: 'yfm-popup', maxWidth: '260px' })
      .setLngLat(coords)
      .setHTML(
        `<article>
          <h3>${esc(title)}</h3>
          <p class="yfm-popup__meta">${meta}</p>
          <p class="yfm-popup__credit">${esc(p.attribution)}</p>
        </article>`,
      )
      .addTo(map);
  });

  for (const layer of ['sighting-clusters', 'sighting-points', 'quake-rings', 'fire-points']) {
    map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
  }

  // A bare map click (no feature, no marker) clears the selection.
  map.on('click', (e) => {
    const hits = map.queryRenderedFeatures(e.point, {
      layers: ['sighting-clusters', 'sighting-points', 'quake-rings', 'fire-points'],
    });
    if (hits.length === 0) selectSite(null);
  });
}

export function renderSiteMarkers(sites: Site[]): void {
  for (const site of sites) {
    const el = document.createElement('button');
    el.className = `site-marker site-marker--${site.kind} site-marker--label-${site.labelPos ?? 'bottom'}`;
    el.type = 'button';
    el.setAttribute('aria-label', `${site.name} — open site details`);
    const label = site.shortName
      ? `<span class="site-marker__label" aria-hidden="true">${esc(site.shortName)}</span>`
      : '';
    el.innerHTML = `<span class="site-marker__shape" aria-hidden="true"></span>${label}`;
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      selectSite(site.id);
    });
    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat(site.lngLat)
      .addTo(map);
    siteMarkers.set(site.id, { marker, el });
  }
}

function syncSelection(): void {
  for (const [id, { el }] of siteMarkers) {
    el.classList.toggle('site-marker--selected', id === state.selectedSiteId);
  }
  const site = state.sites.find((s) => s.id === state.selectedSiteId);
  const desktop = window.matchMedia('(min-width: 720px)').matches;

  if (site) {
    // Site view: tilt into real terrain and frame the landmark, panel right.
    // Sites without a tuned framing (campgrounds) get a conservative camera —
    // many sit at the base of big walls.
    stopOrbit();
    applyTerrain(true);
    const opts = {
      center: site.lngLat,
      zoom: site.view?.zoom ?? 13.3,
      pitch: site.view?.pitch ?? 55,
      bearing: site.view?.bearing ?? 18,
      padding: desktop ? { right: 380, top: 40, bottom: 40, left: 40 } : { bottom: 300, top: 60, left: 20, right: 20 },
    };
    map.once('moveend', () => ensureCameraClear());
    if (REDUCED_MOTION) map.jumpTo(opts);
    else map.easeTo({ ...opts, duration: 1900 });
  } else {
    // Browse view: back down to the flat quad sheet.
    applyTerrain(false);
    const opts = {
      pitch: 0,
      bearing: 0,
      zoom: Math.min(map.getZoom(), 11.6),
      padding: { top: 0, bottom: 0, left: 0, right: 0 },
    };
    if (REDUCED_MOTION) map.jumpTo(opts);
    else map.easeTo({ ...opts, duration: 1100 });
  }
}

function setSourceData(sourceId: string, features: FmFeature[]): void {
  const src = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
  if (src) src.setData(toCollection(features) as never);
}

function syncSightings(): void {
  if (!map.getSource('sightings')) return;
  const features = allSightings();
  setSourceData('sightings', features);
  setSourceData('sightings-heat', features);
}
function syncQuakes(): void {
  if (map.getSource('quakes')) setSourceData('quakes', state.quakes);
}
function syncFires(): void {
  if (!map.getSource('fires')) return;
  setSourceData('fires', allFires());
  const perims = map.getSource('nifc-perims') as maplibregl.GeoJSONSource | undefined;
  if (perims) perims.setData(state.nifcPerimeters as never);
}

function syncLayerVisibility(): void {
  const vis = (on: boolean) => (on ? 'visible' : 'none');
  const layerMap: Record<string, boolean> = {
    'sighting-clusters': state.layers.sightings,
    'sighting-cluster-count': state.layers.sightings,
    'sighting-points': state.layers.sightings,
    'sighting-heat': state.layers.heat,
    'quake-rings': state.layers.hazards,
    'fire-points': state.layers.fire,
    'nifc-perim-fill': state.layers.fire,
    'nifc-perim-line': state.layers.fire,
  };
  for (const [layerId, visible] of Object.entries(layerMap)) {
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', vis(visible));
  }
  for (const { el } of siteMarkers.values()) {
    const isCamp = el.classList.contains('site-marker--campground');
    el.style.display = (isCamp ? state.layers.camps : state.layers.sites) ? '' : 'none';
  }
}
