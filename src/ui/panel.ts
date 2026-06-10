import type { FmFeature, GaugeReading, ModuleId, Site } from '../model';
import { FRESHNESS_LABEL, freshnessOf } from '../model';
import { absoluteTime, aqiBand, formatCoords, formatMiles, formatNumber, haversineKm, relativeTime } from '../format';
import { allFires, allSightings, on, selectSite, state } from '../state';

// Site detail panel: everything around the chosen spot, each block honest
// about its own freshness and its own failures.

let panelEl: HTMLElement;
const NEARBY_SIGHTINGS = 6;
const HAZARD_RADIUS_KM = 50;

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

export function initPanel(el: HTMLElement): void {
  panelEl = el;
  on('selection', render);
  on('site-data', render);
  on('sightings', render);
  on('gauges', render);
  on('fires', render);
  on('park-alerts', render);
  on('modules', render);
  on('roads', render);
  on('snow', render);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.selectedSiteId) selectSite(null);
  });
  panelEl.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-close]')) selectSite(null);
  });
}

function chip(observedAt: string | null): string {
  const f = freshnessOf(observedAt);
  return `<span class="chip chip--${f}">${FRESHNESS_LABEL[f]}</span>`;
}

// Section header with the survey-form dashed rule running to the edge.
function secTitle(title: string): string {
  return `<h3><span>${esc(title)}</span></h3>`;
}

// 24h discharge sparkline (design system Gauge card treatment).
function sparklineSvg(points: number[], width = 68, height = 24): string {
  if (points.length < 2) return '';
  const step = width / (points.length - 1);
  const xy = points.map(
    (v, i) => `${(i * step).toFixed(1)},${(height - 3 - v * (height - 6)).toFixed(1)}`,
  );
  const lastY = (height - 3 - points[points.length - 1] * (height - 6)).toFixed(1);
  return `<svg class="spark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">
    <polygon points="0,${height} ${xy.join(' ')} ${width},${height}" fill="rgba(62,124,155,0.12)"></polygon>
    <polyline points="${xy.join(' ')}" fill="none" stroke="#3E7C9B" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"></polyline>
    <circle cx="${width}" cy="${lastY}" r="2.2" fill="#3E7C9B"></circle>
  </svg>`;
}

function render(): void {
  const site = state.sites.find((s) => s.id === state.selectedSiteId);
  if (!site) {
    panelEl.hidden = true;
    panelEl.innerHTML = '';
    return;
  }

  const wasHidden = panelEl.hidden;
  panelEl.hidden = false;
  panelEl.innerHTML = `
    <header class="panel__head">
      <div>
        <span class="panel__kind"><span class="kind-pip kind-pip--${esc(site.kind)}" aria-hidden="true"></span>${esc(site.kind)}</span>
        <h2 class="panel__name">${esc(site.name)}</h2>
        <p class="panel__coords">${formatCoords(site.lngLat)}${site.elevFt != null ? ` · ${formatNumber(site.elevFt)} FT` : ''}</p>
      </div>
      <button class="panel__close" type="button" data-close aria-label="Close site details">✕</button>
    </header>
    <p class="panel__blurb">${esc(site.blurb)}</p>
    ${site.kind === 'campground' ? campgroundSection(site) : ''}
    ${aqiSection(site)}
    ${gaugeSection(site)}
    ${snowSection(site)}
    ${alertSection(site)}
    ${bulletinSection()}
    ${roadsSection()}
    ${hazardSection(site)}
    ${sightingsSection(site)}
    <footer class="panel__credits">
      AQI: AirNow (observed) and Open-Meteo CAMS (modeled). Sightings © their iNaturalist/eBird
      observers, licenses as marked. River data USGS NWIS, public domain. Alerts NWS + NPS.
      Fire: NIFC/WFIGS, NASA FIRMS, NASA EONET.${dormantLine()}
    </footer>`;

  if (wasHidden) panelEl.focus();
}

