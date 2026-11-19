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
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Chip, ChipGroup } from '@/components/ui/chip';
import { Field, Input, Select } from '@/components/ui/field';
import { List, ListRow } from '@/components/ui/list';
import { useApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-shared';

type View = 'trends' | 'members';

const NO_ACCESS = 'You do not have admin access for this area.';

function describeFailure(error: unknown, subject: string) {
  return error instanceof ApiError && error.status === 403
    ? NO_ACCESS
    : `${subject} could not be loaded right now.`;
}

function Count({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="flex flex-col items-center gap-100 px-200">
      <p className={`type-display-500 ${tone}`}>{value}</p>
      <p className="whitespace-nowrap text-body-100 text-foreground-faint">{label}</p>
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
    <section className="flex flex-col gap-500">
      <Card className="grid gap-400 md:grid-cols-split">
        <Field className="min-w-0" htmlFor="trends-discipline" label="Discipline">
          <Select
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
          </Select>
        </Field>
        <div className="grid min-w-0 grid-cols-split gap-400">
          <Field className="min-w-0" htmlFor="trends-from" label="From">
            <Input
              id="trends-from"
              onChange={(event) => setFrom(event.target.value)}
              type="date"
              value={from}
            />
          </Field>
          <Field className="min-w-0" htmlFor="trends-to" label="To">
            <Input
              id="trends-to"
              onChange={(event) => setTo(event.target.value)}
              type="date"
              value={to}
            />
          </Field>
        </div>
      </Card>

      {invalidRange ? (
        <p className="text-body-200 text-foreground-critical" role="alert">
          The start date must not be after the end date.
        </p>
      ) : error ? (
        <p className="text-body-200 text-foreground-critical" role="alert">
          {error}
        </p>
      ) : items === null ? null : items.length === 0 ? (
        <p className="text-body-200 text-foreground-faint">
          No item has been tagged by {JOURNAL_TRENDS_MIN_MEMBERS} or more members in this range.
        </p>
      ) : (
        <List>
          {items.map((item) => (
            <ListRow
              badges={<Badge label={getDisciplineLabel(item.discipline)} />}
              key={`${item.discipline}:${item.track}`}
              stack
              title={getJournalTrackLabel(item.discipline, item.track)}
              trailing={
                <>
                  <Count
                    label="Didn't work"
                    tone="text-foreground-critical"
                    value={item.didNotWorkCount}
                  />
                  <Count label="Worked" tone="text-foreground-success" value={item.workedCount} />
                  <Count label="Members" tone="text-foreground-primary" value={item.memberCount} />
                </>
              }
            />
          ))}
        </List>
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
    <section className="flex flex-col gap-500">
      {members?.length === 0 ? (
        <p className="text-body-200 text-foreground-faint">No member has a journal entry yet.</p>
      ) : (
        <Card>
          <Field className="max-w-reading" htmlFor="journal-member" label="Member">
            <Select
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
            </Select>
          </Field>
        </Card>
      )}

      {error ? (
        <p className="text-body-200 text-foreground-critical" role="alert">
          {error}
        </p>
      ) : null}

      {detail ? (
        <div className="flex flex-col gap-400">
          {detail.entries.length === 0 ? (
            <p className="text-body-200 text-foreground-faint">This member has no entries.</p>
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
    <AppShell>
      <PageHeader
        actions={
          <ChipGroup label="Journal views">
            {(['trends', 'members'] as const).map((value) => (
              <Chip key={value} onClick={() => setView(value)} pressed={view === value}>
                {value === 'trends' ? 'Trends' : 'Members'}
              </Chip>
            ))}
          </ChipGroup>
        }
        title="Journal"
      />

      {view === 'trends' ? <TrendsView /> : <MembersView />}
    </AppShell>
  );
}
