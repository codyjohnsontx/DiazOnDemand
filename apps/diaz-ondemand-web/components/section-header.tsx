import type { ReactNode } from 'react';

export function SectionHeader({
  title,
  detail,
}: {
  title: string;
  detail?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <h2 className="type-title-lg text-[var(--text)]">{title}</h2>
      {detail ? <div className="text-sm text-[var(--text-muted)]">{detail}</div> : null}
    </div>
  );
}
