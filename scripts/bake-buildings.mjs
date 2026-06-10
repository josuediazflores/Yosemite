// One-time bake: valley-core building volumes for the 3D site view.
//
//   Footprints  — OpenStreetMap via Overpass (ODbL)
//   Heights     — OSM height tag → building:levels × 3.4 m → type default,
//                 with the source recorded per building (honesty rule)
//   Roof tint   — sampled from Esri World Imagery at each footprint centroid
//
// Output: public/data/buildings.geojson (frozen; never fetched live)
// Run: node scripts/bake-buildings.mjs

import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';

// Valley core: Yosemite Village, the Ahwahnee, Yosemite Valley Lodge,
// the chapel, Camp 4 environs. Curry Village deliberately out of scope.
const BBOX = { south: 37.736, west: -119.612, north: 37.753, east: -119.566 };

const QUERY = `
[out:json][timeout:60];
way["building"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
out geom;`;

const LEVEL_M = 3.4;
const TYPE_DEFAULTS = {
  church: 11,
  chapel: 11,
  hotel: 12,
  school: 7,
  retail: 6,
  commercial: 6,
  public: 7,
  cabin: 3.5,
  hut: 3,
  shed: 3,
  garage: 3.5,
  tent: 2.5,
  static_caravan: 3,
  house: 5,
  apartments: 8,
  yes: 4.5,
};

function heightOf(tags) {
  const h = parseFloat(tags.height);
  if (Number.isFinite(h) && h > 0) return { height: h, src: 'osm-height' };
  const levels = parseFloat(tags['building:levels']);
  if (Number.isFinite(levels) && levels > 0) return { height: levels * LEVEL_M, src: 'osm-levels' };
  return { height: TYPE_DEFAULTS[tags.building] ?? TYPE_DEFAULTS.yes, src: 'type-default' };
}

// --- Esri tile pixel sampling for roof tint -------------------------------
const Z = 17;
const tileCache = new Map();

const lon2tile = (lon) => ((lon + 180) / 360) * 2 ** Z;
const lat2tile = (lat) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * 2 ** Z;
};

async function roofTint(lng, lat) {
  const tx = lon2tile(lng);
  const ty = lat2tile(lat);
  const key = `${Math.floor(tx)}/${Math.floor(ty)}`;
  if (!tileCache.has(key)) {
    const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${Z}/${Math.floor(ty)}/${Math.floor(tx)}`;
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    tileCache.set(key, await sharp(buf).raw().toBuffer({ resolveWithObject: true }));
  }
  const { data, info } = tileCache.get(key);
  const px = Math.min(info.width - 1, Math.floor((tx % 1) * info.width));
  const py = Math.min(info.height - 1, Math.floor((ty % 1) * info.height));
  // 3×3 average around the centroid pixel.
  let r = 0, g = 0, b = 0, n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = Math.min(info.width - 1, Math.max(0, px + dx));
      const y = Math.min(info.height - 1, Math.max(0, py + dy));
      const i = (y * info.width + x) * info.channels;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
  }
  const hex = (v) => Math.round(v / n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

// --- main ------------------------------------------------------------------
const res = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': 'ouzel-yosemite-field-monitor (one-time bake)',
  },
  body: `data=${encodeURIComponent(QUERY)}`,
});
if (!res.ok) throw new Error(`Overpass ${res.status}`);
const osm = await res.json();
const ways = osm.elements.filter((e) => e.type === 'way' && e.geometry?.length >= 4);
console.log(`footprints: ${ways.length}`);

const features = [];
const srcCount = {};
for (const w of ways) {
  const tags = w.tags ?? {};
  const ring = w.geometry.map((p) => [p.lon, p.lat]);
  const { height, src } = heightOf(tags);
  srcCount[src] = (srcCount[src] ?? 0) + 1;
  const cLng = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cLat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  let tint = '#8d8876';
  try {
    tint = await roofTint(cLng, cLat);
  } catch {
    tint = '#8d8876';
  }
  features.push({
    type: 'Feature',
    properties: {
      name: tags.name ?? null,
      kind: tags.building,
      height: Math.round(height * 10) / 10,
      tint,
      heightSrc: src,
    },
    geometry: { type: 'Polygon', coordinates: [ring] },
  });
}

console.log('height sources:', srcCount);
console.log('named:', features.filter((f) => f.properties.name).length);
await writeFile(
  new URL('../public/data/buildings.geojson', import.meta.url),
  JSON.stringify({ type: 'FeatureCollection', features }),
);
console.log('wrote public/data/buildings.geojson');
