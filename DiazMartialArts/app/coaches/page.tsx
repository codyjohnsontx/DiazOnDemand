import Image from 'next/image';

import { Card } from '@/components/Card';
import { Section } from '@/components/Section';
import { coaches } from '@/content/coaches';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'Coaches',
  description: 'Meet the Diaz Martial Arts coaching team leading BJJ classes for all levels.',
  path: '/coaches',
});

export default function CoachesPage() {
  return (
    <Section
      title="Coaches"
      eyebrow="Instruction"
      description="Experienced coaches focused on technique, safety, and long-term student development."
    >
      <div className="grid gap-5 md:grid-cols-3">
        {coaches.map((coach) => (
          <Card key={coach.name} className="overflow-hidden p-0">
            <Image
              src={coach.image}
              alt={coach.name}
              width={600}
              height={400}
              className="h-52 w-full object-cover"
            />
            <div className="p-5">
              <h3 className="text-xl font-bold text-ink">{coach.name}</h3>
              <p className="mt-1 text-sm font-semibold uppercase tracking-[0.14em] text-bronze">{coach.rank}</p>
              <p className="mt-3 text-sm leading-relaxed text-black/70">{coach.bio}</p>
            </div>
          </Card>
        ))}
      </div>
    </Section>
  );
}
