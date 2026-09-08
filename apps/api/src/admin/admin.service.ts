import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, VideoProvider } from '@diaz/db';
import type { CurriculumMetadata } from '@diaz/shared';
import {
  clearsMuxPlaybackIdOnPaidTransition,
  createCurriculumTags,
  isStoredIdentifierAbsent,
} from '@diaz/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { mapAdminLessonSummary } from '../content/lesson-presentation.js';

/** The stored fields a paid-access transition has to reason about. */
type LessonVideoRow = {
  accessLevel: string;
  videoProvider: string;
  muxAssetId: string | null;
  muxPlaybackId: string | null;
};

/**
 * What a Prisma update sets this field to, or `undefined` when the write leaves
 * the column alone.
 *
 * Prisma accepts either the bare value or `{ set: value }`, and both spellings
 * have to answer the same here: reading only the bare one would report "not
 * mentioned" for a write that did mention the column, and the guard below turns
 * exactly that distinction into a decision.
 *
 * No caller in this repository produces the `{ set: value }` spelling today, and
 * it is kept deliberately rather than left as dead code: a future caller writing
 * `{ set: null }` would otherwise dodge the guard silently.
 */
function nextFieldValue(
  field: string | null | { set?: string | null } | undefined,
): string | null | undefined {
  if (field === undefined || field === null || typeof field === 'string') {
    return field;
  }

  return field.set;
}

/** The value a column will hold after this write. */
function nextStoredValue(field: string | null | undefined, stored: string | null) {
  return field === undefined ? stored : field;
}

/**
 * The write that actually gets saved when an admin flips a lesson to premium,
 * and whether it retired the Mux playback id doing so.
 *
 * `clearsMuxPlaybackIdOnPaidTransition` in @diaz/shared holds the rule and the
 * reasoning, including why `youtubeVideoId` is deliberately untouched. This is
 * the half that has to keep the row storable: `lesson_video_provider_consistency_chk`
 * requires a MUX row to hold a playback id *or* an asset id, so clearing the
 * playback id off a lesson that has no asset id would answer 500 on the save
 * rather than protecting anything. Such a row is left with no Mux identifier at
 * all, which is `videoProvider = NONE` - the honest not-filmed state, and the
 * one the read path would resolve to anyway.
 *
 * A lesson that does keep its asset id lands in the "Waiting for Mux" state
 * instead, and that is the useful place for it: the asset id is the operator's
 * record of which upload this lesson came from, it addresses no stream, and
 * redelivering `video.asset.ready` for it is refused by `syncMuxAsset` with the
 * remedy named - re-create the asset with a signed-only playback policy. The
 * loop an operator can get into here ends at the right instruction rather than
 * at a lesson that quietly plays for free.
 */
