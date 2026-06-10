import './home.css';
import { freshnessOf, MissingKeyError, PARK_CENTER } from './model';
import type { FmFeature, GaugeReading } from './model';
import { aqiBand, formatMiles, formatNumber, haversineKm, relativeTime } from './format';
import { fetchGauges } from './api/usgsWater';
import { fetchAqi } from './api/openMeteoAqi';
import { fetchAirnow } from './api/airnow';
import { fetchAlerts } from './api/nwsAlerts';
import { fetchSightings } from './api/inaturalist';
import { fetchEbirdSightings } from './api/ebird';
import { fetchSnow } from './api/cdecSnow';
import { deriveTiogaStatus, fetchRoads } from './api/roads';
import { fetchNpsBulletins } from './api/nps';
import { campUrl, fetchCampAvailability } from './api/recgov';
import { fetchFieldCams } from './api/npsWebcams';

// Ouzel Console homepage (design direction B) — the layout is the design's;
// the readings are real. Everything the mock showed as fixtures is wired to
// the same sources the monitor uses.

const VALLEY_FLOOR: [number, number] = [-119.5931, 37.7459]; // Cook's Meadow
const TUNNEL_VIEW: [number, number] = [-119.6771, 37.7156];

interface StationDef {
  site: string;
  badge: string;
  kind: string;
  name: string;
  elevFt: number;
  datum: 'aqi' | 'gauge' | 'static';
  gaugeId?: string;
  staticDatum?: string;
  lngLat: [number, number];
}

const STATIONS: StationDef[] = [
  { site: 'glacier-point', badge: 'viewpoint', kind: 'Viewpoint', name: 'Glacier Point', elevFt: 7214, datum: 'aqi', lngLat: [-119.5733, 37.7281] },
  { site: 'bridalveil-fall', badge: 'waterfall', kind: 'Waterfall', name: 'Bridalveil Fall', elevFt: 4000, datum: 'gauge', gaugeId: '11266500', lngLat: [-119.651, 37.7158] },
  { site: 'cooks-meadow', badge: 'meadow', kind: 'Meadow', name: "Cook's Meadow", elevFt: 3975, datum: 'aqi', lngLat: [-119.5931, 37.7459] },
  { site: 'happy-isles', badge: 'trailhead', kind: 'Trailhead', name: 'Happy Isles', elevFt: 4035, datum: 'gauge', gaugeId: '11264500', lngLat: [-119.5582, 37.7325] },
  { site: 'upper-pines', badge: 'camp', kind: 'Campground', name: 'Upper Pines', elevFt: 4000, datum: 'static', staticDatum: '236 SITES', lngLat: [-119.5631, 37.739] },
  { site: 'tunnel-view', badge: 'viewpoint', kind: 'Viewpoint', name: 'Tunnel View', elevFt: 4400, datum: 'aqi', lngLat: [-119.6771, 37.7156] },
  { site: 'tuolumne-meadows', badge: 'meadow', kind: 'Meadow', name: 'Tuolumne Meadows', elevFt: 8600, datum: 'gauge', gaugeId: '11276500', lngLat: [-119.3622, 37.8767] },
  { site: 'olmsted-point', badge: 'viewpoint', kind: 'Viewpoint', name: 'Olmsted Point', elevFt: 8300, datum: 'aqi', lngLat: [-119.4855, 37.8108] },
];

const datums = new Map<string, { text: string; tier: 'live' | 'recent' | 'historical' }>();
let gauges: GaugeReading[] = [];

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

function chipHtml(tier: 'live' | 'recent' | 'historical', onInk = false): string {
  const label = tier === 'historical' ? 'ARCHIVE' : tier.toUpperCase();
  return `<span class="chip chip--${tier}${tier === 'historical' && onInk ? ' chip--on-ink' : ''}">${label}</span>`;
}

function ptTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Los_Angeles' });
}

function logTimeLabel(iso: string | null): string {
  if (!iso) return 'UNDATED';
  const d = new Date(iso);
  const now = new Date();
  const pt = (x: Date) => x.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' });
  const yesterday = new Date(now.getTime() - 86400_000);
  if (pt(d) === pt(now)) return `${ptTime(d)} · TODAY`;
  if (pt(d) === pt(yesterday)) return 'YESTERDAY';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' }).toUpperCase();
}

