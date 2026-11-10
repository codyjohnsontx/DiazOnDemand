import Link from 'next/link';
import type { ButtonHTMLAttributes, ComponentProps } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex items-center justify-center gap-200 whitespace-nowrap rounded-200 border font-semibold leading-none transition-colors duration-fast';

/**
 * Orange is the one primary action on a screen. Secondary is the bordered raised surface,
 * ghost is text on nothing; both answer hover and press with the neutral interactive
 * surfaces, so colour stays reserved for meaning.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'border-surface-accent bg-surface-accent text-foreground-on-accent hover:border-surface-accent-hover hover:bg-surface-accent-hover active:border-surface-accent-active active:bg-surface-accent-active',
  secondary:
    'border-border-strong bg-surface-raised text-foreground-primary hover:bg-surface-interactive-hover active:bg-surface-interactive-active',
  ghost:
    'border-transparent bg-transparent text-foreground-primary hover:bg-surface-interactive-hover active:bg-surface-interactive-active',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-control-sm px-300 text-body-200',
  md: 'h-control-md px-400 text-body-200',
  lg: 'h-control-lg px-500 text-body-300',
};

const DISABLED = 'disabled:pointer-events-none disabled:opacity-disabled';

export function buttonClassName({
  variant = 'secondary',
  size = 'md',
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  return [BASE, VARIANTS[variant], SIZES[size], DISABLED, className].filter(Boolean).join(' ');
}

export function Button({
  variant,
  size,
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button className={buttonClassName({ variant, size, className })} type={type} {...props} />
  );
}

export function ButtonLink({
  variant,
  size,
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link className={buttonClassName({ variant, size, className })} {...props} />;
}
