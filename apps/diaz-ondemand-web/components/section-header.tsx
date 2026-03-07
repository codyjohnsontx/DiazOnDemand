import type { ReactNode } from 'react';

export function SectionHeader({
  title,
  eyebrow,
  detail,
}: {
  title: string;
  eyebrow?: string;
  detail?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="space-y-1">
        {eyebrow ? (
          <p className="font-display text-xs uppercase tracking-[0.28em] text-[var(--text-muted)]">{eyebrow}</p>
        ) : null}
        <h2 className="font-display text-3xl uppercase tracking-[0.03em] text-[var(--text)]">{title}</h2>
      </div>
      {detail ? <div className="text-sm text-[var(--text-muted)]">{detail}</div> : null}
    </div>
  );
}
