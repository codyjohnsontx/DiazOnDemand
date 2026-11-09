import type { HTMLAttributes } from 'react';

export type CardVariant = 'default' | 'raised' | 'emphasis';
export type CardPadding = 'default' | 'compact' | 'none';

/**
 * One solid surface with one solid border. `emphasis` is the stronger border for the one
 * card a page leads with; `raised` is the surface for a card that sits inside another.
 */
const VARIANTS: Record<CardVariant, string> = {
  default: 'border-border-primary bg-surface-primary',
  emphasis: 'border-border-strong bg-surface-primary',
  raised: 'border-border-strong bg-surface-raised',
};

const PADDING: Record<CardPadding, string> = {
  default: 'p-600',
  compact: 'p-400',
  none: 'overflow-hidden',
};

export function Card({
  variant = 'default',
  padding = 'default',
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { variant?: CardVariant; padding?: CardPadding }) {
  return (
    <div
      className={['rounded-300 border', VARIANTS[variant], PADDING[padding], className]
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