// ---- conditions band -------------------------------------------------------

function gaugeBlock(g: GaugeReading): string {
  const fresh = freshnessOf(g.observedAt);
  return `
    <div class="gauge${fresh === 'live' ? ' gauge--live' : ''}">
      <span class="gauge__station">${esc(g.shortName.toUpperCase())} · STN ${esc(g.siteId)}</span>
      <span class="gauge__values">
        <span class="gauge__cell">
          <span class="gauge__num">${g.dischargeCfs !== null ? formatNumber(g.dischargeCfs) : '——'}</span>
          <span class="gauge__unit">CFS</span>
        </span>
        <span class="gauge__cell">
          <span class="gauge__num">${g.gageHeightFt !== null ? g.gageHeightFt.toFixed(2) : '——'}</span>
          <span class="gauge__unit">FT STAGE</span>
        </span>
        <span class="gauge__cell gauge__cell--status">
          <span class="gauge__dot" aria-hidden="true"></span>
          <span class="gauge__age">${fresh === 'live' ? 'LIVE' : 'STALE'} · ${esc(relativeTime(g.observedAt))}</span>
        </span>
      </span>
    </div>`;
}

async function loadConditions(): Promise<void> {
  const row = document.getElementById('oz-cond-row')!;
  const sweep = document.getElementById('oz-sweep')!;
  try {
    gauges = await fetchGauges();
  } catch {
    row.innerHTML = `<p class="ozc-error">Gage network didn't answer. Readings resume on the next 15-minute sweep.</p>`;
    sweep.textContent = 'GAGE NETWORK DOWN · NEXT SWEEP IN 15 MIN';
    return;
  }

  const featured = ['11264500', '11276500']
    .map((id) => gauges.find((g) => g.siteId === id))
    .filter((g): g is GaugeReading => Boolean(g));

  row.innerHTML =
    `${featured.map(gaugeBlock).join('')}` +
    `<div class="ozc-aqi" id="oz-aqi-tile"><span class="ozc-pending">Reading the air…</span></div>` +
    `<div class="ozc-aqi" id="oz-snow-tile"><span class="ozc-pending">Reading the snow pillows…</span></div>`;

  const latest = featured.map((g) => g.observedAt).filter(Boolean).sort().pop();
  if (latest) sweep.textContent = `SWEEP ${ptTime(new Date(latest))} · NEXT IN 15 MIN`;

  for (const def of STATIONS) {
    if (def.datum === 'gauge' && def.gaugeId) {
      const g = gauges.find((x) => x.siteId === def.gaugeId);
      if (g?.dischargeCfs != null) {
        datums.set(def.site, { text: `${formatNumber(g.dischargeCfs)} CFS`, tier: freshnessOf(g.observedAt) });
      }
    }
  }
  renderStations();
  loadAqiTile();
  loadSnowTile();
}

async function loadSnowTile(): Promise<void> {
  const tile = document.getElementById('oz-snow-tile');
  if (!tile) return;
  try {
    const snow = await fetchSnow();
    // Deepest pack tells the season's story best.
    const top = snow.sort((a, b) => (b.depthIn ?? 0) - (a.depthIn ?? 0))[0];
    if (!top) {
      tile.innerHTML = `<span class="ozc-pending">Snow sensors read nothing — full melt-out.</span>`;
      return;
    }
    const melted = (top.sweIn ?? 0) <= 0 && (top.depthIn ?? 0) <= 0;
    const reading = melted
      ? 'Melted out for the season'
      : [
          top.depthIn != null ? `${Math.round(top.depthIn)} in depth` : '',
          top.sweIn != null ? `${top.sweIn.toFixed(2)} in SWE` : '',
        ].filter(Boolean).join(' · ');
    tile.innerHTML = `
      <span class="ozc-snow__num">${top.depthIn != null ? Math.round(top.depthIn) : '—'}<span>IN</span></span>
      <span class="ozc-aqi__col">
        <span class="ozc-aqi__label">SNOWPACK · ${esc(top.name.toUpperCase())} · ${formatNumber(top.elevFt)} FT</span>
        <span class="ozc-aqi__band">${esc(reading)}</span>
        <span class="ozc-aqi__age">${chipHtml(freshnessOf(top.observedAt), true)} posted ${esc(relativeTime(top.observedAt))}</span>
      </span>`;
  } catch {
    tile.innerHTML = `<span class="ozc-error">Snow sensors didn't answer. Reload to retry.</span>`;
  }
}

