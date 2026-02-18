import { Card } from '@/components/Card';
import { ContactForm } from '@/components/ContactForm';
import { LocalBusinessSchema } from '@/components/LocalBusinessSchema';
import { Section } from '@/components/Section';
import { site } from '@/content/site';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'Contact',
  description: 'Book a free trial and contact Diaz Martial Arts.',
  path: '/contact',
});

export default function ContactPage() {
  return (
    <>
      <LocalBusinessSchema />
      <Section
        title="Contact"
        eyebrow="Book a Free Trial"
        description="Tell us your goals and availability. We’ll help you choose the right class."
      >
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card>
            <ContactForm />
          </Card>

          <Card>
            <h3 className="text-xl font-bold text-ink">Visit the academy</h3>
            <p className="mt-3 text-sm text-black/70">
              {site.address.street}
              <br />
              {site.address.city}, {site.address.state} {site.address.zip}
            </p>
            <p className="mt-4 text-sm text-black/70">
              Phone: <a href={`tel:${site.phone}`}>{site.phone}</a>
              <br />
              Email: <a href={`mailto:${site.email}`}>{site.email}</a>
            </p>

            <h4 className="mt-6 text-sm font-semibold uppercase tracking-[0.16em] text-bronze">Hours</h4>
            <ul className="mt-2 space-y-1 text-sm text-black/70">
              {site.hours.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Card>
        </div>
      </Section>
    </>
  );
}
