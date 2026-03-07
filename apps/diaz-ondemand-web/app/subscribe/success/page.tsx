import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';

export default function SubscribeSuccessPage() {
  return (
    <AppShell className="space-y-8">
      <PageHeader
        description="Stripe completed successfully. Your entitlement should update as soon as the webhook finishes processing."
        eyebrow="Billing"
        title="Subscription active"
      />
      <div className="surface-panel space-y-6 p-8">
        <p className="max-w-2xl text-base leading-7 text-[var(--text-muted)]">
          If premium access does not appear immediately, refresh in a few seconds and reopen the lesson or library.
        </p>
        <Link
          className="inline-flex items-center rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-[var(--accent-strong)]"
          href="/library"
        >
          Open library
        </Link>
      </div>
    </AppShell>
  );
}
