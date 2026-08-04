import { VideoProvider } from './enums.js';

/**
 * The 16 placeholder Mux playback ids this repository itself seeded into
 * published lessons. `seedgrddef101` reads "seed / guard retention / defense /
 * 101"; each one loaded the player and then failed with "Video does not exist".
 *
 * This list is the whole known-bad set, and it is verifiable rather than
 * inferred: it is exactly the `muxPlaybackId: 'seed...'` values that stood in
 * `packages/db/prisma/seed-curriculum/programs.ts` before they were cleared,
 * recoverable from git history at `d099a83`.
 */
const SEEDED_PLACEHOLDER_MUX_PLAYBACK_IDS: ReadonlySet<string> = new Set([
  'seedgrddef101',
  'seedgrddef102',
  'seedgrdoff201',
  'seedgrdoff202',
  'seedgpsdef301',
  'seedgpsdef302',
  'seedgpsoff401',
  'seedgpsoff402',
  'seedscddef501',
  'seedscddef502',
  'seedscdoff601',
  'seedscdoff602',
  'seedbcddef701',
  'seedbcddef702',
  'seedbcdoff801',
  'seedbcdoff802',
]);

/**
 * Characters an identifier may contain to be interpolated into
 * `https://stream.mux.com/<id>.m3u8` without changing what that URL addresses.
 *
 * This constraint is justified by the interpolation site, NOT by any claim
 * about Mux's alphabet: `/`, `?`, `#`, `.` and whitespace would change the path,
 * start a query, start a fragment, or traverse. Everything else is allowed
 * through, because Mux does not document a character set and inventing one is
 * how the previous version of this rule broke.
 */
const URL_PATH_SAFE_PATTERN = /^[A-Za-z0-9_-]+$/;

const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/**
 * Whether a stored Mux playback id may be used, which is a narrower claim than
 * "this identifier addresses a real video".
 *
 * This rule used to require 20 or more characters, on my assertion that Mux
 * issues ids of roughly 35 to 50. Mux documents no such thing: `PlaybackID.id`
 * is documented only as a string, and Mux's own API reference response example
 * is the 18-character `a1B2c3D4e5F6g7H8i9`. That floor therefore routed a
 * genuine Mux id to NONE and told the member the lesson was not filmed - the
 * same product lying this module exists to stop, pointed the other way, and
 * silently. An independent review reproduced it.
 *
 * So the rule is inverted. It rejects only what can be shown to be bad:
 *
 * - the 16 placeholders this repository seeded, listed above and checkable
 *   against git history, and
 * - values that are not safe to interpolate into the playback URL.
 *
 * Everything else is accepted, because Mux's documented contract is "a string"
 * and guessing at a tighter shape is what caused the defect.
 *
 * What this deliberately does NOT promise, in either direction: it cannot tell
 * whether an accepted id addresses anything. A mistyped-but-URL-safe id, or an
 * asset later deleted from Mux, is accepted here and will still fail in the
 * player. Only the provider can settle existence, and nothing in this
 * repository is permitted to ask it. Catching a *new* placeholder someone types
 * needs provider validation at a write boundary, not a shape rule.
 */
export function isValidMuxPlaybackId(value: string | null | undefined): value is string {
  return (
    typeof value === 'string' &&
    URL_PATH_SAFE_PATTERN.test(value) &&
    !SEEDED_PLACEHOLDER_MUX_PLAYBACK_IDS.has(value)
  );
}

export function isValidYouTubeVideoId(value: string | null | undefined): value is string {
  return typeof value === 'string' && YOUTUBE_VIDEO_ID_PATTERN.test(value);
}

/**
 * Whether a lesson resolves to a video a member can actually watch.
 *
 * The API answers that on the read path and publishes the answer as the
 * lesson's `videoProvider`, so member surfaces read it here rather than
 * re-deriving the rule: a lesson whose stored identifier cannot address a video
 * arrives as NONE. Anything a member is told *about* the video - its runtime,
 * for one - is only true when this is true, so a not-yet-filmed lesson does not
 * advertise an exact length it has never had.
 *
 * Admin payloads carry the *stored* provider instead, so this is not the
 * question to ask there - see `hasUnplayableVideoIdentifier`.
 */
export function hasPlayableVideo(lesson: { videoProvider?: VideoProvider | null }) {
  return (
    lesson.videoProvider === VideoProvider.MUX || lesson.videoProvider === VideoProvider.YOUTUBE
  );
}

/**
 * Whether a lesson holds a stored identifier the read path will refuse.
 *
 * This is the staff-side view of the same rule. Members are shown the honest
 * not-filmed state, silently, which leaves the one person who can fix a
 * mistyped identifier with nothing to see: the admin payload reports the row as
 * saved, so a broken id looks correctly configured. It rejects nothing and
 * blocks no save - a format rule cannot be checked against the provider account
 * - it only says that this row, as stored, will not play.
 */
export function hasUnplayableVideoIdentifier(lesson: {
  videoProvider?: VideoProvider | null;
  muxPlaybackId?: string | null;
  youtubeVideoId?: string | null;
}) {
  if (lesson.videoProvider === VideoProvider.MUX) {
    const stored = lesson.muxPlaybackId ?? '';
    return stored.trim().length > 0 && !isValidMuxPlaybackId(stored);
  }

  if (lesson.videoProvider === VideoProvider.YOUTUBE) {
    const stored = lesson.youtubeVideoId ?? '';
    return stored.trim().length > 0 && !isValidYouTubeVideoId(stored);
  }

  return false;
}
