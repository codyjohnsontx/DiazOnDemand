/**
 * The FREE -> PAID transition, which is the one ordinary admin action that can
 * carry a publicly-served Mux playback id into paid content.
 *
 * Reproduced end to end against the built API and a real Postgres before this
 * was written: an anonymous `GET /programs` handed out
 * `reproPublicPlaybackId000000000001` and `GET /lessons/:id` handed out
 * `https://stream.mux.com/reproPublicPlaybackId000000000001.m3u8`; the admin
 * PATCH then set `accessLevel` to PAID; `/programs` correctly stopped publishing
 * the id, and the row still held that exact id - so the url the anonymous caller
 * already had went on playing. Withholding is not retiring.
 *
 * These are the mocked half. `mux-ingestion.db.test.ts` carries the half that
 * needs a real database, because what the clear must not do is leave a row
 * `lesson_video_provider_consistency_chk` refuses, and no mocked Prisma can say.
 */
import { AccessLevel, VideoProvider } from '@diaz/db';
import { lessonEditorFieldsAfterSave } from '@diaz/shared';
import { describe, expect, it, vi } from 'vitest';
import { AdminService, planPaidAccessTransition } from '../admin/admin.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

const PUBLIC_PLAYBACK_ID = 'freePlaybackId00000000000000000001';
const SIGNED_PLAYBACK_ID = 'signedPlaybackId0000000000000001';

/** The video columns of a stored lesson; a Prisma row carries every one of them. */
type LessonRow = {
  accessLevel: AccessLevel;
  videoProvider: VideoProvider;
  muxAssetId: string | null;
  muxPlaybackId: string | null;
  youtubeVideoId: string | null;
};

function freeMuxLesson(overrides: Partial<LessonRow> = {}): LessonRow {
  return {
    accessLevel: AccessLevel.FREE,
    videoProvider: VideoProvider.MUX,
    muxAssetId: 'asset-free',
    muxPlaybackId: PUBLIC_PLAYBACK_ID,
    youtubeVideoId: null,
    ...overrides,
  };
}

/** The body the lesson editor sends: every field, including the id it loaded. */
function editorSave(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Lesson',
    accessLevel: AccessLevel.PAID,
    videoProvider: VideoProvider.MUX,
    muxAssetId: 'asset-free',
    muxPlaybackId: PUBLIC_PLAYBACK_ID,
    youtubeVideoId: null,
    ...overrides,
  };
}

