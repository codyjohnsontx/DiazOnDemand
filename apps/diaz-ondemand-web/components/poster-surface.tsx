import type { ReactNode } from 'react';

const themes = [
  'bg-[#5d2b1e]',
  'bg-[#173545]',
  'bg-[#3e4620]',
  'bg-[#3d1f35]',
  'bg-[#403223]',
  'bg-[#1d3840]',
];

export function PosterSurface({
  seed,
  monogram,
  children,
  className,
}: {
  seed: number;
  monogram: string;
  children: ReactNode;
  className?: string;
}) {
  const theme = themes[seed % themes.length] ?? themes[0];

  return (
    <div
      className={[
        'group relative overflow-hidden rounded-[28px] border border-white/10 bg-[var(--surface)] shadow-[0_24px_72px_rgba(0,0,0,0.28)]',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div
        className={`absolute inset-0 ${theme} transition-transform duration-500 group-hover:scale-[1.03]`}
      />
      <div className="absolute -right-4 top-4 font-display text-[7rem] font-semibold leading-none text-white/10 transition-transform duration-500 group-hover:-translate-y-1 group-hover:translate-x-1 sm:text-[8.5rem]">
        {monogram}
      </div>
      <div className="relative z-10 h-full">{children}</div>
    </div>
  );
}
