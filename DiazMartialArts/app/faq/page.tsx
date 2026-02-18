import { Card } from '@/components/Card';
import { Section } from '@/components/Section';
import { faq } from '@/content/faq';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'FAQ',
  description: 'Answers to common questions about classes, trial sessions, and memberships.',
  path: '/faq',
});

export default function FaqPage() {
  return (
    <Section title="FAQ" eyebrow="Common Questions" description="Everything you need before your first class.">
      <div className="space-y-4">
        {faq.map((item) => (
          <Card key={item.question}>
            <h3 className="text-lg font-bold text-ink">{item.question}</h3>
            <p className="mt-2 text-sm leading-relaxed text-black/70">{item.answer}</p>
          </Card>
        ))}
      </div>
    </Section>
  );
}
