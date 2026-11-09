import type { ReactNode } from 'react';

/**
 * A section title with an optional detail that carries information: a count, a
 * description, a link. The h2 form puts the detail on the right; the h3 form stacks a
 * description under the title at reading width.
 */
export function SectionHeader({
  title,
  detail,
  as: Heading = 'h2',
}: {
  title: string;
  detail?: ReactNode;
  as?: 'h2' | 'h3';
}) {
  if (Heading === 'h3') {
    return (
      <div className="flex flex-col gap-100">
        <h3 className="type-display-400">{title}</h3>
        {detail ? (
          <div className="max-w-reading text-body-200 text-foreground-faint">{detail}</div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-400 gap-y-100">
      <h2 className="type-display-500">{title}</h2>
      {detail ? <div className="text-body-200 text-foreground-faint">{detail}</div> : null}
    </div>
  );
}
