'use client';

import MuxPlayer from '@mux/mux-player-react';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LessonDetailDto } from '@diaz/shared';
import { apiFetch } from '@/lib/api';

export default function LessonPage() {
  const params = useParams<{ id: string }>();
  const lessonId = params.id;
  const [lesson, setLesson] = useState<LessonDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const playerRef = useRef<HTMLVideoElement | null>(null);

  const saveProgress = useCallback(async () => {
    if (!playerRef.current || !lessonId) {
      return;
    }

    const current = Math.floor(playerRef.current.currentTime || 0);
    const complete = (playerRef.current.duration || 0) - current < 10;

    try {
      await apiFetch(`/progress/${lessonId}`, {
        method: 'POST',
        body: JSON.stringify({
          lastPositionSeconds: current,
          completed: complete,
        }),
      });
    } catch (progressError) {
      console.error(progressError);
    }
  }, [lessonId]);

  useEffect(() => {
    apiFetch<LessonDetailDto>(`/lessons/${lessonId}`)
      .then(setLesson)
      .catch((requestError) => setError((requestError as Error).message));
  }, [lessonId]);

  useEffect(() => {
    const interval = setInterval(saveProgress, 10000);
    window.addEventListener('beforeunload', saveProgress);

    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', saveProgress);
      void saveProgress();
    };
  }, [saveProgress]);

  if (error?.startsWith('402')) {
    return (
      <div className="rounded border bg-white p-6">
        <h1 className="text-xl font-semibold">Premium lesson</h1>
        <p className="mt-2 text-sm text-gray-700">This lesson is locked behind premium access.</p>
        <a className="mt-4 inline-block rounded bg-black px-4 py-2 text-white" href="/subscribe">
          Subscribe
        </a>
      </div>
    );
  }

  if (error) {
    return <p className="text-red-600">Error: {error}</p>;
  }

  if (!lesson) {
    return <p>Loading lesson...</p>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{lesson.title}</h1>
      <p className="text-sm text-gray-600">{lesson.description}</p>
      {lesson.muxPlaybackId ? (
        <MuxPlayer
          ref={(node) => {
            playerRef.current = node as unknown as HTMLVideoElement;
          }}
          playbackId={lesson.muxPlaybackId}
          streamType="on-demand"
          controls
        />
      ) : lesson.playbackUrl ? (
        <video ref={playerRef} controls className="w-full rounded bg-black" src={lesson.playbackUrl} />
      ) : (
        <div className="rounded border border-dashed p-6 text-sm text-gray-500">
          No playback source yet. Add Mux playbackId in admin.
        </div>
      )}
    </div>
  );
}
