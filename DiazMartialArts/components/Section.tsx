import { cn } from '@/lib/utils';

type SectionProps = {
  id?: string;
  title?: string;
  eyebrow?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
};

export function Section({ id, title, eyebrow, description, children, className }: SectionProps) {
  return (
    <section id={id} className={cn('mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 lg:px-8', className)}>
      {(title || eyebrow || description) && (
        <header className="mb-8 max-w-3xl">
          {eyebrow && <p className="mb-2 text-xs font-bold uppercase tracking-[0.24em] text-bronze">{eyebrow}</p>}
          {title && <h2 className="text-3xl font-bold text-ink sm:text-4xl">{title}</h2>}
          {description && <p className="mt-3 text-base leading-relaxed text-black/70">{description}</p>}
        </header>
      )}
      {children}
    </section>
  );
}
