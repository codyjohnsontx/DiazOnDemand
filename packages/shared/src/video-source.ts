import { AccessLevel, VideoProvider } from './enums.js';

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
 * Whether a stored identifier counts as absent - by the database's definition
 * of absent, which is the only one that decides anything.
 *
 * `lesson_video_provider_consistency_chk` asks `NULLIF(TRIM(<column>), '')`, and
 * Postgres `TRIM()` with no character set strips **U+0020 only**. JavaScript's
 * `String.prototype.trim()` strips every Unicode whitespace character, so the
 * two disagree on a tab or a newline: `'\t'.trim()` is empty and
 * `TRIM(E'\t')` is not.
 *
 * That disagreement is not cosmetic, and it is why this rule exists in one
 * place instead of being spelled out at each call site. A tab-only
 * `youtubeVideoId` read as blank in JavaScript lets `syncMuxAsset` skip its
 * refusal and write `videoProvider = MUX`, which the constraint then rejects -
 * a failed delivery Mux retries forever, on a row whose badge had just told an
 * admin to redeliver it. Every caller that asks "is this identifier there?"
 * has to get the same answer the database would give, so every caller asks
 * here.
 *
 * **Do not replace this with `.trim()`.** It looks like a hand-rolled version
 * of the standard method sitting next to a perfectly good one, and it is not:
 * `.trim()` is how this bug was introduced. The database is the authority here
 * because it is the only layer that can refuse the write; everything above it
 * is describing a rule it does not own.
 *
 * The anchored `test` is also deliberate, and a `replace(/^ +| +$/g, '')` that
 * reads more like a trim is not an equivalent spelling of it. That form
 * backtracks quadratically across an interior run of spaces - measured at 686ms
 * for 20,000 of them, against 0.004ms here. Nothing bounds the length of these
 * identifiers: `adminBaseLessonSchema` types them as plain strings and the
 * Postgres columns are `text`, so an admin can store such a value and every
 * later Mux delivery for that row would then block the API's single event loop
 * inside this guard. `/^ *$/` is anchored at position 0 with no `m` flag, so it
 * is linear.
 *
 * Wanting a stricter definition of blank is reasonable - a tab in an identifier
 * column is nobody's intent. But it is a migration, and the order is fixed:
 * change the CHECK constraint first, then this function to match. Never the
 * reverse, because tightening the JavaScript alone re-creates exactly the gap
 * described above, pointed the other way.
 */
export function isStoredIdentifierAbsent(value: string | null | undefined) {
  return /^ *$/.test(value ?? '');
}

/**
 * Whether a lesson holds a Mux asset that no playback id has arrived for: the
 * asset id is stored, the playback id is not, and nothing else claims the row.
 *
 * Derived from the row, never stored beside it. `muxAssetId`, `muxPlaybackId`
 * and `youtubeVideoId` already say all of it - this is the asset, it is not
 * playable yet, and no other provider owns this lesson - so a status column
 * would be a second record of one fact, free to disagree with the fields it
 * describes and with nothing to arbitrate. A derived answer cannot drift.
 *
 * `videoProvider` is deliberately not consulted, and it is accepted here only so
 * a whole lesson row can be passed. This predicate has to agree with what
 * `syncMuxAsset` will actually complete, and that handler finds the lesson by
 * asset id alone and sets the provider to MUX itself - so a row that lost its
 * provider is still a row the webhook will finish. Re-seeding produces exactly
 * that shape: `packages/db/prisma/seed.ts` writes `videoProvider` back to the
 * seed value and `muxPlaybackId` to null while leaving `muxAssetId` in place.
 * Reading the provider here would make the badge and the webhook disagree about
 * what "waiting" means, which is the drift the derived state exists to avoid.
 *
 * A stored `youtubeVideoId` is the one thing that takes the row out of this
 * state, because it is a competing claim the webhook refuses rather than
 * completes.
 *
 * It is a third state, not a shade of the other two. A lesson with no
 * identifier at all has not been filmed; one holding a playback id the read
 * path refuses is broken - see `hasUnplayableVideoIdentifier` - and this one is
 * simply not ready. The webhook may take minutes, it may already have been
 * delivered before any lesson held the asset id, and it may never arrive at all
 * (a failed upload, a lost delivery, a webhook that was never configured),
 * which is exactly why the state has to be visible to staff rather than
 * inferred from a lesson that never starts playing.
 *
 * Not the same question as `hasPlayableVideo`: nothing here plays yet, so the
 * API still resolves such a lesson to NONE for members and they see the honest
 * empty state rather than a player that fails.
 */
