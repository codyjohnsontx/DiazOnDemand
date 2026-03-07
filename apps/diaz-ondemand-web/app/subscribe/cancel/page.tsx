import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';

export default function SubscribeCancelPage() {
  return (
    <AppShell className="space-y-8">
      <PageHeader
        description="No charge was made. You can return to premium access any time from the same monthly checkout."
        eyebrow="Billing"
        title="Checkout canceled"
      />
      <div className="surface-panel space-y-6 p-8">
        <p className="max-w-2xl text-base leading-7 text-[var(--text-muted)]">
          Your current access has not changed. Free lessons remain open, and premium lessons stay locked until you subscribe.
        </p>
        <Link
          className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-white/10"
          href="/subscribe"
        >
          Return to premium
        </Link>
      </div>
    </AppShell>
  );
}
