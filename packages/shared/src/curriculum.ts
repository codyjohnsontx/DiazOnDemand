import { z } from 'zod';

export const fundamentalsBlockKey = 'fundamentals' as const;

export const fundamentalsPositionKeys = [
  'guard-retention',
  'guard-passing',
  'side-control',
  'back-control',
] as const;

export const fundamentalsTrackKeys = ['defense', 'offense'] as const;

export const fundamentalsSkillKeys = [
  'retention',
  'passing',
  'control',
  'escape',
  'submission',
  'transition',
] as const;

export const fundamentalsPositionSchema = z.enum(fundamentalsPositionKeys);
export const fundamentalsTrackSchema = z.enum(fundamentalsTrackKeys);
export const fundamentalsSkillSchema = z.enum(fundamentalsSkillKeys);
export const fundamentalsBlockSchema = z.literal(fundamentalsBlockKey);

export const fundamentalsCurriculumSchema = z.object({
  block: fundamentalsBlockSchema,
  position: fundamentalsPositionSchema,
  track: fundamentalsTrackSchema,
  skill: fundamentalsSkillSchema.optional(),
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

    if (key === 'block') {
      if (value !== fundamentalsBlockKey) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Block tag must be block:${fundamentalsBlockKey}`,
        });
      }
      return;
    }

    if (key === 'position') {
      if (!fundamentalsPositionSchema.safeParse(value).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Position tag must be one of: ${fundamentalsPositionKeys.join(', ')}`,
        });
      }
      return;
    }

    if (key === 'track') {
      if (!fundamentalsTrackSchema.safeParse(value).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Track tag must be one of: ${fundamentalsTrackKeys.join(', ')}`,
        });
      }
      return;
    }

    if (key === 'skill') {
      if (!fundamentalsSkillSchema.safeParse(value).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Skill tag must be one of: ${fundamentalsSkillKeys.join(', ')}`,
        });
      }
      return;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Curriculum tag key must be one of: block, position, track, skill',
    });
  });

export type FundamentalsPosition = z.infer<typeof fundamentalsPositionSchema>;
export type FundamentalsTrack = z.infer<typeof fundamentalsTrackSchema>;
export type FundamentalsSkill = z.infer<typeof fundamentalsSkillSchema>;
export type FundamentalsCurriculum = z.infer<typeof fundamentalsCurriculumSchema>;
export type CurriculumTag = z.infer<typeof curriculumTagSchema>;

export function createFundamentalsCurriculumTags({
  position,
  track,
  skill,
}: {
  position: FundamentalsPosition;
  track: FundamentalsTrack;
  skill?: FundamentalsSkill;
}): CurriculumTag[] {
  const tags: CurriculumTag[] = [
    `block:${fundamentalsBlockKey}`,
    `position:${position}`,
    `track:${track}`,
  ];

  if (skill) {
    tags.push(`skill:${skill}`);
  }

  return tags;
}

export function parseFundamentalsCurriculumTags(tags: string[]): FundamentalsCurriculum | null {
  const validTags = tags
    .map((tag) => curriculumTagSchema.safeParse(tag))
    .filter((result): result is { success: true; data: CurriculumTag } => result.success)
    .map((result) => result.data);

  const block = validTags.find((tag) => tag.startsWith('block:'))?.split(':')[1];
  const position = validTags.find((tag) => tag.startsWith('position:'))?.split(':')[1];
  const track = validTags.find((tag) => tag.startsWith('track:'))?.split(':')[1];
  const skill = validTags.find((tag) => tag.startsWith('skill:'))?.split(':')[1];

  const parsed = fundamentalsCurriculumSchema.safeParse({
    block,
    position,
    track,
    ...(skill ? { skill } : {}),
  });

  return parsed.success ? parsed.data : null;
}
