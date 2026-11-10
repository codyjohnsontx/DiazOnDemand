'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import type { AdminMemberSummary } from '@diaz/shared';
import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import { List, ListRow } from '@/components/ui/list';
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
    <AppShell>
      <PageHeader title="Members" />

      {error ? (
        <EmptyState description={error} title="Admin unavailable" />
      ) : (
        <section className="flex flex-col gap-400">
          <form onSubmit={onSubmit}>
            <Card className="flex flex-col gap-300 md:flex-row md:items-end">
              <Field
                className="flex-1"
                htmlFor={searchInputId}
                label="Clerk user id, member id, or Stripe customer or subscription id"
              >
                <Input
                  id={searchInputId}
                  placeholder="user_..., cus_..., sub_..."
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </Field>
              <Button disabled={searching} type="submit" variant="primary">
                {searching ? 'Searching...' : 'Search'}
              </Button>
            </Card>
          </form>

          {members === null ? null : members.length === 0 ? (
            <p className="text-body-200 text-foreground-faint">No members match that search.</p>
          ) : (
            <List>
              {members.map((member) => (
                <ListRow
                  badges={
                    <>
                      <Badge
                        label={member.hasAccess ? 'Premium' : 'No access'}
                        variant={member.hasAccess ? 'premium' : 'neutral'}
                      />
                      {member.role === 'STUDENT' ? null : <Badge label={member.role} />}
                    </>
                  }
                  key={member.id}
                  meta={describeAccess(member.access)}
                  stack
                  title={<span className="break-all">{member.clerkUserId}</span>}
                  trailing={
                    <ButtonLink href={`/admin/members/${member.id}`} size="sm" variant="secondary">
                      Manage
                    </ButtonLink>
                  }
                />
              ))}
            </List>
          )}
        </section>
      )}
    </AppShell>
  );
}
