import Link from 'next/link';
import { AppShell } from './app-shell';
import { PageHeader } from './page-header';

export function LandingView() {
  return (
    <AppShell className="space-y-12">
      <PageHeader title="Train on your schedule." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="surface-panel space-y-6 p-8">
          <div className="flex flex-wrap gap-3">
            <Link
              className="inline-flex items-center btn-radius-py-3 bg-[var(--accent)] px-5 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-[var(--text)] transition-colors duration-200 hover:bg-[var(--accent-strong)]"
              href="/library"
            >
              Browse free content
            </Link>
            <Link
              className="inline-flex items-center btn-radius-py-3 btn-radius-bordered border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-[var(--text)] transition-colors duration-200 hover:bg-white/10"
              href="/sign-in"
            >
              Sign in
            </Link>
          </div>
        </section>

        <aside className="surface-panel space-y-5 p-8">
          <h2 className="font-display text-4xl leading-none text-[var(--text)]">
            Unlock the full library
          </h2>
          <Link
            className="inline-flex items-center justify-center btn-radius-py-3 btn-radius-bordered border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-[var(--text)] transition-colors duration-200 hover:bg-white/10"
            href="/subscribe"
          >
            View premium
          </Link>
        </aside>
      </div>
    </AppShell>
  );
}
