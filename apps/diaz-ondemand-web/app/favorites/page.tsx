'use client';

import { useEffect, useState } from 'react';
import type { FavoriteDto } from '@diaz/shared';
import { apiFetch } from '@/lib/api';

export default function FavoritesPage() {
  const [favorites, setFavorites] = useState<FavoriteDto[]>([]);

  useEffect(() => {
    apiFetch<FavoriteDto[]>('/favorites').then(setFavorites).catch(() => setFavorites([]));
  }, []);

  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold">Favorites</h1>
      {favorites.map((favorite) => (
        <div key={favorite.id} className="rounded border bg-white p-3">
          {favorite.lesson?.title ?? 'Lesson'}
        </div>
      ))}
      {favorites.length === 0 ? <p className="text-sm text-gray-500">No favorites yet.</p> : null}
    </div>
  );
}
