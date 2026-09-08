'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import type { AdminProgramWithContentDto, CurriculumMetadata } from '@diaz/shared';
import {
  // A value import, not a type-only one: the paid-YouTube note below compares
  // against it, and TypeScript refuses to compare a string enum with a bare
  // string literal.
  AccessLevel,
  VideoProvider,
  clearsMuxPlaybackIdOnPaidTransition,
  createDefaultCurriculum,
  curriculumDisciplineKeys,
  getCurriculumPhaseLabel,
  getCurriculumLevelKeys,
  getCurriculumPhaseKeys,
  getCurriculumSkillKeys,
  getCurriculumSkillLabel,
  getCurriculumTrackLabel,
  getCurriculumTrackKeys,
  getDisciplineLabel,
  hasUnplayableVideoIdentifier,
  isAwaitingMuxPlayback,
  lessonEditorFieldsAfterSave,
  programDisciplineToCurriculumDiscipline,
} from '@diaz/shared';
import { AppShell } from '@/components/app-shell';
import { AwaitingMuxPlaybackNote } from '@/components/awaiting-mux-playback-note';
import { EmptyState } from '@/components/empty-state';
import { PremiumBadge } from '@/components/premium-badge';
import { useApiClient } from '@/lib/api-client';

// What forces the clear is stated flatly, because it holds either way: nothing
// on the lesson records the asset's playback policy. The two things that would
// make the cleared ID watchable by a stranger are stated as the separate
// conditions they are - the asset being public-policy, and the lesson having
// been published while it was free - because a stranger needs both.
const PAID_CLEAR_STATUS =
  'Lesson saved as premium, and the Mux playback ID was cleared. A public-policy Mux asset ' +
  'cannot back premium content, and nothing on the lesson records which policy this asset ' +
  'carries, so the ID is cleared rather than kept. If the asset is public-policy, that ID plays ' +
  'for anyone holding it - and if the lesson was ever published while it was free, everyone who ' +
  'browsed the catalogue holds it and it cannot be recalled. ';

// Both remedies below follow one shape: the step that always applies, then a
// conditional shortcut where there is one, then a fallback that works in every
// state which can reach that branch. A conditional step with nothing under it
// can only fail an operator it does not happen to describe, and neither the row
// nor the form can say which playback policy an asset carries.
//
// The shortcut here is redelivery: an asset that is already signed-only is
// accepted by the webhook and gives back the same playback ID, so a re-create
// would be a re-upload the video never needed.
const PAID_CLEAR_REMEDY_KEPT_ASSET =
  'Redeliver video.asset.ready from the Mux dashboard first - if the asset is already ' +
  'signed-only that restores its playback ID. If it carries a public playback policy the ' +
  'redelivery is refused; re-create the asset in Mux with a signed-only playback policy, paste ' +
  'its asset ID here, and video.asset.ready will fill in the new playback ID.';

// This branch is reached only when the lesson stored no asset ID, so it cannot
// presuppose one. Dropping to no video source also takes the Mux asset ID field
// off this page, and both paths need it back, so that step is named before the
// branch rather than inside the shortcut.
const PAID_CLEAR_REMEDY_RESET_SOURCE =
  'Video source was reset to No video source, because the lesson had no Mux asset ID to keep. ' +
  'Set Video source back to Mux to bring the asset ID field back. If you still have that asset ' +
  'in Mux, paste its asset ID and save, then redeliver video.asset.ready from the Mux ' +
  'dashboard. Otherwise re-create it in Mux with a signed-only playback policy and save the ' +
  'new asset ID.';

type LessonEditorForm = {
  title: string;
  description: string;
  accessLevel: AccessLevel;
  videoProvider: VideoProvider;
  muxAssetId: string;
  muxPlaybackId: string;
  youtubeVideoId: string;
  durationSeconds: string;
  curriculum: CurriculumMetadata;
};

