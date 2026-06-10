import type { FmFeature } from '../model';
import { PARK_BBOX } from '../model';

// NIFC / WFIGS interagency feeds — keyless, CORS-open ArcGIS services.
// Incident points label wildfires vs prescribed burns; perimeter polygons
// draw the actual footprint when one exists.
const PAD = 0.5;
const ENVELOPE = `${PARK_BBOX.west - PAD},${PARK_BBOX.south - PAD},${PARK_BBOX.east + PAD},${PARK_BBOX.north + PAD}`;
const BASE = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services';

const GEO_PARAMS =
  `geometry=${ENVELOPE}&geometryType=esriGeometryEnvelope&inSR=4326` +
  `&spatialRel=esriSpatialRelIntersects&where=1%3D1&f=geojson`;

const TYPE_LABEL: Record<string, string> = {
  WF: 'Wildfire',
  RX: 'Prescribed burn',
  CX: 'Complex',
};

export async function fetchNifcIncidents(): Promise<FmFeature[]> {
  const url =
    `${BASE}/WFIGS_Incident_Locations_Current/FeatureServer/0/query?${GEO_PARAMS}` +
    `&outFields=IncidentName,FireDiscoveryDateTime,IncidentSize,PercentContained,IncidentTypeCategory`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NIFC incidents ${res.status}`);
  const json = await res.json();

  return (json.features ?? [])
    .filter((f: any) => f.geometry?.type === 'Point')
    .map((f: any): FmFeature => {
      const p = f.properties ?? {};
      return {
        id: `nifc-${p.IncidentName}-${p.FireDiscoveryDateTime}`,
        source: 'nifc',
        layer: 'fire',
        lngLat: [f.geometry.coordinates[0], f.geometry.coordinates[1]],
        observedAt: p.FireDiscoveryDateTime ? new Date(p.FireDiscoveryDateTime).toISOString() : null,
        license: 'public domain',
        attribution: 'NIFC / WFIGS',
        props: {
          kind: 'incident',
          title: p.IncidentName ?? 'Unnamed incident',
          typeLabel: TYPE_LABEL[p.IncidentTypeCategory] ?? p.IncidentTypeCategory ?? 'Incident',
          sizeAcres: p.IncidentSize ?? null,
          contained: p.PercentContained ?? null,
        },
      };
    });
}

export async function fetchNifcPerimeters(): Promise<GeoJSON.FeatureCollection> {
  const url =
    `${BASE}/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query?${GEO_PARAMS}` +
    `&outFields=attr_IncidentName,attr_IncidentSize,attr_FireDiscoveryDateTime`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NIFC perimeters ${res.status}`);
  return (await res.json()) as GeoJSON.FeatureCollection;
}
