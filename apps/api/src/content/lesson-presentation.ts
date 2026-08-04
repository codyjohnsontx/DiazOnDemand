import { createSign } from 'node:crypto';
import { InternalServerErrorException } from '@nestjs/common';
import {
  VideoProvider,
  isValidMuxPlaybackId,
  isValidYouTubeVideoId,
  parseCurriculumTags,
  type AdminLessonSummary,
  type LessonDetailDto,
  type LessonSummary,
} from '@diaz/shared';
import { isUnsignedPaidPlaybackAllowed } from '../config/env.js';

type LessonTagLike = { tag: { name: string } } | { name: string };

type LessonLike = {
  id: string;
  courseId: string;
  title: string;
  description: string | null;
  orderIndex: number;
  isPublished: boolean;
  accessLevel: 'FREE' | 'PAID';
  videoProvider?: string | null;
  muxAssetId?: string | null;
  muxPlaybackId?: string | null;
  youtubeVideoId?: string | null;
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

/**
 * Mux signed playback tokens are RS256 JWTs signed with a Mux *signing key* -
 * a different credential from the MUX_TOKEN_ID/MUX_TOKEN_SECRET API access
 * token, and a different algorithm from HMAC. See Mux's secure-playback guide.
 */
function createMuxPlaybackToken(playbackId: string) {
  const keyId = process.env.MUX_SIGNING_KEY_ID;
  const rawPrivateKey = process.env.MUX_SIGNING_KEY_PRIVATE;

  if (!keyId || !rawPrivateKey) {
    return null;
  }

  // The dashboard hands the RSA key over base64-encoded so it fits on one env
  // line; a key pasted straight from a .pem file is already usable as-is.
  const privateKey = rawPrivateKey.includes('-----BEGIN')
    ? rawPrivateKey
    : Buffer.from(rawPrivateKey, 'base64').toString('utf8');

  const header = {
    alg: 'RS256',
    typ: 'JWT',
    kid: keyId,
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
  const signature = createSign('RSA-SHA256').update(data).sign(privateKey);

  return `${data}.${base64UrlEncode(signature)}`;
}

function extractTagName(tag: LessonTagLike) {
  return 'tag' in tag ? tag.tag.name : tag.name;
}

export function mapLessonCurriculum(tags: LessonTagLike[] = []) {
  return parseCurriculumTags(tags.map(extractTagName));
}

/**
 * The provider identifiers a caller is allowed to see, which for a PAID lesson
 * is none of them. One rule for every provider, so a new one cannot be added
 * past it.
 *
 * `/programs`, `/programs/:id` and `/courses/:id` need no authentication, so
 * every id on those payloads is public. These ids are not names, they are the
 * whole address of the video: on a Mux asset uploaded with a `public` playback
 * policy, `https://stream.mux.com/<id>.m3u8` plays for anyone holding it, and a
 * YouTube video id plays at youtube.com for anyone holding it unless that video
 * is Private. An anonymous visitor is meant to see that a paid lesson exists,
 * not to be handed the key to it.
 *
 * The urls built in `mapLessonDetail` - the signed `playbackUrl` for Mux, the
 * `embedUrl` for YouTube - are the only handles on a paid video, and they are
 * minted behind the entitlement check in `ContentService.getLesson`. Admins get
 * the real ids back through `mapAdminLessonSummary`.
 */
function publicVideoIdentifiers(lesson: LessonLike) {
  const withheld = lesson.accessLevel === 'PAID';
  const provider = resolveVideoProvider(lesson);

  return {
    // An identifier the provider cannot address is never handed out, whatever
    // the access level: it can only produce a hard player error.
    muxPlaybackId:
      withheld || provider !== VideoProvider.MUX ? null : (lesson.muxPlaybackId ?? null),
    youtubeVideoId:
      withheld || provider !== VideoProvider.YOUTUBE ? null : (lesson.youtubeVideoId ?? null),
  };
}

/**
 * Which provider can actually play this lesson, which is not the same question
 * as which provider the row says it uses.
 *
 * A stored identifier that is provably unusable - see `isValidMuxPlaybackId` in
 * @diaz/shared, which rejects the placeholders this repository seeded and
 * values unsafe in the playback url, and accepts everything else because Mux
 * documents no shape - resolves to NONE, so the member gets
 * the honest not-yet-filmed state instead of a player that loads and then fails
 * with "Video does not exist". A truthful empty state beats a broken one, and
 * that is the whole reason this check sits on the read path rather than only on
 * the seed: it covers rows this repository never wrote.
 *
 * Staff see the stored provider instead - see `mapAdminLessonSummary`.
 */
function resolveVideoProvider(lesson: LessonLike) {
  if (lesson.videoProvider === VideoProvider.YOUTUBE && isValidYouTubeVideoId(lesson.youtubeVideoId)) {
    return VideoProvider.YOUTUBE;
  }

  if (
    (lesson.videoProvider === VideoProvider.MUX || !lesson.videoProvider) &&
    isValidMuxPlaybackId(lesson.muxPlaybackId)
  ) {
    return VideoProvider.MUX;
  }

  return VideoProvider.NONE;
}

export function mapLessonSummary(lesson: LessonLike): LessonSummary {
  const videoProvider = resolveVideoProvider(lesson);

  return {
    id: lesson.id,
    courseId: lesson.courseId,
    title: lesson.title,
    description: lesson.description ?? null,
    orderIndex: lesson.orderIndex,
    isPublished: lesson.isPublished,
    accessLevel: lesson.accessLevel as LessonSummary['accessLevel'],
    videoProvider,
    ...publicVideoIdentifiers(lesson),
    durationSeconds: lesson.durationSeconds ?? null,
    curriculum: mapLessonCurriculum(lesson.tags ?? []),
  };
}

/**
 * Admin projection: same as the public summary plus `muxAssetId`, which admins
 * set so the Mux `video.asset.ready` webhook can find the lesson to sync, and
 * the real provider identifiers the public summary withholds for PAID lessons -
 * admins type them into the lesson editor, and this route is behind
 * `AuthGuard` + `RolesGuard(ADMIN, COACH)`.
 *
 * `videoProvider` is the *stored* one here, not the resolved one. The lesson
 * editor loads this payload straight into its form, so a resolved NONE would
 * hide the playback-id field and blank the identifier on the next save - the
 * editor would quietly eat whatever an admin had typed. Staff need to see the
 * row as saved; members need to see only what plays.
 */
export function mapAdminLessonSummary(lesson: LessonLike): AdminLessonSummary {
  return {
    ...mapLessonSummary(lesson),
    videoProvider: (lesson.videoProvider as AdminLessonSummary['videoProvider']) ?? VideoProvider.MUX,
    muxPlaybackId: lesson.muxPlaybackId ?? null,
    youtubeVideoId: lesson.youtubeVideoId ?? null,
    muxAssetId: lesson.muxAssetId ?? null,
  };
}

export function mapLessonDetail(lesson: LessonLike & { tags: LessonTagLike[] }): LessonDetailDto {
  const summary = mapLessonSummary(lesson);
  const videoProvider = resolveVideoProvider(lesson);

  let playbackUrl: string | null = null;
  let embedUrl: string | null = null;

  if (videoProvider === VideoProvider.MUX && lesson.muxPlaybackId) {
    if (lesson.accessLevel === 'FREE') {
      playbackUrl = `https://stream.mux.com/${lesson.muxPlaybackId}.m3u8`;
    } else {
      const token = createMuxPlaybackToken(lesson.muxPlaybackId as string);

      if (token) {
        playbackUrl = `https://stream.mux.com/${lesson.muxPlaybackId}.m3u8?token=${encodeURIComponent(token)}`;
      } else if (isUnsignedPaidPlaybackAllowed(process.env)) {
        playbackUrl = `https://stream.mux.com/${lesson.muxPlaybackId}.m3u8`;
      } else {
        throw new InternalServerErrorException(
          'Premium playback is not configured. Add MUX_SIGNING_KEY_ID and MUX_SIGNING_KEY_PRIVATE.',
        );
      }
    }
  }

  if (videoProvider === VideoProvider.YOUTUBE && lesson.youtubeVideoId) {
    embedUrl = `https://www.youtube-nocookie.com/embed/${lesson.youtubeVideoId}?rel=0&modestbranding=1`;
  }

  return {
    ...summary,
    muxAssetId: lesson.muxAssetId ?? null,
    tags: lesson.tags
      .map((tag) => ('tag' in tag ? tag.tag : tag))
      .map((tag) => ({ id: ('id' in tag ? tag.id : tag.name) as string, name: tag.name })),
    video: {
      provider: videoProvider,
      playbackUrl,
      // Withheld for PAID lessons even here, behind the entitlement check.
      // Measured against @mux/mux-player 3.11.4 in Chrome: given both a
      // `playbackId` and a signed `src`, the player requests
      // `stream.mux.com/<id>.m3u8?redundant_streams=true` and drops the token
      // entirely - byte-identical to the request it makes with no `src` at all.
      // So leaving the id on this payload does not merely widen the exposure,
      // it is what stops signed playback working. `playbackUrl` and `embedUrl`
      // are the handles.
      ...publicVideoIdentifiers(lesson),
      embedUrl,
    },
  };
}
