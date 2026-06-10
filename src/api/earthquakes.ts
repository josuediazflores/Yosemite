import type { FmFeature } from '../model';
import { PARK_CENTER } from '../model';

// USGS FDSN event service — already GeoJSON, already [lng, lat].
const RADIUS_KM = 80;
const WINDOW_DAYS = 30;

export async function fetchQuakes(): Promise<FmFeature[]> {
  const start = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString();
  const url =
    `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson` +
    `&latitude=${PARK_CENTER[1]}&longitude=${PARK_CENTER[0]}` +
    `&maxradiuskm=${RADIUS_KM}&starttime=${start}&orderby=time`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`USGS quakes ${res.status}`);
  const json = await res.json();

  return (json.features ?? []).map((f: any): FmFeature => ({
    id: `quake-${f.id}`,
    source: 'usgs-quake',
    layer: 'hazards',
    lngLat: [f.geometry.coordinates[0], f.geometry.coordinates[1]],
    observedAt: new Date(f.properties.time).toISOString(),
    license: 'public domain',
    attribution: 'USGS Earthquake Hazards Program',
    props: {
      mag: f.properties.mag,
      place: f.properties.place,
      depthKm: f.geometry.coordinates[2],
      url: f.properties.url,
    },
  }));
}
