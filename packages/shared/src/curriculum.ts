import { z } from 'zod';
import { Discipline } from './enums.js';

const slugSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/, 'Curriculum values must use lowercase slug format');

export const curriculumDisciplineKeys = ['bjj', 'muay-thai', 'haganah'] as const;
export const curriculumLevelKeys = ['intro', 'core', 'advanced'] as const;

export const curriculumDisciplineSchema = z.enum(curriculumDisciplineKeys);
export const curriculumLevelSchema = z.enum(curriculumLevelKeys);

export type CurriculumDiscipline = z.infer<typeof curriculumDisciplineSchema>;
export type CurriculumLevel = z.infer<typeof curriculumLevelSchema>;

type DisciplineCatalog = {
  label: string;
  phases: Record<
    string,
    {
      label: string;
      tracks: Record<string, string>;
    }
  >;
  skills: Record<string, string>;
  levels: readonly CurriculumLevel[];
};

export const curriculumCatalog = {
  bjj: {
    label: 'BJJ',
    phases: {
      fundamentals: {
        label: 'Fundamentals',
        tracks: {
          'guard-retention-defense': 'Guard Retention - Defense',
          'guard-retention-offense': 'Guard Retention - Offense',
          'guard-passing-defense': 'Guard Passing - Defense',
          'guard-passing-offense': 'Guard Passing - Offense',
          'side-control-defense': 'Side Control - Defense',
          'side-control-offense': 'Side Control - Offense',
          'back-control-defense': 'Back Control - Defense',
          'back-control-offense': 'Back Control - Offense',
        },
      },
    },
    skills: {
      retention: 'Retention',
      passing: 'Passing',
      control: 'Control',
      escape: 'Escape',
      submission: 'Submission',
      transition: 'Transition',
    },
    levels: ['core'],
  },
  'muay-thai': {
    label: 'Muay Thai',
    phases: {
      foundations: {
        label: 'Foundations',
        tracks: {
          'stance-guard-footwork': 'Stance, Guard & Footwork',
          'straight-punches-and-returns': 'Straight Punches & Returns',
          'teeps-round-kicks-and-checks': 'Teeps, Round Kicks & Checks',
          'knees-elbows-and-entry-range': 'Knees, Elbows & Entry Range',
          'defensive-shells-and-counters': 'Defensive Shells & Counters',
          'combination-building-and-pad-flow': 'Combination Building & Pad Flow',
        },
      },
    },
    skills: {
      balance: 'Balance',
      timing: 'Timing',
      defense: 'Defense',
      combination: 'Combination',
      'clinch-entry': 'Clinch Entry',
      countering: 'Countering',
    },
    levels: ['intro', 'core', 'advanced'],
  },
  haganah: {
    label: 'Haganah',
    phases: {
      foundations: {
        label: 'Foundations',
        tracks: {
          'ready-stance-and-burst-movement': 'Ready Stance & Burst Movement',
          'striking-under-pressure': 'Striking Under Pressure',
          'wrist-releases-and-clothing-grabs': 'Wrist Releases & Clothing Grabs',
          'front-side-choke-responses': 'Front & Side Choke Responses',
          'ground-survival-and-technical-stand-up': 'Ground Survival & Technical Stand-Up',
          'weapon-threat-principles': 'Weapon Threat Principles',
        },
      },
    },
    skills: {
      awareness: 'Awareness',
      'burst-entry': 'Burst Entry',
      release: 'Release',
      'escape-priority': 'Escape Priority',
      'technical-stand-up': 'Technical Stand-Up',
      'threat-management': 'Threat Management',
    },
    levels: ['intro', 'core', 'advanced'],
  },
} satisfies Record<CurriculumDiscipline, DisciplineCatalog>;

function getDisciplineCatalog(discipline: CurriculumDiscipline): DisciplineCatalog {
  return curriculumCatalog[discipline] as DisciplineCatalog;
}

export const curriculumMetadataSchema = z
  .object({
    discipline: curriculumDisciplineSchema,
    phase: slugSchema,
    track: slugSchema,
    skill: slugSchema.optional(),
    level: curriculumLevelSchema,
  })
  .superRefine((value, ctx) => {
    const discipline = getDisciplineCatalog(value.discipline);
    const phase = discipline.phases[value.phase];

    if (!phase) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown phase "${value.phase}" for ${discipline.label}`,
        path: ['phase'],
      });
      return;
    }

    if (!phase.tracks[value.track]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown track "${value.track}" for ${discipline.label} / ${phase.label}`,
        path: ['track'],
      });
    }

    if (value.skill && !discipline.skills[value.skill]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown skill "${value.skill}" for ${discipline.label}`,
        path: ['skill'],
      });
    }

    if (!discipline.levels.includes(value.level)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Level "${value.level}" is not valid for ${discipline.label}`,
        path: ['level'],
      });
    }
  });

export const curriculumTagSchema = z
  .string()
  .regex(/^[a-z]+:[a-z0-9-]+$/, 'Curriculum tag must use `key:value` lowercase format')
  .superRefine((tag, ctx) => {
    const [key, value, extra] = tag.split(':');

    if (!key || !value || extra) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Curriculum tag must contain exactly one `:` separator',
      });
      return;
    }

    if (!['discipline', 'phase', 'track', 'skill', 'level'].includes(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Curriculum tag key must be one of: discipline, phase, track, skill, level',
      });
      return;
    }

    if (key === 'discipline' && !curriculumDisciplineSchema.safeParse(value).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Discipline tag must be one of: ${curriculumDisciplineKeys.join(', ')}`,
      });
      return;
    }

    if (key === 'level' && !curriculumLevelSchema.safeParse(value).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Level tag must be one of: ${curriculumLevelKeys.join(', ')}`,
      });
    }
  });

