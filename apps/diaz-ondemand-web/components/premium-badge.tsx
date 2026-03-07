export function PremiumBadge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'premium' | 'accent';
}) {
  const toneClass =
    tone === 'premium'
      ? 'border-[var(--premium)]/30 bg-[var(--premium)]/10 text-[var(--premium)]'
      : tone === 'accent'
        ? 'border-[var(--progress)]/30 bg-[var(--progress)]/10 text-[var(--progress)]'
        : 'border-white/10 bg-white/5 text-[var(--text-muted)]';

  return (
    <span
      className={[
        'inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em]',
        toneClass,
      ].join(' ')}
    >
      {label}
    </span>
  );
}
