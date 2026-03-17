'use client';

import MuxPlayer from '@mux/mux-player-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  VideoProvider,
  getCurriculumPhaseLabel,
  getDisciplineLabel,
  type CourseDto,
  type FavoriteDto,
  type LessonDetailDto,
  type ProgramWithContentDto,
  type ProgressDto,
} from '@diaz/shared';
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

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function getPlaybackStatusMessage({
  provider,
  currentCompleted,
  lastSavedAt,
  saveState,
}: {
  provider: VideoProvider;
  currentCompleted: boolean;
  lastSavedAt: string | null;
  saveState: SaveState;
}) {
  if (provider === VideoProvider.YOUTUBE) {
    if (saveState === 'error') {
      return 'Progress save failed. Mark the lesson complete again to retry.';
    }

    return currentCompleted
      ? `Marked complete${lastSavedAt ? ` at ${lastSavedAt}` : ''}.`
      : 'Demo video progress is not time-synced. Mark this lesson complete when you finish the walkthrough.';
  }

  if (saveState === 'saving') {
    return 'Saving progress...';
  }

  if (saveState === 'saved') {
    return `Progress saved ${lastSavedAt ? `at ${lastSavedAt}` : 'just now'}.`;
  }

  if (saveState === 'error') {
    return 'Progress save failed. We will retry automatically.';
  }

  return 'Progress sync starts once playback begins.';
}

function isTrustedYouTubeEmbed(url: string) {
  try {
    const parsedUrl = new URL(url);
    const host = parsedUrl.hostname.toLowerCase();
    const isTrustedHost =
      host === 'www.youtube.com' ||
      host === 'youtube.com' ||
      host === 'www.youtube-nocookie.com';

    return isTrustedHost && parsedUrl.pathname.startsWith('/embed/');
  } catch {
    return false;
  }
}

