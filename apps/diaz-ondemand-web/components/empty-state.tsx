import { ButtonLink } from '@/components/ui/button';
import { Card, CardActions } from '@/components/ui/card';

export function EmptyState({
  title,
  description,
  ctaHref,
  ctaLabel,
}: {
  title: string;
  description?: string;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <Card className="flex flex-col gap-600">
      <div className="flex flex-col gap-200">
        <h2 className="type-display-500">{title}</h2>
        {description ? (
          <p className="max-w-reading text-body-300 text-foreground-faint">{description}</p>
        ) : null}
      </div>
      {ctaHref && ctaLabel ? (
        <CardActions>
          <ButtonLink href={ctaHref} variant="secondary">
            {ctaLabel}
          </ButtonLink>
        </CardActions>
      ) : null}
    </Card>
  );
}
