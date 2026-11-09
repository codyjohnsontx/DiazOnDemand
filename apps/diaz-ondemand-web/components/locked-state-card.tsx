import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardActions } from '@/components/ui/card';

export function LockedStateCard() {
  return (
    <Card className="flex flex-col gap-600" variant="emphasis">
      <div className="flex flex-col gap-400">
        <div className="flex flex-wrap gap-200">
          <Badge label="Premium lesson" variant="premium" />
          <Badge label="Monthly access" />
        </div>
        <h1 className="type-display-700 max-w-reading">Unlock the full training library</h1>
      </div>
      <CardActions>
        <ButtonLink href="/subscribe" size="lg" variant="primary">
          Go premium
        </ButtonLink>
      </CardActions>
    </Card>
  );
}
