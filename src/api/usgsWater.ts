import type { GaugeReading } from '../model';

// USGS NWIS instantaneous values. Public domain, keyless, ~15-min cadence.
// One comma-list call covers all gauges we track.
const GAUGE_IDS = ['11264500', '11266500', '11276500'];

const SHORT_NAMES: Record<string, string> = {
  '11264500': 'Merced R · Happy Isles',
  '11266500': 'Merced R · Pohono Bridge',
  '11276500': 'Tuolumne R · Hetch Hetchy',
};

const URL =
  `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${GAUGE_IDS.join(',')}` +
  `&parameterCd=00060,00065&siteStatus=all`;

interface NwisTimeSeries {
  sourceInfo: {
    siteName: string;
    siteCode: { value: string }[];
    geoLocation: { geogLocation: { latitude: number; longitude: number } };
  };
  variable: { variableCode: { value: string }[] };
  values: { value: { value: string; dateTime: string }[] }[];
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
    };
    const param = ts.variable.variableCode[0]?.value;
    const latest = ts.values[0]?.value[0];
    if (latest) {
      const v = Number(latest.value);
      // NWIS uses large negative sentinels (-999999) for missing data.
      if (Number.isFinite(v) && v > -1000) {
        if (param === '00060') reading.dischargeCfs = v;
        if (param === '00065') reading.gageHeightFt = v;
        if (!reading.observedAt || latest.dateTime > reading.observedAt) {
          reading.observedAt = latest.dateTime;
        }
      }
    }
    bySite.set(id, reading);
  }
  return [...bySite.values()];
}
