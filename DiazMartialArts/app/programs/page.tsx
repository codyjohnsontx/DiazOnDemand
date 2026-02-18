import { ProgramCard } from '@/components/ProgramCard';
import { Section } from '@/components/Section';
import { programs } from '@/content/programs';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'Programs',
  description: 'Explore BJJ programs for adults, kids, and no-gi training at Diaz Martial Arts.',
  path: '/programs',
});

export default function ProgramsPage() {
  return (
    <Section
      title="Programs"
      eyebrow="Training Path"
      description="Each class follows a clear plan so students can track progress and build strong fundamentals."
    >
      <div className="grid gap-5 md:grid-cols-2">
        {programs.map((program) => (
          <ProgramCard key={program.title} {...program} />
        ))}
      </div>
    </Section>
  );
}
