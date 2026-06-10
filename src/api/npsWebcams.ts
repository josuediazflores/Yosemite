import type { FieldCam } from '../model';
import { proxyFetch } from './proxyFetch';

// Park field cameras via the NPS API. We render honest *plates* — official
// representative frames + true positions — and link out to the source player.
// Live frames aren't redistributable (NPS's embed is JS-walled and the
// Conservancy runs its own players), so the plates never fake liveness.

// The four marquee cams are operated with Yosemite Conservancy — their
// working players live on yosemite.org, not the NPS page.
const CONSERVANCY_PAGES: Record<string, string> = {
  'yosemite falls': 'https://yosemite.org/webcams/yosemite-falls/',
  'half dome': 'https://yosemite.org/webcams/half-dome/',
  'el capitan': 'https://yosemite.org/webcams/el-capitan/',
  'yosemite high sierra': 'https://yosemite.org/webcams/high-sierra/',
};

const ORDER = [
  'yosemite falls',
  'half dome',
  'el capitan',
  'yosemite high sierra',
  'merced river at happy isles',
  'turtleback dome & air quality',
  'badger pass ski area',
];

function repairUrl(u: string | undefined): string | null {
  if (!u) return null;
  // The NPS API double-prefixes its own domain on these.
  return u.startsWith('https://www.nps.govhttps://') ? u.replace('https://www.nps.govhttps://', 'https://') : u;
}

export async function fetchFieldCams(): Promise<FieldCam[]> {
  const res = await proxyFetch('/proxy/nps/webcams?parkCode=yose&limit=50');
  const json = await res.json();

  const byTitle = new Map<string, FieldCam>();
  for (const c of json.data ?? []) {
    if (c.status !== 'Active') continue;
    const key = String(c.title ?? '').trim().toLowerCase();
    if (!key) continue;
    // NPS sends null coords on some entries — Number(null) is 0, so guard first.
    const lat = c.latitude == null ? NaN : Number(c.latitude);
    const lng = c.longitude == null ? NaN : Number(c.longitude);
    const cam: FieldCam = {
      id: c.id,
      title: c.title,
      lngLat: Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0) ? [lng, lat] : null,
      img: repairUrl(c.images?.[0]?.url),
      streaming: Boolean(c.isStreaming),
      watchUrl: CONSERVANCY_PAGES[key] ?? c.url,
    };
    // Duplicates exist (streaming + still variants of the same camera):
    // merge fields so each plate gets the best of all its entries.
    const prev = byTitle.get(key);
    byTitle.set(
      key,
      prev
        ? {
            ...prev,
            lngLat: prev.lngLat ?? cam.lngLat,
            img: prev.img ?? cam.img,
            streaming: prev.streaming || cam.streaming,
          }
        : cam,
    );
  }

  return [...byTitle.values()].sort((a, b) => {
    const ia = ORDER.indexOf(a.title.toLowerCase());
    const ib = ORDER.indexOf(b.title.toLowerCase());
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}
