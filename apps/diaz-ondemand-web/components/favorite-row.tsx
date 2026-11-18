import type { FavoriteDto } from '@diaz/shared';
import { Button, ButtonLink } from '@/components/ui/button';
import { ListRow } from '@/components/ui/list';

interface FavoriteRowProps {
  favorite: FavoriteDto;
  onRemove: (lessonId: string) => Promise<void>;
}

export function FavoriteRow({ favorite, onRemove }: FavoriteRowProps) {
  return (
    <ListRow
      stack
      title={favorite.lesson?.title ?? 'Lesson'}
      trailing={
        <>
          <Button onClick={() => void onRemove(favorite.lessonId)} size="sm" variant="ghost">
            Remove
          </Button>
          <ButtonLink href={`/lesson/${favorite.lessonId}`} size="sm" variant="secondary">
            Open lesson
          </ButtonLink>
        </>
      }
    />
  );
}
