import type { NwsAlert } from '../model';

// api.weather.gov point query. The documented User-Agent requirement is
// satisfied automatically in a browser (fetch always sends the browser UA).
const cache = new Map<string, { at: number; alerts: NwsAlert[] }>();
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function fetchAlerts(lngLat: [number, number]): Promise<NwsAlert[]> {
  const key = lngLat.map((n) => n.toFixed(3)).join(',');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.alerts;

  // NWS wants the point lat-first in the URL — one of the flip points.
  const url = `https://api.weather.gov/alerts/active?point=${lngLat[1]},${lngLat[0]}`;
  const res = await fetch(url, { headers: { Accept: 'application/geo+json' } });
  if (!res.ok) throw new Error(`NWS ${res.status}`);
  const json = await res.json();

  const alerts: NwsAlert[] = (json.features ?? []).map((f: any) => ({
    id: f.properties.id,
    event: f.properties.event,
    severity: f.properties.severity ?? 'Unknown',
    headline: f.properties.headline ?? f.properties.event,
    ends: f.properties.ends ?? f.properties.expires ?? null,
  }));
  cache.set(key, { at: Date.now(), alerts });
  return alerts;
}