function aqiSection(site: Site): string {
  const airnow = state.airnowBySite.get(site.id);
  const aqi = state.aqiBySite.get(site.id);

  // AirNow (observed) outranks the Open-Meteo model when a station reported.
  if (airnow && airnow !== 'error' && airnow !== 'unavailable') {
    const band = aqiBand(airnow.aqi);
    const modelLine =
      aqi && aqi !== 'error' ? `<span class="aqi__time">Model check (Open-Meteo): ${Math.round(aqi.usAqi)}</span>` : '';
    return `<section class="panel__section">${secTitle('Air quality · US AQI')}
      <div class="aqi">
        <span class="aqi__badge" style="background:${band.color};color:${band.text}">${Math.round(airnow.aqi)}</span>
        <div class="aqi__detail">
          <span class="aqi__label">${esc(band.label)}</span>
          <span class="aqi__particles">observed · primary ${esc(airnow.primaryPollutant)} · AirNow</span>
          <span class="aqi__time">${chip(airnow.observedAt)} reported ${esc(relativeTime(airnow.observedAt))}</span>
          ${modelLine}
        </div>
      </div></section>`;
  }

  let body: string;
  if (aqi === undefined) {
    body = `<p class="panel__pending">Reading the air model…</p>`;
  } else if (aqi === 'error') {
    body = `<p class="panel__error">Air quality model didn't respond. Close and reopen this site to retry.</p>`;
  } else {
    const band = aqiBand(aqi.usAqi);
    body = `
      <div class="aqi">
        <span class="aqi__badge" style="background:${band.color};color:${band.text}">${Math.round(aqi.usAqi)}</span>
        <div class="aqi__detail">
          <span class="aqi__label">${esc(band.label)}</span>
          <span class="aqi__particles">PM2.5 ${aqi.pm25 ?? '—'} · PM10 ${aqi.pm10 ?? '—'} · O₃ ${aqi.ozone ?? '—'} µg/m³</span>
          <span class="aqi__time">${chip(aqi.observedAt)} modeled ${esc(relativeTime(aqi.observedAt))}</span>
        </div>
      </div>`;
  }
  return `<section class="panel__section">${secTitle('Air quality · US AQI')}${body}</section>`;
}

function campgroundSection(site: Site): string {
  const info = state.campgroundInfo.get(site.id);
  if (!info) return '';

  const counts: string[] = [];
  if (info.totalSites) counts.push(`${info.totalSites} sites`);
  if (info.reservable) counts.push(`${info.reservable} reservable`);
  if (info.firstCome) counts.push(`${info.firstCome} first-come`);
  const fee = info.feeCost ? ` · from ${info.feeCost}/night` : '';

  const amenities = info.amenities.length
    ? `<div class="campcard__amenities">${info.amenities.map((a) => `<span class="amenity">${esc(a)}</span>`).join('')}</div>`
    : '';
  const season = info.season ? `<p class="campcard__season">${esc(info.season)}</p>` : '';
  const reserve = info.reserveUrl
    ? `<a class="campcard__link" href="${esc(info.reserveUrl)}" target="_blank" rel="noopener">Reservations & details ↗</a>`
    : '';

  return `<section class="panel__section">${secTitle('Campground')}
    <div class="campcard">
      <div class="campcard__row mono">${esc(counts.join(' · '))}${esc(fee)}</div>
      ${amenities}
      ${season}
      ${reserve}
    </div></section>`;
}

const MODULE_LABEL: Record<ModuleId, string> = {
  nps: 'NPS',
  firms: 'FIRMS',
  airnow: 'AirNow',
  ebird: 'eBird',
};

function dormantLine(): string {
  const dormant = (Object.keys(MODULE_LABEL) as ModuleId[])
    .filter((m) => state.modules[m] === 'missing-key')
    .map((m) => MODULE_LABEL[m]);
  if (!dormant.length) return '';
  return `<br /><span class="panel__dormant">Dormant modules awaiting keys in .env: ${dormant.join(', ')} — see .env.example.</span>`;
}

function bulletinSection(): string {
  if (state.modules.nps !== 'ok') return '';
  if (!state.npsBulletins.length) {
    return `<section class="panel__section">${secTitle('Park bulletins · NPS')}
      <p class="panel__empty">No active park bulletins.</p></section>`;
  }
  const urgent = (c: string) => c === 'Danger' || c === 'Park Closure';
  const rows = [...state.npsBulletins]
    .sort((a, b) => Number(urgent(b.category)) - Number(urgent(a.category)))
    .slice(0, 4)
    .map(
      (b) => `
      <div class="alertcard ${urgent(b.category) ? '' : 'alertcard--info'}">
        <span class="alertcard__event">${esc(b.category)}</span>
        <span class="alertcard__headline">${esc(b.title)}</span>
      </div>`,
    )
    .join('');
  const more = state.npsBulletins.length > 4 ? `<p class="panel__empty">+${state.npsBulletins.length - 4} more on nps.gov/yose.</p>` : '';
  return `<section class="panel__section">${secTitle('Park bulletins · NPS')}${rows}${more}</section>`;
}

