import { z } from 'zod';
import { curriculumCatalog, programDisciplineToCurriculumDiscipline } from './curriculum.js';
import { Discipline, JournalOutcome } from './enums.js';

/** An item reaches Trends only once this many distinct members tagged it in the range. */
export const JOURNAL_TRENDS_MIN_MEMBERS = 3;
export const JOURNAL_NOTE_MAX_LENGTH = 2000;

export type JournalTrack = { id: string; label: string };

/** Every curriculum track of a discipline, which is the level a journal entry tags. */
export function getJournalTracks(discipline: Discipline): JournalTrack[] {
  const phases: Record<string, { tracks: Record<string, string> }> =
    curriculumCatalog[programDisciplineToCurriculumDiscipline(discipline)].phases;

  return Object.values(phases).flatMap(({ tracks }) =>
    Object.entries(tracks).map(([id, label]) => ({ id, label })),
  );
}

/** Falls back to the id so a stored track the catalog has since dropped still renders. */
export function getJournalTrackLabel(discipline: Discipline, track: string) {
  return getJournalTracks(discipline).find((entry) => entry.id === track)?.label ?? track;
}

function isCalendarDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const journalDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must use YYYY-MM-DD format')
  .refine(isCalendarDate, 'Not a real calendar date');

/**
 * The latest date a member can truthfully be on, anywhere: the furthest timezone
 * is 14 hours ahead of UTC, so it is never past tomorrow's UTC date.
 */
function latestPossibleLocalDate(now: Date) {
  return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export const journalEntryWriteSchema = z
  .object({
    sessionDate: journalDateSchema.refine(
      (value) => value <= latestPossibleLocalDate(new Date()),
      'Session date cannot be in the future',
    ),
    discipline: z.nativeEnum(Discipline),
    items: z
      .array(z.object({ track: z.string(), outcome: z.nativeEnum(JournalOutcome) }))
      .min(1, 'Mark at least one curriculum item'),
    // Postgres text cannot hold a NUL, so it would otherwise surface as a 500.
    note: z
      .string()
      .max(JOURNAL_NOTE_MAX_LENGTH)
      .refine((value) => !value.includes('\0'), 'Note contains an invalid character')
      .nullish()
      .transform((value) => value?.trim() || null),
  })
  .superRefine((entry, ctx) => {
    const known = new Set(getJournalTracks(entry.discipline).map((track) => track.id));
    const seen = new Set<string>();

    entry.items.forEach(({ track }, index) => {
      if (!known.has(track)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown curriculum item "${track}" for this discipline`,
          path: ['items', index, 'track'],
        });
      }

      if (seen.has(track)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Curriculum item "${track}" is listed twice`,
          path: ['items', index, 'track'],
        });
      }

      seen.add(track);
    });
  });

export const journalTrendsQuerySchema = z
  .object({
    discipline: z.nativeEnum(Discipline).optional(),
    from: journalDateSchema.optional(),
    to: journalDateSchema.optional(),
  })
  .refine(({ from, to }) => !from || !to || from <= to, {
    message: 'The start date must not be after the end date',
    path: ['from'],
  });

export type JournalEntryWriteDto = z.infer<typeof journalEntryWriteSchema>;
export type JournalTrendsQueryDto = z.infer<typeof journalTrendsQuerySchema>;

export type JournalEntryDto = {
  id: string;
  sessionDate: string;
  discipline: Discipline;
  note: string | null;
  items: { track: string; outcome: JournalOutcome }[];
};

export type JournalOverviewDto = {
  adultConfirmed: boolean;
  canWrite: boolean;
  entries: JournalEntryDto[];
};

export type JournalTrendItemDto = {
  discipline: Discipline;
  track: string;
  workedCount: number;
  didNotWorkCount: number;
  memberCount: number;
};

export type JournalMemberSummaryDto = {
  id: string;
  label: string;
  entryCount: number;
  lastSessionDate: string;
};

export type JournalMemberDetailDto = {
  id: string;
  label: string;
  entries: JournalEntryDto[];
};
