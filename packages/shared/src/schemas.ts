import { z } from 'zod';
import { AccessLevel, EntitlementTier, Role } from './enums';

export const lessonSummarySchema = z.object({
  id: z.string().uuid(),
  courseId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  orderIndex: z.number().int().nonnegative(),
  isPublished: z.boolean(),
  accessLevel: z.nativeEnum(AccessLevel),
  muxPlaybackId: z.string().nullable().optional(),
  durationSeconds: z.number().int().nonnegative().nullable().optional(),
});

export const courseSchema = z.object({
  id: z.string().uuid(),
  programId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  orderIndex: z.number().int().nonnegative(),
  isPublished: z.boolean(),
  lessons: z.array(lessonSummarySchema).optional(),
});

export const programSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  orderIndex: z.number().int().nonnegative(),
  isPublished: z.boolean(),
  courses: z.array(courseSchema).optional(),
});

export const lessonDetailSchema = lessonSummarySchema.extend({
  muxAssetId: z.string().nullable().optional(),
  tags: z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1),
      }),
    )
    .default([]),
  playbackUrl: z.string().nullable().optional(),
  signedPlaybackToken: z.string().nullable().optional(),
  playbackTokenTodo: z.string().nullable().optional(),
});

export const programWithContentSchema = programSchema.extend({
  courses: z.array(
    courseSchema.extend({
      lessons: z.array(lessonSummarySchema),
    }),
  ),
});

export const progressUpsertSchema = z.object({
  lastPositionSeconds: z.number().int().nonnegative(),
  completed: z.boolean(),
});

export const progressSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  lessonId: z.string().uuid(),
  lastPositionSeconds: z.number().int().nonnegative(),
  completed: z.boolean(),
  updatedAt: z.string().datetime().or(z.date()),
});

export const favoriteToggleSchema = z.object({
  lessonId: z.string().uuid(),
});

export const favoriteSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  lessonId: z.string().uuid(),
  createdAt: z.string().datetime().or(z.date()),
  lesson: lessonSummarySchema.optional(),
});

const adminBaseProgramSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  orderIndex: z.number().int().default(0),
  isPublished: z.boolean().default(false),
});

const adminBaseCourseSchema = z.object({
  programId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  orderIndex: z.number().int().default(0),
  isPublished: z.boolean().default(false),
});

const adminBaseLessonSchema = z.object({
  courseId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  orderIndex: z.number().int().default(0),
  isPublished: z.boolean().default(false),
  accessLevel: z.nativeEnum(AccessLevel).default(AccessLevel.FREE),
  muxAssetId: z.string().optional().nullable(),
  muxPlaybackId: z.string().optional().nullable(),
  durationSeconds: z.number().int().nonnegative().optional().nullable(),
});

export const adminCreateProgramSchema = adminBaseProgramSchema;
export const adminUpdateProgramSchema = adminBaseProgramSchema.partial();

export const adminCreateCourseSchema = adminBaseCourseSchema;
export const adminUpdateCourseSchema = adminBaseCourseSchema.partial();

export const adminCreateLessonSchema = adminBaseLessonSchema;
export const adminUpdateLessonSchema = adminBaseLessonSchema.partial();

export const meSchema = z.object({
  userId: z.string().uuid(),
  clerkUserId: z.string(),
  role: z.nativeEnum(Role),
  entitlementTier: z.nativeEnum(EntitlementTier),
});

export const checkoutSessionSchema = z.object({
  url: z.string().url().nullable().optional(),
});

export type LessonSummary = z.infer<typeof lessonSummarySchema>;
export type LessonDetailDto = z.infer<typeof lessonDetailSchema>;
export type CourseDto = z.infer<typeof courseSchema>;
export type ProgramDto = z.infer<typeof programSchema>;
export type ProgramWithContentDto = z.infer<typeof programWithContentSchema>;
export type ProgressUpsertPayload = z.infer<typeof progressUpsertSchema>;
export type ProgressDto = z.infer<typeof progressSchema>;
export type FavoriteTogglePayload = z.infer<typeof favoriteToggleSchema>;
export type FavoriteDto = z.infer<typeof favoriteSchema>;
export type AdminCreateProgramDto = z.infer<typeof adminCreateProgramSchema>;
export type AdminUpdateProgramDto = z.infer<typeof adminUpdateProgramSchema>;
export type AdminCreateCourseDto = z.infer<typeof adminCreateCourseSchema>;
export type AdminUpdateCourseDto = z.infer<typeof adminUpdateCourseSchema>;
export type AdminCreateLessonDto = z.infer<typeof adminCreateLessonSchema>;
export type AdminUpdateLessonDto = z.infer<typeof adminUpdateLessonSchema>;
export type MeDto = z.infer<typeof meSchema>;
export type CheckoutSessionDto = z.infer<typeof checkoutSessionSchema>;