export function isAwaitingMuxPlayback(lesson: {
  videoProvider?: VideoProvider | null;
  muxAssetId?: string | null;
  muxPlaybackId?: string | null;
  youtubeVideoId?: string | null;
}) {
  return (
    !isStoredIdentifierAbsent(lesson.muxAssetId) &&
    isStoredIdentifierAbsent(lesson.muxPlaybackId) &&
    isStoredIdentifierAbsent(lesson.youtubeVideoId)
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
    return !isStoredIdentifierAbsent(stored) && !isValidMuxPlaybackId(stored);
  }

  if (lesson.videoProvider === VideoProvider.YOUTUBE) {
    const stored = lesson.youtubeVideoId ?? '';
    return !isStoredIdentifierAbsent(stored) && !isValidYouTubeVideoId(stored);
  }

  return false;
}

/**
 * Whether saving this lesson as PAID has to drop the Mux playback id it is
 * already carrying.
 *
 * A FREE lesson publishes its `muxPlaybackId` to anonymous callers of
 * `/programs`, `/programs/:id` and `/courses/:id` once it is published - every
 * public read filters `isPublished` - and that id is not a name for the video,
 * it is the whole address of one: on an asset with a public playback policy,
 * `https://stream.mux.com/<id>.m3u8` plays for anyone holding it, never expires
 * and asks for nothing. Flipping the lesson to PAID stops the API handing that
 * id out and changes nothing whatsoever for the people already holding it, so
 * the lesson stays free forever for everyone who read the catalogue first.
 * Withholding an identifier is not the same act as retiring one, and only the
 * second one closes this.
 *
 * `syncMuxAsset` gives a FREE lesson only a public playback id, but it is not
 * the only writer of that column: the admin access-level flip is a second one,
 * and PAID -> FREE deliberately keeps the id the row already holds, so a FREE
 * lesson can be carrying a signed-only id instead. The rule still fires on every
 * FREE -> PAID flip anyway, because nothing on the row records which policy the
 * asset carries and clearing is the only choice that cannot leak. The cost of
 * being wrong that way is a redelivery of `video.asset.ready` on a
 * PAID -> FREE -> PAID round trip, which restores the same signed-only id.
 *
 * Clearing the column is what forces the fix that does work when the asset is
 * public: a new asset in Mux with a signed-only playback policy, which carries a
 * different playback id nobody has yet, arriving through `video.asset.ready`.
 * The webhook refuses to attach a public playback id to a PAID lesson, so the
 * re-ingestion cannot put the same kind of identifier quietly back - see
 * `syncMuxAsset` in apps/api/src/webhooks/webhooks.service.ts.
 *
 * A write that supplies a *different* id is a rotation the operator is already
 * performing, and it is left alone: only the carried-over id is retired.
 *
 * `youtubeVideoId` has no counterpart here, and the asymmetry is a conclusion
 * rather than an omission. A Mux playback id is rotatable; a YouTube video id is
 * the video's permanent name on YouTube, so re-ingesting yields the same id and
 * clearing the column retires nothing that leaked. There is no signed variant to
 * rotate *to* either - `mapLessonDetail` hands an entitled member
 * `youtube-nocookie.com/embed/<id>`, the same public address the anonymous
 * catalogue used to publish - so a PAID YouTube lesson has exactly one handle,
 * and clearing it would take a working lesson to NONE while leaving the leaked
 * id as playable as it was. That is a clear with no rotation behind it, which is
 * the shape of a mitigation that only looks like one. The remedy is in YouTube
 * Studio, and the lesson editor says so instead.
 */
