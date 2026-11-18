import type { ReactNode } from 'react';

/**
 * The page title, on its own. A line under it appears only when it carries information
 * the visitor would otherwise lose; never a decorative sub-line, never an eyebrow above.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-500 md:flex-row md:items-end md:justify-between md:gap-600">
      <div className="flex min-w-0 flex-col gap-300">
        <h1 className="type-display-700 break-words">{title}</h1>
        {description ? (
          <p className="max-w-reading text-body-300 text-foreground-faint">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-300">{actions}</div>
      ) : null}
    </div>
  );
}
