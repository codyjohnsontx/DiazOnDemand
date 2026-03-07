import type { ReactNode } from 'react';

export function AppShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={['student-shell page-enter', className].filter(Boolean).join(' ')}>{children}</div>;
}
