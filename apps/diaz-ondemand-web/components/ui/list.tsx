import Link from 'next/link';
import type { HTMLAttributes, ReactNode } from 'react';

export function List({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={[
        'flex flex-col divide-y divide-border-primary overflow-hidden rounded-300 border border-border-primary bg-surface-primary',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    />
  );
}

export function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={['size-icon shrink-0', className].filter(Boolean).join(' ')}
      viewBox="0 0 16 16"
    >
      <path
        d="M6 3l5 5-5 5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

const ROW = 'flex gap-400 p-400 transition-colors duration-fast';

/**
 * A row: a title, a meta line that carries the facts, optional content under them (a
 * progress bar) and something trailing (a badge, a label, an action). With `href` the
 * whole row is the link and ends in a chevron. `stack` puts the trailing actions under the
 * body at phone width, for rows whose actions do not fit beside a title.
 */
export function ListRow({
  href,
  label,
  title,
  badges,
  meta,
  trailing,
  selected = false,
  stack = false,
  children,
}: {
  href?: string;
  label?: ReactNode;
  title: ReactNode;
  badges?: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
  stack?: boolean;
  children?: ReactNode;
}) {
  const body = (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-100">
        {label ? <p className="type-kicker">{label}</p> : null}
        <div className="flex flex-wrap items-center gap-x-200 gap-y-100">
          <h3 className="min-w-0 text-body-300 font-semibold">{title}</h3>
          {badges}
        </div>
        {meta ? <p className="text-body-200 text-foreground-faint">{meta}</p> : null}
        {children}
      </div>
      {trailing || href ? (
        <div
          className={[
            'flex shrink-0 items-center gap-300 text-foreground-faint',
            stack ? 'flex-wrap md:flex-nowrap' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {trailing}
          {href ? <ChevronIcon /> : null}
        </div>
      ) : null}
    </>
  );
  const layout = stack ? 'flex-col md:flex-row md:items-center' : 'items-center';
  const state = selected ? 'bg-surface-interactive-active' : '';

  if (href) {
    return (
      <Link
        aria-current={selected ? 'true' : undefined}
        className={[
          ROW,
          layout,
          state,
          'hover:bg-surface-interactive-hover focus-visible:-outline-offset-ring',
        ]
          .filter(Boolean)
          .join(' ')}
        href={href}
      >
        {body}
      </Link>
    );
  }

  return <div className={[ROW, layout, state].filter(Boolean).join(' ')}>{body}</div>;
}