function gaugeSection(site: Site): string {
  if (state.gaugesError && !state.gauges.length) {
    return `<section class="panel__section">${secTitle('Nearest river gage')}
      <p class="panel__error">Gage network didn't answer. Readings resume on the next 15-minute sweep.</p></section>`;
  }
  if (!state.gauges.length) {
    return `<section class="panel__section">${secTitle('Nearest river gage')}
      <p class="panel__pending">Contacting gage network…</p></section>`;
  }
  const nearest = state.gauges.reduce<{ g: GaugeReading; km: number } | null>((best, g) => {
    const km = haversineKm(site.lngLat, g.lngLat);
    return !best || km < best.km ? { g, km } : best;
  }, null)!;

  const reading = [
    nearest.g.dischargeCfs !== null ? `${formatNumber(nearest.g.dischargeCfs)} cfs` : 'no flow value',
    nearest.g.gageHeightFt !== null ? `${nearest.g.gageHeightFt.toFixed(2)} ft stage` : '',
  ].filter(Boolean).join(' · ');

  const spark = sparklineSvg(nearest.g.spark);
  const sparkCol = spark
    ? `<span class="gaugecard__sparkcol">${spark}<span class="gaugecard__sparklabel">LAST 24 H</span></span>`
    : '';

  return `<section class="panel__section">${secTitle('Nearest river gage')}
    <div class="gaugecard">
      <div class="gaugecard__row">
        <span class="gaugecard__name">${esc(nearest.g.shortName)}</span>
        <span class="gaugecard__dist">${formatMiles(nearest.km)} away</span>
      </div>
      <div class="gaugecard__body">
        <span class="gaugecard__readcol">
          <span class="gaugecard__reading mono">${esc(reading)}</span>
          <span class="gaugecard__sub">${chip(nearest.g.observedAt)} ${esc(relativeTime(nearest.g.observedAt))}</span>
        </span>
        ${sparkCol}
      </div>
    </div></section>`;
}

function snowSection(site: Site): string {
  if (state.snowError && !state.snow.length) {
    return `<section class="panel__section">${secTitle('Snowpack')}
      <p class="panel__error">Snow sensors didn't answer. Next sweep within 6 hours.</p></section>`;
  }
  if (!state.snow.length) {
    return `<section class="panel__section">${secTitle('Snowpack')}
      <p class="panel__pending">Contacting snow sensors…</p></section>`;
  }
  const nearest = state.snow.reduce((best, s) =>
    haversineKm(site.lngLat, s.lngLat) < haversineKm(site.lngLat, best.lngLat) ? s : best,
  );
  const km = haversineKm(site.lngLat, nearest.lngLat);

  const melted = (nearest.sweIn ?? 0) <= 0 && (nearest.depthIn ?? 0) <= 0;
  const reading = melted
    ? 'Sensors read zero — melted out for the season.'
    : [
        nearest.sweIn != null ? `${nearest.sweIn.toFixed(2)} in SWE` : '',
        nearest.depthIn != null ? `${Math.round(nearest.depthIn)} in depth` : '',
      ].filter(Boolean).join(' · ');

  return `<section class="panel__section">${secTitle('Snowpack')}
    <div class="gaugecard gaugecard--snow">
      <div class="gaugecard__row">
        <span class="gaugecard__name">${esc(nearest.name)} · ${formatNumber(nearest.elevFt)} FT</span>
        <span class="gaugecard__dist">${formatMiles(km)} away</span>
      </div>
      <div class="gaugecard__body">
        <span class="gaugecard__readcol">
          <span class="gaugecard__reading mono">${esc(reading)}</span>
          <span class="gaugecard__sub">${chip(nearest.observedAt)} posted ${esc(relativeTime(nearest.observedAt))}</span>
        </span>
      </div>
    </div></section>`;
}

const ROAD_LABEL: Record<string, string> = { open: 'OPEN', chains: 'CHAINS', closed: 'CLOSED' };

function roadsSection(): string {
  if (state.roadsError && !state.roads.length) {
    return `<section class="panel__section">${secTitle('Roads & access')}
      <p class="panel__error">Caltrans didn't answer. Next sweep in 20 min — or call 1-800-427-7623.</p></section>`;
  }
  if (!state.roads.length) {
    return `<section class="panel__section">${secTitle('Roads & access')}
      <p class="panel__pending">Checking the highway wire…</p></section>`;
  }
  const rows = state.roads
    .map(
      (r) => `
      <li class="roadrow">
        <span class="roadrow__name mono">${esc(r.corridor)}</span>
        <span class="roadchip roadchip--${esc(r.status)}">${ROAD_LABEL[r.status]}</span>
        <span class="roadrow__summary">${esc(r.summary)}</span>
      </li>`,
    )
    .join('');
  const asOf = state.roads[0]?.observedAt
    ? `<p class="roadrow__asof mono">CALTRANS WIRE · ${esc(relativeTime(state.roads[0].observedAt).toUpperCase())}</p>`
    : '';
  return `<section class="panel__section">${secTitle('Roads & access')}
    <ul class="roadlist">${rows}</ul>${asOf}</section>`;
}

