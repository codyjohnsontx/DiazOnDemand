import { getUpcomingEvents } from '@/lib/upcoming';
import { formatDateTimeRange } from '@/lib/utils';

import { Card } from './Card';

export async function UpcomingEvents() {
  const { source, events } = await getUpcomingEvents();

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-xl font-bold text-ink">Upcoming (Next 60 Days)</h3>
        <span className="rounded-full bg-sand px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-black/60">
          Source: {source === 'ics' ? 'Google Calendar' : 'Local fallback'}
        </span>
      </div>

      {events.length === 0 ? (
        <p className="text-sm text-black/65">No upcoming events in the next 60 days.</p>
      ) : (
        <ul className="space-y-3">
          {events.map((event) => (
            <li key={event.id} className="rounded-xl border border-black/10 bg-sand p-4">
              <p className="text-base font-semibold text-ink">{event.title}</p>
              <p className="mt-1 text-sm text-black/70">{formatDateTimeRange(event.start, event.end)}</p>
              {event.location && <p className="mt-1 text-sm text-black/60">Location: {event.location}</p>}
              {event.notes && <p className="mt-1 text-sm text-black/60">{event.notes}</p>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
