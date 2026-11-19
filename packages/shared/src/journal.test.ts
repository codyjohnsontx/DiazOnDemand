import { describe, expect, it } from 'vitest';
import { getCurriculumPhaseKeys, programDisciplineToCurriculumDiscipline } from './curriculum.js';
import { Discipline, JournalOutcome } from './enums.js';
import {
  JOURNAL_NOTE_MAX_LENGTH,
  getJournalTrackLabel,
  getJournalTracks,
  journalEntryWriteSchema,
  journalTrendsQuerySchema,
} from './journal.js';

const entry = {
  sessionDate: '2026-01-15',
  discipline: Discipline.BJJ,
  items: [{ track: 'guard-passing-offense', outcome: JournalOutcome.WORKED }],
};

describe('journal curriculum items', () => {
  it.each(Object.values(Discipline))('gives %s tracks to tag, each id once', (discipline) => {
    const tracks = getJournalTracks(discipline);

    expect(tracks.length).toBeGreaterThan(0);
    // Items store the track id alone, so an id repeated across phases would merge in Trends.
    expect(new Set(tracks.map((track) => track.id)).size).toBe(tracks.length);
    expect(
      getCurriculumPhaseKeys(programDisciplineToCurriculumDiscipline(discipline)).length,
    ).toBeGreaterThan(0);
  });

  it('labels a stored track the catalog has dropped with its id', () => {
    expect(getJournalTrackLabel(Discipline.BJJ, 'guard-passing-offense')).toBe(
      'Guard Passing - Offense',
    );
    expect(getJournalTrackLabel(Discipline.BJJ, 'retired-track')).toBe('retired-track');
  });
});

describe('journalEntryWriteSchema', () => {
  it('accepts an entry and normalises a blank note to null', () => {
    expect(journalEntryWriteSchema.parse({ ...entry, note: '   ' }).note).toBeNull();
    expect(journalEntryWriteSchema.parse({ ...entry, note: ' Good ' }).note).toBe('Good');
    expect(journalEntryWriteSchema.parse(entry).note).toBeNull();
  });

  it.each([
    [
      'a track from another discipline',
      { items: [{ track: 'stance-guard-footwork', outcome: 'WORKED' }] },
    ],
    ['free text', { items: [{ track: 'my armbar', outcome: 'WORKED' }] }],
    ['no items', { items: [] }],
    [
      'a repeated item',
      {
        items: [
          { track: 'guard-passing-offense', outcome: 'WORKED' },
          { track: 'guard-passing-offense', outcome: 'DID_NOT_WORK' },
        ],
      },
    ],
    ['an unknown outcome', { items: [{ track: 'guard-passing-offense', outcome: 'MAYBE' }] }],
    ['an impossible date', { sessionDate: '2026-02-30' }],
    ['a future date', { sessionDate: '2999-01-01' }],
    ['an overlong note', { note: 'x'.repeat(JOURNAL_NOTE_MAX_LENGTH + 1) }],
    ['a NUL in the note', { note: 'a\0b' }],
  ])('refuses %s', (_label, override) => {
    expect(journalEntryWriteSchema.safeParse({ ...entry, ...override }).success).toBe(false);
  });
});

describe('journalTrendsQuerySchema', () => {
  it('takes every filter as optional and refuses an inverted range', () => {
    expect(journalTrendsQuerySchema.safeParse({}).success).toBe(true);
    expect(
      journalTrendsQuerySchema.safeParse({ from: '2026-02-01', to: '2026-01-01' }).success,
    ).toBe(false);
    expect(journalTrendsQuerySchema.safeParse({ discipline: 'JUDO' }).success).toBe(false);
  });
});