function alertSection(site: Site): string {
  const alerts = state.alertsBySite.get(site.id);
  let body: string;
  if (alerts === undefined) {
    body = `<p class="panel__pending">Checking the weather wire…</p>`;
  } else if (alerts === 'error') {
    body = `<p class="panel__error">Weather alert check failed. Close and reopen this site to retry.</p>`;
  } else if (!alerts.length) {
    body = `<p class="panel__empty">No active weather alerts for this point.</p>`;
  } else {
    body = alerts
      .map(
        (a) => `
      <div class="alertcard alertcard--${esc(a.severity.toLowerCase())}">
        <span class="alertcard__event">${esc(a.event)}</span>
        <span class="alertcard__headline">${esc(a.headline)}</span>
        ${a.ends ? `<span class="alertcard__ends">until ${esc(absoluteTime(a.ends))}</span>` : ''}
      </div>`,
      )
      .join('');
  }
  return `<section class="panel__section">${secTitle('Weather alerts')}${body}</section>`;
}

function hazardSection(site: Site): string {
  const within = (fs: FmFeature[]) =>
    fs
      .map((f) => ({ f, km: haversineKm(site.lngLat, f.lngLat) }))
      .filter((x) => x.km <= HAZARD_RADIUS_KM)
      .sort((a, b) => a.km - b.km);

  const quakes = within(state.quakes);
  const fires = within(allFires());

  const fireLabel = (f: FmFeature): string => {
    const p = f.props as Record<string, unknown>;
    if (p.kind === 'detection') {
      const frp = p.frp != null ? ` · FRP ${Number(p.frp).toFixed(1)} MW` : '';
      return `VIIRS thermal detection${frp}`;
    }
    if (p.kind === 'incident') {
      const acres = p.sizeAcres != null ? ` · ${Math.round(Number(p.sizeAcres))} ac` : '';
      return `${p.title} (${p.typeLabel})${acres}`;
    }
    return String(p.title);
  };

  const fireLine = fires.length
    ? fires
        .slice(0, 3)
        .map(
          ({ f, km }) =>
            `<li><span class="haz haz--fire" aria-hidden="true"></span>${esc(fireLabel(f))} — ${formatMiles(km)} ${chip(f.observedAt)}</li>`,
        )
        .join('')
    : `<li class="panel__empty">No fire activity within ${formatMiles(HAZARD_RADIUS_KM)}.</li>`;

  const quakeLine = quakes.length
    ? quakes
        .slice(0, 2)
        .map(
          ({ f, km }) =>
            `<li><span class="haz haz--quake" aria-hidden="true"></span>M ${esc(Number(f.props.mag).toFixed(1))} ${esc(f.props.place)} — ${formatMiles(km)} ${chip(f.observedAt)}</li>`,
        )
        .join('')
    : `<li class="panel__empty">No earthquakes above the noise floor within ${formatMiles(HAZARD_RADIUS_KM)} in 30 days.</li>`;

  return `<section class="panel__section">${secTitle('Fire & seismic')}
    <ul class="hazlist">${fireLine}${quakeLine}</ul></section>`;
}

function sightingsSection(site: Site): string {
  const pool = allSightings();
  if (state.sightingsError && !pool.length) {
    return `<section class="panel__section">${secTitle('Recent sightings')}
      <p class="panel__error">iNaturalist didn't answer. Reload the page to refetch sightings.</p></section>`;
  }
  if (!pool.length) {
    return `<section class="panel__section">${secTitle('Recent sightings')}
      <p class="panel__pending">Pulling the sightings log…</p></section>`;
  }

  const nearest = pool
    .map((f) => ({ f, km: haversineKm(site.lngLat, f.lngLat) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, NEARBY_SIGHTINGS);

  if (!nearest.length) {
    return `<section class="panel__section">${secTitle('Recent sightings')}
      <p class="panel__empty">No research-grade sightings cached in range. The log refreshes every 30 minutes.</p></section>`;
  }

  const rows = nearest
    .map(({ f, km }) => {
      const p = f.props as Record<string, string | null>;
      const img = p.photo
        ? `<img class="sight__photo" src="${esc(p.photo)}" alt="Photo of ${esc(p.commonName)}" loading="lazy" />`
        : `<span class="sight__photo sight__photo--none" aria-hidden="true">∅</span>`;
      return `
      <li class="sight">
        ${img}
        <div class="sight__body">
          <span class="sight__name">${esc(p.commonName)}</span>
          <span class="sight__meta mono">${esc(p.group)} · ${formatMiles(km)} · ${esc(relativeTime(f.observedAt))}</span>
          <span class="sight__credit">${chip(f.observedAt)} ${esc(f.attribution)} · ${esc(f.license)}</span>
        </div>
      </li>`;
    })
    .join('');

  return `<section class="panel__section">${secTitle('Recent sightings')}
    <ul class="sightlist">${rows}</ul></section>`;
}
