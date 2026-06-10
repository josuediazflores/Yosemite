// Normalized shapes shared across every data source. The single rule that
// holds the project together: coordinates are ALWAYS [lng, lat]; any
// lat-first source gets flipped at ingestion, never later.

export type Freshness = 'live' | 'recent' | 'historical';

export type SourceId =
  | 'curated'
  | 'inat'
  | 'usgs-water'
  | 'open-meteo'
  | 'nws'
  | 'usgs-quake'
  | 'eonet'
  | 'firms'
  | 'nifc'
  | 'airnow'
  | 'ebird'
  | 'nps';

export type LayerId = 'sites' | 'camps' | 'sightings' | 'fire' | 'hazards' | 'heat';

/** Keyed modules proxied through the dev server; 'missing-key' = no .env entry yet. */
export type ModuleStatus = 'pending' | 'ok' | 'missing-key' | 'error';
export type ModuleId = 'nps' | 'firms' | 'airnow' | 'ebird';

export class MissingKeyError extends Error {
  envVar: string;
  constructor(envVar: string) {
    super(`missing key: ${envVar}`);
    this.envVar = envVar;
  }
}

export interface FmFeature {
  id: string;
  source: SourceId;
  layer: LayerId;
  lngLat: [number, number];
  /** ISO timestamp of the underlying observation; null = undated. */
  observedAt: string | null;
  license: string;
  attribution: string;
  props: Record<string, unknown>;
}

export interface Site {
  id: string;
  name: string;
  kind: 'viewpoint' | 'waterfall' | 'meadow' | 'trailhead' | 'campground';
  lngLat: [number, number];
  elevFt: number | null;
  blurb: string;
}

export interface CampgroundInfo {
  totalSites: number | null;
  reservable: number;
  firstCome: number;
  season: string | null;
  feeCost: string | null;
  amenities: string[];
  reserveUrl: string | null;
}

export interface GaugeReading {
  siteId: string;
  name: string;
  shortName: string;
  lngLat: [number, number];
  dischargeCfs: number | null;
  gageHeightFt: number | null;
  observedAt: string | null;
}

export interface AqiReading {
  usAqi: number;
  pm25: number | null;
  pm10: number | null;
  ozone: number | null;
  observedAt: string;
}

export interface NwsAlert {
  id: string;
  event: string;
  severity: string;
  headline: string;
  ends: string | null;
}

export interface NpsBulletin {
  id: string;
  title: string;
  category: string; // Danger | Park Closure | Caution | Information
  description: string;
  url: string | null;
}

export interface AirnowReading {
  aqi: number;
  primaryPollutant: string;
  categoryName: string;
  observedAt: string;
}

// Freshness is derived from the observation timestamp at render time, so a
// reading ages out of "live" without a refetch.
const LIVE_MS = 60 * 60 * 1000; // 1 hour
const RECENT_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export function freshnessOf(observedAt: string | null, now = Date.now()): Freshness {
  if (!observedAt) return 'historical';
  const age = now - new Date(observedAt).getTime();
  if (age <= LIVE_MS) return 'live';
  if (age <= RECENT_MS) return 'recent';
  return 'historical';
}

export const FRESHNESS_LABEL: Record<Freshness, string> = {
  live: 'LIVE',
  recent: 'RECENT',
  historical: 'ARCHIVE',
};

// Park-wide constants
export const PARK_CENTER: [number, number] = [-119.54, 37.84];
export const PARK_BBOX = { west: -119.886, south: 37.49, east: -119.19, north: 38.19 };
export const HEADER_GAUGE_ID = '11264500';
