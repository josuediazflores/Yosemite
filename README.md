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

## Phase 2 (not built)

Keyed sources (NPS alerts, NASA FIRMS, AirNow, eBird, Recreation.gov) need a
server-side proxy so keys stay private. The Keep Bears Wild tracker has no
public API and real terms friction — it stays out unless the Yosemite
Conservancy grants permission.