export function clearsMuxPlaybackIdOnPaidTransition(transition: {
  previousAccessLevel: string | null | undefined;
  nextAccessLevel: string | null | undefined;
  storedMuxPlaybackId?: string | null;
  /** `undefined` when the write does not mention the column at all. */
  incomingMuxPlaybackId?: string | null;
}) {
  if (
    transition.previousAccessLevel !== AccessLevel.FREE ||
    transition.nextAccessLevel !== AccessLevel.PAID
  ) {
    return false;
  }

  // Blank is the database's definition of blank, not JavaScript's, because the
  // clear this authorises has to leave a row `lesson_video_provider_consistency_chk`
  // accepts - see `isStoredIdentifierAbsent`.
  if (isStoredIdentifierAbsent(transition.storedMuxPlaybackId)) {
    return false;
  }

  return (
    transition.incomingMuxPlaybackId === undefined ||
    transition.incomingMuxPlaybackId === transition.storedMuxPlaybackId
  );
}

/**
 * The access and video fields an editor form must adopt from a save the API has
 * already completed, so the next save cannot resend a value that save retired.
 *
 * This exists because the fields the operator is looking at and the fields the
 * row now holds stop agreeing the instant a save changes something the operator
 * did not type. `clearsMuxPlaybackIdOnPaidTransition` is exactly such a change:
 * the API clears `muxPlaybackId` on a FREE -> PAID flip, answers the cleared
 * row, and the form is then holding an identifier that no longer exists on the
 * lesson. A second save in that state PATCHes it straight back - the API sees
 * PAID -> PAID, correctly does not clear, and writes the id it was given, so one
 * extra click silently undoes the retirement and reports "Lesson saved."
 *
 * That was found by an independent review of the change that introduced the
 * clear, and reproduced against the real transition function before this was
 * written: save one gives PAID with a null playback id, save two gives PAID
 * carrying the public id again. Which is the state the clear exists to prevent,
 * reached through the button that performs it.
 *
 * The rule is therefore "believe the answer, not the form". Every field here is
 * taken from the saved row rather than merged with what the form held, because
 * a merge is what the defect was: the form's copy is stale by definition once
 * the API has answered, and the API's answer is the only account of the row that
 * is current. A blank identifier arrives as null and becomes the empty string
 * the inputs are controlled with - the two spellings of absent that
 * `adminUpdateLessonSchema` normalises back at the write boundary.
 *
 * Only these fields, and not the whole form: a save answers the row, not the
 * operator's unsaved edits to fields it did not touch. Access level and video
 * source are included because the clear can change `videoProvider` too, dropping
 * a lesson with no `muxAssetId` to fall back on to NONE.
 *
 * A direct upload ends with `video.asset.ready` writing the asset id, the
 * playback id and the measured `durationSeconds` onto the row behind the form,
 * and the editor polls for exactly that - so the fields it then holds are stale
 * in the same way as after a save, and a Save that resent them would blank the
 * asset id the webhook just bound or put a typed-in planned length back over the
 * real one. `durationSeconds` is therefore adopted here too, as the string the
 * duration input is controlled with; a row that carries none leaves the field
 * alone, because the webhook never writes null there and a save answering the
 * form's own value has nothing to correct. A polled row goes through
 * `lessonEditorFieldsAfterRowChange` rather than this function directly, because
 * it answers a webhook write and not a save: only what that write changed is
 * the row's to decide.
 */
export function lessonEditorFieldsAfterSave<Access extends string, Provider extends string>(saved: {
  accessLevel: Access;
  videoProvider: Provider;
  muxAssetId?: string | null;
  muxPlaybackId?: string | null;
  youtubeVideoId?: string | null;
  durationSeconds?: number | null;
}) {
  return {
    accessLevel: saved.accessLevel,
    videoProvider: saved.videoProvider,
    muxAssetId: saved.muxAssetId ?? '',
    muxPlaybackId: saved.muxPlaybackId ?? '',
    youtubeVideoId: saved.youtubeVideoId ?? '',
    ...(typeof saved.durationSeconds === 'number'
      ? { durationSeconds: String(saved.durationSeconds) }
      : {}),
  };
}

/**
 * The form fields to adopt when a row changed behind the editor - the Mux
 * webhooks writing during an upload, handed over by polling - as opposed to a
 * save the operator asked for. A save answers every field it was sent, so
 * `lessonEditorFieldsAfterSave` takes them all; a webhook writes a few columns
 * and leaves the rest as they were, and adopting an unchanged stored value from
 * such a row is nothing but a revert of whatever the operator has typed and not
 * yet saved. The upload request itself, `video.upload.asset_created` and the
 * failure events all carry the duration the row already had, and only
 * `video.asset.ready` brings the measured one - so only that one reaches the
 * input. The same holds for every field here, the access level included: no
 * webhook writes it, so it is never adopted from a poll.
 */
