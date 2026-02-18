import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Section } from '@/components/Section';
import { site } from '@/content/site';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'Pricing',
  description: 'Membership options for adults and kids at Diaz Martial Arts.',
  path: '/pricing',
});

const plans = [
  {
    name: 'Essentials',
    price: '$159/mo',
    notes: '2 classes per week',
    features: ['Fundamentals + all-level classes', 'No enrollment fee this month', 'Month-to-month billing'],
  },
  {
    name: 'Unlimited',
    price: '$199/mo',
    notes: 'Most popular',
    features: ['Unlimited classes', 'Open mat access', 'Priority workshop registration'],
  },
  {
    name: 'Kids Program',
    price: '$139/mo',
    notes: 'Ages 6-14',
    features: ['2-3 youth classes per week', 'Progress tracking', 'Belt promotion support'],
  },
];

export default function PricingPage() {
  return (
    <Section title="Pricing" eyebrow="Membership" description="Straightforward plans. No hidden fees.">
      <div className="grid gap-5 md:grid-cols-3">
        {plans.map((plan) => (
          <Card key={plan.name} className="h-full">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-bronze">{plan.notes}</p>
            <h3 className="mt-2 text-2xl font-bold text-ink">{plan.name}</h3>
            <p className="mt-2 text-3xl font-bold text-ink">{plan.price}</p>
            <ul className="mt-4 space-y-2 text-sm text-black/70">
              {plan.features.map((feature) => (
                <li key={feature}>• {feature}</li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
      <div className="mt-8">
        <Button href={site.ctas.primary.href}>{site.ctas.primary.label}</Button>
      </div>
    </Section>
  );
}
