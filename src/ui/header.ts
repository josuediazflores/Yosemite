import { HEADER_GAUGE_ID, freshnessOf } from '../model';
import { formatNumber, relativeTime } from '../format';
import { on, state } from '../state';

// The signature element: a gauge-station readout for Merced @ Happy Isles.
// Pulses gently when a new reading lands (suppressed under reduced motion).

let readoutEl: HTMLElement;
let bannerEl: HTMLElement;
let lastObservedAt: string | null = null;

export function initHeader(readout: HTMLElement, banner: HTMLElement): void {
  readoutEl = readout;
  bannerEl = banner;
  render();
  renderBanner();
  on('gauges', render);
  on('park-alerts', renderBanner);
  // Re-render every 30 s so the reading's age stays honest without refetching.
  setInterval(render, 30_000);
}

function render(): void {
  const gauge = state.gauges.find((g) => g.siteId === HEADER_GAUGE_ID);

  if (!gauge) {
    readoutEl.innerHTML = state.gaugesError
      ? `<div class="gauge gauge--down">
           <span class="gauge__station">MERCED R · HAPPY ISLES · STN ${HEADER_GAUGE_ID}</span>
           <span class="gauge__error">Gage didn't answer. Next sweep in 15 min.</span>
         </div>`
      : `<div class="gauge">
           <span class="gauge__station">MERCED R · HAPPY ISLES · STN ${HEADER_GAUGE_ID}</span>
           <span class="gauge__error">Contacting gage…</span>
         </div>`;
    return;
  }

  const fresh = freshnessOf(gauge.observedAt);
  const isNew = gauge.observedAt !== lastObservedAt && lastObservedAt !== null;
  lastObservedAt = gauge.observedAt;

  readoutEl.innerHTML = `
    <div class="gauge${fresh === 'live' ? ' gauge--live' : ''}">
      <span class="gauge__station">MERCED R · HAPPY ISLES · STN ${HEADER_GAUGE_ID}</span>
      <span class="gauge__values">
        <span class="gauge__cell">
          <span class="gauge__num">${gauge.dischargeCfs !== null ? formatNumber(gauge.dischargeCfs) : '——'}</span>
          <span class="gauge__unit">CFS</span>
        </span>
        <span class="gauge__cell">
          <span class="gauge__num">${gauge.gageHeightFt !== null ? gauge.gageHeightFt.toFixed(2) : '——'}</span>
          <span class="gauge__unit">FT STAGE</span>
        </span>
        <span class="gauge__cell gauge__cell--status">
          <span class="gauge__dot" aria-hidden="true"></span>
          <span class="gauge__age">${fresh === 'live' ? 'LIVE' : 'STALE'} · ${relativeTime(gauge.observedAt)}</span>
        </span>
      </span>
    </div>`;

  if (isNew) {
    const g = readoutEl.querySelector('.gauge');
    g?.classList.add('gauge--pulse');
    setTimeout(() => g?.classList.remove('gauge--pulse'), 1600);
  }
}

function renderBanner(): void {
  // NWS weather alerts lead; NPS Danger/Closure bulletins count alongside.
  const closures = state.npsBulletins.filter(
    (b) => b.category === 'Danger' || b.category === 'Park Closure',
  );
  const items: { tag: string; text: string }[] = [
    ...state.parkAlerts.map((a) => ({ tag: 'ALERT', text: `${a.event}: ${a.headline}` })),
    ...closures.map((b) => ({ tag: 'PARK', text: `${b.category}: ${b.title}` })),
  ];
  if (!items.length) {
    bannerEl.hidden = true;
    return;
  }
  bannerEl.hidden = false;
  const first = items[0];
  const more = items.length > 1 ? ` · +${items.length - 1} more in the detail panels` : '';
  bannerEl.innerHTML = `<span class="banner__tag">${escapeHtml(first.tag)}</span> ${escapeHtml(first.text)}${more}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
