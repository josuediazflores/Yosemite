// Vercel serverless mirror of the dev-server key proxy (vite.config.ts).
// Same /proxy/* contract (vercel.json rewrites /proxy/* here), same
// missing-key sentinel, so the client and its dormant-module behavior are
// identical in dev and production. Keys live in Vercel env vars — encrypted,
// server-side, never in the bundle.
//
// KEEP THE ROUTE TABLE IN SYNC with vite.config.ts.

const PARK_FIRMS_BBOX = '-119.95,37.45,-119.15,38.25';

const ROUTES = {
  nps: {
    envVar: 'NPS_API_KEY',
    build: (rest, key) => `https://developer.nps.gov/api/v1${rest}${rest.includes('?') ? '&' : '?'}api_key=${key}`,
    cache: 300,
  },
  airnow: {
    envVar: 'AIRNOW_API_KEY',
    build: (rest, key) => `https://www.airnowapi.org/aq${rest}${rest.includes('?') ? '&' : '?'}API_KEY=${key}`,
    cache: 600,
  },
  ebird: {
    envVar: 'EBIRD_API_KEY',
    build: (rest) => `https://api.ebird.org/v2${rest}`,
    headers: (key) => ({ 'X-eBirdApiToken': key }),
    cache: 900,
  },
  firms: {
    envVar: 'FIRMS_MAP_KEY',
    build: (_rest, key) =>
      `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/VIIRS_NOAA20_NRT/${PARK_FIRMS_BBOX}/2`,
    cache: 1800,
  },
  roads: {
    build: (rest) => `https://roads.dot.ca.gov/roadscell.php${rest.startsWith('/?') ? rest.slice(1) : rest}`,
    cache: 300,
  },
  cdec: {
    build: (rest) => `https://cdec.water.ca.gov/dynamicapp/req/JSONDataServlet${rest.startsWith('/?') ? rest.slice(1) : rest}`,
    cache: 1800,
  },
  recgov: {
    build: (rest) => `https://www.recreation.gov/api${rest}`,
    headers: () => ({ 'User-Agent': 'Mozilla/5.0 (Macintosh) ouzel-field-monitor/personal' }),
    cache: 1800,
  },
};

export default async function handler(req, res) {
  // The rewrite flattens /proxy/<route>/<rest>?<query> into
  // /api/proxy?path=<route>/<rest>&<query> — no catch-all routing needed.
  const url = new URL(req.url, 'http://x');
  const segments = (url.searchParams.get('path') ?? '').split('/').filter(Boolean);
  url.searchParams.delete('path');
  const routeKey = segments.shift();
  const route = ROUTES[routeKey];
  if (!route) {
    res.status(404).json({ error: 'unknown-route' });
    return;
  }

  const key = route.envVar ? process.env[route.envVar] : '';
  if (route.envVar && !key) {
    res.status(503).json({ error: 'missing-key', envVar: route.envVar });
    return;
  }

  // Vercel's rewrite merge can duplicate incoming params — keep first wins.
  // (recreation.gov hard-rejects requests with repeated query parameters.)
  const seen = new Set();
  const parts = [];
  for (const [k, v] of url.searchParams) {
    if (seen.has(k)) continue;
    seen.add(k);
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  const rest = `/${segments.join('/')}${parts.length ? `?${parts.join('&')}` : ''}`;
  try {
    const upstream = await fetch(route.build(rest, key), {
      headers: {
        'User-Agent': 'ouzel-yosemite-field-monitor (vercel proxy)',
        ...(route.headers ? route.headers(key) : {}),
      },
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/octet-stream');
    // Let Vercel's edge cache absorb repeat traffic — polite to the sources.
    res.setHeader('Cache-Control', `s-maxage=${route.cache}, stale-while-revalidate=60`);
    res.send(body);
  } catch {
    res.status(502).json({ error: 'upstream-failed' });
  }
}
