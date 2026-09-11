'use client';

import { ChangeEvent, useEffect, useRef, useState } from 'react';
import {
  LessonVideoState,
  resolveLessonVideoState,
  type AdminLessonSummary,
  type AdminLessonUploadDto,
} from '@diaz/shared';
import { LessonVideoStateNote } from '@/components/lesson-video-state';
import { ProgressBar } from '@/components/progress-bar';
import { useApiClient } from '@/lib/api-client';
import { uploadFileToMux } from '@/lib/mux-direct-upload';

/** How often the editor asks the API whether Mux has moved the lesson along. */
const POLL_INTERVAL_MS = 4000;

/** The columns the Mux webhooks write; a poll that changes none of them is noise. */
const WATCHED_FIELDS = [
  'videoProvider',
  'muxUploadId',
  'muxVideoError',
  'muxAssetId',
  'muxPlaybackId',
  'youtubeVideoId',
  'durationSeconds',
] as const;

function videoFingerprint(lesson: AdminLessonSummary) {
  return JSON.stringify(WATCHED_FIELDS.map((field) => lesson[field] ?? null));
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'requesting' }
  | { kind: 'uploading'; fraction: number }
  | { kind: 'error'; message: string };

/**
 * The upload control: asks the API for a Mux direct upload, sends the file to
 * it from the browser, then watches the lesson row until Mux has answered.
 *
 * The browser never sees a Mux credential. `POST /admin/lessons/:id/mux-upload`
 * is behind the admin guards and answers a one-off signed URL for this upload
 * alone; the playback policy was chosen by the API from the lesson's tier
 * before the file existed. Everything after the PUT is the webhooks' job, so
 * this component only polls `GET /admin/lessons/:id` and hands each changed
 * row to the editor - which adopts the video fields, or a later Save would
 * PATCH the asset id the webhook just bound straight back off the row.
 *
 * Polling runs whenever the row says an upload or an encode is outstanding,
 * not only after a PUT from this tab: an operator who reloads mid-encode is
 * looking at the same state and deserves the same answer.
 */
export function LessonVideoUpload({
  lesson,
  onLessonChanged,
}: {
  lesson: AdminLessonSummary;
  onLessonChanged: (lesson: AdminLessonSummary) => void;
}) {
  const apiFetch = useApiClient();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const onLessonChangedRef = useRef(onLessonChanged);
  const fingerprintRef = useRef(videoFingerprint(lesson));
  const { state } = resolveLessonVideoState(lesson);
  const outstanding =
    state === LessonVideoState.UPLOADING || state === LessonVideoState.PROCESSING;
  const busy = phase.kind === 'requesting' || phase.kind === 'uploading';

  useEffect(() => {
    onLessonChangedRef.current = onLessonChanged;
    fingerprintRef.current = videoFingerprint(lesson);
  }, [lesson, onLessonChanged]);

  useEffect(() => {
    if (!outstanding) return;

    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const next = await apiFetch<AdminLessonSummary>(`/admin/lessons/${lesson.id}`);
        if (cancelled || videoFingerprint(next) === fingerprintRef.current) return;
        onLessonChangedRef.current(next);
      } catch {
        // A missed poll is not a failure of the upload; the next tick asks again.
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [apiFetch, lesson.id, outstanding]);

  const onFileChosen = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || busy) return;

    setPhase({ kind: 'requesting' });

    try {
      const upload = await apiFetch<AdminLessonUploadDto>(`/admin/lessons/${lesson.id}/mux-upload`, {
        method: 'POST',
      });
      // The row now holds the upload id, so the editor shows "Upload in
      // progress" from the same rule the course list uses.
      onLessonChangedRef.current(upload.lesson);
      setPhase({ kind: 'uploading', fraction: 0 });
      await uploadFileToMux(upload.url, file, (fraction) =>
        setPhase({ kind: 'uploading', fraction }),
      );
      setPhase({ kind: 'idle' });
    } catch (error) {
      setPhase({
        kind: 'error',
        message:
          error instanceof Error
            ? `The video could not be uploaded. ${error.message}`
            : 'The video could not be uploaded.',
      });
    } finally {
      // So choosing the same file again fires `change`.
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const buttonLabel = busy
    ? phase.kind === 'requesting'
      ? 'Preparing upload...'
      : 'Uploading...'
    : state === LessonVideoState.READY
      ? 'Replace video'
      : 'Upload video';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label
          className={[
            'inline-flex cursor-pointer items-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-white/10',
            busy ? 'cursor-not-allowed opacity-60' : '',
          ].join(' ')}
        >
          {buttonLabel}
          <input
            ref={inputRef}
            accept="video/*"
            className="sr-only"
            disabled={busy}
            onChange={(event) => void onFileChosen(event)}
            type="file"
          />
        </label>
        <span className="type-meta text-[var(--text-muted)]">
          {lesson.accessLevel === 'PAID'
            ? 'Premium lesson: the asset is created signed-only.'
            : 'Free lesson: the asset is created with a public playback policy.'}
        </span>
      </div>
      {phase.kind === 'uploading' ? (
        <ProgressBar label="Sending to Mux" value={phase.fraction * 100} />
      ) : null}
      {phase.kind === 'error' ? (
        <p className="type-meta text-[var(--danger)]">{phase.message}</p>
      ) : null}
      {state === LessonVideoState.READY && !busy ? (
        <p className="type-meta text-[var(--text-muted)]">
          Replacing the video retires the current playback ID the moment Mux receives the new
          file, and members see the not-filmed state until the new asset is ready. The previous
          asset stays in the Mux account.
        </p>
      ) : null}
      <LessonVideoStateNote className="type-meta text-[var(--text-muted)]" lesson={lesson} />
    </div>
  );
}
