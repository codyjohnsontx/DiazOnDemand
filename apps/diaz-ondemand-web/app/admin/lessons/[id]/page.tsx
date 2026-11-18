'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import type {
  AdminLessonSummary,
  AdminProgramWithContentDto,
  CurriculumMetadata,
} from '@diaz/shared';
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
  isStoredIdentifierAbsent,
  lessonEditorFieldsAfterRowChange,
  lessonEditorFieldsAfterSave,
  programDisciplineToCurriculumDiscipline,
} from '@diaz/shared';
import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/empty-state';
import { LessonVideoStateBadge } from '@/components/lesson-video-state';
import { LessonVideoUpload } from '@/components/lesson-video-upload';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardActions } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
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

/**
 * The identifiers a save sends for the form as it stands against a given row.
 * A function of both rather than of the render, because the save re-reads the
 * row right before it PATCHes and has to derive them again from what it finds.
 */
function outgoingVideoIdentifiers(
  form: LessonEditorForm,
  lesson: Parameters<typeof isAwaitingMuxPlayback>[0] | undefined,
) {
  // The asset ID is not a playback identifier: the webhook matches on it
  // whatever the stored provider says, and the database allows it on any row.
  // Gating the field on the form provider hid it on exactly the rows the
  // "Waiting for Mux" badge points at, and the next save then blanked the id the
  // badge was about.
  const showMuxAssetIdField =
    form.videoProvider === VideoProvider.MUX ||
    (isAwaitingMuxPlayback(lesson ?? {}) && form.videoProvider !== VideoProvider.YOUTUBE);

  // Blank is stored as NULL, never as an empty string: "no playback id yet"
  // needs one spelling, or a query for the lessons still waiting on Mux misses
  // exactly the ones saved here.
  return {
    showMuxAssetIdField,
    muxPlaybackId:
      form.videoProvider === VideoProvider.MUX ? form.muxPlaybackId.trim() || null : null,
    muxAssetId: showMuxAssetIdField ? form.muxAssetId.trim() || null : null,
  };
}

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
  // Which lesson the form was last populated for. The form is built from the
  // row once, when it first arrives; after that the row changes behind it - a
  // save, a publish toggle, a Mux webhook - and only the fields those changes
  // actually decide are adopted, so an operator's unsaved edits survive them.
  const populatedForLessonId = useRef<string | null>(null);
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
  const { showMuxAssetIdField, muxPlaybackId: outgoingMuxPlaybackId } = outgoingVideoIdentifiers(
    form,
    lesson,
  );

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
    // Mount-only load, kept as-is: load is a new closure on every render, so listing it would
    // re-run this effect after every render, and since load sets state that is an endless fetch loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!lesson || populatedForLessonId.current === lesson.id) return;
    populatedForLessonId.current = lesson.id;
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

  /**
   * A row the Mux webhooks changed while this page was open, handed over by the
   * upload control's polling. The catalogue copy is updated in place so every
   * badge reads the new row, and the form adopts what the webhook changed, for
   * the reason `lessonEditorFieldsAfterRowChange` gives: until it does, a Save
   * would PATCH the asset id the webhook just bound straight back off the row,
   * and put a typed-in planned length back over the duration Mux measured.
   */
  const applyLessonRow = useCallback(
    (next: AdminLessonSummary) => {
      setPrograms((current) =>
        current
          ? current.map((entry) => ({
              ...entry,
              courses: entry.courses.map((course) => ({
                ...course,
                lessons: course.lessons.map((item) => (item.id === next.id ? next : item)),
              })),
            }))
          : current,
      );
      const adopted = lessonEditorFieldsAfterRowChange(lesson ?? next, next);
      setForm((prev) => ({ ...prev, ...adopted }));
    },
    [lesson],
  );

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

    try {
      // The row as it is now, not as the last poll saw it. A webhook that landed
      // inside the poll window - `video.asset.ready` writing the playback id and
      // the measured duration - would otherwise be PATCHed straight back off the
      // row by the fields this form still holds from before it.
      const fresh = await apiFetch<AdminLessonSummary>(`/admin/lessons/${lessonId}`);
      const adopted = lessonEditorFieldsAfterRowChange(lesson ?? fresh, fresh);
      const current = { ...form, ...adopted };
      if (Object.keys(adopted).length > 0) applyLessonRow(fresh);

      const outgoing = outgoingVideoIdentifiers(current, fresh);
      const normalizedYoutubeVideoId = current.youtubeVideoId.trim();

      // An asset id on its own is a complete Mux lesson that is not playable yet:
      // Mux issues the playback id later, on `video.asset.ready`, and the webhook
      // finds the lesson by exactly this asset id. Demanding a playback id here
      // was what left ingestion with no entrance at all.
      if (
        current.videoProvider === VideoProvider.MUX &&
        !outgoing.muxPlaybackId &&
        !outgoing.muxAssetId
      ) {
        setStatus('Set the Mux asset ID or the playback ID when the lesson uses Mux.');
        return;
      }

      if (current.videoProvider === VideoProvider.YOUTUBE && !normalizedYoutubeVideoId) {
        setStatus('YouTube video ID is required when the lesson uses YouTube.');
        return;
      }

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
          title: current.title,
          description: current.description,
          accessLevel: current.accessLevel,
          videoProvider: current.videoProvider,
          muxAssetId: outgoing.muxAssetId,
          muxPlaybackId: outgoing.muxPlaybackId,
          youtubeVideoId:
            current.videoProvider === VideoProvider.YOUTUBE ? normalizedYoutubeVideoId : null,
          durationSeconds: current.durationSeconds ? Number(current.durationSeconds) : null,
          curriculum: {
            ...current.curriculum,
            skill: current.curriculum.skill || undefined,
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
      // this app's only tests cover `middleware.ts`.
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
        <Card>
          <p className="type-display-400 text-foreground-faint">Loading lesson...</p>
        </Card>
      </AppShell>
    );
  }

  if (lessonContext === null || !lesson) {
    return (
      <AppShell>
        <EmptyState
          description="The selected lesson could not be found."
          title="Lesson unavailable"
        />
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
    <AppShell>
      <form className="grid gap-600 xl:grid-cols-split" onSubmit={onSave}>
        <Card className="flex flex-col gap-500">
          <div className="flex flex-col gap-300">
            <h1 className="type-display-500">{lesson.title}</h1>
            <div className="flex flex-wrap items-center gap-200">
              {program ? <Badge label={getDisciplineLabel(program.discipline)} /> : null}
              {program?.isFeaturedDemo ? <Badge label="Demo" /> : null}
              <LessonVideoStateBadge lesson={lesson} />
              <Badge
                label={lesson.isPublished ? 'Published' : 'Draft'}
                variant={lesson.isPublished ? 'success' : 'neutral'}
              />
            </div>
          </div>

          <Field htmlFor={titleInputId} label="Lesson title">
            <Input
              id={titleInputId}
              value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
            />
          </Field>
          <Field htmlFor={descriptionInputId} label="Lesson description">
            <Textarea
              id={descriptionInputId}
              rows={6}
              value={form.description}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, description: event.target.value }))
              }
            />
          </Field>
          <div className="grid gap-400 md:grid-cols-split">
            <Field
              error={
                willClearMuxPlaybackId
                  ? 'Saving will clear the Mux playback ID. A public-policy Mux asset cannot back ' +
                    'premium content, and nothing on the lesson records which policy this asset ' +
                    'carries, so the ID is cleared rather than kept. If the asset is public-policy, ' +
                    'that ID plays for anyone holding it - and if this lesson was ever published while ' +
                    'it was free, everyone who browsed the catalogue holds it and it cannot be ' +
                    'recalled. A premium lesson needs a signed-only Mux asset.'
                  : undefined
              }
              htmlFor={accessLevelInputId}
              label="Access level"
            >
              <Select
                id={accessLevelInputId}
                value={form.accessLevel}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, accessLevel: event.target.value as AccessLevel }))
                }
              >
                <option value="FREE">Free lesson</option>
                <option value="PAID">Premium lesson</option>
              </Select>
            </Field>
            <Field htmlFor={durationSecondsInputId} label="Duration seconds">
              <Input
                id={durationSecondsInputId}
                placeholder="Duration seconds"
                value={form.durationSeconds}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, durationSeconds: event.target.value }))
                }
              />
            </Field>
          </div>
          <div className="flex flex-col gap-300">
            <p className="type-kicker">Lesson video</p>
            {/*
              Against the saved row, not the form: the upload binds to the
              lesson as stored, and the API refuses a lesson still holding a
              YouTube id for the reason the webhook does. The form's provider is
              checked too, so an operator halfway through switching to YouTube
              is not offered an upload that would contradict the save.
            */}
            {isStoredIdentifierAbsent(lesson.youtubeVideoId) &&
            form.videoProvider !== VideoProvider.YOUTUBE ? (
              <LessonVideoUpload
                lesson={lesson}
                onLessonChanged={applyLessonRow}
                disabledReason={
                  form.accessLevel !== lesson.accessLevel
                    ? 'Save the access level first. The upload takes its playback policy from ' +
                      'the saved tier, and a premium video created under the free tier would be ' +
                      'public.'
                    : undefined
                }
              />
            ) : (
              <p className="text-body-200 text-foreground-faint">
                This lesson uses a YouTube video. To upload a video to Mux instead, set Video source
                to Mux playback and save, then the upload control appears here.
              </p>
            )}
          </div>
          <Field htmlFor={videoProviderInputId} label="Video source">
            <Select
              id={videoProviderInputId}
              value={form.videoProvider}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, videoProvider: event.target.value as VideoProvider }))
              }
            >
              <option value={VideoProvider.NONE}>No video source</option>
              <option value={VideoProvider.MUX}>Mux playback</option>
              <option value={VideoProvider.YOUTUBE}>YouTube demo video</option>
            </Select>
          </Field>
          {showMuxAssetIdField ? (
            <Field
              help="Filled in by an upload above, or paste the ID of an asset that already exists in Mux. Either way the Mux webhook fills in the playback ID and duration once the asset finishes encoding."
              htmlFor={muxAssetInputId}
              label="Mux asset ID"
            >
              <Input
                id={muxAssetInputId}
                placeholder="Mux asset ID"
                value={form.muxAssetId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, muxAssetId: event.target.value }))
                }
              />
            </Field>
          ) : null}
          {form.videoProvider === VideoProvider.MUX ? (
            <Field
              error={
                showMuxPlaybackIdHint
                  ? 'This playback ID will not play. A published lesson with it shows the not-filmed state.'
                  : undefined
              }
              htmlFor={muxPlaybackInputId}
              label="Mux playback ID"
            >
              <Input
                id={muxPlaybackInputId}
                placeholder="Mux playback ID"
                value={form.muxPlaybackId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, muxPlaybackId: event.target.value }))
                }
              />
            </Field>
          ) : null}
          {form.videoProvider === VideoProvider.YOUTUBE ? (
            <Field
              error={
                showYoutubeVideoIdHint
                  ? 'This video ID will not play. A published lesson with it shows the not-filmed state.'
                  : undefined
              }
              help={
                showPaidYoutubeExposureNote
                  ? "Premium does not protect a YouTube video. This ID is the video's permanent address and premium playback embeds that same public ID. If this lesson was ever published while it was free, everyone who browsed the catalogue holds this ID and it cannot be recalled. Only YouTube Studio can restrict the video."
                  : undefined
              }
              htmlFor={youtubeVideoInputId}
              label="YouTube video ID"
            >
              <Input
                id={youtubeVideoInputId}
                placeholder="YouTube video ID"
                value={form.youtubeVideoId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, youtubeVideoId: event.target.value }))
                }
              />
            </Field>
          ) : null}
          <CardActions>
            <Button disabled={saving} type="submit" variant="primary">
              {saving ? 'Saving...' : 'Save lesson'}
            </Button>
            <Button onClick={togglePublish} variant="secondary">
              {lesson.isPublished ? 'Move to draft' : 'Publish lesson'}
            </Button>
            <ButtonLink href={`/lesson/${lesson.id}`} variant="ghost">
              Preview lesson
            </ButtonLink>
          </CardActions>
          {status ? (
            <p aria-live="polite" className="text-body-200 text-foreground-success">
              {status}
            </p>
          ) : null}
        </Card>

        <section className="flex flex-col gap-500">
          <Card className="flex flex-col gap-500">
            <h2 className="type-display-500">Guided path</h2>
            <div className="grid gap-400 md:grid-cols-split">
              <Field htmlFor={curriculumDisciplineInputId} label="Curriculum discipline">
                <Select
                  id={curriculumDisciplineInputId}
                  value={form.curriculum.discipline}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      curriculum: createDefaultCurriculum(
                        event.target.value as CurriculumMetadata['discipline'],
                      ),
                    }))
                  }
                >
                  {curriculumDisciplineKeys.map((discipline) => (
                    <option key={discipline} value={discipline}>
                      {getDisciplineLabel(discipline)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field htmlFor={curriculumPhaseInputId} label="Curriculum phase">
                <Select
                  id={curriculumPhaseInputId}
                  value={form.curriculum.phase}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      curriculum: {
                        ...prev.curriculum,
                        phase: event.target.value,
                        track:
                          getCurriculumTrackKeys(
                            prev.curriculum.discipline,
                            event.target.value,
                          )[0] ?? prev.curriculum.track,
                      },
                    }))
                  }
                >
                  {phaseOptions.map((phase) => (
                    <option key={phase} value={phase}>
                      {getCurriculumPhaseLabel(form.curriculum.discipline, phase)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field htmlFor={curriculumTrackInputId} label="Curriculum track">
                <Select
                  id={curriculumTrackInputId}
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
                </Select>
              </Field>
              <Field htmlFor={curriculumSkillInputId} label="Curriculum skill">
                <Select
                  id={curriculumSkillInputId}
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
                </Select>
              </Field>
              <Field htmlFor={curriculumLevelInputId} label="Curriculum level">
                <Select
                  id={curriculumLevelInputId}
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
                </Select>
              </Field>
            </div>
          </Card>

          <Card className="flex flex-col gap-300" variant="raised">
            <p className="type-kicker">Generated tags</p>
            <div className="flex flex-wrap gap-200">
              <Badge label={`discipline:${form.curriculum.discipline}`} />
              <Badge label={`phase:${form.curriculum.phase}`} />
              <Badge label={`track:${form.curriculum.track}`} />
              {form.curriculum.skill ? <Badge label={`skill:${form.curriculum.skill}`} /> : null}
              <Badge label={`level:${form.curriculum.level}`} />
            </div>
          </Card>
        </section>
      </form>
    </AppShell>
  );
}
