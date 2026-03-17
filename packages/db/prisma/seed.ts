import {
  PrismaClient,
  Discipline,
  EntitlementTier,
  Role,
  VideoProvider,
} from '@prisma/client';
import { createCurriculumTags, type CurriculumMetadata } from '@diaz/shared';
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
        muxPlaybackId: lesson.muxPlaybackId,
        youtubeVideoId: lesson.youtubeVideoId,
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
        muxPlaybackId: lesson.muxPlaybackId,
        youtubeVideoId: lesson.youtubeVideoId,
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
