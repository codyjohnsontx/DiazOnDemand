import { Section } from '@/components/Section';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'Terms of Service',
  description: 'Terms of service for Diaz Martial Arts.',
  path: '/terms',
});

export default function TermsPage() {
  return (
    <Section title="Terms of Service" eyebrow="Legal">
      <div className="space-y-4 text-sm leading-relaxed text-black/75">
        <p>
          By using this website, you agree to use the content for lawful purposes and acknowledge that class schedules and pricing may change.
        </p>
        <p>
          Trial sessions and memberships are subject to academy policies provided during registration.
        </p>
        <p>
          Contact us if you need a full copy of membership terms and academy conduct guidelines.
        </p>
      </div>
    </Section>
  );
}
