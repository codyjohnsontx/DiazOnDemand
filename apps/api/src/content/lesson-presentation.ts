import { createHmac } from 'node:crypto';
import { InternalServerErrorException } from '@nestjs/common';
import {
  parseFundamentalsCurriculumTags,
  type LessonDetailDto,
  type LessonSummary,
} from '@diaz/shared';

type LessonTagLike = { tag: { name: string } } | { name: string };

type LessonLike = {
  id: string;
  courseId: string;
  title: string;
  description: string | null;
  orderIndex: number;
  isPublished: boolean;
  accessLevel: 'FREE' | 'PAID';
  muxAssetId?: string | null;
  muxPlaybackId?: string | null;
  durationSeconds?: number | null;
  tags?: LessonTagLike[];
};

function base64UrlEncode(value: string | Buffer) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createMuxPlaybackToken(playbackId: string) {
  const tokenId = process.env.MUX_TOKEN_ID;
  const tokenSecret = process.env.MUX_TOKEN_SECRET;

  if (!tokenId || !tokenSecret) {
    return null;
  }

  const header = {
    alg: 'HS256',
    typ: 'JWT',
    kid: tokenId,
  };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: 'v',
    sub: playbackId,
    exp: now + 60 * 60 * 4,
    nbf: now - 30,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const data = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', tokenSecret).update(data).digest();

  return `${data}.${base64UrlEncode(signature)}`;
}

function extractTagName(tag: LessonTagLike) {
  return 'tag' in tag ? tag.tag.name : tag.name;
}

export function mapLessonCurriculum(tags: LessonTagLike[] = []) {
  return parseFundamentalsCurriculumTags(tags.map(extractTagName));
}

export function mapLessonSummary(lesson: LessonLike): LessonSummary {
  return {
    id: lesson.id,
    courseId: lesson.courseId,
    title: lesson.title,
    description: lesson.description ?? null,
    orderIndex: lesson.orderIndex,
    isPublished: lesson.isPublished,
    accessLevel: lesson.accessLevel as LessonSummary['accessLevel'],
    muxPlaybackId: lesson.muxPlaybackId ?? null,
    durationSeconds: lesson.durationSeconds ?? null,
    curriculum: mapLessonCurriculum(lesson.tags ?? []),
  };
}

export function mapLessonDetail(lesson: LessonLike & { tags: LessonTagLike[] }): LessonDetailDto {
  const summary = mapLessonSummary(lesson);
  const hasPlayback = Boolean(lesson.muxPlaybackId);

  let playbackUrl: string | null = null;
  if (hasPlayback) {
    if (lesson.accessLevel === 'FREE') {
      playbackUrl = `https://stream.mux.com/${lesson.muxPlaybackId}.m3u8`;
    } else {
      const token = createMuxPlaybackToken(lesson.muxPlaybackId as string);

      if (token) {
        playbackUrl = `https://stream.mux.com/${lesson.muxPlaybackId}.m3u8?token=${encodeURIComponent(token)}`;
      } else if (process.env.NODE_ENV !== 'production') {
        playbackUrl = `https://stream.mux.com/${lesson.muxPlaybackId}.m3u8`;
      } else {
        throw new InternalServerErrorException(
          'Premium playback is not configured. Add MUX_TOKEN_ID and MUX_TOKEN_SECRET.',
        );
      }
    }
  }

  return {
    ...summary,
    muxAssetId: lesson.muxAssetId ?? null,
    tags: lesson.tags
      .map((tag) => ('tag' in tag ? tag.tag : tag))
      .map((tag) => ({ id: ('id' in tag ? tag.id : tag.name) as string, name: tag.name })),
    playbackUrl,
    signedPlaybackToken: null,
  };
}
