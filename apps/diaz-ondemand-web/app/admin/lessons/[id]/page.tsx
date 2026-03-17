'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import type {
  AccessLevel,
  CurriculumMetadata,
  ProgramWithContentDto,
} from '@diaz/shared';
import {
  VideoProvider,
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
  programDisciplineToCurriculumDiscipline,
} from '@diaz/shared';
import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/empty-state';
import { PremiumBadge } from '@/components/premium-badge';
import { useApiClient } from '@/lib/api-client';

type LessonEditorForm = {
  title: string;
  description: string;
  accessLevel: AccessLevel;
  videoProvider: VideoProvider;
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
  const muxPlaybackInputId = 'mux-playback-id';
  const youtubeVideoInputId = 'youtube-video-id';
  const curriculumDisciplineInputId = 'curriculum-discipline';
  const curriculumPhaseInputId = 'curriculum-phase';
  const curriculumTrackInputId = 'curriculum-track';
  const curriculumSkillInputId = 'curriculum-skill';
  const curriculumLevelInputId = 'curriculum-level';
  const [programs, setPrograms] = useState<ProgramWithContentDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [form, setForm] = useState<LessonEditorForm>({
    title: '',
    description: '',
    accessLevel: 'FREE' as AccessLevel,
    videoProvider: VideoProvider.NONE,
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

  const load = async () => {
    try {
      const data = await apiFetch<ProgramWithContentDto[]>('/admin/programs');
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
    const normalizedMuxPlaybackId = form.muxPlaybackId.trim();
    const normalizedYoutubeVideoId = form.youtubeVideoId.trim();

    if (form.videoProvider === VideoProvider.MUX && !normalizedMuxPlaybackId) {
      setStatus('Mux playback ID is required when the lesson uses Mux.');
      return;
    }

    if (form.videoProvider === VideoProvider.YOUTUBE && !normalizedYoutubeVideoId) {
      setStatus('YouTube video ID is required when the lesson uses YouTube.');
      return;
    }

    try {
      await apiFetch(`/admin/lessons/${lessonId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          accessLevel: form.accessLevel,
          videoProvider: form.videoProvider,
          muxPlaybackId: form.videoProvider === VideoProvider.MUX ? normalizedMuxPlaybackId : null,
          youtubeVideoId:
            form.videoProvider === VideoProvider.YOUTUBE ? normalizedYoutubeVideoId : null,
          durationSeconds: form.durationSeconds ? Number(form.durationSeconds) : null,
          curriculum: {
            ...form.curriculum,
            skill: form.curriculum.skill || undefined,
          },
        }),
      });
      setStatus('Lesson saved.');
      await load();
    } catch (requestError) {
      setStatus(
        requestError instanceof Error
          ? `Lesson could not be saved. ${requestError.message}`
          : 'Lesson could not be saved.',
      );
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
            </div>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <button
              className="inline-flex items-center rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-[var(--accent-strong)]"
              type="submit"
            >
              Save lesson
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