describe('the FREE -> PAID transition', () => {
  it('clears the playback id the lesson was serving publicly', () => {
    const plan = planPaidAccessTransition(freeMuxLesson(), editorSave());

    expect(plan.data.muxPlaybackId).toBeNull();
    expect(plan.muxPlaybackIdClearedForPaidAccess).toBe(true);
  });

  // The asset id is the operator's record of which upload this lesson came
  // from, it addresses no stream, and keeping it puts the lesson in the state
  // the "Waiting for Mux" badge already describes.
  it('keeps the asset id, so the lesson lands in the waiting-for-Mux state', () => {
    const plan = planPaidAccessTransition(freeMuxLesson(), editorSave());

    // The clear itself is asserted alongside, or a guard that did nothing at
    // all would satisfy this test by leaving both fields exactly as they were.
    expect(plan.data.muxPlaybackId).toBeNull();
    expect(plan.data.muxAssetId).toBe('asset-free');
    expect(plan.data.videoProvider).toBe(VideoProvider.MUX);
  });

  // `lesson_video_provider_consistency_chk` requires a MUX row to hold a
  // playback id or an asset id. Clearing the only identifier a lesson has would
  // answer 500 on the save instead of protecting anything.
  it('drops the provider to NONE when clearing leaves no Mux identifier at all', () => {
    const plan = planPaidAccessTransition(
      freeMuxLesson({ muxAssetId: null }),
      editorSave({ muxAssetId: null }),
    );

    expect(plan.data.muxPlaybackId).toBeNull();
    expect(plan.data.videoProvider).toBe(VideoProvider.NONE);
    expect(plan.muxPlaybackIdClearedForPaidAccess).toBe(true);
  });

  // Blank is the database's definition of blank. Postgres TRIM() strips U+0020
  // only, so a tab-only id is *present* to the constraint - clearing it is a
  // real change, and the row it leaves behind still has to be storable.
  it('treats a tab-only stored id as present, the way the CHECK constraint does', () => {
    const plan = planPaidAccessTransition(
      freeMuxLesson({ muxAssetId: null, muxPlaybackId: '\t' }),
      editorSave({ muxAssetId: null, muxPlaybackId: '\t' }),
    );

    expect(plan.data.muxPlaybackId).toBeNull();
    expect(plan.data.videoProvider).toBe(VideoProvider.NONE);
  });

  it('has nothing to clear when the free lesson never held a playback id', () => {
    const plan = planPaidAccessTransition(
      freeMuxLesson({ muxPlaybackId: null }),
      editorSave({ muxPlaybackId: null }),
    );

    expect(plan.muxPlaybackIdClearedForPaidAccess).toBe(false);
    expect(plan.data.videoProvider).toBe(VideoProvider.MUX);
  });

  // The operator re-created the asset in Mux and is pasting the new id in the
  // same save. That is the rotation this guard exists to force, so it must not
  // eat the value they just typed.
  it('keeps a different playback id supplied by the same write', () => {
    const plan = planPaidAccessTransition(
      freeMuxLesson(),
      editorSave({ muxPlaybackId: SIGNED_PLAYBACK_ID }),
    );

    expect(plan.data.muxPlaybackId).toBe(SIGNED_PLAYBACK_ID);
    expect(plan.muxPlaybackIdClearedForPaidAccess).toBe(false);
  });

  // A YouTube video id is the video's permanent address on YouTube: re-ingesting
  // yields the same id, premium playback embeds that same public id, and the
  // lesson has no second handle - so clearing it would break a working lesson
  // while retiring nothing. The remedy is in YouTube Studio, and the editor
  // says so.
  it('leaves a YouTube video id alone', () => {
    const plan = planPaidAccessTransition(
      {
        accessLevel: 'FREE',
        videoProvider: VideoProvider.YOUTUBE,
        muxAssetId: null,
        muxPlaybackId: null,
      },
      { accessLevel: 'PAID', videoProvider: VideoProvider.YOUTUBE, youtubeVideoId: 'dQw4w9WgXcQ' },
    );

    expect(plan.data.youtubeVideoId).toBe('dQw4w9WgXcQ');
    expect(plan.muxPlaybackIdClearedForPaidAccess).toBe(false);
  });

  it('reads the { set } spelling of an update the same as the bare value', () => {
    const plan = planPaidAccessTransition(freeMuxLesson(), {
      accessLevel: { set: 'PAID' },
      muxPlaybackId: { set: PUBLIC_PLAYBACK_ID },
    });

    expect(plan.data.muxPlaybackId).toBeNull();
    expect(plan.muxPlaybackIdClearedForPaidAccess).toBe(true);
  });
});

describe('transitions that must not clear anything', () => {
  it('leaves the reverse PAID -> FREE transition alone', () => {
    const plan = planPaidAccessTransition(
      freeMuxLesson({ accessLevel: AccessLevel.PAID }),
      editorSave({ accessLevel: AccessLevel.FREE }),
    );

    expect(plan.data.muxPlaybackId).toBe(PUBLIC_PLAYBACK_ID);
    expect(plan.muxPlaybackIdClearedForPaidAccess).toBe(false);
  });

  // A lesson that was premium from the start never published its id, so there
  // is nothing to retire and an ordinary edit must not blank the video.
  it('leaves an already-paid lesson alone on an ordinary save', () => {
    const plan = planPaidAccessTransition(
      freeMuxLesson({ accessLevel: AccessLevel.PAID, muxPlaybackId: SIGNED_PLAYBACK_ID }),
      editorSave({ muxPlaybackId: SIGNED_PLAYBACK_ID }),
    );

    expect(plan.data.muxPlaybackId).toBe(SIGNED_PLAYBACK_ID);
    expect(plan.muxPlaybackIdClearedForPaidAccess).toBe(false);
  });

  it('leaves a free lesson saved as free alone', () => {
    const plan = planPaidAccessTransition(
      freeMuxLesson(),
      editorSave({ accessLevel: AccessLevel.FREE }),
    );

    expect(plan.data.muxPlaybackId).toBe(PUBLIC_PLAYBACK_ID);
    expect(plan.muxPlaybackIdClearedForPaidAccess).toBe(false);
  });

  // PATCH /admin/lessons/:id/publish sends isPublished and nothing else, so the
  // access level is not mentioned and the row keeps whatever it had.
  it('leaves a publish toggle alone, which never mentions the access level', () => {
    const plan = planPaidAccessTransition(freeMuxLesson(), { isPublished: true });

    expect(plan.data).toEqual({ isPublished: true });
    expect(plan.muxPlaybackIdClearedForPaidAccess).toBe(false);
  });
});