async function loadRoads(): Promise<void> {
  const strip = document.getElementById('oz-roads')!;
  try {
    const caltrans = await fetchRoads();
    let bulletins: Awaited<ReturnType<typeof fetchNpsBulletins>> = [];
    try {
      bulletins = await fetchNpsBulletins();
    } catch {
      /* NPS module dormant → Tioga derives from an empty list, honestly */
    }
    const roads = [...caltrans, deriveTiogaStatus(bulletins, caltrans[0]?.observedAt ?? null)];
    strip.innerHTML =
      `<span class="ozc-roads__label">ACCESS</span>` +
      roads
        .map(
          (r) =>
            `<span class="ozc-roads__item"><span class="oz-mono">${esc(r.corridor)}</span> <span class="roadchip roadchip--${esc(r.status)}">${esc(r.status.toUpperCase())}</span></span>`,
        )
        .join('');
  } catch {
    strip.innerHTML = `<span class="ozc-roads__label">ACCESS</span><span class="ozc-error">Caltrans didn't answer — call 1-800-427-7623.</span>`;
  }
}

async function loadAqiTile(): Promise<void> {
  const tile = document.getElementById('oz-aqi-tile');
  if (!tile) return;
  let aqi: number | null = null;
  let detail = '';
  let age = '';
  try {
    const an = await fetchAirnow(VALLEY_FLOOR);
    if (an !== 'unavailable') {
      aqi = an.aqi;
      detail = `observed · primary ${an.primaryPollutant}`;
      age = `reported ${relativeTime(an.observedAt)}`;
    }
  } catch (err) {
    if (!(err instanceof MissingKeyError)) console.error('[ouzel] airnow', err);
  }
  if (aqi === null) {
    try {
      const om = await fetchAqi(VALLEY_FLOOR);
      aqi = om.usAqi;
      detail = 'modeled · Open-Meteo CAMS';
      age = `modeled ${relativeTime(om.observedAt)}`;
    } catch {
      tile.innerHTML = `<p class="ozc-error">Air model didn't respond. Reload to retry.</p>`;
      return;
    }
  }
  const band = aqiBand(aqi);
  tile.innerHTML = `
    <span class="ozc-aqi__badge" style="background:${band.color};color:${band.text}">${Math.round(aqi)}</span>
    <span class="ozc-aqi__col">
      <span class="ozc-aqi__label">US AQI · VALLEY FLOOR</span>
      <span class="ozc-aqi__band">${esc(band.label)} · ${esc(detail)}</span>
      <span class="ozc-aqi__age">${chipHtml('live')} ${esc(age)}</span>
    </span>`;
}

// ---- stations index --------------------------------------------------------

function renderStations(): void {
  const wrap = document.getElementById('oz-stations')!;
  wrap.innerHTML = STATIONS.map((s, i) => {
    const d = datums.get(s.site);
    return `
    <a class="oz-st-row" href="/monitor.html?site=${esc(s.site)}" aria-label="Open ${esc(s.name)} in the monitor">
      <span class="oz-st-row__idx">${String(i + 1).padStart(2, '0')}</span>
      <img class="oz-st-row__badge" src="/icons/${esc(s.badge)}-badge.png" alt="" aria-hidden="true" />
      <span class="oz-st-row__name">${esc(s.name)}<span>${esc(s.kind)}</span></span>
      <span class="oz-st-row__elev">${formatNumber(s.elevFt)} FT</span>
      <span class="oz-st-row__datum">${esc(d?.text ?? '—')}</span>
      <span class="oz-st-row__chip">${d ? chipHtml(d.tier, true) : ''}</span>
    </a>`;
  }).join('');
}

