import type { CampgroundInfo, Site } from '../model';
import { proxyFetch } from './proxyFetch';

// NPS campgrounds for Yosemite. Semi-static: fetched once per session.
// Each campground becomes a full Site, so the whole cross-layer panel
// (AQI, gage, sightings, alerts) works at a campground too.
export interface CampgroundRecord {
  site: Site;
  info: CampgroundInfo;
}

function first(v: unknown): string {
  return Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '');
}

// NPS amenity values read like "Flush Toilets - year round", "Yes - seasonal",
// "No water", "None". Anything not starting with a negative counts as present.
function present(v: unknown): boolean {
  const s = first(v).trim();
  return s.length > 0 && !/^(no\b|none)/i.test(s);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, s.lastIndexOf(' ', max))}…`;
}

export async function fetchCampgrounds(): Promise<CampgroundRecord[]> {
  const res = await proxyFetch('/proxy/nps/campgrounds?parkCode=yose&limit=50');
  const json = await res.json();

  return (json.data ?? [])
    .filter((c: any) => Number(c.latitude) && Number(c.longitude))
    .map((c: any): CampgroundRecord => {
      const am = c.amenities ?? {};
      const amenities: string[] = [];
      if (present(am.toilets)) amenities.push('toilets');
      if (present(am.potableWater)) amenities.push('water');
      if (present(am.showers)) amenities.push('showers');
      if (present(am.dumpStation)) amenities.push('dump station');
      if (present(am.campStore)) amenities.push('camp store');
      if (present(am.foodStorageLockers)) amenities.push('bear lockers');
      if (present(am.firewoodForSale)) amenities.push('firewood');

      const feeCost = c.fees?.[0]?.cost ? Number(c.fees[0].cost) : null;
      return {
        site: {
          id: `cg-${c.id}`,
          name: c.name,
          kind: 'campground',
          lngLat: [Number(c.longitude), Number(c.latitude)],
          elevFt: null,
          blurb: truncate(String(c.description ?? ''), 150),
        },
        info: {
          totalSites: Number(c.campsites?.totalSites) || null,
          reservable: Number(c.numberOfSitesReservable) || 0,
          firstCome: Number(c.numberOfSitesFirstComeFirstServe) || 0,
          season: c.operatingHours?.[0]?.description
            ? truncate(String(c.operatingHours[0].description), 220)
            : null,
          feeCost: feeCost != null && feeCost > 0 ? `$${feeCost % 1 ? feeCost.toFixed(2) : feeCost}` : null,
          amenities,
          reserveUrl: c.reservationUrl || c.url || null,
        },
      };
    });
}
