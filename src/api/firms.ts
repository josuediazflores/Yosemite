import type { FmFeature } from '../model';
import { proxyFetch } from './proxyFetch';

// NASA FIRMS VIIRS thermal detections (NOAA-20, last 2 days, park bbox).
// The proxy holds the MAP_KEY and the fixed query; we just parse CSV.
export async function fetchFirmsDetections(): Promise<FmFeature[]> {
  const res = await proxyFetch('/proxy/firms');
  const text = await res.text();
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  const cols = lines[0].split(',');
  const idx = (name: string) => cols.indexOf(name);
  const iLat = idx('latitude');
  const iLng = idx('longitude');
  const iDate = idx('acq_date');
  const iTime = idx('acq_time');
  const iFrp = idx('frp');
  const iConf = idx('confidence');
  const iDay = idx('daynight');
  if (iLat < 0 || iLng < 0) return [];

  return lines.slice(1).map((line, n): FmFeature => {
    const f = line.split(',');
    const t = Number(f[iTime] ?? 0); // HHMM as integer, UTC
    const hh = String(Math.floor(t / 100)).padStart(2, '0');
    const mm = String(t % 100).padStart(2, '0');
    return {
      id: `firms-${n}-${f[iDate]}${f[iTime]}`,
      source: 'firms',
      layer: 'fire',
      // FIRMS CSV is lat,lng — flip here.
      lngLat: [Number(f[iLng]), Number(f[iLat])],
      observedAt: `${f[iDate]}T${hh}:${mm}:00Z`,
      license: 'public domain',
      attribution: 'NASA FIRMS (VIIRS NOAA-20)',
      props: {
        kind: 'detection',
        title: 'Thermal detection',
        frp: iFrp >= 0 ? Number(f[iFrp]) : null,
        confidence: iConf >= 0 ? f[iConf] : null, // l / n / h
        daynight: iDay >= 0 ? f[iDay] : null,
      },
    };
  }).filter((f) => Number.isFinite(f.lngLat[0]) && Number.isFinite(f.lngLat[1]));
}
