import type { ReactNode } from 'react';
import { JournalOutcome, getDisciplineLabel, getJournalTrackLabel } from '@diaz/shared';
import type { JournalEntryDto } from '@diaz/shared';
import { PremiumBadge } from '@/components/premium-badge';
import { formatSessionDate } from '@/lib/journal';

export function JournalEntryCard({
  entry,
  actions,
}: {
  entry: JournalEntryDto;
  actions?: ReactNode;
}) {
  const groups = [
    { label: 'Worked', outcome: JournalOutcome.WORKED, tone: 'text-[var(--progress)]' },
    { label: "Didn't work", outcome: JournalOutcome.DID_NOT_WORK, tone: 'text-[var(--danger)]' },
  ]
    .map((group) => ({
      ...group,
      tracks: entry.items.filter((item) => item.outcome === group.outcome),
    }))
    .filter((group) => group.tracks.length > 0);

  return (
    <article className="surface-panel-muted space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-2xl leading-tight text-[var(--text)]">
          {formatSessionDate(entry.sessionDate)}
        </h3>
        <PremiumBadge label={getDisciplineLabel(entry.discipline)} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {groups.map((group) => (
          <div className="space-y-1" key={group.outcome}>
            <p className={`type-kicker ${group.tone}`}>{group.label}</p>
            <ul className="type-meta text-[var(--text)]">
              {group.tracks.map((item) => (
                <li key={item.track}>{getJournalTrackLabel(entry.discipline, item.track)}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {entry.note ? (
        <p className="type-meta whitespace-pre-wrap break-words text-[var(--text-muted)]">
          {entry.note}
        </p>
      ) : null}

      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </article>
  );
}
