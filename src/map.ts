import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { FmFeature, Site } from './model';
import { freshnessOf, PARK_CENTER } from './model';
import { relativeTime } from './format';
import { selectSite, state, on } from './state';

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// USGS National Map topo — public domain raster, no usage-policy friction,
// and natively the quad-sheet look the design direction asks for.
const TOPO_TILES =
  'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}';

let map: maplibregl.Map;
const siteMarkers = new Map<string, { marker: maplibregl.Marker; el: HTMLButtonElement }>();

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
      },
      layers: [{ id: 'topo', type: 'raster', source: 'topo' }],
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
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

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

  // Fires: solid rust markers with a stone casing.
  map.addSource('fires', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'fire-points',
    type: 'circle',
    source: 'fires',
    paint: {
      'circle-color': '#B4552C',
      'circle-stroke-color': '#EAE6DA',
      'circle-stroke-width': 2,
      'circle-radius': 7,
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
    new maplibregl.Popup({ offset: 10, className: 'yfm-popup', maxWidth: '260px' })
      .setLngLat(coords)
      .setHTML(
        `<article>
          <h3>${esc(p.title)}</h3>
          <p class="yfm-popup__meta">Open wildfire event · reported ${esc(relativeTime(p.observedAt as string))}</p>
          <p class="yfm-popup__credit">NASA EONET</p>
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
    el.className = `site-marker site-marker--${site.kind}`;
    el.type = 'button';
    el.setAttribute('aria-label', `${site.name} — open site details`);
    el.innerHTML = `<span class="site-marker__shape" aria-hidden="true"></span>`;
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
  if (site) {
    const desktop = window.matchMedia('(min-width: 720px)').matches;
    const opts = {
      center: site.lngLat,
      padding: desktop ? { right: 380, top: 40, bottom: 40, left: 40 } : { bottom: 300, top: 40, left: 20, right: 20 },
      zoom: Math.max(map.getZoom(), 11.5),
    };
    if (REDUCED_MOTION) map.jumpTo(opts);
    else map.easeTo({ ...opts, duration: 700 });
  }
}

function setSourceData(sourceId: string, features: FmFeature[]): void {
  const src = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
  if (src) src.setData(toCollection(features) as never);
}

function syncSightings(): void {
  if (map.isStyleLoaded() || map.getSource('sightings')) setSourceData('sightings', state.sightings);
}
function syncQuakes(): void {
  if (map.getSource('quakes')) setSourceData('quakes', state.quakes);
}
function syncFires(): void {
  if (map.getSource('fires')) setSourceData('fires', state.fires);
}

function syncLayerVisibility(): void {
  const vis = (on: boolean) => (on ? 'visible' : 'none');
  const layerMap: Record<string, boolean> = {
    'sighting-clusters': state.layers.sightings,
    'sighting-cluster-count': state.layers.sightings,
    'sighting-points': state.layers.sightings,
    'quake-rings': state.layers.hazards,
    'fire-points': state.layers.fire,
  };
  for (const [layerId, visible] of Object.entries(layerMap)) {
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', vis(visible));
  }
  for (const { el } of siteMarkers.values()) {
    el.style.display = state.layers.sites ? '' : 'none';
  }
}
