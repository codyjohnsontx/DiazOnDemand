import { Section } from '@/components/Section';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'Privacy Policy',
  description: 'Privacy policy for Diaz Martial Arts.',
  path: '/privacy',
});

export default function PrivacyPage() {
  return (
    <Section title="Privacy Policy" eyebrow="Legal">
      <div className="space-y-4 text-sm leading-relaxed text-black/75">
        <p>
          Diaz Martial Arts collects basic contact information you submit through our website to respond to inquiries and schedule classes.
        </p>
        <p>
          We do not sell personal information. Data may be processed by service providers such as hosting and form handling tools.
        </p>
        <p>
          You may request updates or deletion of your submitted data by contacting us directly.
        </p>
      </div>
    </Section>
  );
}