async function loadStationAqi(): Promise<void> {
  const targets = STATIONS.filter((s) => s.datum === 'aqi');
  await Promise.allSettled(
    targets.map(async (s) => {
      const om = await fetchAqi(s.lngLat);
      datums.set(s.site, { text: `AQI ${Math.round(om.usAqi)}`, tier: freshnessOf(om.observedAt) });
    }),
  );
  for (const s of STATIONS) {
    if (s.datum === 'static' && s.staticDatum) datums.set(s.site, { text: s.staticDatum, tier: 'recent' });
  }
  renderStations();
}

// ---- plates · field cameras --------------------------------------------------

function camCoords(lngLat: [number, number] | null): string {
  if (!lngLat) return 'POSITION UNPUBLISHED';
  const [lng, lat] = lngLat;
  return `${Math.abs(lat).toFixed(4)}°N ${Math.abs(lng).toFixed(4)}°W`;
}

async function loadPlates(): Promise<void> {
  const rail = document.getElementById('oz-plates')!;
  let cams;
  try {
    cams = await fetchFieldCams();
  } catch (err) {
    if (err instanceof MissingKeyError) {
      rail.innerHTML = `<p class="ozc-pending">Field cameras sleep until the NPS key lands in .env.</p>`;
    } else {
      rail.innerHTML = `<p class="ozc-error">Camera network didn't answer. Reload to retry.</p>`;
    }
    return;
  }
  if (!cams.length) {
    rail.innerHTML = `<p class="ozc-pending">No active cameras reported by NPS right now.</p>`;
    return;
  }

  rail.innerHTML = cams
    .map((c, i) => {
      const frame = c.img
        ? `<img src="${esc(c.img)}" alt="Reference frame from the ${esc(c.title)} camera" loading="lazy" />`
        : `<span class="ozc-plate__none" aria-hidden="true">∅</span>`;
      return `
      <a class="ozc-plate ozc-plate--cam" href="${esc(c.watchUrl)}" target="_blank" rel="noopener"
         aria-label="Open the ${esc(c.title)} camera at its source">
        <span class="ozc-plate__img ozc-plate__img--cam">${frame}<span class="ozc-plate__grade" aria-hidden="true"></span></span>
        <span class="ozc-plate__caption">
          <span>PLATE ${String(i + 2).padStart(2, '0')} · ${esc(c.title.toUpperCase())}</span>
          <span>${esc(camCoords(c.lngLat))}</span>
        </span>
        <span class="ozc-plate__watch">${c.streaming ? 'WATCH LIVE ↗' : 'OPEN CAM ↗'}</span>
      </a>`;
    })
    .join('');
}

// ---- camps · tonight -------------------------------------------------------

async function loadCamps(): Promise<void> {
  const wrap = document.getElementById('oz-camps')!;
  const asof = document.getElementById('oz-camps-asof')!;
  let rows;
  try {
    rows = await fetchCampAvailability();
  } catch {
    wrap.innerHTML = `<p class="ozc-error">Reservation wire didn't answer. Counts resume on the next hourly sweep.</p>`;
    return;
  }

  const sorted = [...rows].sort(
    (a, b) => b.availableTonight - a.availableTonight || a.name.localeCompare(b.name),
  );

  wrap.innerHTML = sorted
    .map((c, i) => {
      const datum =
        c.note === 'lottery'
          ? `<span class="campopen campopen--lottery">LOTTERY</span>`
          : c.availableTonight > 0
            ? `<span class="campopen campopen--open">${c.availableTonight} OPEN</span>`
            : c.reservableTonight === 0
              ? `<span class="campopen campopen--closed">NOT OPEN</span>`
              : `<span class="campopen campopen--full">SOLD OUT</span>`;
      return `
      <a class="oz-st-row" href="${esc(campUrl(c.recId))}" target="_blank" rel="noopener"
         aria-label="Open ${esc(c.name)} on Recreation.gov">
        <span class="oz-st-row__idx">${String(i + 1).padStart(2, '0')}</span>
        <img class="oz-st-row__badge" src="/icons/camp-badge.png" alt="" aria-hidden="true" />
        <span class="oz-st-row__name">${esc(c.name)}<span>Campground</span></span>
        <span class="oz-st-row__elev">${c.note === 'lottery' || c.reservableTonight === 0 ? '—' : `${c.reservableTonight} RESERVABLE`}</span>
        <span class="oz-st-row__datum">${c.note === 'lottery' ? 'PER-PERSON' : c.reservableTonight === 0 ? 'SEASONAL' : c.availableTonight > 0 ? `${c.availableTonight} SITES` : 'FULL'}</span>
        <span class="oz-st-row__chip">${datum}</span>
      </a>`;
    })
    .join('');

  const tonight = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Los_Angeles',
  }).toUpperCase();
  asof.textContent = `TONIGHT · ${tonight} · RESERVATION WIRE ${relativeTime(rows[0].observedAt).toUpperCase()}`;
}

