import type { FmFeature } from '../model';
import { PARK_BBOX } from '../model';

// NASA EONET curated wildfire events — keyless GeoJSON. Stands in for FIRMS
// until Phase 2 adds the keyed sources. Bbox is padded ~0.5° beyond the park
// so fires just outside (whose smoke matters) still show.
const PAD = 0.5;

export async function fetchFires(): Promise<FmFeature[]> {
  const url =
    `https://eonet.gsfc.nasa.gov/api/v3/events/geojson?category=wildfires&status=open&days=120` +
    `&bbox=${PARK_BBOX.west - PAD},${PARK_BBOX.north + PAD},${PARK_BBOX.east + PAD},${PARK_BBOX.south - PAD}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`EONET ${res.status}`);
  const json = await res.json();

  return (json.features ?? [])
    .filter((f: any) => f.geometry?.type === 'Point')
    .map((f: any): FmFeature => ({
      id: `eonet-${f.properties.id}`,
      source: 'eonet',
      layer: 'fire',
      lngLat: [f.geometry.coordinates[0], f.geometry.coordinates[1]],
      observedAt: f.properties.date ?? null,
      license: 'public domain',
      attribution: 'NASA EONET',
      props: {
        title: f.properties.title,
        url: f.properties.link,
      },
    }));
}
