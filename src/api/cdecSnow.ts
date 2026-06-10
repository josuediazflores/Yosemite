import type { SnowReading } from '../model';

// CA DWR CDEC snow sensors — the Tioga-opening predictors. Daily values;
// sensor 3 is snow water equivalent, 18 is depth, both in inches. Today's
// row is a -9999 sentinel until posted, so we take the latest valid value.
const STATIONS: Record<string, { name: string; lngLat: [number, number]; elevFt: number }> = {
  TUM: { name: 'Tuolumne Meadows', lngLat: [-119.35, 37.873], elevFt: 8600 },
  DAN: { name: 'Dana Meadows', lngLat: [-119.257, 37.897], elevFt: 9800 },
  SLI: { name: 'Slide Canyon', lngLat: [-119.43, 38.092], elevFt: 9200 },
};

function dateParam(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface CdecRow {
  stationId: string;
  sensorType: string; // "SNOW WC" | "SNOW DP"
  date: string; // "2026-6-9 00:00"
  value: number;
}

export async function fetchSnow(): Promise<SnowReading[]> {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 86400_000);
  const url =
    `/proxy/cdec?Stations=${Object.keys(STATIONS).join(',')}` +
    `&SensorNums=3,18&dur_code=D&Start=${dateParam(start)}&End=${dateParam(end)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CDEC ${res.status}`);
  const rows: CdecRow[] = await res.json();

  const readings = new Map<string, SnowReading>();
  for (const [id, meta] of Object.entries(STATIONS)) {
    readings.set(id, {
      stationId: id,
      name: meta.name,
      lngLat: meta.lngLat,
      elevFt: meta.elevFt,
      sweIn: null,
      depthIn: null,
      observedAt: null,
    });
  }

  // Rows are chronological per station/sensor; keep overwriting with each
  // valid value so the latest one wins. Negative snow is sensor noise
  // (CDEC posts -9999 sentinels and the pillows drift to small negatives).
  for (const row of rows) {
    const reading = readings.get(row.stationId);
    if (!reading || typeof row.value !== 'number' || row.value < 0) continue;
    // CDEC dates aren't zero-padded ("2026-6-9 00:00") — parse by parts.
    const m = row.date.match(/^(\d+)-(\d+)-(\d+) (\d+):(\d+)/);
    const observed = m
      ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]))
      : new Date(NaN);
    const iso = Number.isNaN(observed.getTime()) ? null : observed.toISOString();
    if (row.sensorType === 'SNOW WC') {
      reading.sweIn = row.value;
    } else if (row.sensorType === 'SNOW DP') {
      reading.depthIn = row.value;
    } else {
      continue;
    }
    if (iso && (!reading.observedAt || iso > reading.observedAt)) reading.observedAt = iso;
  }

  return [...readings.values()].filter((r) => r.sweIn !== null || r.depthIn !== null);
}
