import {
  PrismaClient,
  Discipline,
  EntitlementTier,
  Role,
  VideoProvider,
} from '@prisma/client';
import { createCurriculumTags } from '@diaz/shared';
import { curriculumProgramsSeed } from './seed-curriculum/programs.js';

const prisma = new PrismaClient();

async function seedPrograms() {
  for (const program of curriculumProgramsSeed) {
    await prisma.program.upsert({
      where: { id: program.id },
      update: {
        title: program.title,
        description: program.description,
        orderIndex: program.orderIndex,
        discipline: program.discipline as Discipline,
        isFeaturedDemo: program.isFeaturedDemo,
        isPublished: program.isPublished,
      },
      create: {
        id: program.id,
        title: program.title,
        description: program.description,
        orderIndex: program.orderIndex,
        discipline: program.discipline as Discipline,
        isFeaturedDemo: program.isFeaturedDemo,
        isPublished: program.isPublished,
      },
    });

    for (const course of program.courses) {
      await prisma.course.upsert({
        where: { id: course.id },
        update: {
          programId: program.id,
          title: course.title,
          description: course.description,
          orderIndex: course.orderIndex,
          isPublished: true,
        },
        create: {
          id: course.id,
          programId: program.id,
          title: course.title,
          description: course.description,
          orderIndex: course.orderIndex,
          isPublished: true,
        },
      });
    }
  }

  const seededLessons = curriculumProgramsSeed.flatMap((program) =>
    program.courses.flatMap((course) =>
      course.lessons.map((lesson) => ({
        ...lesson,
        courseId: course.id,
        tags: createCurriculumTags(lesson.curriculum),
      })),
    ),
  );

  for (const lesson of seededLessons) {
    await prisma.lesson.upsert({
      where: { id: lesson.id },
      update: {
        courseId: lesson.courseId,
        title: lesson.title,
        description: lesson.description,
        orderIndex: lesson.orderIndex,
        accessLevel: lesson.accessLevel,
        videoProvider: lesson.videoProvider as VideoProvider,
        // Always null, never a seeded value: `LessonSeed` has no field for a Mux
        // playback id, because seed data inventing them is what published 16
        // lessons pointing at videos that did not exist. The only Mux ids that
        // reach this column come from the `video.asset.ready` webhook and are
        // real by construction.
        //
        // Written explicitly rather than left out, because Prisma reads
        // `undefined` as "leave this column alone": re-running the seed has to
        // be able to clear a stale identifier, not only set one. That does mean
        // the seed is authoritative and will clear a Mux id later attached to a
        // seeded lesson, which matches how it already overwrites title, access
        // level, duration and publication state.
        muxPlaybackId: null,
        youtubeVideoId: lesson.youtubeVideoId ?? null,
        durationSeconds: lesson.durationSeconds,
        isPublished: true,
      },
      create: {
        id: lesson.id,
        courseId: lesson.courseId,
        title: lesson.title,
        description: lesson.description,
        orderIndex: lesson.orderIndex,
        accessLevel: lesson.accessLevel,
        videoProvider: lesson.videoProvider as VideoProvider,
        muxPlaybackId: null,
        youtubeVideoId: lesson.youtubeVideoId ?? null,
        durationSeconds: lesson.durationSeconds,
        isPublished: true,
      },
    });
  }

  const uniqueTagNames = [...new Set(seededLessons.flatMap((lesson) => lesson.tags))];
  const tagIdByName = new Map<string, string>();

  for (const tagName of uniqueTagNames) {
    const tag = await prisma.tag.upsert({
      where: { name: tagName },
      update: {},
      create: { name: tagName },
    });
    tagIdByName.set(tag.name, tag.id);
  }

  for (const lesson of seededLessons) {
    await prisma.lessonTag.deleteMany({
      where: {
        lessonId: lesson.id,
        tag: {
          name: {
            notIn: [...lesson.tags],
          },
        },
      },
    });

    for (const tagName of lesson.tags) {
      const tagId = tagIdByName.get(tagName);
      if (!tagId) {
        throw new Error(`Missing tag id for lesson tag "${tagName}"`);
      }

      await prisma.lessonTag.upsert({
        where: { lessonId_tagId: { lessonId: lesson.id, tagId } },
        update: {},
        create: { lessonId: lesson.id, tagId },
      });
    }
  }

  return {
    programCount: curriculumProgramsSeed.length,
    courseCount: curriculumProgramsSeed.reduce((sum, program) => sum + program.courses.length, 0),
    lessonCount: seededLessons.length,
    tagCount: uniqueTagNames.length,
  };
}

async function main() {
  const clerkUserId = process.env.SEED_DEV_CLERK_USER_ID ?? 'dev_clerk_user';

  const user = await prisma.user.upsert({
    where: { clerkUserId },
    update: {},
    create: {
      clerkUserId,
      role: Role.ADMIN,
      entitlement: { create: { tier: EntitlementTier.PREMIUM } },
    },
    include: { entitlement: true },
  });

  const curriculum = await seedPrograms();

  console.log('Seed complete', {
    userId: user.id,
    ...curriculum,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
