'use client';

import { useEffect, useState } from 'react';
import {
  Discipline,
  JOURNAL_TRENDS_MIN_MEMBERS,
  Role,
  getDisciplineLabel,
  getJournalTrackLabel,
} from '@diaz/shared';
import type {
  JournalMemberDetailDto,
  JournalMemberSummaryDto,
  JournalTrendItemDto,
  MeDto,
} from '@diaz/shared';
import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/empty-state';
import { JournalEntryCard } from '@/components/journal-entry-card';
import { PageHeader } from '@/components/page-header';
import { PremiumBadge } from '@/components/premium-badge';
import { useApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-shared';

type View = 'trends' | 'members';

const FIELD_CLASSES =
  'h-[3.25rem] w-full rounded-[20px] border border-white/10 bg-[var(--surface-2)] px-4 py-3 text-[var(--text)]';

const NO_ACCESS = 'You do not have admin access for this area.';

function describeFailure(error: unknown, subject: string) {
  return error instanceof ApiError && error.status === 403
    ? NO_ACCESS
    : `${subject} could not be loaded right now.`;
}

function Count({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="min-w-[4.5rem] space-y-1 text-center">
      <p className={`font-display text-3xl leading-none ${tone}`}>{value}</p>
      <p className="text-[11px] leading-4 text-[var(--text-muted)]">{label}</p>
    </div>
  );
}

function TrendsView() {
  const apiFetch = useApiClient();
  const [discipline, setDiscipline] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [items, setItems] = useState<JournalTrendItemDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const invalidRange = Boolean(from && to && from > to);

  useEffect(() => {
    if (invalidRange) {
      return;
    }

    let current = true;
    const params = new URLSearchParams();
    if (discipline) params.set('discipline', discipline);
    if (from) params.set('from', from);
    if (to) params.set('to', to);

    apiFetch<{ items: JournalTrendItemDto[] }>(`/admin/journal/trends?${params}`)
      .then((response) => {
        if (current) {
          setItems(response.items);
          setError(null);
        }
      })
      .catch((requestError) => {
        if (current) {
          setError(describeFailure(requestError, 'Trends'));
        }
      });

    return () => {
      current = false;
    };
  }, [apiFetch, discipline, from, invalidRange, to]);

  return (
    <section className="surface-panel space-y-5 p-5 sm:p-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="min-w-0 space-y-2">
          <label className="type-kicker text-[var(--text-muted)]" htmlFor="trends-discipline">
            Discipline
          </label>
          <select
            className={FIELD_CLASSES}
            id="trends-discipline"
            onChange={(event) => setDiscipline(event.target.value)}
            value={discipline}
          >
            <option value="">All disciplines</option>
            {Object.values(Discipline).map((value) => (
              <option key={value} value={value}>
                {getDisciplineLabel(value)}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 space-y-2">
          <label className="type-kicker text-[var(--text-muted)]" htmlFor="trends-from">
            From
          </label>
          <input
            className={FIELD_CLASSES}
            id="trends-from"
            onChange={(event) => setFrom(event.target.value)}
            type="date"
            value={from}
          />
        </div>
        <div className="min-w-0 space-y-2">
          <label className="type-kicker text-[var(--text-muted)]" htmlFor="trends-to">
            To
          </label>
          <input
            className={FIELD_CLASSES}
            id="trends-to"
            onChange={(event) => setTo(event.target.value)}
            type="date"
            value={to}
          />
        </div>
      </div>

      {invalidRange ? (
        <p className="text-sm text-[var(--danger)]" role="alert">
          The start date must not be after the end date.
        </p>
      ) : error ? (
        <p className="text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      ) : items === null ? null : items.length === 0 ? (
        <p className="type-meta text-[var(--text-muted)]">
          No item has been tagged by {JOURNAL_TRENDS_MIN_MEMBERS} or more members in this range.
        </p>
      ) : (
        <ol className="space-y-3">
          {items.map((item) => (
            <li
              className="surface-panel-muted flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"
              key={`${item.discipline}:${item.track}`}
            >
              <div className="min-w-0 space-y-2">
                <h3 className="font-display text-2xl leading-tight text-[var(--text)]">
                  {getJournalTrackLabel(item.discipline, item.track)}
                </h3>
                <PremiumBadge label={getDisciplineLabel(item.discipline)} />
              </div>
              <div className="flex shrink-0 justify-around gap-2 sm:justify-end">
                <Count
                  label="Didn't work"
                  tone="text-[var(--danger)]"
                  value={item.didNotWorkCount}
                />
                <Count label="Worked" tone="text-[var(--progress)]" value={item.workedCount} />
                <Count label="Members" tone="text-[var(--text)]" value={item.memberCount} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function MembersView() {
  const apiFetch = useApiClient();
  const [members, setMembers] = useState<JournalMemberSummaryDto[] | null>(null);
  const [memberId, setMemberId] = useState('');
  const [detail, setDetail] = useState<JournalMemberDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;

    apiFetch<JournalMemberSummaryDto[]>('/admin/journal/members')
      .then((response) => {
        if (current) {
          setMembers(response);
          setError(null);
        }
      })
      .catch((requestError) => {
        if (current) {
          setError(describeFailure(requestError, 'Members'));
        }
      });

    return () => {
      current = false;
    };
  }, [apiFetch]);

  useEffect(() => {
    setDetail(null);

    if (!memberId) {
      return;
    }

    let current = true;

    apiFetch<JournalMemberDetailDto>(`/admin/journal/members/${memberId}`)
      .then((response) => {
        if (current) {
          setDetail(response);
          setError(null);
        }
      })
      .catch((requestError) => {
        if (current) {
          setError(describeFailure(requestError, 'That member'));
        }
      });

    return () => {
      current = false;
    };
  }, [apiFetch, memberId]);

  return (
    <section className="surface-panel space-y-5 p-5 sm:p-6">
      {members?.length === 0 ? (
        <p className="type-meta text-[var(--text-muted)]">No member has a journal entry yet.</p>
      ) : (
        <div className="max-w-xl space-y-2">
          <label className="type-kicker text-[var(--text-muted)]" htmlFor="journal-member">
            Member
          </label>
          <select
            className={FIELD_CLASSES}
            id="journal-member"
            onChange={(event) => setMemberId(event.target.value)}
            value={memberId}
          >
            <option value="">Choose a member</option>
            {members?.map((member) => (
              <option key={member.id} value={member.id}>
                {member.label} ({member.entryCount})
              </option>
            ))}
          </select>
        </div>
      )}

      {error ? (
        <p className="text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      ) : null}

      {detail ? (
        <div className="space-y-4">
          {detail.entries.length === 0 ? (
            <p className="type-meta text-[var(--text-muted)]">This member has no entries.</p>
          ) : (
            detail.entries.map((entry) => <JournalEntryCard entry={entry} key={entry.id} />)
          )}
        </div>
      ) : null}
    </section>
  );
}

export default function AdminJournalPage() {
  const apiFetch = useApiClient();
  const [view, setView] = useState<View>('trends');
  const [role, setRole] = useState<Role | null>(null);
  const [roleFailed, setRoleFailed] = useState(false);

  // Only decides what to draw, so nothing staff-shaped flashes up for a student.
  // The API's role guard is what actually refuses them.
  useEffect(() => {
    apiFetch<MeDto>('/me')
      .then((me) => setRole(me.role))
      .catch(() => setRoleFailed(true));
  }, [apiFetch]);

  if (roleFailed || role === Role.STUDENT) {
    return (
      <AppShell>
        <EmptyState
          description={roleFailed ? 'Journal could not be loaded right now.' : NO_ACCESS}
          title="Admin unavailable"
        />
      </AppShell>
    );
  }

  if (role === null) {
    return null;
  }

  return (
    <AppShell className="space-y-8">
      <PageHeader
        actions={
          <div
            aria-label="Journal views"
            className="inline-flex rounded-full border border-white/10 bg-white/5 p-1"
            role="group"
          >
            {(['trends', 'members'] as const).map((value) => (
              <button
                aria-pressed={view === value}
                className={[
                  'rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] transition-colors duration-200',
                  view === value
                    ? 'bg-[var(--accent)] text-[var(--text)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]',
                ].join(' ')}
                key={value}
                onClick={() => setView(value)}
                type="button"
              >
                {value === 'trends' ? 'Trends' : 'Members'}
              </button>
            ))}
          </div>
        }
        title="Journal"
      />

      {view === 'trends' ? <TrendsView /> : <MembersView />}
    </AppShell>
  );
}
