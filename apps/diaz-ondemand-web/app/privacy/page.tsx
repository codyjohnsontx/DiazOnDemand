import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';

const SECTIONS = [
  {
    title: 'Your account',
    body: [
      'Sign-in is handled by Clerk, which holds the details you sign in with and uses cookies to keep you signed in. Our database stores the Clerk id for your account, your role and the date the account was created.',
    ],
  },
  {
    title: 'Billing',
    body: [
      'Payments are handled by Stripe, and you enter your card details with Stripe rather than with us. We store your Stripe customer and subscription ids, the plan, the subscription status, the billing period end date, and any refund or chargeback that withdrew access.',
    ],
  },
  {
    title: 'Progress and favorites',
    body: [
      'We store how far you have watched each lesson, whether you completed it, and the lessons you favorite. Videos are delivered by Mux and YouTube, which receive the requests your browser or app makes to play them.',
    ],
  },
  {
    title: 'Journal entries',
    body: [
      'If you use the journal we store each entry: the date, the discipline, the curriculum items you marked, how each one went, and any note you wrote. We also store the date you confirmed you are 18 or older.',
      'Coaches and admins can read journal entries for coaching and curriculum.',
      'You can edit or delete your own entries. A deleted entry is gone permanently, for staff too, and removing an account removes its journal.',
    ],
  },
];

export default function PrivacyPage() {
  return (
    <AppShell className="space-y-8">
      <PageHeader title="Privacy" />

      <div className="max-w-3xl space-y-8">
        {SECTIONS.map((section) => (
          <section className="space-y-3" key={section.title}>
            <h2 className="type-title-lg text-[var(--text)]">{section.title}</h2>
            {section.body.map((paragraph) => (
              <p className="type-body text-[var(--text-muted)]" key={paragraph}>
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </div>
    </AppShell>
  );
}