export type CurriculumMetadata = z.infer<typeof curriculumMetadataSchema>;
export type CurriculumTag = z.infer<typeof curriculumTagSchema>;

function getRequiredCatalogValue<T>(values: T[], label: string): T {
  const [value] = values;

  if (value === undefined) {
    throw new Error(`No ${label} configured in curriculum catalog.`);
  }

  return value;
}

function titleCaseFallback(value: string) {
  return value
    .split('-')
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

export function curriculumDisciplineToProgramDiscipline(
  discipline: CurriculumDiscipline,
): Discipline {
  switch (discipline) {
    case 'bjj':
      return Discipline.BJJ;
    case 'muay-thai':
      return Discipline.MUAY_THAI;
    case 'haganah':
      return Discipline.HAGANAH;
    default:
      throw new Error(`Unsupported curriculum discipline: ${String(discipline)}`);
  }
}

export function programDisciplineToCurriculumDiscipline(
  discipline: Discipline,
): CurriculumDiscipline {
  switch (discipline) {
    case Discipline.BJJ:
      return 'bjj';
    case Discipline.MUAY_THAI:
      return 'muay-thai';
    case Discipline.HAGANAH:
      return 'haganah';
    default:
      throw new Error(`Unsupported program discipline: ${String(discipline)}`);
  }
}

export function getDisciplineLabel(
  discipline: Discipline | CurriculumDiscipline,
) {
  const slug =
    typeof discipline === 'string' && discipline in curriculumCatalog
      ? (discipline as CurriculumDiscipline)
      : programDisciplineToCurriculumDiscipline(discipline as Discipline);

  return getDisciplineCatalog(slug).label;
}

export function getCurriculumPhaseKeys(discipline: CurriculumDiscipline) {
  return Object.keys(getDisciplineCatalog(discipline).phases);
}

export function getCurriculumTrackKeys(
  discipline: CurriculumDiscipline,
  phase: string,
) {
  return Object.keys(getDisciplineCatalog(discipline).phases[phase]?.tracks ?? {});
}

export function getCurriculumSkillKeys(discipline: CurriculumDiscipline) {
  return Object.keys(getDisciplineCatalog(discipline).skills);
}

export function getCurriculumLevelKeys(discipline: CurriculumDiscipline) {
  return [...getDisciplineCatalog(discipline).levels];
}

export function getCurriculumPhaseLabel(
  discipline: CurriculumDiscipline,
  phase: string,
) {
  return getDisciplineCatalog(discipline).phases[phase]?.label ?? titleCaseFallback(phase);
}

export function getCurriculumTrackLabel(metadata: CurriculumMetadata) {
  return (
    getDisciplineCatalog(metadata.discipline).phases[metadata.phase]?.tracks[metadata.track] ??
    titleCaseFallback(metadata.track)
  );
}

export function getCurriculumSkillLabel(metadata: CurriculumMetadata) {
  if (!metadata.skill) {
    return null;
  }

  return getDisciplineCatalog(metadata.discipline).skills[metadata.skill] ?? titleCaseFallback(metadata.skill);
}

export function getCurriculumLevelLabel(level: CurriculumLevel) {
  return titleCaseFallback(level);
}

export function formatCurriculumMetadataLabel(metadata: CurriculumMetadata) {
  return getCurriculumTrackLabel(metadata);
}

export function createCurriculumTags(metadata: CurriculumMetadata): CurriculumTag[] {
  const tags: CurriculumTag[] = [
    `discipline:${metadata.discipline}`,
    `phase:${metadata.phase}`,
    `track:${metadata.track}`,
    `level:${metadata.level}`,
  ];

  if (metadata.skill) {
    tags.push(`skill:${metadata.skill}`);
  }

  return tags;
}

export function parseCurriculumTags(tags: string[]): CurriculumMetadata | null {
  const validTags = tags
    .map((tag) => curriculumTagSchema.safeParse(tag))
    .filter((result): result is { success: true; data: CurriculumTag } => result.success)
    .map((result) => result.data);

  const discipline = validTags.find((tag) => tag.startsWith('discipline:'))?.split(':')[1];
  const phase = validTags.find((tag) => tag.startsWith('phase:'))?.split(':')[1];
  const track = validTags.find((tag) => tag.startsWith('track:'))?.split(':')[1];
  const skill = validTags.find((tag) => tag.startsWith('skill:'))?.split(':')[1];
  const level = validTags.find((tag) => tag.startsWith('level:'))?.split(':')[1];

  const parsed = curriculumMetadataSchema.safeParse({
    discipline,
    phase,
    track,
    level,
    ...(skill ? { skill } : {}),
  });

  return parsed.success ? parsed.data : null;
}

export function createDefaultCurriculum(
  discipline: CurriculumDiscipline = 'bjj',
): CurriculumMetadata {
  const phase = getRequiredCatalogValue(getCurriculumPhaseKeys(discipline), `${discipline} phase`);
  const track = getRequiredCatalogValue(
    getCurriculumTrackKeys(discipline, phase),
    `${discipline} track for phase ${phase}`,
  );
  const skill = getCurriculumSkillKeys(discipline)[0];
  const level = getRequiredCatalogValue(getCurriculumLevelKeys(discipline), `${discipline} level`);

  return {
    discipline,
    phase,
    track,
    ...(skill ? { skill } : {}),
    level,
  };
}