// ---- field log -------------------------------------------------------------

async function loadLog(): Promise<void> {
  const list = document.getElementById('oz-log')!;
  let pool: FmFeature[] = [];
  try {
    pool = await fetchSightings();
  } catch {
    list.innerHTML = `<li class="ozc-log__row"><span class="ozc-log__time">—</span><span class="ozc-log__name ozc-error">iNaturalist didn't answer. Reload to refetch the log.</span></li>`;
    return;
  }
  try {
    pool = [...pool, ...(await fetchEbirdSightings())];
  } catch (err) {
    if (!(err instanceof MissingKeyError)) console.error('[ouzel] ebird', err);
  }

  const rows = pool
    .filter((f) => f.observedAt)
    .sort((a, b) => String(b.observedAt).localeCompare(String(a.observedAt)))
    .slice(0, 6);

  if (!rows.length) {
    list.innerHTML = `<li class="ozc-log__row"><span class="ozc-log__time">—</span><span class="ozc-log__name">No sightings cached yet. The log refreshes every 30 minutes.</span></li>`;
    return;
  }

  list.innerHTML = rows
    .map((f) => {
      const p = f.props as Record<string, string | null>;
      const tier = freshnessOf(f.observedAt);
      return `
      <li class="ozc-log__row">
        <span class="ozc-log__time">${esc(logTimeLabel(f.observedAt))}</span>
        <span class="ozc-log__name">${esc(p.commonName)} <span>· ${esc(p.group)}</span></span>
        <span class="ozc-log__dist">${formatMiles(haversineKm(VALLEY_FLOOR, f.lngLat)).toUpperCase()}</span>
        ${chipHtml(tier, true)}
      </li>`;
    })
    .join('');
}

// ---- banner + plate meta ---------------------------------------------------

async function loadBanner(): Promise<void> {
  const banner = document.getElementById('oz-banner')!;
  try {
    const alerts = await fetchAlerts(PARK_CENTER);
    if (!alerts.length) return;
    const first = alerts[0];
    const more = alerts.length > 1 ? ` · +${alerts.length - 1} more in the monitor` : '';
    banner.innerHTML = `<span class="ozc-banner__tag">ALERT</span> ${esc(first.event)}: ${esc(first.headline)}${more}`;
    banner.hidden = false;
  } catch {
    /* a quiet banner is the correct failure mode here */
  }
}

async function loadPlateMeta(): Promise<void> {
  const el = document.getElementById('oz-plate-meta')!;
  const coords = '37.7156°N 119.6771°W';
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${TUNNEL_VIEW[1]}&longitude=${TUNNEL_VIEW[0]}` +
        `&current=temperature_2m&temperature_unit=fahrenheit&timezone=America/Los_Angeles`,
    );
    const json = await res.json();
    const t = json.current?.temperature_2m;
    el.textContent = `${coords} · ${ptTime(new Date())}${typeof t === 'number' ? ` · ${Math.round(t)}°F` : ''}`;
  } catch {
    el.textContent = coords;
  }
}

renderStations();
loadConditions();
loadStationAqi();
loadLog();
loadBanner();
loadPlateMeta();
loadRoads();
loadCamps();
loadPlates();
