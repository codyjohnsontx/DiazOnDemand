import type { ReactNode } from 'react';

/** The page container: one reading column, sections stacked with the page gap. */
export function AppShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={[
        'mx-auto flex w-full max-w-container flex-col gap-1200 px-400 md:gap-1600 md:px-600',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}
