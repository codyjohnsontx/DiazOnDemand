import { z } from 'zod';
import { curriculumMetadataSchema } from './curriculum.js';
import { AccessLevel, Discipline, EntitlementTier, Role, VideoProvider } from './enums.js';
import { isStoredIdentifierAbsent } from './video-source.js';

export const curriculumSchema = curriculumMetadataSchema;
/**
 * What a lesson's video may look like, including while Mux is still encoding it.
 *
 * `muxAssetId` counts as a Mux source, because Mux issues the playback id later,
 * on `video.asset.ready`, and a lesson holding only the asset id is a complete
 * description of "uploaded, not playable yet". See `isAwaitingMuxPlayback`.
 *
 * This rule is **not** on the write path and never refused a save. It types
 * `lessonDetailSchema`, which exists only to produce the `LessonDetailDto` type;
 * nothing parses either at runtime, and the admin PATCH validates with
 * `adminUpdateLessonSchema`, which has never consulted this schema. Widening it
 * keeps the DTO type honest about a state the API can now emit, and that is all
 * it does. What actually refused the save was the client-side guard in
 * `apps/diaz-ondemand-web/app/admin/lessons/[id]/page.tsx` and the Postgres
 * CHECK constraint `lesson_video_provider_consistency_chk`, added in migration
 * `20260307235900_three_discipline_demo`. An earlier framing called this Zod
 * rule the blocker; that was wrong, and the record is corrected here rather than
 * restated.
 *
 * The NONE rule still rejects every *playback* identifier and deliberately says
 * nothing about `muxAssetId`. An asset id addresses no video - it is an
 * ingestion handle, useless without the Mux API credentials - and the read path
 * resolves a lesson awaiting its playback id to NONE, so forbidding it here
 * would reject the very state this schema was widened to accept.
 */
export const videoSchema = z
  .object({
    provider: z.nativeEnum(VideoProvider),
    playbackUrl: z.string().url().nullable().optional(),
    muxAssetId: z.string().nullable().optional(),
    muxPlaybackId: z.string().nullable().optional(),
    youtubeVideoId: z.string().nullable().optional(),
    embedUrl: z.string().url().nullable().optional(),
  })
  .superRefine((video, ctx) => {
    const hasMuxPlaybackSource = Boolean(video.muxPlaybackId || video.playbackUrl);
    const hasMuxSource = hasMuxPlaybackSource || Boolean(video.muxAssetId);
    const hasYoutubeSource = Boolean(video.youtubeVideoId || video.embedUrl);

    if (video.provider === VideoProvider.MUX && !hasMuxSource) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['muxPlaybackId'],
        message:
          'Mux videos must include an asset identifier, a playback identifier or a playback URL.',
      });
    }

    if (video.provider === VideoProvider.YOUTUBE && !hasYoutubeSource) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['youtubeVideoId'],
        message: 'YouTube videos must include a video identifier or embed URL.',
      });
    }

    if (video.provider === VideoProvider.NONE && (hasMuxPlaybackSource || hasYoutubeSource)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['provider'],
        message: 'Video provider NONE cannot include playback identifiers.',
      });
    }
  });

export const lessonSummarySchema = z.object({
  id: z.string().uuid(),
  courseId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  orderIndex: z.number().int().nonnegative(),
  isPublished: z.boolean(),
  accessLevel: z.nativeEnum(AccessLevel),
  videoProvider: z.nativeEnum(VideoProvider).default(VideoProvider.MUX),
  muxPlaybackId: z.string().nullable().optional(),
  youtubeVideoId: z.string().nullable().optional(),
  durationSeconds: z.number().int().nonnegative().nullable().optional(),
  curriculum: curriculumSchema.nullable().optional(),
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
  discipline: z.nativeEnum(Discipline),
  isFeaturedDemo: z.boolean().default(false),
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
  video: videoSchema,
});

export const programWithContentSchema = programSchema.extend({
  courses: z.array(
    courseSchema.extend({
      lessons: z.array(lessonSummarySchema),
    }),
  ),
});

// Admin-only projections. `muxAssetId` is the join key the Mux `video.asset.ready`
// webhook matches on, so admins need to set it - and it stays off the public
// *summary* payloads, which are built from lessonSummarySchema and are what
// `/programs`, `/programs/:id` and `/courses/:id` answer.
//
// The lesson *detail* payload keeps the field on its type but no longer carries
// a value: `mapLessonDetail` takes it from `publicVideoIdentifiers`, the same
// gate the two playback identifiers go through, and that gate answers null for
// the asset id at every access level. It used to be read straight off the row
// outside the gate, so a FREE published lesson's asset id reached an
// unauthenticated caller of `GET /lessons/:id` (`getOptionalUser`, 402 only for
// PAID). The exposure was narrow - an asset id is an ingestion handle that
// addresses no video and does nothing without Mux API credentials - but "one
// rule for every provider identifier" was false as a property, and that was the
// defect worth closing.
export const adminLessonSummarySchema = lessonSummarySchema.extend({
  muxAssetId: z.string().nullable().optional(),
});

