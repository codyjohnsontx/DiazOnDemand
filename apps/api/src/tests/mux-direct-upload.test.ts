/**
 * The mocked half of direct-to-Mux upload: what the API asks Mux for, and what
 * it writes on the lesson before the file exists. The webhook side that
 * completes the upload is in mux-ingestion.db.test.ts, against a real Postgres,
 * because every one of those writes has to satisfy
 * `lesson_video_provider_consistency_chk`.
 */
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { AccessLevel, VideoProvider } from '@diaz/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminService, uploadCorsOrigin } from '../admin/admin.service.js';
import {
  MuxDirectUploadService,
  playbackPolicyForAccessLevel,
} from '../mux/mux-direct-upload.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

const UPLOAD_URL = 'https://storage.googleapis.com/video-storage/upload-1?signed';

function muxAnswers(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function withMuxToken<T>(run: () => Promise<T>) {
  const previous = { id: process.env.MUX_TOKEN_ID, secret: process.env.MUX_TOKEN_SECRET };
  process.env.MUX_TOKEN_ID = 'token-id';
  process.env.MUX_TOKEN_SECRET = 'token-secret';

  try {
    return await run();
  } finally {
    if (previous.id === undefined) delete process.env.MUX_TOKEN_ID;
    else process.env.MUX_TOKEN_ID = previous.id;
    if (previous.secret === undefined) delete process.env.MUX_TOKEN_SECRET;
    else process.env.MUX_TOKEN_SECRET = previous.secret;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The tier decides the playback policy before the file exists, and
 * `syncMuxAsset` checks the same rule when the asset is ready - so an upload
 * created here is the only kind that handler accepts.
 */
describe('playbackPolicyForAccessLevel', () => {
  it('creates a signed-only asset for a premium lesson', () => {
    expect(playbackPolicyForAccessLevel(AccessLevel.PAID)).toBe('signed');
  });

  it('creates a public asset for a free lesson', () => {
    expect(playbackPolicyForAccessLevel(AccessLevel.FREE)).toBe('public');
  });
});

describe('MuxDirectUploadService.createDirectUpload', () => {
  it('asks Mux for an upload bound to the lesson, under the API token', async () => {
    const fetchMock = muxAnswers(201, {
      data: { id: 'upload-1', url: UPLOAD_URL, status: 'waiting', timeout: 3600 },
    });

    const upload = await withMuxToken(() =>
      new MuxDirectUploadService().createDirectUpload({
        lessonId: 'lesson-1',
        accessLevel: AccessLevel.PAID,
        corsOrigin: 'http://localhost:3000',
      }),
    );

    expect(upload).toEqual({ id: 'upload-1', url: UPLOAD_URL, timeout: 3600 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.mux.com/video/v1/uploads');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('token-id:token-secret').toString('base64')}`,
    );
    expect(JSON.parse(init.body as string)).toEqual({
      cors_origin: 'http://localhost:3000',
      timeout: 3600,
      new_asset_settings: {
        playback_policies: ['signed'],
        // The lesson id rides on the asset, so every later asset event names
        // the lesson it belongs to.
        passthrough: 'lesson-1',
      },
    });
  });

  it('refuses without the API token rather than sending an unauthenticated request', async () => {
    const fetchMock = muxAnswers(201, {});
    delete process.env.MUX_TOKEN_ID;
    delete process.env.MUX_TOKEN_SECRET;

    await expect(
      new MuxDirectUploadService().createDirectUpload({
        lessonId: 'lesson-1',
        accessLevel: AccessLevel.FREE,
        corsOrigin: 'http://localhost:3000',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The status is the diagnosis - 401 is the token, 422 the request - and it
  // reaches the operator, while the body, which may quote the request, is only
  // logged.
  it('reports a Mux refusal by status without echoing the response body', async () => {
    muxAnswers(401, { error: { messages: ['Unauthorized: bearer token invalid'] } });

    await expect(
      withMuxToken(() =>
        new MuxDirectUploadService().createDirectUpload({
          lessonId: 'lesson-1',
          accessLevel: AccessLevel.FREE,
          corsOrigin: 'http://localhost:3000',
        }),
      ),
    ).rejects.toThrow(/HTTP 401/);
  });

  it('refuses an answer that carries no upload url', async () => {
    muxAnswers(201, { data: { id: 'upload-1' } });

    await expect(
      withMuxToken(() =>
        new MuxDirectUploadService().createDirectUpload({
          lessonId: 'lesson-1',
          accessLevel: AccessLevel.FREE,
          corsOrigin: 'http://localhost:3000',
        }),
      ),
    ).rejects.toThrow(/without an upload URL/);
  });
});

describe('uploadCorsOrigin', () => {
  it('reduces the web app url to its origin', () => {
    expect(uploadCorsOrigin('https://app.example.com/some/path?x=1')).toBe('https://app.example.com');
  });

  it('falls back to the local web app', () => {
    expect(uploadCorsOrigin(undefined)).toBe('http://localhost:3000');
  });
});

describe('AdminService.createLessonUpload', () => {
  function service(lesson: Record<string, unknown> | null) {
    const update = vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'lesson-1',
      courseId: 'course-1',
      title: 'Lesson',
      orderIndex: 0,
      isPublished: false,
      accessLevel: AccessLevel.FREE,
      videoProvider: VideoProvider.NONE,
      muxAssetId: null,
      muxPlaybackId: null,
      youtubeVideoId: null,
      muxVideoError: null,
      durationSeconds: null,
      tags: [],
      ...lesson,
      ...data,
    }));
    const prisma = {
      client: { lesson: { findUnique: vi.fn().mockResolvedValue(lesson), update } },
    } as unknown as PrismaService;
    const mux = {
      createDirectUpload: vi.fn().mockResolvedValue({ id: 'upload-1', url: UPLOAD_URL, timeout: 3600 }),
    } as unknown as MuxDirectUploadService;

    return { admin: new AdminService(prisma, mux), update, mux };
  }

  it('stores the upload id, clears the last error, and answers the url with the row', async () => {
    const { admin, update, mux } = service({
      id: 'lesson-1',
      accessLevel: AccessLevel.PAID,
      youtubeVideoId: null,
      muxVideoError: 'Mux could not accept the upload.',
    });

    const answer = await admin.createLessonUpload('lesson-1');

    expect(mux.createDirectUpload).toHaveBeenCalledWith({
      lessonId: 'lesson-1',
      accessLevel: AccessLevel.PAID,
      corsOrigin: expect.stringMatching(/^https?:\/\//),
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'lesson-1' },
        data: { muxUploadId: 'upload-1', muxVideoError: null },
      }),
    );
    expect(answer.uploadId).toBe('upload-1');
    expect(answer.url).toBe(UPLOAD_URL);
    expect(answer.lesson.muxUploadId).toBe('upload-1');
    expect(answer.lesson.muxVideoError).toBeNull();
    // No Mux credential on the payload, ever.
    expect(JSON.stringify(answer)).not.toMatch(/token/i);
  });

  // Nothing about the existing video changes when an upload merely starts:
  // members keep the current asset until `video.upload.asset_created` binds
  // the new one.
  it('leaves the existing asset and playback id alone', async () => {
    const { admin, update } = service({
      id: 'lesson-1',
      accessLevel: AccessLevel.FREE,
      videoProvider: VideoProvider.MUX,
      muxAssetId: 'asset-old',
      muxPlaybackId: 'a1B2c3D4e5F6g7H8i9',
      youtubeVideoId: null,
    });

    await admin.createLessonUpload('lesson-1');

    const [{ data }] = update.mock.calls[0] as [{ data: Record<string, unknown> }];
    expect(data).not.toHaveProperty('muxAssetId');
    expect(data).not.toHaveProperty('muxPlaybackId');
  });

  it('refuses a lesson still holding a YouTube video id, naming the remedy', async () => {
    const { admin, mux } = service({
      id: 'lesson-1',
      accessLevel: AccessLevel.FREE,
      videoProvider: VideoProvider.YOUTUBE,
      youtubeVideoId: 'dQw4w9WgXcQ',
    });

    await expect(admin.createLessonUpload('lesson-1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(admin.createLessonUpload('lesson-1')).rejects.toThrow(/video source to Mux/);
    expect(mux.createDirectUpload).not.toHaveBeenCalled();
  });

  it('answers 404 for a lesson that does not exist', async () => {
    const { admin } = service(null);

    await expect(admin.createLessonUpload('missing')).rejects.toThrow(/Lesson not found/);
  });
});
