import Link from 'next/link';
import { AppShell } from './app-shell';
import { PageHeader } from './page-header';

export function LandingView() {
  return (
    <AppShell className="space-y-12">
      <PageHeader
        description="On-demand technique library built around disciplined progression and repeatable modules. Free content is available with no account required."
        eyebrow="Diaz on Demand"
        title="Train on your schedule."
      />
      <div className="flex flex-wrap gap-3">
        <Link
          className="inline-flex items-center rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-[var(--text)] transition-colors duration-200 hover:bg-[var(--accent-strong)]"
          href="/library"
        >
          Browse free content
        </Link>
        <Link
          className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-[var(--text)] transition-colors duration-200 hover:bg-white/10"
          href="/sign-in"
        >
          Sign in
        </Link>
      </div>
    </AppShell>
  );
}
