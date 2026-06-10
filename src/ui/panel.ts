import type { FmFeature, GaugeReading, Site } from '../model';
import { FRESHNESS_LABEL, freshnessOf } from '../model';
import { absoluteTime, aqiBand, formatCoords, formatMiles, formatNumber, haversineKm, relativeTime } from '../format';
import { on, selectSite, state } from '../state';

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
        <span class="panel__kind">${esc(site.kind)}</span>
        <h2 class="panel__name">${esc(site.name)}</h2>
        <p class="panel__coords">${formatCoords(site.lngLat)} · ${formatNumber(site.elevFt)} FT</p>
      </div>
      <button class="panel__close" type="button" data-close aria-label="Close site details">✕</button>
    </header>
    <p class="panel__blurb">${esc(site.blurb)}</p>
    ${aqiSection(site)}
    ${gaugeSection(site)}
    ${alertSection(site)}
    ${hazardSection(site)}
    ${sightingsSection(site)}
    <footer class="panel__credits">
      AQI modeled by Open-Meteo (CAMS). Sightings © their iNaturalist observers, licenses as marked.
      River data USGS NWIS, public domain. Alerts NWS. Fire events NASA EONET.
    </footer>`;

  if (wasHidden) panelEl.focus();
}

function aqiSection(site: Site): string {
  const aqi = state.aqiBySite.get(site.id);
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
  return `<section class="panel__section"><h3>Air quality · US AQI</h3>${body}</section>`;
}

function gaugeSection(site: Site): string {
  if (state.gaugesError && !state.gauges.length) {
    return `<section class="panel__section"><h3>Nearest river gage</h3>
      <p class="panel__error">Gage network didn't answer. Readings resume on the next 15-minute sweep.</p></section>`;
  }
  if (!state.gauges.length) {
    return `<section class="panel__section"><h3>Nearest river gage</h3>
      <p class="panel__pending">Contacting gage network…</p></section>`;
  }
  const nearest = state.gauges.reduce<{ g: GaugeReading; km: number } | null>((best, g) => {
    const km = haversineKm(site.lngLat, g.lngLat);
    return !best || km < best.km ? { g, km } : best;
  }, null)!;

  return `<section class="panel__section"><h3>Nearest river gage</h3>
    <div class="gaugecard">
      <div class="gaugecard__row">
        <span class="gaugecard__name">${esc(nearest.g.shortName)}</span>
        <span class="gaugecard__dist">${formatMiles(nearest.km)} away</span>
      </div>
      <div class="gaugecard__row gaugecard__row--data">
        <span class="mono">${nearest.g.dischargeCfs !== null ? `${formatNumber(nearest.g.dischargeCfs)} cfs` : 'no flow value'}</span>
        <span class="mono">${nearest.g.gageHeightFt !== null ? `${nearest.g.gageHeightFt.toFixed(2)} ft stage` : ''}</span>
        <span>${chip(nearest.g.observedAt)} ${esc(relativeTime(nearest.g.observedAt))}</span>
      </div>
    </div></section>`;
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
  return `<section class="panel__section"><h3>Weather alerts</h3>${body}</section>`;
}

function hazardSection(site: Site): string {
  const within = (fs: FmFeature[]) =>
    fs
      .map((f) => ({ f, km: haversineKm(site.lngLat, f.lngLat) }))
      .filter((x) => x.km <= HAZARD_RADIUS_KM)
      .sort((a, b) => a.km - b.km);

  const quakes = within(state.quakes);
  const fires = within(state.fires);

  const fireLine = fires.length
    ? fires
        .slice(0, 2)
        .map(
          ({ f, km }) =>
            `<li><span class="haz haz--fire" aria-hidden="true"></span>${esc(f.props.title)} — ${formatMiles(km)} ${chip(f.observedAt)}</li>`,
        )
        .join('')
    : `<li class="panel__empty">No open wildfire events within ${formatMiles(HAZARD_RADIUS_KM)}.</li>`;

  const quakeLine = quakes.length
    ? quakes
        .slice(0, 2)
        .map(
          ({ f, km }) =>
            `<li><span class="haz haz--quake" aria-hidden="true"></span>M ${esc(Number(f.props.mag).toFixed(1))} ${esc(f.props.place)} — ${formatMiles(km)} ${chip(f.observedAt)}</li>`,
        )
        .join('')
    : `<li class="panel__empty">No earthquakes above the noise floor within ${formatMiles(HAZARD_RADIUS_KM)} in 30 days.</li>`;

  return `<section class="panel__section"><h3>Fire & seismic</h3>
    <ul class="hazlist">${fireLine}${quakeLine}</ul></section>`;
}

function sightingsSection(site: Site): string {
  if (state.sightingsError && !state.sightings.length) {
    return `<section class="panel__section"><h3>Recent sightings</h3>
      <p class="panel__error">iNaturalist didn't answer. Reload the page to refetch sightings.</p></section>`;
  }
  if (!state.sightings.length) {
    return `<section class="panel__section"><h3>Recent sightings</h3>
      <p class="panel__pending">Pulling the sightings log…</p></section>`;
  }

  const nearest = state.sightings
    .map((f) => ({ f, km: haversineKm(site.lngLat, f.lngLat) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, NEARBY_SIGHTINGS);

  if (!nearest.length) {
    return `<section class="panel__section"><h3>Recent sightings</h3>
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

  return `<section class="panel__section"><h3>Recent sightings</h3>
    <ul class="sightlist">${rows}</ul></section>`;
}
