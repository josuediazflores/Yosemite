import './styles.css';
import { PARK_CENTER } from './model';
import type { Site } from './model';
import { emit, on, state } from './state';
import { initMap, renderSiteMarkers } from './map';
import { initHeader } from './ui/header';
import { initLayerControl } from './ui/layers';
import { initPanel } from './ui/panel';
import { fetchGauges } from './api/usgsWater';
import { fetchSightings } from './api/inaturalist';
import { fetchAqi } from './api/openMeteoAqi';
import { fetchAlerts } from './api/nwsAlerts';
import { fetchQuakes } from './api/earthquakes';
import { fetchFires } from './api/eonet';

const GAUGE_POLL_MS = 15 * 60 * 1000;
const HAZARD_POLL_MS = 60 * 60 * 1000;
const PARK_ALERT_POLL_MS = 20 * 60 * 1000;

async function boot(): Promise<void> {
  const res = await fetch('/data/sites.json');
  const { sites } = (await res.json()) as { sites: Site[] };
  state.sites = sites;

  initMap(document.getElementById('map')!);
  renderSiteMarkers(sites);
  initHeader(document.getElementById('gauge-readout')!, document.getElementById('alert-banner')!);
  initLayerControl(document.getElementById('layer-control')!);
  initPanel(document.getElementById('panel')!);

  // Selecting a site triggers its per-point fetches (each cached in its module).
  on('selection', () => {
    const site = state.sites.find((s) => s.id === state.selectedSiteId);
    if (site) loadSiteData(site);
  });

  pollGauges();
  setInterval(pollGauges, GAUGE_POLL_MS);
  pollHazards();
  setInterval(pollHazards, HAZARD_POLL_MS);
  pollParkAlerts();
  setInterval(pollParkAlerts, PARK_ALERT_POLL_MS);
  loadSightings();
}

async function pollGauges(): Promise<void> {
  try {
    state.gauges = await fetchGauges();
    state.gaugesError = false;
  } catch (err) {
    console.error('[yfm] gauges', err);
    state.gaugesError = true;
  }
  emit('gauges');
}

async function loadSightings(): Promise<void> {
  try {
    state.sightings = await fetchSightings();
    state.sightingsError = false;
  } catch (err) {
    console.error('[yfm] sightings', err);
    state.sightingsError = true;
  }
  emit('sightings');
}

async function pollHazards(): Promise<void> {
  const [quakes, fires] = await Promise.allSettled([fetchQuakes(), fetchFires()]);
  if (quakes.status === 'fulfilled') {
    state.quakes = quakes.value;
  } else {
    console.error('[yfm] quakes', quakes.reason);
  }
  if (fires.status === 'fulfilled') {
    state.fires = fires.value;
  } else {
    console.error('[yfm] fires', fires.reason);
  }
  emit('quakes');
  emit('fires');
}

async function pollParkAlerts(): Promise<void> {
  try {
    state.parkAlerts = await fetchAlerts(PARK_CENTER);
  } catch (err) {
    console.error('[yfm] park alerts', err);
  }
  emit('park-alerts');
}

async function loadSiteData(site: Site): Promise<void> {
  const [aqi, alerts] = await Promise.allSettled([fetchAqi(site.lngLat), fetchAlerts(site.lngLat)]);
  state.aqiBySite.set(site.id, aqi.status === 'fulfilled' ? aqi.value : 'error');
  state.alertsBySite.set(site.id, alerts.status === 'fulfilled' ? alerts.value : 'error');
  if (aqi.status === 'rejected') console.error('[yfm] aqi', aqi.reason);
  if (alerts.status === 'rejected') console.error('[yfm] site alerts', alerts.reason);
  // Only repaint if this site is still the one on screen.
  if (state.selectedSiteId === site.id) emit('site-data');
}

boot().catch((err) => {
  console.error('[yfm] boot failed', err);
  document.getElementById('gauge-readout')!.innerHTML =
    `<div class="gauge gauge--down"><span class="gauge__error">The console failed to start. Reload the page.</span></div>`;
});
