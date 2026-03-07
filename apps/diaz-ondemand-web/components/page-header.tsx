import type { ReactNode } from 'react';

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
      <div className="max-w-3xl space-y-3">
        {eyebrow ? (
          <p className="font-display text-sm uppercase tracking-[0.32em] text-[var(--accent-strong)]">{eyebrow}</p>
        ) : null}
        <h1 className="font-display text-5xl uppercase leading-none tracking-[0.03em] text-[var(--text)] sm:text-6xl">
          {title}
        </h1>
        {description ? <p className="max-w-2xl text-base leading-7 text-[var(--text-muted)]">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-3">{actions}</div> : null}
    </div>
  );
}
