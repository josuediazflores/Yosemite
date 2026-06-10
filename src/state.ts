import type {
  AirnowReading,
  AqiReading,
  CampgroundInfo,
  FmFeature,
  GaugeReading,
  LayerId,
  ModuleId,
  ModuleStatus,
  NpsBulletin,
  NwsAlert,
  Site,
} from './model';

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
  // Phase 2
  modules: Record<ModuleId, ModuleStatus>;
  npsBulletins: NpsBulletin[];
  campgroundInfo: Map<string, CampgroundInfo>;
  firmsDetections: FmFeature[];
  nifcIncidents: FmFeature[];
  nifcPerimeters: GeoJSON.FeatureCollection;
  ebirdSightings: FmFeature[];
  airnowBySite: Map<string, AirnowReading | 'error' | 'unavailable'>;
}

export const state: AppState = {
  sites: [],
  selectedSiteId: null,
  layers: { sites: true, camps: true, sightings: true, fire: true, hazards: true, heat: false },
  gauges: [],
  gaugesError: false,
  sightings: [],
  sightingsError: false,
  quakes: [],
  fires: [],
  parkAlerts: [],
  aqiBySite: new Map(),
  alertsBySite: new Map(),
  modules: { nps: 'pending', firms: 'pending', airnow: 'pending', ebird: 'pending' },
  npsBulletins: [],
  campgroundInfo: new Map(),
  firmsDetections: [],
  nifcIncidents: [],
  nifcPerimeters: { type: 'FeatureCollection', features: [] },
  ebirdSightings: [],
  airnowBySite: new Map(),
};

export type StateEvent =
  | 'gauges'
  | 'sightings'
  | 'quakes'
  | 'fires'
  | 'park-alerts'
  | 'selection'
  | 'layers'
  | 'site-data'
  | 'modules';

/** All sightings (iNaturalist + eBird) for map + nearest-N queries. */
export function allSightings(): FmFeature[] {
  return [...state.sightings, ...state.ebirdSightings];
}

/** All fire features (EONET events + FIRMS detections + NIFC incidents). */
export function allFires(): FmFeature[] {
  return [...state.fires, ...state.firmsDetections, ...state.nifcIncidents];
}

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
