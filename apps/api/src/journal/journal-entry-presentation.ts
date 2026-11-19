import type { JournalEntry, JournalEntryItem } from '@diaz/db';
import { Discipline, JournalOutcome, type JournalEntryDto } from '@diaz/shared';

type JournalEntryRow = JournalEntry & { items: JournalEntryItem[] };

export const journalEntryInclude = { items: { orderBy: { track: 'asc' } } } as const;

export const journalEntryOrder = [{ sessionDate: 'desc' }, { createdAt: 'desc' }] as const;

/** `sessionDate` is a Postgres DATE, which Prisma hands back as UTC midnight. */
export function formatSessionDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function mapJournalEntry(entry: JournalEntryRow): JournalEntryDto {
  return {
    id: entry.id,
    sessionDate: formatSessionDate(entry.sessionDate),
    discipline: entry.discipline as Discipline,
    note: entry.note,
    items: entry.items.map(({ track, outcome }) => ({
      track,
      outcome: outcome as JournalOutcome,
    })),
  };
}
