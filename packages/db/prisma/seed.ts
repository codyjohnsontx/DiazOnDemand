import { PrismaClient, AccessLevel, EntitlementTier, Role } from '@prisma/client';

const prisma = new PrismaClient();

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

  const program = await prisma.program.upsert({
    where: { id: '11111111-1111-1111-1111-111111111111' },
    update: {
      title: 'Diaz Fundamentals',
      description: 'MVP seeded fundamentals program',
      isPublished: true,
    },
    create: {
      id: '11111111-1111-1111-1111-111111111111',
      title: 'Diaz Fundamentals',
      description: 'MVP seeded fundamentals program',
      orderIndex: 1,
      isPublished: true,
    },
  });

  const course = await prisma.course.upsert({
    where: { id: '22222222-2222-2222-2222-222222222222' },
    update: {
      title: 'Guard Retention 101',
      description: 'Core frames, hip movement, and recovery drills',
      isPublished: true,
    },
    create: {
      id: '22222222-2222-2222-2222-222222222222',
      programId: program.id,
      title: 'Guard Retention 101',
      description: 'Core frames, hip movement, and recovery drills',
      orderIndex: 1,
      isPublished: true,
    },
  });

  const lessons = [
    {
      id: '33333333-3333-3333-3333-333333333331',
      title: 'Frame Fundamentals',
      orderIndex: 1,
      accessLevel: AccessLevel.FREE,
      muxPlaybackId: 'seedplaybackfree123',
    },
    {
      id: '33333333-3333-3333-3333-333333333332',
      title: 'Hip Escape from Bottom Side Control to Guard Recovery',
      orderIndex: 2,
      accessLevel: AccessLevel.PAID,
      muxPlaybackId: 'seedplaybackpaid234',
    },
    {
      id: '33333333-3333-3333-3333-333333333333',
      title: 'Leg Pummel Timing',
      orderIndex: 3,
      accessLevel: AccessLevel.PAID,
      muxPlaybackId: 'seedplaybackpaid345',
    },
  ];
  const [lessonOne, lessonTwo, lessonThree] = lessons;
  if (!lessonOne || !lessonTwo || !lessonThree) {
    throw new Error('Seed lessons are not fully defined');
  }

  for (const lesson of lessons) {
    await prisma.lesson.upsert({
      where: { id: lesson.id },
      update: {
        title: lesson.title,
        description: `${lesson.title} drill`,
        orderIndex: lesson.orderIndex,
        accessLevel: lesson.accessLevel,
        muxPlaybackId: lesson.muxPlaybackId,
        isPublished: true,
      },
      create: {
        id: lesson.id,
        courseId: course.id,
        title: lesson.title,
        description: `${lesson.title} drill`,
        orderIndex: lesson.orderIndex,
        accessLevel: lesson.accessLevel,
        muxPlaybackId: lesson.muxPlaybackId,
        isPublished: true,
      },
    });
  }

  const [tagGuard, tagMobility, tagAdvanced] = await Promise.all([
    prisma.tag.upsert({ where: { name: 'guard' }, update: {}, create: { name: 'guard' } }),
    prisma.tag.upsert({ where: { name: 'mobility' }, update: {}, create: { name: 'mobility' } }),
    prisma.tag.upsert({ where: { name: 'advanced' }, update: {}, create: { name: 'advanced' } }),
  ]);

  await prisma.lessonTag.upsert({
    where: { lessonId_tagId: { lessonId: lessonOne.id, tagId: tagGuard.id } },
    update: {},
    create: { lessonId: lessonOne.id, tagId: tagGuard.id },
  });
  await prisma.lessonTag.upsert({
    where: { lessonId_tagId: { lessonId: lessonTwo.id, tagId: tagMobility.id } },
    update: {},
    create: { lessonId: lessonTwo.id, tagId: tagMobility.id },
  });
  await prisma.lessonTag.upsert({
    where: { lessonId_tagId: { lessonId: lessonThree.id, tagId: tagAdvanced.id } },
    update: {},
    create: { lessonId: lessonThree.id, tagId: tagAdvanced.id },
  });

  console.log('Seed complete', { userId: user.id, programId: program.id, courseId: course.id });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