export default function AdminLessonDetailPage() {
  const params = useParams<{ id: string }>();
  const lessonId = params.id;
  const apiFetch = useApiClient();
  const titleInputId = 'lesson-title';
  const descriptionInputId = 'lesson-description';
  const accessLevelInputId = 'lesson-access-level';
  const durationSecondsInputId = 'lesson-duration-seconds';
  const videoProviderInputId = 'video-provider';
  const muxAssetInputId = 'mux-asset-id';
  const muxPlaybackInputId = 'mux-playback-id';
  const youtubeVideoInputId = 'youtube-video-id';
  const curriculumDisciplineInputId = 'curriculum-discipline';
  const curriculumPhaseInputId = 'curriculum-phase';
  const curriculumTrackInputId = 'curriculum-track';
  const curriculumSkillInputId = 'curriculum-skill';
  const curriculumLevelInputId = 'curriculum-level';
  const [programs, setPrograms] = useState<AdminProgramWithContentDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // A save is not instant and the form it was built from keeps accepting clicks
  // until it returns. See the guard at the top of `onSave`.
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<LessonEditorForm>({
    title: '',
    description: '',
    accessLevel: 'FREE' as AccessLevel,
    videoProvider: VideoProvider.NONE,
    muxAssetId: '',
    muxPlaybackId: '',
    youtubeVideoId: '',
    durationSeconds: '',
    curriculum: createDefaultCurriculum('bjj'),
  });

  const lessonContext = useMemo(() => {
    if (programs === null) {
      return undefined;
    }

    for (const program of programs) {
      for (const course of program.courses) {
        const found = course.lessons.find((entry) => entry.id === lessonId);
        if (found) {
          return { lesson: found, course, program };
        }
      }
    }
    return null;
  }, [lessonId, programs]);
  const lesson = lessonContext?.lesson;
  const program = lessonContext?.program;
  // Derived from the saved row, not from the form: the point is to show which
  // lessons the webhook has not completed, including the ones where it never
  // will because the upload failed or the delivery was lost.
  const awaitingMuxPlayback = isAwaitingMuxPlayback(lesson ?? {});
  // The asset ID is not a playback identifier: the webhook matches on it
  // whatever the stored provider says, and the database allows it on any row.
  // Gating the field on the form provider hid it on exactly the rows the
  // "Waiting for Mux" badge points at, and the next save then blanked the id the
  // badge was about.
  const showMuxAssetIdField =
    form.videoProvider === VideoProvider.MUX ||
    (awaitingMuxPlayback && form.videoProvider !== VideoProvider.YOUTUBE);
  // Blank is stored as NULL, never as an empty string: "no playback id yet"
  // needs one spelling, or a query for the lessons still waiting on Mux misses
  // exactly the ones saved here.
  const outgoingMuxPlaybackId =
    form.videoProvider === VideoProvider.MUX ? form.muxPlaybackId.trim() || null : null;
  const outgoingMuxAssetId = showMuxAssetIdField ? form.muxAssetId.trim() || null : null;

  const load = async () => {
    try {
      const data = await apiFetch<AdminProgramWithContentDto[]>('/admin/programs');
      setPrograms(data);
      setLoadError(null);
    } catch (requestError) {
      setLoadError(
        requestError instanceof Error
          ? `Lesson editor could not be loaded right now. ${requestError.message}`
          : 'Lesson editor could not be loaded right now.',
      );
      setPrograms([]);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!lesson) return;
    setForm({
      title: lesson.title,
      description: lesson.description ?? '',
      accessLevel: lesson.accessLevel,
      videoProvider: lesson.videoProvider,
      muxAssetId: lesson.muxAssetId ?? '',
      muxPlaybackId: lesson.muxPlaybackId ?? '',
      youtubeVideoId: lesson.youtubeVideoId ?? '',
      durationSeconds: lesson.durationSeconds ? String(lesson.durationSeconds) : '',
      curriculum:
        lesson.curriculum ??
        createDefaultCurriculum(
          program ? programDisciplineToCurriculumDiscipline(program.discipline) : 'bjj',
        ),
    });
  }, [lesson, program]);

  const onSave = async (event: FormEvent) => {
    event.preventDefault();

    // A second click while the first save is outstanding re-sends the form as it
    // stood before the API answered, and the API is then looking at a row it has
    // already changed. On a FREE -> PAID flip that means PATCHing the cleared
    // playback ID back onto a row that is PAID by then: the transition is
    // PAID -> PAID, no clear is due, and the identifier the first save retired is
    // written straight back under a plain "Lesson saved.". One click is the only
    // save this form is describing.
    if (saving) return;
    setSaving(true);

    const normalizedYoutubeVideoId = form.youtubeVideoId.trim();

    // An asset id on its own is a complete Mux lesson that is not playable yet:
    // Mux issues the playback id later, on `video.asset.ready`, and the webhook
    // finds the lesson by exactly this asset id. Demanding a playback id here
    // was what left ingestion with no entrance at all.
    if (form.videoProvider === VideoProvider.MUX && !outgoingMuxPlaybackId && !outgoingMuxAssetId) {
      setStatus('Set the Mux asset ID or the playback ID when the lesson uses Mux.');
      setSaving(false);
      return;
    }

    if (form.videoProvider === VideoProvider.YOUTUBE && !normalizedYoutubeVideoId) {
      setStatus('YouTube video ID is required when the lesson uses YouTube.');
      setSaving(false);
      return;
    }

    try {
      const saved = await apiFetch<{
        muxPlaybackIdClearedForPaidAccess?: boolean;
        accessLevel: AccessLevel;
        videoProvider: VideoProvider;
        muxAssetId: string | null;
        muxPlaybackId: string | null;
        youtubeVideoId: string | null;
      }>(`/admin/lessons/${lessonId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          accessLevel: form.accessLevel,
          videoProvider: form.videoProvider,
          muxAssetId: outgoingMuxAssetId,
          muxPlaybackId: outgoingMuxPlaybackId,
          youtubeVideoId:
            form.videoProvider === VideoProvider.YOUTUBE ? normalizedYoutubeVideoId : null,
          durationSeconds: form.durationSeconds ? Number(form.durationSeconds) : null,
          curriculum: {
            ...form.curriculum,
            skill: form.curriculum.skill || undefined,
          },
        }),
      });
      // What the API decided, not what this form predicted. The warning beside
      // the access level says a clear is coming; this says it happened, and it
      // is the only thing an operator sees if the flip reached the API some
      // other way.
      //
      // Which remedy applies is the API's answer as well. `planPaidAccessTransition`
      // is what decides whether the lesson keeps MUX or drops to no video source,
      // and the saved row it returns carries the result, so the remedy is chosen by
      // reading that rather than by re-deriving the rule here. A client-side copy
      // of it would have nothing to catch the two drifting apart.
      setStatus(
        saved?.muxPlaybackIdClearedForPaidAccess
          ? PAID_CLEAR_STATUS +
              (saved.videoProvider === VideoProvider.NONE
                ? PAID_CLEAR_REMEDY_RESET_SOURCE
                : PAID_CLEAR_REMEDY_KEPT_ASSET)
          : 'Lesson saved.',
      );
      // Adopt the row the API answered, before `load()` is even started. The
      // effect below repopulates this form from `/admin/programs`, and until that
      // round trip lands the form still holds the playback ID this save just
      // retired - so the reload is far too late to be the only thing that
      // reconciles them. The rule lives in `@diaz/shared` so it can be tested;
      // this app has no test runner.
      setForm((prev) => ({ ...prev, ...lessonEditorFieldsAfterSave(saved) }));
      await load();
    } catch (requestError) {
      setStatus(
        requestError instanceof Error
          ? `Lesson could not be saved. ${requestError.message}`
          : 'Lesson could not be saved.',
      );
    } finally {
      setSaving(false);
    }
  };

  const togglePublish = async () => {
    if (!lesson) return;
    await apiFetch(`/admin/lessons/${lesson.id}/publish`, {
      method: 'PATCH',
      body: JSON.stringify({ isPublished: !lesson.isPublished }),
    });
    setStatus(lesson.isPublished ? 'Lesson moved to draft.' : 'Lesson published.');
    await load();
  };

  if (loadError) {
    return (
      <AppShell>
        <EmptyState description={loadError} title="Lesson editor unavailable" />
      </AppShell>
    );
  }

  if (lessonContext === undefined) {
    return (
      <AppShell>
        <div className="surface-panel p-8">
          <p className="font-display text-2xl leading-tight text-[var(--text-muted)]">Loading lesson...</p>
        </div>
      </AppShell>
    );
  }

  if (lessonContext === null || !lesson) {
    return (
      <AppShell>
        <EmptyState description="The selected lesson could not be found." title="Lesson unavailable" />
      </AppShell>
    );
  }

  const showMuxPlaybackIdHint = hasUnplayableVideoIdentifier({
    videoProvider: form.videoProvider,
    muxPlaybackId: form.muxPlaybackId,
  });
  const showYoutubeVideoIdHint = hasUnplayableVideoIdentifier({
    videoProvider: form.videoProvider,
    youtubeVideoId: form.youtubeVideoId,
  });
  // Saved row against pending form, so the operator is warned before the save
  // rather than only told afterwards. The incoming id mirrors exactly what
  // onSave sends, so this predicts the API's own answer; the API still decides,
  // and the save status reports what it decided.
  const willClearMuxPlaybackId = clearsMuxPlaybackIdOnPaidTransition({
    previousAccessLevel: lesson.accessLevel,
    nextAccessLevel: form.accessLevel,
    storedMuxPlaybackId: lesson.muxPlaybackId,
    incomingMuxPlaybackId: outgoingMuxPlaybackId,
  });
  // A YouTube video id is the video's permanent address on YouTube, so there is
  // nothing to rotate it to and premium playback embeds that same public id.
  // Without this the Mux warning above would imply, by contrast, that switching
  // a YouTube lesson to premium protects it.
  const showPaidYoutubeExposureNote =
    form.accessLevel === AccessLevel.PAID &&
    form.videoProvider === VideoProvider.YOUTUBE &&
    form.youtubeVideoId.trim().length > 0;
  const phaseOptions = getCurriculumPhaseKeys(form.curriculum.discipline);
  const trackOptions = getCurriculumTrackKeys(form.curriculum.discipline, form.curriculum.phase);
  const skillOptions = getCurriculumSkillKeys(form.curriculum.discipline);
  const levelOptions = getCurriculumLevelKeys(form.curriculum.discipline);

  return (
    <AppShell className="space-y-8">
      <form className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]" onSubmit={onSave}>
        <section className="surface-panel space-y-5 p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <p className="type-kicker text-[var(--text-muted)]">Lesson editor</p>
              <h1 className="font-display text-4xl leading-none text-[var(--text)]">{lesson.title}</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {program ? <PremiumBadge label={getDisciplineLabel(program.discipline)} /> : null}
              {program?.isFeaturedDemo ? <PremiumBadge label="Demo" tone="accent" /> : null}
              {awaitingMuxPlayback ? <PremiumBadge label="Waiting for Mux" /> : null}
              <PremiumBadge label={lesson.isPublished ? 'Published' : 'Draft'} tone={lesson.isPublished ? 'accent' : 'neutral'} />
            </div>
          </div>

          <div className="space-y-2">
            <label className="type-kicker text-[var(--text-muted)]" htmlFor={titleInputId}>
              Lesson title
            </label>
            <input
              id={titleInputId}
              className="w-full rounded-[20px] border border-white/10 bg-[var(--surface-2)] px-4 py-3 text-[var(--text)]"
              value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <label className="type-kicker text-[var(--text-muted)]" htmlFor={descriptionInputId}>
              Lesson description
            </label>
            <textarea
              id={descriptionInputId}
              className="min-h-[180px] w-full rounded-[24px] border border-white/10 bg-[var(--surface-2)] px-4 py-3 text-[var(--text)]"
              rows={6}
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="type-kicker text-[var(--text-muted)]" htmlFor={accessLevelInputId}>
                Access level
              </label>
              <select
                id={accessLevelInputId}
                className="w-full rounded-[20px] border border-white/10 bg-[var(--surface-2)] px-4 py-3 text-[var(--text)]"
                value={form.accessLevel}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, accessLevel: event.target.value as AccessLevel }))
                }
              >
                <option value="FREE">Free lesson</option>
                <option value="PAID">Premium lesson</option>
              </select>
              {willClearMuxPlaybackId ? (
                <p className="type-meta text-[var(--danger)]">
                  Saving will clear the Mux playback ID. A public-policy Mux asset cannot back
                  premium content, and nothing on the lesson records which policy this asset
                  carries, so the ID is cleared rather than kept. If the asset is public-policy,
                  that ID plays for anyone holding it - and if this lesson was ever published while
                  it was free, everyone who browsed the catalogue holds it and it cannot be
                  recalled. A premium lesson needs a signed-only Mux asset.
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <label className="type-kicker text-[var(--text-muted)]" htmlFor={durationSecondsInputId}>
                Duration seconds
              </label>
              <input
                id={durationSecondsInputId}
                className="w-full rounded-[20px] border border-white/10 bg-[var(--surface-2)] px-4 py-3 text-[var(--text)]"
                placeholder="Duration seconds"
                value={form.durationSeconds}
                onChange={(event) => setForm((prev) => ({ ...prev, durationSeconds: event.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="type-kicker text-[var(--text-muted)]" htmlFor={videoProviderInputId}>
              Video source
            </label>
            <select
              id={videoProviderInputId}
              className="w-full rounded-[20px] border border-white/10 bg-[var(--surface-2)] px-4 py-3 text-[var(--text)]"
              value={form.videoProvider}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, videoProvider: event.target.value as VideoProvider }))
              }
            >
              <option value={VideoProvider.NONE}>No video source</option>
              <option value={VideoProvider.MUX}>Mux playback</option>
              <option value={VideoProvider.YOUTUBE}>YouTube demo video</option>
            </select>
          </div>
          {showMuxAssetIdField ? (
            <div className="space-y-2">
              <label className="type-kicker text-[var(--text-muted)]" htmlFor={muxAssetInputId}>
                Mux asset ID
              </label>
              <input
                id={muxAssetInputId}
                className="w-full rounded-[20px] border border-white/10 bg-[var(--surface-2)] px-4 py-3 text-[var(--text)]"
                placeholder="Mux asset ID"
                value={form.muxAssetId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, muxAssetId: event.target.value }))
                }
              />
              <p className="type-meta text-[var(--text-muted)]">
                Optional. Set this to let the Mux webhook fill in the playback ID and duration
                automatically once the asset finishes encoding.
              </p>
              {/*
                Both derived from the saved row rather than the pending form: the
                remedy has to describe the lesson the webhook will actually meet,
                not the one this form would save.
              */}
              {awaitingMuxPlayback ? (
                <AwaitingMuxPlaybackNote
                  accessLevel={lesson.accessLevel}
                  className="type-meta text-[var(--text-muted)]"
                />
              ) : null}
            </div>
          ) : null}
          {form.videoProvider === VideoProvider.MUX ? (
            <div className="space-y-2">
              <label className="type-kicker text-[var(--text-muted)]" htmlFor={muxPlaybackInputId}>
                Mux playback ID
              </label>
              <input
                id={muxPlaybackInputId}
                className="w-full rounded-[20px] border border-white/10 bg-[var(--surface-2)] px-4 py-3 text-[var(--text)]"
                placeholder="Mux playback ID"
                value={form.muxPlaybackId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, muxPlaybackId: event.target.value }))
                }
              />
              {showMuxPlaybackIdHint ? (
                <p className="type-meta text-[var(--danger)]">
                  This playback ID will not play. A published lesson with it shows the not-filmed
                  state.
                </p>
              ) : null}
            </div>
          ) : null}
          {form.videoProvider === VideoProvider.YOUTUBE ? (
            <div className="space-y-2">
              <label className="type-kicker text-[var(--text-muted)]" htmlFor={youtubeVideoInputId}>
                YouTube video ID
              </label>
              <input
                id={youtubeVideoInputId}
                className="w-full rounded-[20px] border border-white/10 bg-[var(--surface-2)] px-4 py-3 text-[var(--text)]"
                placeholder="YouTube video ID"
                value={form.youtubeVideoId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, youtubeVideoId: event.target.value }))
                }
              />
              {showYoutubeVideoIdHint ? (
                <p className="type-meta text-[var(--danger)]">
                  This video ID will not play. A published lesson with it shows the not-filmed
                  state.
                </p>
              ) : null}
              {showPaidYoutubeExposureNote ? (
                <p className="type-meta text-[var(--text-muted)]">
                  Premium does not protect a YouTube video. This ID is the video&apos;s permanent
                  address and premium playback embeds that same public ID. If this lesson was ever
                  published while it was free, everyone who browsed the catalogue holds this ID and
                  it cannot be recalled. Only YouTube Studio can restrict the video.
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <button
              className="inline-flex items-center rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={saving}
              type="submit"
            >
              {saving ? 'Saving...' : 'Save lesson'}
            </button>
            <button
              className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-white/10"
              onClick={togglePublish}
              type="button"
            >
              {lesson.isPublished ? 'Move to draft' : 'Publish lesson'}
            </button>
            <Link
              className="inline-flex items-center rounded-full border border-white/10 bg-transparent px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)] transition-colors duration-200 hover:border-white/20 hover:text-[var(--text)]"
              href={`/lesson/${lesson.id}`}
            >
              Preview lesson
            </Link>
          </div>
          {status ? <p className="text-sm text-[var(--progress)]">{status}</p> : null}
        </section>

        <section className="space-y-5">
          <div className="surface-panel space-y-5 p-6">
            <div className="space-y-2">
              <p className="type-kicker text-[var(--text-muted)]">Curriculum metadata</p>
              <h2 className="type-title-lg text-[var(--text)]">Guided path</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="type-kicker text-[var(--text-muted)]" htmlFor={curriculumDisciplineInputId}>
                  Curriculum discipline
                </label>
                <select
                  id={curriculumDisciplineInputId}
                  className="w-full rounded-[20px] border border-white/10 bg-[var(--surface-2)] px-4 py-3 text-[var(--text)]"
                  value={form.curriculum.discipline}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      curriculum: createDefaultCurriculum(event.target.value as CurriculumMetadata['discipline']),
                    }))
                  }
                >
                  {curriculumDisciplineKeys.map((discipline) => (
                    <option key={discipline} value={discipline}>
                      {getDisciplineLabel(discipline)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="type-kicker text-[var(--text-muted)]" htmlFor={curriculumPhaseInputId}>
                  Curriculum phase
                </label>
                <select
                  id={curriculumPhaseInputId}
                  className="w-full rounded-[20px] border border-white/10 bg-[var(--surface-2)] px-4 py-3 text-[var(--text)]"
                  value={form.curriculum.phase}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      curriculum: {
                        ...prev.curriculum,
                        phase: event.target.value,
                        track:
                          getCurriculumTrackKeys(prev.curriculum.discipline, event.target.value)[0] ??
                          prev.curriculum.track,
                      },
                    }))
                  }
                >
                  {phaseOptions.map((phase) => (
                    <option key={phase} value={phase}>
                      {getCurriculumPhaseLabel(form.curriculum.discipline, phase)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="type-kicker text-[var(--text-muted)]" htmlFor={curriculumTrackInputId}>
                  Curriculum track
                </label>
                <select
                  id={curriculumTrackInputId}
                  className="w-full rounded-[20px] border border-white/10 bg-[var(--surface-2)] px-4 py-3 text-[var(--text)]"
                  value={form.curriculum.track}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      curriculum: { ...prev.curriculum, track: event.target.value },
                    }))
                  }
                >
                  {trackOptions.map((track) => (
                    <option key={track} value={track}>
                      {getCurriculumTrackLabel({ ...form.curriculum, track })}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="type-kicker text-[var(--text-muted)]" htmlFor={curriculumSkillInputId}>
                  Curriculum skill
                </label>
                <select
                  id={curriculumSkillInputId}
                  className="w-full rounded-[20px] border border-white/10 bg-[var(--surface-2)] px-4 py-3 text-[var(--text)]"
                  value={form.curriculum.skill ?? ''}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      curriculum: { ...prev.curriculum, skill: event.target.value || undefined },
                    }))
                  }
                >
                  <option value="">No skill tag</option>
                  {skillOptions.map((skill) => (
                    <option key={skill} value={skill}>
                      {getCurriculumSkillLabel({ ...form.curriculum, skill }) ?? skill}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="type-kicker text-[var(--text-muted)]" htmlFor={curriculumLevelInputId}>
                  Curriculum level
                </label>
                <select
                  id={curriculumLevelInputId}
                  className="w-full rounded-[20px] border border-white/10 bg-[var(--surface-2)] px-4 py-3 text-[var(--text)]"
                  value={form.curriculum.level}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      curriculum: {
                        ...prev.curriculum,
                        level: event.target.value as CurriculumMetadata['level'],
                      },
                    }))
                  }
                >
                  {levelOptions.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="surface-panel-muted space-y-3 p-5">
            <p className="type-kicker text-[var(--text-muted)]">Generated tags</p>
            <div className="flex flex-wrap gap-2">
              <PremiumBadge label={`discipline:${form.curriculum.discipline}`} />
              <PremiumBadge label={`phase:${form.curriculum.phase}`} />
              <PremiumBadge label={`track:${form.curriculum.track}`} />
              {form.curriculum.skill ? <PremiumBadge label={`skill:${form.curriculum.skill}`} /> : null}
              <PremiumBadge label={`level:${form.curriculum.level}`} />
            </div>
            <p className="text-sm leading-7 text-[var(--text-muted)]">
              These tags drive guided recommendations across the library and keep the taxonomy consistent without free-form entry.
            </p>
          </div>
        </section>
      </form>
    </AppShell>
  );
}
