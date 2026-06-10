import type { GaugeReading } from '../model';

// USGS NWIS instantaneous values. Public domain, keyless, ~15-min cadence.
// One comma-list call covers all gauges; period=P1D returns the full last-24h
// series, which feeds both the latest readout and the gage-card sparkline.
const GAUGE_IDS = ['11264500', '11266500', '11276500'];

const SHORT_NAMES: Record<string, string> = {
  '11264500': 'Merced R · Happy Isles',
  '11266500': 'Merced R · Pohono Bridge',
  '11276500': 'Tuolumne R · Hetch Hetchy',
};

const URL =
  `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${GAUGE_IDS.join(',')}` +
  `&parameterCd=00060,00065&period=P1D&siteStatus=all`;

const SPARK_POINTS = 24;

interface NwisTimeSeries {
  sourceInfo: {
    siteName: string;
    siteCode: { value: string }[];
    geoLocation: { geogLocation: { latitude: number; longitude: number } };
  };
  variable: { variableCode: { value: string }[] };
  values: { value: { value: string; dateTime: string }[] }[];
}

// NWIS uses large negative sentinels (-999999) for missing data.
function validValues(ts: NwisTimeSeries): { v: number; t: string }[] {
  return (ts.values[0]?.value ?? [])
    .map((p) => ({ v: Number(p.value), t: p.dateTime }))
    .filter((p) => Number.isFinite(p.v) && p.v > -1000);
}

// Downsample the day's series to a fixed point count and normalize to 0..1.
function toSpark(series: { v: number }[]): number[] {
  if (series.length < 2) return [];
  const step = (series.length - 1) / (SPARK_POINTS - 1);
  const sampled = Array.from({ length: SPARK_POINTS }, (_, i) => series[Math.round(i * step)].v);
  const min = Math.min(...sampled);
  const max = Math.max(...sampled);
  if (max - min < 1e-9) return sampled.map(() => 0.5);
  return sampled.map((v) => (v - min) / (max - min));
}

export async function fetchGauges(): Promise<GaugeReading[]> {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`NWIS ${res.status}`);
  const json = await res.json();
  const series: NwisTimeSeries[] = json.value?.timeSeries ?? [];

  const bySite = new Map<string, GaugeReading>();
  for (const ts of series) {
    const id = ts.sourceInfo.siteCode[0]?.value;
    if (!id) continue;
    const loc = ts.sourceInfo.geoLocation.geogLocation;
    const reading = bySite.get(id) ?? {
      siteId: id,
      name: ts.sourceInfo.siteName,
      shortName: SHORT_NAMES[id] ?? ts.sourceInfo.siteName,
      // NWIS is lat-first; normalize to [lng, lat] here and nowhere else.
      lngLat: [loc.longitude, loc.latitude] as [number, number],
      dischargeCfs: null,
      gageHeightFt: null,
      observedAt: null,
      spark: [],
    };
    const param = ts.variable.variableCode[0]?.value;
    const points = validValues(ts); // chronological; latest reading is last
    const latest = points[points.length - 1];
    if (latest) {
      if (param === '00060') {
        reading.dischargeCfs = latest.v;
        reading.spark = toSpark(points);
      }
      if (param === '00065') reading.gageHeightFt = latest.v;
      if (!reading.observedAt || latest.t > reading.observedAt) {
        reading.observedAt = latest.t;
      }
    }
    bySite.set(id, reading);
  }
  return [...bySite.values()];
}
