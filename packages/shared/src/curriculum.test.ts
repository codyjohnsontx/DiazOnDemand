import { describe, expect, it } from 'vitest';
import {
  createCurriculumTags,
  curriculumMetadataSchema,
  curriculumTagSchema,
  getCurriculumTrackKeys,
  parseCurriculumTags,
} from './curriculum';

describe('curriculumTagSchema', () => {
  it('accepts valid multi-discipline taxonomy tags', () => {
    const parsed = curriculumTagSchema.parse('discipline:haganah');
    expect(parsed).toBe('discipline:haganah');
  });

  it('rejects unknown keys', () => {
    expect(() => curriculumTagSchema.parse('subset:guard-retention')).toThrow();
  });

  it('rejects invalid formats', () => {
    expect(() => curriculumTagSchema.parse('track_guard-retention-defense')).toThrow();
  });
});

describe('createCurriculumTags', () => {
  it('returns required discipline/phase/track/level tags and optional skill', () => {
    const tags = createCurriculumTags({
      discipline: 'bjj',
      phase: 'fundamentals',
      track: getCurriculumTrackKeys('bjj', 'fundamentals')[0]!,
      skill: 'retention',
      level: 'core',
    });

    expect(tags).toContain('discipline:bjj');
    expect(tags).toContain('phase:fundamentals');
    expect(tags).toContain('track:guard-retention-defense');
    expect(tags).toContain('skill:retention');
    expect(tags).toContain('level:core');
  });
});

describe('parseCurriculumTags', () => {
  it('returns a structured curriculum object from valid tags', () => {
    const curriculum = parseCurriculumTags([
      'discipline:muay-thai',
      'phase:foundations',
      'track:straight-punches-and-returns',
      'skill:countering',
      'level:core',
    ]);

    expect(curriculum).toEqual({
      discipline: 'muay-thai',
      phase: 'foundations',
      track: 'straight-punches-and-returns',
      skill: 'countering',
      level: 'core',
    });
  });

  it('returns null when required tags are missing', () => {
    expect(parseCurriculumTags(['track:defense'])).toBeNull();
  });
});

describe('curriculumMetadataSchema', () => {
  it('rejects invalid discipline/track combinations', () => {
    expect(() =>
      curriculumMetadataSchema.parse({
        discipline: 'haganah',
        phase: 'foundations',
        track: 'guard-retention-defense',
        level: 'core',
      }),
    ).toThrow();
  });
});
