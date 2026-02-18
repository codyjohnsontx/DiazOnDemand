import { upcomingItems } from '@/content/upcoming';

export type UpcomingEvent = {
  id: string;
  title: string;
  start: Date;
  end?: Date;
  location?: string;
  notes?: string;
};

const MAX_DAYS_AHEAD = 60;
const MAX_ITEMS = 15;

function unfoldIcsLines(content: string): string[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const unfolded: string[] = [];

  for (const line of lines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }

  return unfolded;
}

function parseIcsDate(raw: string): Date | null {
  if (!raw) return null;

  if (/^\d{8}$/.test(raw)) {
    const year = Number(raw.slice(0, 4));
    const month = Number(raw.slice(4, 6)) - 1;
    const day = Number(raw.slice(6, 8));
    return new Date(year, month, day, 0, 0, 0);
  }

  const clean = raw.replace(/Z$/, '');
  if (!/^\d{8}T\d{6}$/.test(clean)) return null;

  const year = Number(clean.slice(0, 4));
  const month = Number(clean.slice(4, 6)) - 1;
  const day = Number(clean.slice(6, 8));
  const hour = Number(clean.slice(9, 11));
  const minute = Number(clean.slice(11, 13));
  const second = Number(clean.slice(13, 15));

  if (raw.endsWith('Z')) {
    return new Date(Date.UTC(year, month, day, hour, minute, second));
  }

  return new Date(year, month, day, hour, minute, second);
}

function parseIcs(icsText: string): UpcomingEvent[] {
  const lines = unfoldIcsLines(icsText);
  const events: UpcomingEvent[] = [];

  let inEvent = false;
  let raw: Record<string, string> = {};

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      inEvent = true;
      raw = {};
      continue;
    }

    if (line === 'END:VEVENT' && inEvent) {
      inEvent = false;
      const start = parseIcsDate(raw.DTSTART || '');
      if (!start) continue;

      const end = parseIcsDate(raw.DTEND || '');
      events.push({
        id: raw.UID || `${raw.SUMMARY || 'event'}-${start.toISOString()}`,
        title: raw.SUMMARY || 'Untitled Event',
        start,
        end: end || undefined,
        location: raw.LOCATION || undefined,
        notes: raw.DESCRIPTION || undefined,
      });
      continue;
    }

    if (!inEvent) continue;

    const sepIdx = line.indexOf(':');
    if (sepIdx <= 0) continue;

    const key = line.slice(0, sepIdx).split(';')[0];
    const value = line.slice(sepIdx + 1).replace(/\\n/g, '\n').trim();

    if (key) raw[key] = value;
  }

  return events;
}

function filterWindow(events: UpcomingEvent[]): UpcomingEvent[] {
  const now = new Date();
  const max = new Date(now.getTime() + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000);

  return events
    .filter((event) => event.start >= now && event.start <= max)
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .slice(0, MAX_ITEMS);
}

function fallbackUpcoming(): UpcomingEvent[] {
  const mapped = upcomingItems.map((item) => ({
    id: item.id,
    title: item.title,
    start: new Date(item.start),
    end: item.end ? new Date(item.end) : undefined,
    location: item.location,
    notes: item.notes,
  }));

  return filterWindow(mapped);
}

export async function getUpcomingEvents(): Promise<{ source: 'ics' | 'fallback'; events: UpcomingEvent[] }> {
  const icsUrl = process.env.NEXT_PUBLIC_GOOGLE_CALENDAR_ICS_URL;

  if (!icsUrl) {
    return { source: 'fallback', events: fallbackUpcoming() };
  }

  try {
    const response = await fetch(icsUrl, {
      next: { revalidate: 1800 },
    });

    if (!response.ok) {
      return { source: 'fallback', events: fallbackUpcoming() };
    }

    const icsText = await response.text();
    const parsed = parseIcs(icsText);
    const filtered = filterWindow(parsed);
    return { source: 'ics', events: filtered };
  } catch {
    return { source: 'fallback', events: fallbackUpcoming() };
  }
}
