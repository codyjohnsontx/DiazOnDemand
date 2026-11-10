import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

/**
 * Text, select and textarea share one surface. The field label is the one place a
 * small-caps label belongs: over a form control, never over a heading.
 */
export const inputClassName =
  'w-full rounded-200 border border-border-strong bg-surface-raised px-300 text-body-200 text-foreground-primary transition-colors duration-fast placeholder:text-foreground-faint hover:border-foreground-faint focus-visible:border-focus-ring focus-visible:outline-offset-0 disabled:cursor-not-allowed disabled:opacity-disabled aria-invalid:border-foreground-critical';

export function Field({
  label,
  htmlFor,
  help,
  error,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  help?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={['flex flex-col gap-200', className].filter(Boolean).join(' ')}>
      <label className="type-kicker" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {help ? <p className="text-body-200 text-foreground-faint">{help}</p> : null}
      {error ? <p className="text-body-200 text-foreground-critical">{error}</p> : null}
    </div>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={[inputClassName, 'h-control-md', className].filter(Boolean).join(' ')}
      {...props}
    />
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={[inputClassName, 'h-control-md', className].filter(Boolean).join(' ')}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={[inputClassName, 'py-200', className].filter(Boolean).join(' ')}
      {...props}
    />
  );
}

/** A native checkbox with its label beside it; the label is the click target. */
export function Checkbox({
  label,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode }) {
  return (
    <label
      className={['flex items-center gap-300 text-body-200 text-foreground-faint', className]
        .filter(Boolean)
        .join(' ')}
      htmlFor={props.id}
    >
      <input className="size-icon rounded-100 accent-surface-accent" type="checkbox" {...props} />
      {label}
    </label>
  );
}
