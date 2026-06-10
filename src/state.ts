import type { AqiReading, FmFeature, GaugeReading, LayerId, NwsAlert, Site } from './model';

// One small store; views subscribe to named events instead of a framework.
type Listener = () => void;

export interface AppState {
  sites: Site[];
  selectedSiteId: string | null;
  layers: Record<LayerId, boolean>;
  gauges: GaugeReading[];
  gaugesError: boolean;
  sightings: FmFeature[];
  sightingsError: boolean;
  quakes: FmFeature[];
  fires: FmFeature[];
  parkAlerts: NwsAlert[];
  aqiBySite: Map<string, AqiReading | 'error'>;
  alertsBySite: Map<string, NwsAlert[] | 'error'>;
}

export const state: AppState = {
  sites: [],
  selectedSiteId: null,
  layers: { sites: true, sightings: true, fire: true, hazards: true },
  gauges: [],
  gaugesError: false,
  sightings: [],
  sightingsError: false,
  quakes: [],
  fires: [],
  parkAlerts: [],
  aqiBySite: new Map(),
  alertsBySite: new Map(),
};

export type StateEvent =
  | 'gauges'
  | 'sightings'
  | 'quakes'
  | 'fires'
  | 'park-alerts'
  | 'selection'
  | 'layers'
  | 'site-data';

const listeners = new Map<StateEvent, Set<Listener>>();

export function on(event: StateEvent, fn: Listener): void {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(fn);
}

export function emit(event: StateEvent): void {
  listeners.get(event)?.forEach((fn) => fn());
}

export function selectSite(id: string | null): void {
  if (state.selectedSiteId === id) return;
  state.selectedSiteId = id;
  emit('selection');
}

export function toggleLayer(layer: LayerId, visible: boolean): void {
  state.layers[layer] = visible;
  emit('layers');
}
