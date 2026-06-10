import type { CampAvailability } from '../model';

// Recreation.gov's public availability grid — the endpoint the booking site
// itself uses. Unofficial: personal-use polling, hourly, 30-min cache, and
// every rendering carries a confirm-at-booking disclaimer.
//
// Facility IDs verified against the live search API during planning.
const FACILITIES: { recId: string; name: string; note?: 'lottery' }[] = [
  { recId: '232447', name: 'Upper Pines' },
  { recId: '232450', name: 'Lower Pines' },
  { recId: '232449', name: 'North Pines' },
  { recId: '232448', name: 'Tuolumne Meadows' },
  { recId: '232446', name: 'Wawona' },
  { recId: '232451', name: 'Hodgdon Meadow' },
  { recId: '232452', name: 'Crane Flat' },
  { recId: '232453', name: 'Bridalveil Creek' },
  { recId: '10083845', name: 'Tamarack Flat' },
  { recId: '10083831', name: 'Porcupine Flat' },
  { recId: '10083567', name: 'White Wolf' },
  { recId: '10083840', name: 'Yosemite Creek' },
  { recId: '10004152', name: 'Camp 4', note: 'lottery' },
  { recId: '10346420', name: 'Tuolumne Horse' },
  { recId: '10220609', name: 'Wawona Horse' },
  { recId: '10390880', name: 'Bridalveil Horse' },
];

const CACHE_KEY = 'yfm-recgov-v1';
const CACHE_TTL_MS = 30 * 60 * 1000;

const NOT_BOOKABLE = new Set(['Closed', 'Not Reservable', 'NYR', 'Not Available', 'Not Available Cutoff']);

export function campMatchKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(campgrounds?|campsites?|camp)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// "Tonight" in park time — at 2 AM PT that's still the current PT date.
function tonightPT(): { dateKey: string; monthStart: string } {
  const pt = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }); // YYYY-MM-DD
  return { dateKey: `${pt}T00:00:00Z`, monthStart: `${pt.slice(0, 8)}01T00:00:00.000Z` };
}

interface GridSite {
  availabilities: Record<string, string>;
}

export function campUrl(recId: string): string {
  return `https://www.recreation.gov/camping/campgrounds/${recId}`;
}

export async function fetchCampAvailability(): Promise<CampAvailability[]> {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const { at, rows } = JSON.parse(cached);
      if (Date.now() - at < CACHE_TTL_MS && Array.isArray(rows) && rows.length) return rows;
    }
  } catch {
    /* cold cache */
  }

  const { dateKey, monthStart } = tonightPT();
  const observedAt = new Date().toISOString();

  const settled = await Promise.allSettled(
    FACILITIES.map(async (f): Promise<CampAvailability> => {
      const res = await fetch(
        `/proxy/recgov/camps/availability/campground/${f.recId}/month?start_date=${encodeURIComponent(monthStart)}`,
      );
      if (!res.ok) throw new Error(`recgov ${f.name} → ${res.status}`);
      const json = await res.json();
      const sites: GridSite[] = Object.values(json.campsites ?? {});
      let available = 0;
      let reservable = 0;
      for (const s of sites) {
        const status = s.availabilities?.[dateKey];
        if (!status || NOT_BOOKABLE.has(status)) continue;
        reservable += 1;
        if (status === 'Available') available += 1;
      }
      return {
        recId: f.recId,
        name: f.name,
        matchKey: campMatchKey(f.name),
        availableTonight: available,
        reservableTonight: reservable,
        note: f.note,
        observedAt,
      };
    }),
  );

  const rows = settled
    .filter((r): r is PromiseFulfilledResult<CampAvailability> => r.status === 'fulfilled')
    .map((r) => r.value);
  if (!rows.length) throw new Error('reservation wire down');

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), rows }));
  } catch {
    /* cache is best-effort */
  }
  return rows;
}
