import type { ReactNode } from 'react';
import { JournalOutcome, getDisciplineLabel, getJournalTrackLabel } from '@diaz/shared';
import type { JournalEntryDto } from '@diaz/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardActions } from '@/components/ui/card';
import { formatSessionDate } from '@/lib/journal';

export function JournalEntryCard({
  entry,
  actions,
}: {
  entry: JournalEntryDto;
  actions?: ReactNode;
}) {
  const groups = [
    { label: 'Worked', outcome: JournalOutcome.WORKED, tone: 'text-foreground-success' },
    {
      label: "Didn't work",
      outcome: JournalOutcome.DID_NOT_WORK,
      tone: 'text-foreground-critical',
    },
  ]
    .map((group) => ({
      ...group,
      tracks: entry.items.filter((item) => item.outcome === group.outcome),
    }))
    .filter((group) => group.tracks.length > 0);

  return (
    <Card className="flex flex-col gap-500" padding="compact">
      <div className="flex flex-wrap items-center justify-between gap-200">
        <h3 className="type-display-400">{formatSessionDate(entry.sessionDate)}</h3>
        <Badge label={getDisciplineLabel(entry.discipline)} />
      </div>

      <div className="grid gap-400 md:grid-cols-split">
        {groups.map((group) => (
          <div className="flex flex-col gap-100" key={group.outcome}>
            <p className={`type-kicker ${group.tone}`}>{group.label}</p>
            <ul className="text-body-200 text-foreground-primary">
              {group.tracks.map((item) => (
                <li key={item.track}>{getJournalTrackLabel(entry.discipline, item.track)}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {entry.note ? (
        <p className="whitespace-pre-wrap break-words text-body-200 text-foreground-faint">
          {entry.note}
        </p>
      ) : null}

      {actions ? <CardActions>{actions}</CardActions> : null}
    </Card>
  );
}
