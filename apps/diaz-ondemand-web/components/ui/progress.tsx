/** Green means progress or success, and nothing else. */
export function Progress({
  value,
  label,
  ariaLabel,
  className,
}: {
  value: number;
  label?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));

  return (
    <div className={['flex flex-col gap-200', className].filter(Boolean).join(' ')}>
      {label ? (
        <div className="type-kicker flex justify-between">
          <span>{label}</span>
          <span>{clamped}%</span>
        </div>
      ) : null}
      <div
        aria-label={label ?? ariaLabel}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={clamped}
        className="h-progress overflow-hidden rounded-100 bg-surface-interactive-active"
        role="progressbar"
      >
        <div
          className="h-full rounded-100 bg-foreground-success"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