describe('AdminService.updateLesson', () => {
  function adminService(lesson: Record<string, unknown>) {
    const update = vi.fn().mockResolvedValue({ id: 'lesson-1' });
    const prisma = {
      client: {
        lesson: {
          findUnique: vi.fn().mockResolvedValue(lesson),
          update,
          findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'lesson-1', tags: [] }),
        },
      },
    } as unknown as PrismaService;

    return { service: new AdminService(prisma), update };
  }

  it('writes the cleared playback id and reports the clear on the response', async () => {
    const { service, update } = adminService({ id: 'lesson-1', ...freeMuxLesson() });

    const saved = await service.updateLesson('lesson-1', editorSave());

    expect(update).toHaveBeenCalledWith({
      where: { id: 'lesson-1' },
      data: expect.objectContaining({ muxPlaybackId: null }),
    });
    expect(saved.muxPlaybackIdClearedForPaidAccess).toBe(true);
  });

  it('reports no clear on an ordinary save', async () => {
    const { service, update } = adminService({ id: 'lesson-1', ...freeMuxLesson() });

    const saved = await service.updateLesson('lesson-1', editorSave({ accessLevel: 'FREE' }));

    expect(update).toHaveBeenCalledWith({
      where: { id: 'lesson-1' },
      data: expect.objectContaining({ muxPlaybackId: PUBLIC_PLAYBACK_ID }),
    });
    expect(saved.muxPlaybackIdClearedForPaidAccess).toBe(false);
  });
});

/**
 * The clear survives a second click on Save.
 *
 * Found by an independent review of this change and reproduced here before it
 * was fixed. The editor's Save button carried no disabled state and `onSave` no
 * in-flight guard, and the form was only repopulated when `load()` returned from
 * `/admin/programs` - so between the PATCH answering and that reload landing, the
 * form still held the playback id the save had just retired. A second click
 * re-sent it, the API saw PAID -> PAID, correctly declined to clear, and wrote
 * the public identifier back onto the paid lesson under a plain "Lesson saved.".
 *
 * The API is right at every step, which is why the guard is not here: nothing on
 * the row distinguishes an operator legitimately pasting a rotated id from a
 * stale form resending a retired one. The fix is for the editor to believe the
 * answer it was given, and `lessonEditorFieldsAfterSave` is that rule. The web
 * app has no test runner, so this is where the two halves can be driven
 * together.
 */
describe('a second save before the editor reloads', () => {
  /** `prisma.lesson.update` semantics: an undefined field leaves the column alone. */
  function applyUpdate(row: LessonRow, data: Record<string, unknown>): LessonRow {
    const next: Record<string, unknown> = { ...row };
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) next[key] = value;
    }
    return next as LessonRow;
  }

  function save(row: LessonRow, body: Record<string, unknown>) {
    const plan = planPaidAccessTransition(row, body as never);
    return { row: applyUpdate(row, plan.data as Record<string, unknown>) };
  }

  it('put the retired playback id back when the form was not reconciled', () => {
    const first = save(freeMuxLesson(), editorSave());
    expect(first.row.muxPlaybackId).toBeNull();

    // The form as it stood before the API answered - unchanged, because nothing
    // had reconciled it.
    const second = save(first.row, editorSave());

    expect(second.row.muxPlaybackId).toBe(PUBLIC_PLAYBACK_ID);
    expect(second.row.accessLevel).toBe(AccessLevel.PAID);
  });

  it('sends no retired playback id once the form adopts the saved row', () => {
    const first = save(freeMuxLesson(), editorSave());
    const reconciled = lessonEditorFieldsAfterSave(first.row);

    // Exactly what the editor builds from its form: blank is sent as null.
    const secondBody = editorSave({
      accessLevel: reconciled.accessLevel,
      videoProvider: reconciled.videoProvider,
      muxAssetId: reconciled.muxAssetId || null,
      muxPlaybackId: reconciled.muxPlaybackId || null,
    });

    expect(secondBody.muxPlaybackId).toBeNull();

    const second = save(first.row, secondBody);

    expect(second.row.muxPlaybackId).toBeNull();
    expect(second.row.accessLevel).toBe(AccessLevel.PAID);
  });
});
