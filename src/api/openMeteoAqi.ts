import type { AqiReading } from '../model';

// Open-Meteo modeled US AQI. Keyless, per-coordinate, instant.
const cache = new Map<string, { at: number; reading: AqiReading }>();
const CACHE_TTL_MS = 30 * 60 * 1000;

export async function fetchAqi(lngLat: [number, number]): Promise<AqiReading> {
  const key = lngLat.map((n) => n.toFixed(3)).join(',');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.reading;

  const url =
    `https://air-quality-api.open-meteo.com/v1/air-quality` +
    `?latitude=${lngLat[1]}&longitude=${lngLat[0]}` +
    `&current=us_aqi,pm2_5,pm10,ozone&timezone=America/Los_Angeles`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const json = await res.json();
  const c = json.current;
  if (typeof c?.us_aqi !== 'number') throw new Error('Open-Meteo: no AQI in response');

  const reading: AqiReading = {
    usAqi: c.us_aqi,
    pm25: c.pm2_5 ?? null,
    pm10: c.pm10 ?? null,
    ozone: c.ozone ?? null,
    observedAt: c.time,
  };
  cache.set(key, { at: Date.now(), reading });
  return reading;
}