export default function LessonPage() {
  const params = useParams<{ id: string }>();
  const lessonId = params.id;
  const apiFetch = useApiClient();
  const [lesson, setLesson] = useState<LessonDetailDto | null>(null);
  const [course, setCourse] = useState<CourseDto | null>(null);
  const [program, setProgram] = useState<ProgramWithContentDto | null>(null);
  const [progress, setProgress] = useState<ProgressDto[]>([]);
  const [isFavorite, setIsFavorite] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const playerRef = useRef<PlayerHandle | null>(null);
  const lessonRef = useRef<LessonDetailDto | null>(null);
  const lessonIdRef = useRef<string>(lessonId);
  const apiFetchRef = useRef(apiFetch);

  useEffect(() => {
    lessonRef.current = lesson;
    lessonIdRef.current = lessonId;
    apiFetchRef.current = apiFetch;
  }, [lesson, lessonId, apiFetch]);

  async function saveProgress() {
    const currentLesson = lessonRef.current;
    const currentLessonId = lessonIdRef.current;

    if (!playerRef.current || !currentLessonId || !currentLesson) {
      return;
    }

    const current = Math.floor(playerRef.current.currentTime || 0);
    const duration = playerRef.current.duration;
    const complete = Number.isFinite(duration) && duration > 0 ? duration - current < 10 : false;

    try {
      setSaveState('saving');
      await apiFetchRef.current(`/progress/${currentLessonId}`, {
        method: 'POST',
        body: JSON.stringify({
          lastPositionSeconds: current,
          completed: complete,
        }),
      });
      setSaveState('saved');
      setLastSavedAt(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
      setProgress((currentProgress) => {
        const existing = currentProgress.find((entry) => entry.lessonId === currentLessonId);
        const nextEntry = {
          id: existing?.id ?? `local-${currentLessonId}`,
          userId: existing?.userId ?? 'pending',
          lessonId: currentLessonId,
          lastPositionSeconds: current,
          completed: complete,
          updatedAt: new Date().toISOString(),
        };

        return existing
          ? currentProgress.map((entry) => (entry.lessonId === currentLessonId ? nextEntry : entry))
          : [nextEntry, ...currentProgress];
      });
    } catch {
      setSaveState('error');
    }
  }

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
        setProgram(findProgramForCourse(programs, nextCourse.programId));
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
    // This effect intentionally reads from refs so the interval and unload handler
    // stay stable while lessonRef, lessonIdRef, and apiFetchRef are updated elsewhere.
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
  }, [lessonId]);

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

  const markLessonComplete = async () => {
    if (!lesson) {
      return;
    }

    const lastPositionSeconds = lesson.durationSeconds ?? Math.max(progress.find((entry) => entry.lessonId === lesson.id)?.lastPositionSeconds ?? 0, 1);

    try {
      setSaveState('saving');
      await apiFetch(`/progress/${lesson.id}`, {
        method: 'POST',
        body: JSON.stringify({
          lastPositionSeconds,
          completed: true,
        }),
      });

      setSaveState('saved');
      setLastSavedAt(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
      setProgress((currentProgress) => {
        const existing = currentProgress.find((entry) => entry.lessonId === lesson.id);
        const nextEntry = {
          id: existing?.id ?? `manual-${lesson.id}`,
          userId: existing?.userId ?? 'pending',
          lessonId: lesson.id,
          lastPositionSeconds,
          completed: true,
          updatedAt: new Date().toISOString(),
        };

        return existing
          ? currentProgress.map((entry) => (entry.lessonId === lesson.id ? nextEntry : entry))
          : [nextEntry, ...currentProgress];
      });
    } catch {
      setSaveState('error');
    }
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
          <p className="font-display text-2xl leading-tight text-[var(--text-muted)]">Loading lesson...</p>
        </div>
      </AppShell>
    );
  }

  const video = lesson.video;
  const currentProgress = progress.find((entry) => entry.lessonId === lesson.id);
  const currentProgressPercent = getLessonProgressPercent(lesson, currentProgress);
  const queue = course ? buildLessonQueue(course, progress, lesson.id) : [];
  const courseProgress = course ? buildCourseProgress(course, progress) : null;
  const currentLessonIndex = course?.lessons?.findIndex((entry) => entry.id === lesson.id) ?? -1;
  const previousLesson = currentLessonIndex > 0 ? course?.lessons?.[currentLessonIndex - 1] ?? null : null;
  const nextLesson =
    currentLessonIndex >= 0 && course?.lessons ? course.lessons[currentLessonIndex + 1] ?? null : null;
  const curriculumLabel = formatCurriculumLabel(lesson);
  const currentCompleted = Boolean(currentProgress?.completed);
  const trustedYoutubeEmbedUrl =
    video.provider === VideoProvider.YOUTUBE && video.embedUrl && isTrustedYouTubeEmbed(video.embedUrl)
      ? video.embedUrl
      : null;

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
              {program ? <PremiumBadge label={getDisciplineLabel(program.discipline)} /> : null}
              {program?.isFeaturedDemo ? <PremiumBadge label="Demo video" tone="accent" /> : null}
              {program ? <PremiumBadge label={program.title} /> : null}
              {course ? <PremiumBadge label={course.title} /> : null}
              {lesson.curriculum ? (
                <PremiumBadge
                  label={getCurriculumPhaseLabel(lesson.curriculum.discipline, lesson.curriculum.phase)}
                />
              ) : null}
              {curriculumLabel ? <PremiumBadge label={curriculumLabel} /> : null}
              {formatDuration(lesson.durationSeconds) ? <PremiumBadge label={formatDuration(lesson.durationSeconds) ?? ''} /> : null}
            </div>
            <div className="space-y-3">
              <h1 className="type-title-xl max-w-4xl text-[var(--text)]">
                {lesson.title}
              </h1>
              <p className="type-body max-w-3xl text-[var(--text-muted)]">
                {lesson.description ?? 'Train the key details, keep your place automatically, and move directly into the next lesson from the queue.'}
              </p>
            </div>
          </div>

          <div className="surface-panel overflow-hidden">
            {video.provider === VideoProvider.MUX && (video.muxPlaybackId || video.playbackUrl) ? (
              <MuxPlayer
                ref={playerRef as never}
                accentColor="#35e0a1"
                className="aspect-video w-full"
                metadata={{ video_id: lesson.id, video_title: lesson.title }}
                playbackId={video.muxPlaybackId ?? undefined}
                preferPlayback="mse"
                src={video.playbackUrl ?? undefined}
                streamType="on-demand"
                onError={() => setPlaybackError('Playback failed. Verify the Mux playback ID and signed playback configuration.')}
                onTimeUpdate={(event) => {
                  playerRef.current = event.currentTarget as unknown as PlayerHandle;
                }}
              />
            ) : video.provider === VideoProvider.YOUTUBE && trustedYoutubeEmbedUrl ? (
              <div className="aspect-video w-full bg-black">
                <iframe
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  className="h-full w-full"
                  referrerPolicy="strict-origin-when-cross-origin"
                  src={trustedYoutubeEmbedUrl}
                  title={lesson.title}
                />
              </div>
            ) : (
              <div className="flex aspect-video items-end bg-[linear-gradient(135deg,#1f242d_0%,#0f1217_55%,#08090b_100%)] p-6 sm:p-8">
                <div className="space-y-3">
                  <p className="type-kicker text-[var(--text-muted)]">
                    {video.provider === VideoProvider.YOUTUBE ? 'Playback source invalid' : 'Playback source missing'}
                  </p>
                  <h2 className="font-display text-4xl leading-none text-[var(--text)]">
                    {video.provider === VideoProvider.YOUTUBE ? 'YouTube embed unavailable' : 'No video source yet'}
                  </h2>
                  <p className="max-w-xl text-sm leading-7 text-[var(--text-muted)]">
                    {video.provider === VideoProvider.YOUTUBE
                      ? 'The configured YouTube embed URL is not trusted. Update the lesson video settings in admin to restore playback.'
                      : 'Add a valid Mux playback ID in admin and this lesson will render inside the player automatically.'}
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
                <p className="type-kicker text-[var(--text-muted)]">Playback status</p>
                <p className="text-sm text-[var(--text-muted)]">
                  {getPlaybackStatusMessage({
                    provider: video.provider,
                    currentCompleted,
                    lastSavedAt,
                    saveState,
                  })}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {video.provider === VideoProvider.YOUTUBE ? (
                  <button
                    className="inline-flex items-center rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-[var(--accent-strong)]"
                    onClick={() => void markLessonComplete()}
                    type="button"
                  >
                    {currentCompleted ? 'Completed' : 'Mark lesson complete'}
                  </button>
                ) : null}
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
                    <p className="type-kicker text-[var(--text-muted)]">Previous</p>
                    <p className="mt-2 text-sm font-semibold text-[var(--text)]">{previousLesson.title}</p>
                  </div>
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-white/60">Open</span>
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
                    <p className="type-kicker text-[var(--text-muted)]">Next</p>
                    <p className="mt-2 text-sm font-semibold text-[var(--text)]">{nextLesson.title}</p>
                  </div>
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-white/60">Open</span>
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
              <p className="type-kicker text-[var(--text-muted)]">Course queue</p>
              <h2 className="type-title-lg text-[var(--text)]">
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
