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
        {eyebrow ? <p className="type-kicker text-[var(--text-muted)]">{eyebrow}</p> : null}
        <h2 className="type-title-lg text-[var(--text)]">{title}</h2>
      </div>
      {detail ? <div className="text-sm text-[var(--text-muted)]">{detail}</div> : null}
    </div>
  );
}
