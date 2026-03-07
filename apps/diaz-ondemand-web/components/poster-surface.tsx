import type { ReactNode } from 'react';

const themes = [
  'from-[#5d2b1e] via-[#281f25] to-[#0d1017]',
  'from-[#173545] via-[#1f2530] to-[#0d1017]',
  'from-[#3e4620] via-[#202622] to-[#0d1017]',
  'from-[#3d1f35] via-[#211d2a] to-[#0d1017]',
  'from-[#403223] via-[#26211d] to-[#0d1017]',
  'from-[#1d3840] via-[#18232a] to-[#0d1017]',
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
      ].filter(Boolean).join(' ')}
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${theme} transition-transform duration-500 group-hover:scale-[1.03]`} />
      <div className="poster-grid absolute inset-0 opacity-20" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.18),transparent_28%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_0%,rgba(7,8,10,0.1)_35%,rgba(7,8,10,0.92)_100%)]" />
      <div className="absolute -right-4 top-4 font-display text-[7rem] uppercase leading-none text-white/10 transition-transform duration-500 group-hover:-translate-y-1 group-hover:translate-x-1 sm:text-[8.5rem]">
        {monogram}
      </div>
      <div className="relative z-10 h-full">{children}</div>
    </div>
  );
}
