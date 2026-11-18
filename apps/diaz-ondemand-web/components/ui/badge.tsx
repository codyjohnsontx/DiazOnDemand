export type BadgeVariant = 'neutral' | 'premium' | 'success' | 'critical';

/**
 * Colour means something here and nowhere else on a badge: gold is premium, green is
 * progress or success, red is critical. Everything else is neutral.
 */
const VARIANTS: Record<BadgeVariant, string> = {
  neutral: 'border-border-strong bg-surface-raised text-foreground-faint',
  premium: 'border-border-premium bg-surface-premium-faint text-foreground-premium',
  success: 'border-border-success bg-surface-success-faint text-foreground-success',
  critical: 'border-border-critical bg-surface-critical-faint text-foreground-critical',
};

export function Badge({
  label,
  variant = 'neutral',
  className,
}: {
  label: string;
  variant?: BadgeVariant;
  className?: string;
}) {
  return (
    <span
      className={[
        'inline-flex h-600 items-center whitespace-nowrap rounded-100 border px-200 text-body-100 font-semibold uppercase leading-none tracking-caps',
        VARIANTS[variant],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {label}
    </span>
  );
}
