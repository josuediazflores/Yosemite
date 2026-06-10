import type { FmFeature } from '../model';
import { PARK_CENTER } from '../model';

// One park-wide fetch, cached in localStorage so reloads inside the TTL
// don't touch the API at all (iNaturalist asks for <60 req/min, <10k/day).
const CACHE_KEY = 'yfm-inat-v1';
const CACHE_TTL_MS = 30 * 60 * 1000;

const URL =
  `https://api.inaturalist.org/v1/observations` +
  `?lat=${PARK_CENTER[1]}&lng=${PARK_CENTER[0]}&radius=45` +
  `&quality_grade=research&photos=true&order_by=observed_on&order=desc&per_page=200`;

interface InatObservation {
  id: number;
  observed_on: string | null;
  time_observed_at: string | null;
  geojson: { coordinates: [number, number] } | null;
  taxon: {
    preferred_common_name?: string;
    name?: string;
    iconic_taxon_name?: string;
  } | null;
  photos: { url: string }[];
  license_code: string | null;
  user: { login: string } | null;
}

function toFeature(o: InatObservation): FmFeature | null {
  if (!o.geojson?.coordinates || !o.taxon) return null;
  const photo = o.photos[0]?.url?.replace('square', 'small') ?? null;
  return {
    id: `inat-${o.id}`,
    source: 'inat',
    layer: 'sightings',
    // iNaturalist's geojson field is already [lng, lat].
    lngLat: [o.geojson.coordinates[0], o.geojson.coordinates[1]],
    observedAt: o.time_observed_at ?? o.observed_on,
    license: o.license_code ?? 'all rights reserved',
    attribution: `${o.user?.login ?? 'iNaturalist user'} · iNaturalist`,
    props: {
      commonName: o.taxon.preferred_common_name ?? o.taxon.name ?? 'Unknown species',
      sciName: o.taxon.name ?? null,
      group: o.taxon.iconic_taxon_name ?? 'Unknown',
      photo,
      observer: o.user?.login ?? null,
      url: `https://www.inaturalist.org/observations/${o.id}`,
    },
  };
}

export async function fetchSightings(): Promise<FmFeature[]> {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const { at, features } = JSON.parse(cached);
      if (Date.now() - at < CACHE_TTL_MS && Array.isArray(features)) return features;
    }
  } catch {
    /* corrupt cache: fall through to a network fetch */
  }

  const res = await fetch(URL);
  if (!res.ok) throw new Error(`iNaturalist ${res.status}`);
  const json = await res.json();
  const features = (json.results as InatObservation[])
    .map(toFeature)
    .filter((f): f is FmFeature => f !== null);

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), features }));
  } catch {
    /* storage full or blocked: cache is an optimization, not a requirement */
  }
  return features;
}
