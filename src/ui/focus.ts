import type { Site } from '../model';
import { HEADER_GAUGE_ID } from '../model';
import { formatMiles, formatNumber, haversineKm } from '../format';
import { allSightings, on, selectSite, state } from '../state';
import { enterFocusStyle, exitFocusStyle } from '../map';

// Focus mode: selecting a site swaps the console for a full-bleed dark
// presentation — desaturated terrain, the chosen site in signal red among
// small ringed dots, and a left rail of big mono stats. ✕ returns to browse.

let overlayEl: HTMLElement;
let lastSiteId: string | null = null;

const SIGHTING_RADIUS_KM = 8; // ~5 mi

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

export function initFocus(el: HTMLElement): void {
  overlayEl = el;
  on('selection', render);
  on('site-data', render);
  on('gauges', render);
  on('sightings', render);
  on('park-alerts', render);
  on('modules', render);
  on('layers', render);

  overlayEl.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-focus-close]')) selectSite(null);
    if (t.closest('[data-focus-report]')) document.body.classList.toggle('show-report');
  });
}

function statRow(num: string, unit: string, label: string): string {
  return `<div class="focus__stat">
    <span class="focus__num">${esc(num)}</span>${unit ? `<span class="focus__unit">${esc(unit)}</span>` : ''}
    <span class="focus__label">— ${esc(label)}</span>
  </div>`;
}

function buildStats(site: Site): string {
  const rows: string[] = [];

  // Air quality: observed AirNow outranks the model, same as the panel.
  const airnow = state.airnowBySite.get(site.id);
  const modeled = state.aqiBySite.get(site.id);
  if (airnow && airnow !== 'error' && airnow !== 'unavailable') {
    rows.push(statRow(String(Math.round(airnow.aqi)), '', 'US AQI · OBSERVED'));
  } else if (modeled && modeled !== 'error') {
    rows.push(statRow(String(Math.round(modeled.usAqi)), '', 'US AQI · MODELED'));
  }
  if (modeled && modeled !== 'error' && modeled.pm25 != null) {
    rows.push(statRow(String(modeled.pm25), 'µg/m³', 'PM2.5'));
  }

  // Nearest gage.
  if (state.gauges.length) {
    const nearest = state.gauges.reduce((best, g) =>
      haversineKm(site.lngLat, g.lngLat) < haversineKm(site.lngLat, best.lngLat) ? g : best,
    );
    if (nearest.dischargeCfs != null) {
      rows.push(statRow(formatNumber(nearest.dischargeCfs), 'CFS', 'RIVER FLOW'));
    }
    if (nearest.gageHeightFt != null) {
      rows.push(statRow(nearest.gageHeightFt.toFixed(2), 'FT', 'GAGE STAGE'));
    }
    rows.push(statRow(formatMiles(haversineKm(site.lngLat, nearest.lngLat)), '', 'TO GAGE'));
  }

  const nearby = allSightings().filter(
    (f) => haversineKm(site.lngLat, f.lngLat) <= SIGHTING_RADIUS_KM,
  ).length;
  rows.push(statRow(String(nearby), '', 'SIGHTINGS · 5 MI'));

  const siteAlerts = state.alertsBySite.get(site.id);
  const nwsCount = Array.isArray(siteAlerts) ? siteAlerts.length : 0;
  const npsUrgent = state.npsBulletins.filter(
    (b) => b.category === 'Danger' || b.category === 'Park Closure',
  ).length;
  rows.push(statRow(String(nwsCount + npsUrgent), '', 'ACTIVE ALERTS'));

  if (site.kind === 'campground') {
    const info = state.campgroundInfo.get(site.id);
    if (info?.totalSites) rows.push(statRow(String(info.totalSites), '', 'CAMPSITES'));
  } else if (site.elevFt != null) {
    rows.push(statRow(formatNumber(site.elevFt), 'FT', 'ELEVATION'));
  }

  return rows.slice(0, 7).join('');
}

function render(): void {
  const site = state.sites.find((s) => s.id === state.selectedSiteId);

  if (!site) {
    if (lastSiteId !== null) {
      document.body.classList.remove('focus-mode', 'show-report');
      overlayEl.hidden = true;
      overlayEl.innerHTML = '';
      exitFocusStyle();
      lastSiteId = null;
    }
    return;
  }

  const entering = lastSiteId === null;
  lastSiteId = site.id;
  document.body.classList.add('focus-mode');
  if (entering) document.body.classList.remove('show-report');
  enterFocusStyle();

  const date = new Date()
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    .toUpperCase();

  overlayEl.hidden = false;
  overlayEl.innerHTML = `
    <button class="focus__close" type="button" data-focus-close aria-label="Close focus view">✕</button>
    <div class="focus__title">
      <h2>${esc(site.name)}</h2>
      <p class="mono">${esc(date)} · STN ${HEADER_GAUGE_ID}</p>
    </div>
    <div class="focus__rail">
      <div class="focus__rule"></div>
      ${buildStats(site)}
      <div class="focus__rule"></div>
      <button class="focus__report mono" type="button" data-focus-report>FULL REPORT →</button>
    </div>`;

  if (entering) (overlayEl.querySelector('[data-focus-close]') as HTMLElement)?.focus();
}
