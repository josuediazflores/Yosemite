import type { NpsBulletin, RoadStatus } from '../model';

// Caltrans highway conditions (roadscell.php) for the three approach
// corridors. The feed is HTML around plain-caps condition text; the in-park
// Tioga segment is NPS jurisdiction, so that corridor derives from NPS
// closure bulletins instead.
const CORRIDORS: { roadnumber: string; corridor: string }[] = [
  { roadnumber: '120', corridor: 'CA-120 W · BIG OAK FLAT' },
  { roadnumber: '140', corridor: 'CA-140 · ARCH ROCK' },
  { roadnumber: '41', corridor: 'CA-41 · WAWONA' },
];

function htmlToLines(html: string): string[] {
  const noScript = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const text = noScript.replace(/<[^>]+>/g, '\n');
  return text
    .split('\n')
    .map((l) =>
      l
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&nbsp;|&#\d+;/gi, ' ') // stray entities (the feed loves &#160;)
        .trim(),
    )
    .filter(Boolean);
}

// "This highway information is the latest reported as of Wednesday, June
// 10th, 2026 at 01:39 AM." → ISO timestamp (feed times are Pacific).
function parseReportedAt(lines: string[]): string | null {
  const line = lines.find((l) => /latest reported as of/i.test(l));
  const m = line?.match(/as of \w+, (\w+) (\d+)\w*, (\d+) at (\d+):(\d+) (AM|PM)/i);
  if (!m) return null;
  const [, mon, day, year, hh, mm, ap] = m;
  let hour = Number(hh) % 12;
  if (ap.toUpperCase() === 'PM') hour += 12;
  const d = new Date(`${mon} ${day}, ${year} ${hour}:${mm}:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function deriveStatus(block: string): RoadStatus['status'] {
  if (/\bIS CLOSED\b|\bCLOSED\b/i.test(block) && !/1-way/i.test(block)) return 'closed';
  if (/CHAIN/i.test(block)) return 'chains';
  return 'open';
}

function conditionBlock(lines: string[], roadnumber: string): string {
  const start = lines.findIndex((l) => new RegExp(`^(SR|US|I)[- ]?${roadnumber}\\b`).test(l));
  if (start < 0) return '';
  const block: string[] = [];
  for (const line of lines.slice(start + 1)) {
    // Next route header or page footer ends the block.
    if (/^(SR|US|I)[- ]?\d+\b/.test(line) || /Caltrans|Copyright|Back to/i.test(line)) break;
    block.push(line);
  }
  return block.join(' ');
}

function summarize(block: string): string {
  const cleaned = block
    .replace(/\[[^\]]*\]/g, '') // area headers like [IN THE CENTRAL CALIFORNIA AREA]
    .replace(/For Yose\w+ Nat'l Park road information call [\d-]+\.?/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'No restrictions reported.';
  return cleaned.length > 150 ? `${cleaned.slice(0, cleaned.lastIndexOf(' ', 150))}…` : cleaned;
}

export async function fetchRoads(): Promise<RoadStatus[]> {
  // The Caltrans server occasionally drops one of a parallel burst — fetch
  // each corridor independently (with one retry) and keep whatever answered.
  const results = await Promise.allSettled(
    CORRIDORS.map(async ({ roadnumber, corridor }) => {
      let res = await fetch(`/proxy/roads?roadnumber=${roadnumber}`);
      if (!res.ok) res = await fetch(`/proxy/roads?roadnumber=${roadnumber}`);
      if (!res.ok) throw new Error(`roads ${roadnumber} → ${res.status}`);
      const lines = htmlToLines(await res.text());
      const block = conditionBlock(lines, roadnumber);
      return {
        corridor,
        status: deriveStatus(block),
        summary: summarize(block),
        observedAt: parseReportedAt(lines),
      } satisfies RoadStatus;
    }),
  );
  const ok = results
    .filter((r): r is PromiseFulfilledResult<RoadStatus> => r.status === 'fulfilled')
    .map((r) => r.value);
  if (!ok.length) throw new Error('all road corridors failed');
  return ok;
}

// Tioga Road is inside the park; Caltrans defers to NPS there. Derive from
// the NPS closure bulletins we already poll, and say what the basis is.
export function deriveTiogaStatus(bulletins: NpsBulletin[], observedAt: string | null): RoadStatus {
  const hit = bulletins.find(
    (b) => /tioga/i.test(`${b.title} ${b.description}`) && (b.category === 'Park Closure' || b.category === 'Danger'),
  );
  if (hit) {
    return { corridor: 'TIOGA RD · CA-120 E', status: 'closed', summary: hit.title, observedAt };
  }
  return {
    corridor: 'TIOGA RD · CA-120 E',
    status: 'open',
    summary: 'No closure posted by NPS.',
    observedAt,
  };
}
