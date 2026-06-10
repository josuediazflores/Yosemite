import type { AirnowReading } from '../model';
import { proxyFetch } from './proxyFetch';

// AirNow observed AQI (authoritative, sensor-based) — preferred over the
// Open-Meteo model when a key is configured. Overall AQI = the max across
// reported pollutants, which is how AirNow defines it.
const cache = new Map<string, { at: number; reading: AirnowReading | 'unavailable' }>();
const CACHE_TTL_MS = 30 * 60 * 1000;

const TZ_OFFSET: Record<string, string> = {
  PST: '-08:00',
  PDT: '-07:00',
  MST: '-07:00',
  MDT: '-06:00',
};

export async function fetchAirnow(lngLat: [number, number]): Promise<AirnowReading | 'unavailable'> {
  const key = lngLat.map((n) => n.toFixed(3)).join(',');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.reading;

  const res = await proxyFetch(
    `/proxy/airnow/observation/latLong/current/?format=application/json` +
      `&latitude=${lngLat[1]}&longitude=${lngLat[0]}&distance=40`,
  );
  const rows: any[] = await res.json();

  let reading: AirnowReading | 'unavailable' = 'unavailable';
  if (rows.length) {
    const top = rows.reduce((a, b) => (b.AQI > a.AQI ? b : a));
    const offset = TZ_OFFSET[top.LocalTimeZone] ?? '-08:00';
    reading = {
      aqi: top.AQI,
      primaryPollutant: top.ParameterName,
      categoryName: top.Category?.Name ?? '',
      observedAt: `${String(top.DateObserved).trim()}T${String(top.HourObserved).padStart(2, '0')}:00:00${offset}`,
    };
  }
  cache.set(key, { at: Date.now(), reading });
  return reading;
}
