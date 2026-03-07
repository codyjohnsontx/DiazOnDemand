'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { FavoriteDto } from '@diaz/shared';
import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { PremiumBadge } from '@/components/premium-badge';
import { useApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-shared';

export default function FavoritesPage() {
  const apiFetch = useApiClient();
  const [favorites, setFavorites] = useState<FavoriteDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadFavorites = async () => {
    try {
      const data = await apiFetch<FavoriteDto[]>('/favorites');
      setFavorites(data);
      setError(null);
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 401) {
        setFavorites([]);
        setError('Sign in to keep a short list of the lessons you want to revisit.');
        return;
      }

      setError('Favorites could not be loaded right now.');
    }
  };

  useEffect(() => {
    void loadFavorites();
  }, []);

  const removeFavorite = async (lessonId: string) => {
    await apiFetch(`/favorites/${lessonId}`, { method: 'DELETE' });
    await loadFavorites();
  };

  return (
    <AppShell className="space-y-8">
      <PageHeader
        description="Keep the drills and lessons you want to revisit without searching the full library every time."
        eyebrow="Saved work"
        title="Favorites"
      />

      {error ? <div className="surface-panel-muted p-4 text-sm text-[var(--danger)]">{error}</div> : null}

      {favorites.length === 0 ? (
        <EmptyState
          ctaHref="/library"
          ctaLabel="Browse library"
          description="Save lessons from the library to build a short list of techniques you want to revisit between classes."
          title="No saved lessons yet"
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {favorites.map((favorite) => (
            <div className="surface-panel flex h-full flex-col justify-between gap-6 p-6" key={favorite.id}>
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <PremiumBadge
                    label={favorite.lesson?.accessLevel === 'PAID' ? 'Premium' : 'Free'}
                    tone={favorite.lesson?.accessLevel === 'PAID' ? 'premium' : 'accent'}
                  />
                  <span className="text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">Saved lesson</span>
                </div>
                <div className="space-y-3">
                  <h2 className="font-display text-4xl uppercase leading-none tracking-[0.03em] text-[var(--text)]">
                    {favorite.lesson?.title ?? 'Lesson'}
                  </h2>
                  {favorite.lesson?.description ? (
                    <p className="text-sm leading-7 text-[var(--text-muted)]">{favorite.lesson.description}</p>
                  ) : (
                    <p className="text-sm leading-7 text-[var(--text-muted)]">
                      Open this lesson to resume training, save progress, and continue through the course queue.
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">Ready when you are</span>
                <div className="flex items-center gap-3">
                  <button
                    className="inline-flex items-center rounded-full border border-white/10 bg-transparent px-4 py-2 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)] transition-colors duration-200 hover:border-white/20 hover:text-[var(--text)]"
                    onClick={() => favorite.lesson && void removeFavorite(favorite.lesson.id)}
                    type="button"
                  >
                    Remove
                  </button>
                  <Link
                    className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-white/10"
                    href={favorite.lesson ? `/lesson/${favorite.lesson.id}` : '/library'}
                  >
                    Open lesson
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
