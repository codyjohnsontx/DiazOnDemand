'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import type { AdminMemberSummary } from '@diaz/shared';
import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { PremiumBadge } from '@/components/premium-badge';
import { useApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-shared';
import { describeAccess } from '@/lib/member-access';

export default function AdminMembersPage() {
  const apiFetch = useApiClient();
  const searchInputId = 'member-search';
  const [query, setQuery] = useState('');
  const [members, setMembers] = useState<AdminMemberSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const search = useCallback(
    async (term: string) => {
      setSearching(true);

      try {
        const params = term.trim() ? `?q=${encodeURIComponent(term.trim())}` : '';
        setMembers(await apiFetch<AdminMemberSummary[]>(`/admin/members${params}`));
        setError(null);
      } catch (requestError) {
        setError(
          requestError instanceof ApiError && requestError.status === 403
            ? 'You do not have admin access for this area.'
            : 'Members could not be loaded right now.',
        );
      } finally {
        setSearching(false);
      }
    },
    [apiFetch],
  );

  useEffect(() => {
    void search('');
  }, [search]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void search(query);
  };

  return (
    <AppShell className="space-y-8">
      <PageHeader title="Members" />

      {error ? (
        <EmptyState description={error} title="Admin unavailable" />
      ) : (
        <section className="surface-panel space-y-5 p-6">
          <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={onSubmit}>
            <div className="flex-1 space-y-2">
              <label className="type-kicker text-[var(--text-muted)]" htmlFor={searchInputId}>
                Clerk user id, member id, or Stripe customer or subscription id
              </label>
              <input
                id={searchInputId}
                className="w-full rounded-[20px] border border-white/10 bg-[var(--surface-2)] px-4 py-3 text-[var(--text)]"
                placeholder="user_..., cus_..., sub_..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <button
              className="inline-flex items-center justify-center rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-[var(--accent-strong)] disabled:opacity-60"
              disabled={searching}
              type="submit"
            >
              {searching ? 'Searching...' : 'Search'}
            </button>
          </form>

          {members === null ? null : members.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No members match that search.</p>
          ) : (
            <div className="space-y-3">
              {members.map((member) => (
                <div
                  className="surface-panel-muted flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"
                  key={member.id}
                >
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="break-all font-display text-2xl leading-tight text-[var(--text)]">
                        {member.clerkUserId}
                      </h2>
                      <PremiumBadge
                        label={member.hasAccess ? 'Premium' : 'No access'}
                        tone={member.hasAccess ? 'premium' : 'neutral'}
                      />
                      {member.role === 'STUDENT' ? null : <PremiumBadge label={member.role} />}
                    </div>
                    <p className="text-sm text-[var(--text-muted)]">
                      {describeAccess(member.access)}
                    </p>
                  </div>
                  <Link
                    className="inline-flex w-fit shrink-0 items-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-white/10"
                    href={`/admin/members/${member.id}`}
                  >
                    Manage
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </AppShell>
  );
}
