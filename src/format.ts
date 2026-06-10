// Formatting + small geo math. All display strings live here so the voice
// stays consistent: plain verbs, sentence case, mono digits.

const EARTH_R_KM = 6371;

export function haversineKm(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const la1 = toRad(a[1]);
  const la2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R_KM * Math.asin(Math.sqrt(h));
}

export function formatMiles(km: number): string {
  const mi = km * 0.621371;
  if (mi < 0.1) return `${Math.round(mi * 5280)} ft`;
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi)} mi`;
}

export function formatCoords(lngLat: [number, number]): string {
  const [lng, lat] = lngLat;
  return `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lng).toFixed(4)}°${lng >= 0 ? 'E' : 'W'}`;
}

export function relativeTime(iso: string | null, now = Date.now()): string {
  if (!iso) return 'undated';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'undated';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 90) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 45) return `${d} d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function absoluteTime(iso: string | null): string {
  if (!iso) return 'undated';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Los_Angeles',
  });
}

export interface AqiBand {
  label: string;
  color: string;
  text: string;
}

// Standard US AQI bands (EPA colors, required by the design direction).
export function aqiBand(aqi: number): AqiBand {
  if (aqi <= 50) return { label: 'Good', color: '#00E400', text: '#20231C' };
  if (aqi <= 100) return { label: 'Moderate', color: '#FFFF00', text: '#20231C' };
  if (aqi <= 150) return { label: 'Unhealthy for sensitive groups', color: '#FF7E00', text: '#20231C' };
  if (aqi <= 200) return { label: 'Unhealthy', color: '#FF0000', text: '#FFFFFF' };
  if (aqi <= 300) return { label: 'Very unhealthy', color: '#8F3F97', text: '#FFFFFF' };
  return { label: 'Hazardous', color: '#7E0023', text: '#FFFFFF' };
}

export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}