export const adminProgramWithContentSchema = programSchema.extend({
  courses: z.array(
    courseSchema.extend({
      lessons: z.array(adminLessonSummarySchema),
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
  discipline: z.nativeEnum(Discipline).default(Discipline.BJJ),
  isFeaturedDemo: z.boolean().default(false),
  isPublished: z.boolean().default(false),
});

const adminBaseCourseSchema = z.object({
  programId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  orderIndex: z.number().int().default(0),
  isPublished: z.boolean().default(false),
});

/**
 * A stored video identifier on an admin write, with blank normalised to NULL.
 *
 * "No identifier yet" needs one spelling in the database, because that is what
 * the query for stalled uploads asks for:
 * `where: { muxAssetId: { not: null }, muxPlaybackId: null, youtubeVideoId: null }`.
 * An empty string is a second spelling of the same fact, and it makes that query
 * miss exactly the rows an operator is looking for. The admin lesson editor
 * already sends `|| null`, but it is one writer of three columns behind one
 * PATCH route - `adminUpdateLessonSchema` is the boundary every writer passes,
 * so the rule lives here rather than in the browser.
 *
 * Blank is `isStoredIdentifierAbsent`, the repository's single definition of it,
 * mirroring Postgres `TRIM()`. Do not spell a second one out here: a tab-only
 * value is *present* to the CHECK constraint, so it is kept verbatim, and a
 * local `.trim()` that disagreed about that is the bug the branch this sits on
 * exists to fix.
 *
 * The `undefined` case is the one that has to be exactly right.
 * `adminUpdateLessonSchema` is this schema `.partial()`, so a PATCH that does
 * not mention a column must leave it alone: `undefined` stays `undefined`, which
 * Prisma reads as "do not update". Mapping it to null instead would blank every
 * unmentioned identifier on every partial save - data loss far worse than the
 * empty string this exists to prevent.
 */
const adminStoredVideoIdentifier = z
  .string()
  .optional()
  .nullable()
  .transform((value) => {
    if (value === undefined) return undefined;
    return isStoredIdentifierAbsent(value) ? null : value;
  });

const adminBaseLessonSchema = z.object({
  courseId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  orderIndex: z.number().int().default(0),
  isPublished: z.boolean().default(false),
  accessLevel: z.nativeEnum(AccessLevel).default(AccessLevel.FREE),
  videoProvider: z.nativeEnum(VideoProvider).default(VideoProvider.MUX),
  muxAssetId: adminStoredVideoIdentifier,
  muxPlaybackId: adminStoredVideoIdentifier,
  youtubeVideoId: adminStoredVideoIdentifier,
  durationSeconds: z.number().int().nonnegative().optional().nullable(),
  curriculum: curriculumSchema.optional().nullable(),
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
  subscriptionStatus: z.string().nullable().optional(),
  currentPeriodEnd: z.string().datetime().nullable().optional(),
  /** True when the member has a Stripe customer, so the billing portal can open. */
  canManageBilling: z.boolean().optional(),
});

export const billingPortalSessionSchema = z.object({
  url: z.string().url().nullable().optional(),
});

export const entitlementsResponseSchema = z.object({
  gymMember: z.boolean(),
  vod: z.boolean(),
  tier: z.enum(['FREE', 'GYM_MEMBER', 'VOD']),
  validUntil: z.string().datetime().nullable().optional(),
});

export const checkoutSessionSchema = z.object({
  url: z.string().url().nullable().optional(),
});

/**
 * Why checkout answered 409. Both refusals share the status, so the client
 * needs this to tell them apart: sending a member who merely double-clicked to
 * an account page that shows no subscription produces a support message rather
 * than a payment.
 */
export const CHECKOUT_CONFLICT_CODES = {
  subscriptionExists: 'subscription_exists',
  checkoutInFlight: 'checkout_in_flight',
} as const;

export type CheckoutConflictCode =
  (typeof CHECKOUT_CONFLICT_CODES)[keyof typeof CHECKOUT_CONFLICT_CODES];

export const checkoutConflictSchema = z.object({
  code: z.enum([
    CHECKOUT_CONFLICT_CODES.subscriptionExists,
    CHECKOUT_CONFLICT_CODES.checkoutInFlight,
  ]),
  message: z.string(),
});

export type LessonSummary = z.infer<typeof lessonSummarySchema>;
export type LessonDetailDto = z.infer<typeof lessonDetailSchema>;
export type CourseDto = z.infer<typeof courseSchema>;
export type ProgramDto = z.infer<typeof programSchema>;
export type ProgramWithContentDto = z.infer<typeof programWithContentSchema>;
export type AdminLessonSummary = z.infer<typeof adminLessonSummarySchema>;
export type AdminProgramWithContentDto = z.infer<typeof adminProgramWithContentSchema>;
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
export type EntitlementsResponse = z.infer<typeof entitlementsResponseSchema>;
export type CheckoutSessionDto = z.infer<typeof checkoutSessionSchema>;
export type CheckoutConflictDto = z.infer<typeof checkoutConflictSchema>;
export type BillingPortalSessionDto = z.infer<typeof billingPortalSessionSchema>;
