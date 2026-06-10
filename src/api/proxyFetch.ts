import { MissingKeyError } from '../model';

// Shared fetch for keyed sources routed through the dev-server proxy.
// A 503 {error:'missing-key'} from the proxy means the .env slot is empty —
// the module sleeps rather than erroring.
export async function proxyFetch(path: string): Promise<Response> {
  const res = await fetch(path);
  if (res.status === 503) {
    const body = await res.json().catch(() => null);
    if (body?.error === 'missing-key') throw new MissingKeyError(body.envVar ?? 'unknown');
  }
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res;
}