export function planPaidAccessTransition(
  lesson: LessonVideoRow,
  data: Prisma.LessonUpdateInput,
): { data: Prisma.LessonUpdateInput; muxPlaybackIdClearedForPaidAccess: boolean } {
  const cleared = clearsMuxPlaybackIdOnPaidTransition({
    previousAccessLevel: lesson.accessLevel,
    nextAccessLevel: nextStoredValue(nextFieldValue(data.accessLevel), lesson.accessLevel),
    storedMuxPlaybackId: lesson.muxPlaybackId,
    incomingMuxPlaybackId: nextFieldValue(data.muxPlaybackId),
  });

  if (!cleared) {
    return { data, muxPlaybackIdClearedForPaidAccess: false };
  }

  const muxAssetId = nextStoredValue(nextFieldValue(data.muxAssetId), lesson.muxAssetId);
  const videoProvider = nextStoredValue(nextFieldValue(data.videoProvider), lesson.videoProvider);

  return {
    data: {
      ...data,
      muxPlaybackId: null,
      ...(videoProvider === VideoProvider.MUX && isStoredIdentifierAbsent(muxAssetId)
        ? { videoProvider: VideoProvider.NONE }
        : {}),
    },
    muxPlaybackIdClearedForPaidAccess: true,
  };
}

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listPrograms() {
    const programs = await this.prisma.client.program.findMany({
      orderBy: { orderIndex: 'asc' },
      include: {
        courses: {
          orderBy: { orderIndex: 'asc' },
          include: {
            lessons: {
              orderBy: { orderIndex: 'asc' },
              include: {
                tags: {
                  include: { tag: true },
                },
              },
            },
          },
        },
      },
    });

    return programs.map((program) => ({
      ...program,
      courses: program.courses.map((course) => ({
        ...course,
        lessons: course.lessons.map((lesson) => mapAdminLessonSummary(lesson)),
      })),
    }));
  }

  createProgram(data: Prisma.ProgramCreateInput) {
    return this.prisma.client.program.create({ data });
  }

  async updateProgram(id: string, data: Prisma.ProgramUpdateInput) {
    const program = await this.prisma.client.program.findUnique({ where: { id } });
    if (!program) {
      throw new NotFoundException('Program not found');
    }
    return this.prisma.client.program.update({ where: { id }, data });
  }

  deleteProgram(id: string) {
    return this.prisma.client.program.delete({ where: { id } });
  }

  createCourse(data: Prisma.CourseCreateInput) {
    return this.prisma.client.course.create({ data });
  }

  async updateCourse(id: string, data: Prisma.CourseUpdateInput) {
    const course = await this.prisma.client.course.findUnique({ where: { id } });
    if (!course) {
      throw new NotFoundException('Course not found');
    }
    return this.prisma.client.course.update({ where: { id }, data });
  }

  deleteCourse(id: string) {
    return this.prisma.client.course.delete({ where: { id } });
  }

  async createLesson(data: Prisma.LessonCreateInput, curriculum?: CurriculumMetadata | null) {
    const lesson = await this.prisma.client.lesson.create({ data });
    await this.syncLessonCurriculumTags(lesson.id, curriculum ?? null);
    return this.prisma.client.lesson.findUniqueOrThrow({
      where: { id: lesson.id },
      include: {
        tags: {
          include: { tag: true },
        },
      },
    });
  }

  async updateLesson(
    id: string,
    data: Prisma.LessonUpdateInput,
    curriculum?: CurriculumMetadata | null,
  ) {
    const lesson = await this.prisma.client.lesson.findUnique({ where: { id } });
    if (!lesson) {
      throw new NotFoundException('Lesson not found');
    }
    const transition = planPaidAccessTransition(lesson, data);
    const updated = await this.prisma.client.lesson.update({
      where: { id },
      data: transition.data,
    });
    if (curriculum !== undefined) {
      await this.syncLessonCurriculumTags(id, curriculum);
    }
    const saved = await this.prisma.client.lesson.findUniqueOrThrow({
      where: { id: updated.id },
      include: {
        tags: {
          include: { tag: true },
        },
      },
    });

    // A fact about this save, not about the row, so it is answered here and
    // never stored: the lesson editor sends the playback id it loaded, and an
    // operator who flips the switch and finds the field empty has to be told
    // why at the moment it happens. Nothing about the saved row records that a
    // clear took place - by design, since a column recording it could only
    // drift from the three fields that already describe the video - so the
    // response is the one place the answer can come from.
    return { ...saved, muxPlaybackIdClearedForPaidAccess: transition.muxPlaybackIdClearedForPaidAccess };
  }

  deleteLesson(id: string) {
    return this.prisma.client.lesson.delete({ where: { id } });
  }

  private async syncLessonCurriculumTags(lessonId: string, curriculum: CurriculumMetadata | null) {
    const desiredNames = curriculum ? createCurriculumTags(curriculum) : [];
    const existing = await this.prisma.client.lessonTag.findMany({
      where: { lessonId },
      include: { tag: true },
    });

    const managedExisting = existing.filter((entry) =>
      entry.tag.name.startsWith('discipline:') ||
      entry.tag.name.startsWith('phase:') ||
      entry.tag.name.startsWith('track:') ||
      entry.tag.name.startsWith('skill:') ||
      entry.tag.name.startsWith('level:'),
    );

    const toRemove = managedExisting.filter((entry) => !desiredNames.includes(entry.tag.name));
    if (toRemove.length > 0) {
      await this.prisma.client.lessonTag.deleteMany({
        where: {
          lessonId,
          tagId: {
            in: toRemove.map((entry) => entry.tagId),
          },
        },
      });
    }

    for (const name of desiredNames) {
      const tag = await this.prisma.client.tag.upsert({
        where: { name },
        update: {},
        create: { name },
      });

      await this.prisma.client.lessonTag.upsert({
        where: { lessonId_tagId: { lessonId, tagId: tag.id } },
        update: {},
        create: { lessonId, tagId: tag.id },
      });
    }
  }
}
