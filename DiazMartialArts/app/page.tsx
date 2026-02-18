import { CTABanner } from '@/components/CTABanner';
import { LocalBusinessSchema } from '@/components/LocalBusinessSchema';
import { ProgramCard } from '@/components/ProgramCard';
import { Section } from '@/components/Section';
import { Testimonial } from '@/components/Testimonial';
import { programs } from '@/content/programs';
import { site } from '@/content/site';
import { pageMetadata } from '@/lib/seo';

import { Button } from '@/components/Button';

export const metadata = pageMetadata({
  title: 'Brazilian Jiu-Jitsu in Austin',
  description: 'Train BJJ at Diaz Martial Arts with structured classes for beginners, kids, and competitors.',
  path: '/',
});

export default function HomePage() {
  return (
    <>
      <LocalBusinessSchema />
      <section className="mx-auto grid w-full max-w-6xl gap-8 px-4 pb-12 pt-16 sm:px-6 lg:grid-cols-2 lg:px-8 lg:pt-20">
        <div className="reveal">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-bronze">Diaz Martial Arts</p>
          <h1 className="mt-4 font-[var(--font-heading)] text-5xl uppercase leading-none text-ink sm:text-7xl">
            Brazilian Jiu-Jitsu for Real Progress
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-black/75">{site.tagline}</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button href={site.ctas.primary.href}>{site.ctas.primary.label}</Button>
            <Button href={site.ctas.secondary.href} variant="secondary">
              {site.ctas.secondary.label}
            </Button>
          </div>
        </div>

        <div className="reveal rounded-3xl border border-black/10 bg-white/80 p-7 shadow-ring backdrop-blur [animation-delay:120ms]">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-bronze">Why Train Here</p>
          <ul className="mt-4 space-y-4 text-sm leading-relaxed text-black/75">
            <li>Structured beginner pathways so new students never feel lost.</li>
            <li>Experienced coaches balancing technical precision and safety.</li>
            <li>Strong team culture for hobbyists, kids, and competitors.</li>
            <li>Morning, lunch, and evening classes to fit real schedules.</li>
          </ul>
        </div>
      </section>

      <Section
        eyebrow="Programs"
        title="Classes for every stage"
        description="From your first day on the mat to competition prep, every class has clear goals and coaching."
      >
        <div className="grid gap-5 md:grid-cols-2">
          {programs.map((program) => (
            <ProgramCard key={program.title} {...program} />
          ))}
        </div>
      </Section>

      <Section
        eyebrow="Student Results"
        title="What members say"
        description="Real outcomes from people training consistently at Diaz Martial Arts."
      >
        <div className="grid gap-5 md:grid-cols-3">
          <Testimonial
            quote="I started with zero grappling experience. The fundamentals system made it click fast."
            name="Jordan T."
            detail="Member, 11 months"
          />
          <Testimonial
            quote="Our son is more focused and confident. The kids coaching is top tier."
            name="Samantha R."
            detail="Parent"
          />
          <Testimonial
            quote="Best training environment I’ve had in 10 years. Strong rounds, no ego."
            name="Mike L."
            detail="Competition team"
          />
        </div>
      </Section>

      <CTABanner />
    </>
  );
}
