import type { FmFeature } from '../model';
import { PARK_CENTER } from '../model';
import { proxyFetch } from './proxyFetch';

// eBird recent observations, park-wide (50 km is the API's max radius).
// Cached like iNaturalist so reloads don't re-hit Cornell.
const CACHE_KEY = 'yfm-ebird-v1';
const CACHE_TTL_MS = 30 * 60 * 1000;

export async function fetchEbirdSightings(): Promise<FmFeature[]> {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const { at, features } = JSON.parse(cached);
      if (Date.now() - at < CACHE_TTL_MS && Array.isArray(features)) return features;
    }
  } catch {
    /* corrupt cache: refetch */
  }

  const res = await proxyFetch(
    `/proxy/ebird/data/obs/geo/recent?lat=${PARK_CENTER[1]}&lng=${PARK_CENTER[0]}` +
      `&dist=50&back=14&maxResults=200`,
  );
  const rows: any[] = await res.json();

  const features = rows
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng))
    .map((r, n): FmFeature => ({
      id: `ebird-${r.subId ?? n}-${r.speciesCode ?? n}`,
      source: 'ebird',
      layer: 'sightings',
      lngLat: [r.lng, r.lat], // eBird fields are named, no order ambiguity
      // obsDt is local park time without zone; Date() will read it in the
      // browser zone — correct for Pacific users, ~hours off elsewhere.
      observedAt: r.obsDt ? new Date(r.obsDt.replace(' ', 'T')).toISOString() : null,
      license: 'eBird terms of use',
      attribution: 'eBird · Cornell Lab of Ornithology',
      props: {
        commonName: r.comName ?? 'Unknown bird',
        sciName: r.sciName ?? null,
        group: 'Aves',
        photo: null,
        locName: r.locName ?? null,
        howMany: r.howMany ?? null,
      },
    }));

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), features }));
  } catch {
    /* cache is best-effort */
  }
  return features;
}
