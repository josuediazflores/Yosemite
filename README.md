# Yosemite Field Monitor

Pick a spot in Yosemite and see what's around it right now: air quality, recent
wildlife sightings, live river conditions, and fire/weather/seismic hazards,
layered on a USGS topographic map. Every reading is honest about how fresh it is.

## Run

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # static output in dist/
```

Pure static client app — no backend, no API keys. Every Phase 1 source is
keyless and CORS-friendly, so the browser calls them directly.

## Data sources

| Layer | Source | Cadence | License |
|---|---|---|---|
| Basemap | USGS The National Map (USGSTopo) | static tiles | public domain |
| River readout | USGS NWIS IV — gauges 11264500, 11266500, 11276500 | poll 15 min | public domain |
| Sightings | iNaturalist API (research grade, park-wide) | 30-min localStorage cache | per-observation (varies) |
| Air quality | Open-Meteo Air Quality (US AQI, CAMS model) | 30-min cache per site | CC BY 4.0 |
| Weather alerts | NWS api.weather.gov | 10-min cache per point | public domain |
| Earthquakes | USGS FDSN (80 km, 30 days) | hourly | public domain |
| Wildfires | NASA EONET open events | hourly | public domain |
| Boundary / trails / sites | NPS boundary service, OSM via Overpass, hand-curated | frozen in `public/data/` | ODbL (trails) |

## Conventions

- **Coordinates are always `[lng, lat]`.** Lat-first sources (NWIS, the NWS
  `point=` param) are flipped at ingestion, never downstream.
- **Freshness tiers** are derived from the observation timestamp at render
  time: `live` ≤ 1 h, `recent` ≤ 14 d, `historical` beyond. Live readings pulse,
  recent renders solid, archive renders hollow/faded.
- Every feature carries its own `license` and `attribution` (iNaturalist photo
  licenses differ per observation).
- iNaturalist is fetched once park-wide and filtered by distance on the client —
  never re-queried per click (rate-limit etiquette).
- Overpass trail data is frozen into `public/data/trails.geojson`; regenerate
  manually if needed, never fetch in the live path.

## Phase 2 — keyed sources

Keyed sources run through a dev-server proxy (`vite.config.ts`) that attaches
keys from a gitignored `.env`, so they never enter the client bundle. Copy
`.env.example` to `.env`, add any keys you want, restart `npm run dev` — each
module lights up on its own; missing keys leave that module dormant, never
broken. Keys are dev-mode only for now; a deploy later swaps the proxy for a
scheduled fetch-and-freeze job or a serverless function with the same paths.

| Module | Adds | Key signup |
|---|---|---|
| NPS | Official park bulletins (closures, danger) in banner + panel | nps.gov/subjects/developer |
| FIRMS | VIIRS thermal detections on the fire layer (hourly) | firms.modaps.eosdis.nasa.gov/api/map_key |
| AirNow | Observed AQI, outranks the Open-Meteo model in the panel | docs.airnowapi.org/account/request |
| eBird | Recent bird observations merged into sightings | ebird.org/api/keygen |

Keyless Phase 2 additions that work today: NIFC/WFIGS incidents + fire
perimeters (wildfire vs prescribed-burn labeled), and a recency-weighted
sightings heatmap toggle.

Still out: Recreation.gov (needs its own availability UI — future work) and
the Keep Bears Wild tracker (no public API, real terms friction — stays out
unless the Yosemite Conservancy grants permission).
