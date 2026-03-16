import Link from 'next/link';

export function EmptyState({
  title,
  description,
  ctaHref,
  ctaLabel,
}: {
  title: string;
  description: string;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <div className="surface-panel flex min-h-[260px] flex-col justify-between gap-8 p-8">
      <div className="space-y-3">
        <p className="type-kicker text-[var(--text-muted)]">Diaz on Demand</p>
        <h2 className="font-display text-4xl leading-none text-[var(--text)]">{title}</h2>
        <p className="type-body max-w-xl text-[var(--text-muted)]">{description}</p>
      </div>
      {ctaHref && ctaLabel ? (
        <Link
          className="inline-flex w-fit items-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-white/10"
          href={ctaHref}
        >
          {ctaLabel}
        </Link>
      ) : null}
    </div>
  );
}
