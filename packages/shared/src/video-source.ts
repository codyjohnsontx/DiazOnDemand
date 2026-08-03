/**
 * Whether a stored provider identifier can address a video at all.
 *
 * The seeded catalog shipped 16 published lessons whose `muxPlaybackId` was a
 * hand-written mnemonic - `seedgrddef101` is "seed / guard retention / defense
 * / 101" - and every one of them made the player fail with "Video does not
 * exist". Telling a placeholder apart from a real identifier has to be a rule
 * rather than a list of those 16, because the next placeholder someone types
 * will be spelled differently.
 *
 * The rule is shape, and it comes from where each identifier is born:
 *
 * - A Mux playback id is *issued by Mux*, never authored by a person. It is an
 *   opaque alphanumeric token, and the ones Mux issues run to roughly 35-50
 *   characters. The floor below is 20: far under anything Mux issues, far over
 *   the 13-character mnemonics, so a real id cannot trip it.
 * - A YouTube video id is exactly 11 characters of `A-Z a-z 0-9 _ -`. That is a
 *   fixed, documented width, so the check can be exact.
 *
 * Restricting the character set is also what keeps an identifier safe to
 * interpolate into `https://stream.mux.com/<id>.m3u8`.
 *
 * What this deliberately cannot do: a *well formed* identifier that points at
 * nothing - a single-character typo in a real id, or an asset later deleted
 * from Mux - still passes here. Only the Mux account can settle that, and
 * nothing in this repository is permitted to ask it.
 */
const MUX_PLAYBACK_ID_PATTERN = /^[A-Za-z0-9]{20,}$/;
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function isValidMuxPlaybackId(value: string | null | undefined): value is string {
  return typeof value === 'string' && MUX_PLAYBACK_ID_PATTERN.test(value);
}

export function isValidYouTubeVideoId(value: string | null | undefined): value is string {
  return typeof value === 'string' && YOUTUBE_VIDEO_ID_PATTERN.test(value);
}
