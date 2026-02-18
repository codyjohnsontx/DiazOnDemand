import React from 'react';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
};

export function PrimaryButton({ label, className, ...props }: ButtonProps) {
  return (
    <button
      className={`rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-60 ${className ?? ''}`}
      {...props}
    >
      {label}
    </button>
  );
}
