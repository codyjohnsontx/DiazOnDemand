import type { ReactNode } from 'react';

export function SectionHeader({
  title,
  detail,
  as: Heading = 'h2',
}: {
  title: string;
  detail?: ReactNode;
  as?: 'h2' | 'h3';
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <Heading
        className={`${Heading === 'h3' ? 'font-display text-2xl leading-none' : 'type-title-lg'} text-[var(--text)]`}
      >
        {title}
      </Heading>
      {detail ? <div className="text-sm text-[var(--text-muted)]">{detail}</div> : null}
    </div>
  );
}