export function lessonEditorFieldsAfterRowChange<Access extends string, Provider extends string>(
  previous: Parameters<typeof lessonEditorFieldsAfterSave<Access, Provider>>[0],
  next: Parameters<typeof lessonEditorFieldsAfterSave<Access, Provider>>[0],
): Partial<ReturnType<typeof lessonEditorFieldsAfterSave<Access, Provider>>> {
  const before: Record<string, string | undefined> = lessonEditorFieldsAfterSave(previous);
  const after = lessonEditorFieldsAfterSave(next);

  return Object.fromEntries(
    Object.entries(after).filter(([field, value]) => before[field] !== value),
  ) as Partial<typeof after>;
}

/**
 * The one video state a lesson is in, for the staff surfaces. Members never see
 * this; they see whether the lesson plays, which is `hasPlayableVideo`.
 *
 * Derived from the row and never stored, for the reason given on
 * `isAwaitingMuxPlayback`: every input is a fact Mux issued or reported -
 * the upload it is waiting on, the asset it was given, the playback id that
 * makes it watchable, the error it last reported - and a status column beside
 * them would be a second record of the same facts with nothing to arbitrate.
 *
 * Precedence, and why it is in this order:
 *
 * - FAILED first. `muxVideoError` is set by `video.upload.errored`,
 *   `video.upload.cancelled` and `video.asset.errored`, and cleared only when a
 *   new upload starts or a ready event brings a new playback id or completes
 *   the upload the lesson was waiting on. A failure that arrives while
 *   the lesson still plays its previous video - a replacement whose new file
 *   Mux rejected - has to beat READY, or the operator sees "ready" and waits
 *   forever for the replacement.
 * - UPLOADING next. `muxUploadId` is held only between the editor requesting a
 *   direct upload and `video.upload.asset_created` exchanging it for the asset
 *   id, so a lesson holding one is waiting for the file to reach Mux, whatever
 *   else it holds. It also beats READY, for the same replacement reason.
 * - READY when a playback identifier is stored. Not "when it plays": the
 *   `hasUnplayableVideoIdentifier` hint sits beside this and says so.
 * - PROCESSING is `isAwaitingMuxPlayback`: the asset exists and Mux has not
 *   sent its playback id yet.
 * - NONE otherwise.
 *
 * `previousVideoStillPlays` is the replacement case spelled out for the copy:
 * FAILED or UPLOADING while a playback identifier is still stored means the
 * catalogue is unaffected until the new asset is bound. The operator needs that
 * sentence, and the two admin surfaces must say it the same way.
 */
export enum LessonVideoState {
  NONE = 'NONE',
  UPLOADING = 'UPLOADING',
  PROCESSING = 'PROCESSING',
  READY = 'READY',
  FAILED = 'FAILED',
}

export function resolveLessonVideoState(lesson: {
  muxUploadId?: string | null;
  muxVideoError?: string | null;
  muxAssetId?: string | null;
  muxPlaybackId?: string | null;
  youtubeVideoId?: string | null;
}): { state: LessonVideoState; previousVideoStillPlays: boolean } {
  const playbackStored =
    !isStoredIdentifierAbsent(lesson.muxPlaybackId) ||
    !isStoredIdentifierAbsent(lesson.youtubeVideoId);

  if (!isStoredIdentifierAbsent(lesson.muxVideoError)) {
    return { state: LessonVideoState.FAILED, previousVideoStillPlays: playbackStored };
  }

  if (!isStoredIdentifierAbsent(lesson.muxUploadId)) {
    return { state: LessonVideoState.UPLOADING, previousVideoStillPlays: playbackStored };
  }

  if (playbackStored) {
    return { state: LessonVideoState.READY, previousVideoStillPlays: false };
  }

  if (isAwaitingMuxPlayback(lesson)) {
    return { state: LessonVideoState.PROCESSING, previousVideoStillPlays: false };
  }

  return { state: LessonVideoState.NONE, previousVideoStillPlays: false };
}
