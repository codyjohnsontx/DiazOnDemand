import type { HTMLAttributes } from 'react';

export type CardVariant = 'default' | 'raised' | 'emphasis';

/**
 * One solid surface with one solid border. `emphasis` is the stronger border for the one
 * card a page leads with; `raised` is the surface for a card that sits inside another.
 */
const VARIANTS: Record<CardVariant, string> = {
  default: 'border-border-primary bg-surface-primary',
  emphasis: 'border-border-strong bg-surface-primary',
  raised: 'border-border-strong bg-surface-raised',
};

export function Card({
  variant = 'default',
  padded = true,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { variant?: CardVariant; padded?: boolean }) {
  return (
    <div
      className={[
        'rounded-300 border',
        VARIANTS[variant],
        padded ? 'p-600' : 'overflow-hidden',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    />
  );
}

export function CardActions({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={['flex flex-wrap gap-300', className].filter(Boolean).join(' ')} {...props} />
  );
}
