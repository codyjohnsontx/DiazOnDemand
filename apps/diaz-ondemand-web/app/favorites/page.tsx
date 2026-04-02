'use client';

import { useEffect, useState } from 'react';
import type { FavoriteDto } from '@diaz/shared';
import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/empty-state';
import { FavoriteRow } from '@/components/favorite-row';
import { PageHeader } from '@/components/page-header';
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
    try {
      await apiFetch(`/favorites/${lessonId}`, { method: 'DELETE' });
      await loadFavorites();
    } catch {
      setError('Could not remove favorite. Please try again.');
    }
  };

  return (
    <AppShell className="space-y-8">
      <PageHeader
        description="Keep the drills and lessons you want to revisit without searching the full library every time."
        eyebrow="Saved work"
        title="Favorites"
      />

      {error ? <p className="text-sm text-[var(--danger)]" role="alert">{error}</p> : null}

      {favorites.length === 0 ? (
        <EmptyState
          ctaHref="/library"
          ctaLabel="Browse library"
          description="Save lessons from the library to build a short list of techniques you want to revisit between classes."
          title="No saved lessons yet"
        />
      ) : (
        <div className="space-y-1">
          {favorites.map((favorite) => (
            <FavoriteRow favorite={favorite} key={favorite.id} onRemove={removeFavorite} />
          ))}
        </div>
      )}
    </AppShell>
  );
}
