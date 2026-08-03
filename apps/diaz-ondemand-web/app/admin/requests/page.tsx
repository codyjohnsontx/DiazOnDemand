'use client';

import { useEffect, useState } from 'react';
import type { AdminMemberRequestDto } from '@diaz/shared';
import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { PremiumBadge } from '@/components/premium-badge';
import { useApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-shared';

function formatSentAt(createdAt: string | Date) {
  return new Date(createdAt).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default function AdminRequestsPage() {
  const apiFetch = useApiClient();
  const [requests, setRequests] = useState<AdminMemberRequestDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<AdminMemberRequestDto[]>('/admin/member-requests')
      .then((data) => {
        setRequests(data);
        setError(null);
      })
      .catch((requestError) => {
        setError(
          requestError instanceof ApiError && requestError.status === 403
            ? 'You do not have admin access for this area.'
            : 'Member requests could not be loaded right now.',
        );
      })
      .finally(() => setLoading(false));
  }, [apiFetch]);

  return (
    <AppShell className="space-y-8">
      <PageHeader
        description="What members have asked to see, newest first. Every one is a filming instruction the catalogue could not answer."
        eyebrow="Admin"
        title="Member Requests"
      />

      {error ? (
        <EmptyState description={error} title="Requests unavailable" />
      ) : loading ? (
        <p className="type-body text-[var(--text-muted)]">Loading requests...</p>
      ) : requests.length === 0 ? (
        /* An empty inbox must not read as "members are not asking for anything".
           Nobody can send one yet, and that is a decision rather than a silence. */
        <EmptyState
          description="Members cannot send requests yet. Under-13 members are excluded from the question box at the account level, and the platform does not yet record an age or account type that identifies one, so submitting is switched off for everyone until it does. This page is ready for the moment that changes."
          title="Collection is not open yet"
        />
      ) : (
        <section className="surface-panel space-y-4 p-4 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="type-kicker text-[var(--text-muted)]">Inbox</p>
              <h2 className="type-title-lg text-[var(--text)]">
                {requests.length} {requests.length === 1 ? 'request' : 'requests'}
              </h2>
            </div>
            <PremiumBadge label="Newest first" />
          </div>

          <ol className="space-y-3">
            {requests.map((request) => (
              <li className="surface-panel-muted space-y-3 p-4 sm:p-5" key={request.id}>
                {/* Member free text. Rendered as text - React escapes it, and
                    nothing here interprets it as markup. */}
                <p className="whitespace-pre-wrap break-words text-base leading-7 text-[var(--text)]">
                  {request.body}
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
                  <span className="break-all font-semibold uppercase tracking-[0.18em]">
                    {request.clerkUserId}
                  </span>
                  <span aria-hidden="true">&middot;</span>
                  <time dateTime={new Date(request.createdAt).toISOString()}>
                    {formatSentAt(request.createdAt)}
                  </time>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </AppShell>
  );
}
