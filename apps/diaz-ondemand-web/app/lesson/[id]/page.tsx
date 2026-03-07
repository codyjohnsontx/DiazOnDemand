'use client';

import MuxPlayer from '@mux/mux-player-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { CourseDto, FavoriteDto, LessonDetailDto, ProgramWithContentDto, ProgressDto } from '@diaz/shared';
import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/empty-state';
import { LessonRow } from '@/components/lesson-row';
import { LockedStateCard } from '@/components/locked-state-card';
import { PremiumBadge } from '@/components/premium-badge';
import { ProgressBar } from '@/components/progress-bar';
import { useApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-shared';
import {
  buildCourseProgress,
  buildLessonQueue,
  findProgramForCourse,
  formatCurriculumLabel,
  formatDuration,
  getLessonProgressPercent,
} from '@/lib/student-ui';

type PlayerHandle = {
  currentTime: number;
  duration: number;
};

export default function LessonPage() {
  const params = useParams<{ id: string }>();
  const lessonId = params.id;
  const apiFetch = useApiClient();
  const [lesson, setLesson] = useState<LessonDetailDto | null>(null);
  const [course, setCourse] = useState<CourseDto | null>(null);
  const [programTitle, setProgramTitle] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressDto[]>([]);
  const [isFavorite, setIsFavorite] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const playerRef = useRef<PlayerHandle | null>(null);

  const saveProgress = useEffectEvent(async () => {
    if (!playerRef.current || !lessonId || !lesson) {
      return;
    }

    const current = Math.floor(playerRef.current.currentTime || 0);
    const complete = (playerRef.current.duration || 0) - current < 10;

    try {
      setSaveState('saving');
      await apiFetch(`/progress/${lessonId}`, {
        method: 'POST',
        body: JSON.stringify({
          lastPositionSeconds: current,
          completed: complete,
        }),
      });
      setSaveState('saved');
      setLastSavedAt(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
      setProgress((currentProgress) => {
        const existing = currentProgress.find((entry) => entry.lessonId === lessonId);
        const nextEntry = {
          id: existing?.id ?? `local-${lessonId}`,
          userId: existing?.userId ?? 'pending',
          lessonId,
          lastPositionSeconds: current,
          completed: complete,
          updatedAt: new Date().toISOString(),
        };

        return existing
          ? currentProgress.map((entry) => (entry.lessonId === lessonId ? nextEntry : entry))
          : [nextEntry, ...currentProgress];
      });
    } catch {
      setSaveState('error');
    }
  });

  useEffect(() => {
    let active = true;

    async function load() {
      setError(null);
      setPlaybackError(null);

      try {
        const nextLesson = await apiFetch<LessonDetailDto>(`/lessons/${lessonId}`);
        const [nextCourse, programs, nextProgress, favorites] = await Promise.all([
          apiFetch<CourseDto>(`/courses/${nextLesson.courseId}`),
          apiFetch<ProgramWithContentDto[]>('/programs'),
          apiFetch<ProgressDto[]>('/progress').catch((progressError) => {
            if (progressError instanceof ApiError && progressError.status === 401) {
              return [];
            }
            throw progressError;
          }),
          apiFetch<FavoriteDto[]>('/favorites').catch((favoriteError) => {
            if (favoriteError instanceof ApiError && favoriteError.status === 401) {
              return [];
            }
            throw favoriteError;
          }),
        ]);

        if (!active) {
          return;
        }

        setLesson(nextLesson);
        setCourse(nextCourse);
        setProgramTitle(findProgramForCourse(programs, nextCourse.programId)?.title ?? null);
        setProgress(nextProgress);
        setIsFavorite(favorites.some((favorite) => favorite.lessonId === nextLesson.id));
      } catch (requestError) {
        if (!active) {
          return;
        }

        setError(requestError instanceof Error ? requestError : new Error('Unknown lesson error.'));
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [lessonId, apiFetch]);

  useEffect(() => {
    const interval = setInterval(() => {
      void saveProgress();
    }, 10000);
    const handleBeforeUnload = () => {
      void saveProgress();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      void saveProgress();
    };
  }, [lessonId, saveProgress]);

  const toggleFavorite = async () => {
    if (!lesson) {
      return;
    }

    if (isFavorite) {
      await apiFetch(`/favorites/${lesson.id}`, { method: 'DELETE' });
      setIsFavorite(false);
      return;
    }

    await apiFetch(`/favorites/${lesson.id}`, { method: 'POST' });
    setIsFavorite(true);
  };

  if (error instanceof ApiError && error.status === 402) {
    return (
      <AppShell>
        <LockedStateCard />
      </AppShell>
    );
  }

  if (error instanceof ApiError && error.status === 401) {
    return (
      <AppShell>
        <EmptyState
          ctaHref="/sign-in"
          ctaLabel="Sign in"
          description="You need member access to load lesson progress, favorites, and premium playback."
          title="Sign in to keep training"
        />
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell>
        <EmptyState
          ctaHref="/library"
          ctaLabel="Back to library"
          description={`The lesson could not be loaded right now. ${error.message}`}
          title="Lesson unavailable"
        />
      </AppShell>
    );
  }

  if (!lesson) {
    return (
      <AppShell>
        <div className="surface-panel p-8">
          <p className="font-display text-2xl uppercase tracking-[0.04em] text-[var(--text-muted)]">Loading lesson...</p>
        </div>
      </AppShell>
    );
  }

  const playbackSrc = lesson.playbackUrl;
  const currentProgress = progress.find((entry) => entry.lessonId === lesson.id);
  const currentProgressPercent = getLessonProgressPercent(lesson, currentProgress);
  const queue = course ? buildLessonQueue(course, progress, lesson.id) : [];
  const courseProgress = course ? buildCourseProgress(course, progress) : null;
  const currentLessonIndex = course?.lessons?.findIndex((entry) => entry.id === lesson.id) ?? -1;
  const previousLesson = currentLessonIndex > 0 ? course?.lessons?.[currentLessonIndex - 1] ?? null : null;
  const nextLesson =
    currentLessonIndex >= 0 && course?.lessons ? course.lessons[currentLessonIndex + 1] ?? null : null;
  const curriculumLabel = formatCurriculumLabel(lesson);

  return (
    <AppShell className="space-y-8">
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)]">
        <section className="space-y-6">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <PremiumBadge
                label={lesson.accessLevel === 'PAID' ? 'Premium lesson' : 'Free lesson'}
                tone={lesson.accessLevel === 'PAID' ? 'premium' : 'accent'}
              />
              {programTitle ? <PremiumBadge label={programTitle} /> : null}
              {course ? <PremiumBadge label={course.title} /> : null}
              {curriculumLabel ? <PremiumBadge label={curriculumLabel} /> : null}
              {formatDuration(lesson.durationSeconds) ? <PremiumBadge label={formatDuration(lesson.durationSeconds) ?? ''} /> : null}
            </div>
            <div className="space-y-3">
              <h1 className="font-display text-5xl uppercase leading-none tracking-[0.03em] text-[var(--text)] sm:text-6xl">
                {lesson.title}
              </h1>
              <p className="max-w-3xl text-base leading-7 text-[var(--text-muted)]">
                {lesson.description ?? 'Train the key details, keep your place automatically, and move directly into the next lesson from the queue.'}
              </p>
            </div>
          </div>

          <div className="surface-panel overflow-hidden">
            {playbackSrc && lesson.muxPlaybackId ? (
              <MuxPlayer
                ref={playerRef as never}
                accentColor="#35e0a1"
                className="aspect-video w-full"
                metadata={{ video_id: lesson.id, video_title: lesson.title }}
                playbackId={lesson.muxPlaybackId}
                preferPlayback="mse"
                src={playbackSrc}
                streamType="on-demand"
                onError={() => setPlaybackError('Playback failed. Verify the Mux playback ID and signed playback configuration.')}
                onTimeUpdate={(event) => {
                  playerRef.current = event.currentTarget as unknown as PlayerHandle;
                }}
              />
            ) : (
              <div className="flex aspect-video items-end bg-[linear-gradient(135deg,#1f242d_0%,#0f1217_55%,#08090b_100%)] p-6 sm:p-8">
                <div className="space-y-3">
                  <p className="font-display text-xs uppercase tracking-[0.28em] text-[var(--text-muted)]">Playback source missing</p>
                  <h2 className="font-display text-4xl uppercase leading-none text-[var(--text)]">No video source yet</h2>
                  <p className="max-w-xl text-sm leading-7 text-[var(--text-muted)]">
                    Add a valid Mux playback ID in admin and this lesson will render inside the player automatically.
                  </p>
                </div>
              </div>
            )}
          </div>

          {playbackError ? (
            <div className="surface-panel-muted p-4 text-sm leading-7 text-[var(--danger)]">{playbackError}</div>
          ) : null}

          <div className="surface-panel space-y-5 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <p className="font-display text-xs uppercase tracking-[0.28em] text-[var(--text-muted)]">Playback status</p>
                <p className="text-sm text-[var(--text-muted)]">
                  {saveState === 'saving'
                    ? 'Saving progress...'
                    : saveState === 'saved'
                      ? `Progress saved ${lastSavedAt ? `at ${lastSavedAt}` : 'just now'}.`
                      : saveState === 'error'
                        ? 'Progress save failed. We will retry automatically.'
                        : 'Progress sync starts once playback begins.'}
                </p>
              </div>
              <button
                className={[
                  'inline-flex items-center rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] transition-colors duration-200',
                  isFavorite
                    ? 'border-[var(--premium)]/40 bg-[var(--premium)]/12 text-[var(--text)]'
                    : 'border-white/10 bg-white/5 text-[var(--text-muted)] hover:bg-white/10 hover:text-[var(--text)]',
                ].join(' ')}
                onClick={() => void toggleFavorite()}
                type="button"
              >
                {isFavorite ? 'Saved to favorites' : 'Save to favorites'}
              </button>
            </div>
            <ProgressBar label="Lesson progress" value={currentProgressPercent} />
            {courseProgress ? <ProgressBar label="Course progress" value={courseProgress.percent} /> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              {previousLesson ? (
                <Link
                  className="surface-panel-muted flex items-center justify-between gap-3 p-4 transition-colors duration-200 hover:bg-[var(--surface-3)]"
                  href={`/lesson/${previousLesson.id}`}
                >
                  <div>
                    <p className="font-display text-xs uppercase tracking-[0.24em] text-[var(--text-muted)]">Previous</p>
                    <p className="mt-2 text-sm font-semibold text-[var(--text)]">{previousLesson.title}</p>
                  </div>
                  <span className="font-display text-xs uppercase tracking-[0.18em] text-white/60">Open</span>
                </Link>
              ) : (
                <div className="surface-panel-muted p-4 text-sm text-[var(--text-muted)]">Start of course.</div>
              )}

              {nextLesson ? (
                <Link
                  className="surface-panel-muted flex items-center justify-between gap-3 p-4 transition-colors duration-200 hover:bg-[var(--surface-3)]"
                  href={`/lesson/${nextLesson.id}`}
                >
                  <div>
                    <p className="font-display text-xs uppercase tracking-[0.24em] text-[var(--text-muted)]">Next</p>
                    <p className="mt-2 text-sm font-semibold text-[var(--text)]">{nextLesson.title}</p>
                  </div>
                  <span className="font-display text-xs uppercase tracking-[0.18em] text-white/60">Open</span>
                </Link>
              ) : (
                <div className="surface-panel-muted p-4 text-sm text-[var(--text-muted)]">End of course.</div>
              )}
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="font-display text-xs uppercase tracking-[0.28em] text-[var(--text-muted)]">Course queue</p>
              <h2 className="font-display text-3xl uppercase tracking-[0.03em] text-[var(--text)]">
                {course?.title ?? 'Current course'}
              </h2>
            </div>
            <Link
              className="text-sm text-[var(--text-muted)] transition-colors duration-200 hover:text-[var(--text)]"
              href={course ? `/course/${course.id}` : '/library'}
            >
              Open course
            </Link>
          </div>

          <div className="space-y-3">
            {queue.map((queueItem) => (
              <LessonRow
                accessLabel={queueItem.accessLabel}
                curriculumLabel={queueItem.curriculumLabel}
                durationLabel={queueItem.durationLabel}
                href={queueItem.href}
                isCompleted={queueItem.isCompleted}
                isCurrent={queueItem.isCurrent}
                isNext={queueItem.isNext}
                key={queueItem.id}
                orderLabel={queueItem.orderLabel}
                title={queueItem.title}
              />
            ))}
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
