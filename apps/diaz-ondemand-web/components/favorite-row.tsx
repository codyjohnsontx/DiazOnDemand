import Link from 'next/link';
import type { FavoriteDto } from '@diaz/shared';

interface FavoriteRowProps {
  favorite: FavoriteDto;
  onRemove: (lessonId: string) => void;
}

export function FavoriteRow({ favorite, onRemove }: FavoriteRowProps) {
  return (
    <div className="group flex items-center gap-4 rounded-[20px] border border-transparent px-4 py-4 transition-all duration-300 hover:border-white/10 hover:bg-white/[0.04]">
      <div className="min-w-0 flex-1 space-y-1">
        <h3 className="truncate text-lg font-medium text-[var(--text)]">
          {favorite.lesson?.title ?? 'Lesson'}
        </h3>
        <p className="text-sm text-[var(--text-muted)]">Saved lesson</p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <button
          className="inline-flex items-center rounded-full border border-white/10 bg-transparent px-4 py-2 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)] transition-colors duration-200 hover:border-white/20 hover:text-[var(--text)]"
          onClick={() => favorite.lesson && onRemove(favorite.lesson.id)}
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
  );
}
