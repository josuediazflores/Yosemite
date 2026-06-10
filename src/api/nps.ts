import type { NpsBulletin } from '../model';
import { proxyFetch } from './proxyFetch';

// Official NPS alerts for Yosemite (closures, danger, caution, information).
// Park-wide, not point-based — these are bulletins, not map features.
export async function fetchNpsBulletins(): Promise<NpsBulletin[]> {
  const res = await proxyFetch('/proxy/nps/alerts?parkCode=yose&limit=50');
  const json = await res.json();
  return (json.data ?? []).map((a: any): NpsBulletin => ({
    id: a.id,
    title: a.title,
    category: a.category ?? 'Information',
    description: a.description ?? '',
    url: a.url || null,
  }));
}
