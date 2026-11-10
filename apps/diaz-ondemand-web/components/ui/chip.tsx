import type { ButtonHTMLAttributes, ReactNode } from 'react';

/** A pressable filter. `aria-pressed` carries the selected state, in markup and in style. */
export function Chip({
  pressed,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { pressed: boolean }) {
  return (
    <button
      aria-pressed={pressed}
      className={[
        'inline-flex h-control-sm items-center rounded-200 border border-border-strong bg-transparent px-300 text-body-200 font-semibold leading-none text-foreground-faint transition-colors duration-fast hover:bg-surface-interactive-hover hover:text-foreground-primary aria-pressed:border-foreground-primary aria-pressed:bg-surface-interactive-active aria-pressed:text-foreground-primary disabled:pointer-events-none disabled:opacity-disabled',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      type="button"
      {...props}
    />
  );
}

export function ChipGroup({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      aria-label={label}
      className={['flex flex-wrap gap-200', className].filter(Boolean).join(' ')}
      role="group"
    >
      {children}
    </div>
  );
}
