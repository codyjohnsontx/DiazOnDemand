'use client';

import { useCallback, useEffect, useState } from 'react';
import type { JournalEntryDto, JournalEntryWriteDto, JournalOverviewDto } from '@diaz/shared';
import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/empty-state';
import { JournalEntryCard } from '@/components/journal-entry-card';
import { JournalEntryForm } from '@/components/journal-entry-form';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useApiClient } from '@/lib/api-client';

export default function JournalPage() {
  const apiFetch = useApiClient();
  const [overview, setOverview] = useState<JournalOverviewDto | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setOverview(await apiFetch<JournalOverviewDto>('/journal'));
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [apiFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  const confirmAdult = async () => {
    setBusy(true);
    setError(null);

    try {
      await apiFetch('/journal/adult-confirmation', { method: 'POST' });
      await load();
    } catch {
      setError('That could not be saved. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const save = async (path: string, method: 'POST' | 'PATCH', payload: JournalEntryWriteDto) => {
    setError(null);

    try {
      await apiFetch(path, { method, body: JSON.stringify(payload) });
      await load();
      return true;
    } catch {
      setError('Your entry could not be saved. Try again.');
      return false;
    }
  };

  const remove = async (entry: JournalEntryDto) => {
    setBusy(true);
    setError(null);

    try {
      await apiFetch(`/journal/${entry.id}`, { method: 'DELETE' });
      setDeletingId(null);
      await load();
    } catch {
      setError('That entry could not be deleted. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (loadFailed && !overview) {
    return (
      <AppShell>
        <EmptyState ctaHref="/sign-in" ctaLabel="Sign in" title="Journal unavailable" />
      </AppShell>
    );
  }

  if (!overview) {
    return null;
  }

  const errorMessage = error ? (
    <p
      aria-atomic="true"
      aria-live="assertive"
      className="text-body-200 text-foreground-critical"
      role="alert"
    >
      {error}
    </p>
  ) : null;

  return (
    <AppShell>
      <PageHeader title="Journal" />

      {overview.adultConfirmed ? null : (
        <Card className="flex flex-col gap-600" variant="emphasis">
          <h2 className="type-display-500">Are you 18 or older?</h2>
          {errorMessage}
          <div>
            <Button disabled={busy} onClick={() => void confirmAdult()} variant="primary">
              {busy ? 'Saving...' : "Yes, I'm 18 or older"}
            </Button>
          </div>
        </Card>
      )}

      {overview.adultConfirmed ? (
        <section className="grid items-start gap-600 xl:grid-cols-split">
          <Card className="flex flex-col gap-600" variant="emphasis">
            <h2 className="type-display-500">New entry</h2>
            <JournalEntryForm
              onSubmit={(payload) => save('/journal', 'POST', payload)}
              submitLabel="Save entry"
            />
            {editingId ? null : errorMessage}
          </Card>

          {overview.entries.length > 0 ? (
            <div className="flex flex-col gap-400">
              <h2 className="type-display-500">Your entries</h2>
              {overview.entries.map((entry) =>
                editingId === entry.id ? (
                  <Card className="flex flex-col gap-500" key={entry.id} padding="compact">
                    <h3 className="type-display-400">Edit entry</h3>
                    <JournalEntryForm
                      entry={entry}
                      onCancel={() => {
                        setEditingId(null);
                        setError(null);
                      }}
                      onSubmit={async (payload) => {
                        const saved = await save(`/journal/${entry.id}`, 'PATCH', payload);

                        if (saved) {
                          setEditingId(null);
                        }

                        return saved;
                      }}
                      submitLabel="Save changes"
                    />
                    {errorMessage}
                  </Card>
                ) : (
                  <JournalEntryCard
                    actions={
                      deletingId === entry.id ? (
                        <>
                          <span className="self-center text-body-200 text-foreground-primary">
                            Delete this entry permanently?
                          </span>
                          <Button
                            className="text-foreground-critical"
                            disabled={busy}
                            onClick={() => void remove(entry)}
                            size="sm"
                          >
                            Delete
                          </Button>
                          <Button disabled={busy} onClick={() => setDeletingId(null)} size="sm">
                            Keep
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            onClick={() => {
                              setDeletingId(null);
                              setEditingId(entry.id);
                              setError(null);
                            }}
                            size="sm"
                          >
                            Edit
                          </Button>
                          <Button
                            onClick={() => {
                              setEditingId(null);
                              setDeletingId(entry.id);
                              setError(null);
                            }}
                            size="sm"
                          >
                            Delete
                          </Button>
                        </>
                      )
                    }
                    entry={entry}
                    key={entry.id}
                  />
                ),
              )}
            </div>
          ) : (
            <EmptyState title="No entries yet" />
          )}
        </section>
      ) : null}
    </AppShell>
  );
}
