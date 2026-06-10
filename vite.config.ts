import { resolve } from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';

// Dev-server key proxy. Keys live in a gitignored .env and are attached
// server-side, so they never enter the client bundle. When this app deploys,
// each route below becomes either a scheduled fetch-and-freeze job or a
// serverless function with the same path contract — the client doesn't change.
interface ProxyRoute {
  mount: string;
  envVar: string;
  build: (path: string, key: string) => string;
  headers?: (key: string) => Record<string, string>;
}

const PARK_FIRMS_BBOX = '-119.95,37.45,-119.15,38.25'; // west,south,east,north

const ROUTES: ProxyRoute[] = [
  {
    mount: '/proxy/nps',
    envVar: 'NPS_API_KEY',
    build: (path, key) =>
      `https://developer.nps.gov/api/v1${path}${path.includes('?') ? '&' : '?'}api_key=${key}`,
  },
  {
    mount: '/proxy/airnow',
    envVar: 'AIRNOW_API_KEY',
    build: (path, key) =>
      `https://www.airnowapi.org/aq${path}${path.includes('?') ? '&' : '?'}API_KEY=${key}`,
  },
  {
    mount: '/proxy/ebird',
    envVar: 'EBIRD_API_KEY',
    build: (path) => `https://api.ebird.org/v2${path}`,
    headers: (key) => ({ 'X-eBirdApiToken': key }),
  },
  {
    // FIRMS wants the key in the URL path. Fixed park-wide query: VIIRS
    // NOAA-20 near-real-time detections, last 2 days.
    mount: '/proxy/firms',
    envVar: 'FIRMS_MAP_KEY',
    build: (_path, key) =>
      `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/VIIRS_NOAA20_NRT/${PARK_FIRMS_BBOX}/2`,
  },
];

function keyProxy(env: Record<string, string>): Plugin {
  return {
    name: 'yfm-key-proxy',
    configureServer(server) {
      for (const route of ROUTES) {
        server.middlewares.use(route.mount, async (req, res) => {
          const key = env[route.envVar];
          if (!key) {
            res.statusCode = 503;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'missing-key', envVar: route.envVar }));
            return;
          }
          try {
            const upstream = await fetch(route.build(req.url ?? '/', key), {
              headers: {
                'User-Agent': 'ouzel-yosemite-field-monitor (local dev tool)',
                ...(route.headers?.(key) ?? {}),
              },
            });
            res.statusCode = upstream.status;
            res.setHeader(
              'Content-Type',
              upstream.headers.get('content-type') ?? 'application/octet-stream',
            );
            res.end(Buffer.from(await upstream.arrayBuffer()));
          } catch {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'upstream-failed' }));
          }
        });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [keyProxy(env)],
    build: {
      rollupOptions: {
        input: {
          monitor: resolve(process.cwd(), 'index.html'),
          home: resolve(process.cwd(), 'home.html'),
        },
      },
    },
  };
});
