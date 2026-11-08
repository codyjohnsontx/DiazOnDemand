'use client';

import { useCallback, useEffect, useState } from 'react';
import type { JournalEntryDto, JournalEntryWriteDto, JournalOverviewDto } from '@diaz/shared';
import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/empty-state';
import { JournalEntryCard } from '@/components/journal-entry-card';
import { JournalEntryForm } from '@/components/journal-entry-form';
import { PageHeader } from '@/components/page-header';
import { useApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-shared';

const SECONDARY_BUTTON =
  'inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-white/10 disabled:opacity-60';
const PRIMARY_BUTTON =
  'inline-flex items-center rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-[var(--accent-strong)] disabled:opacity-60';

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
    } catch (requestError) {
      // Access can end while a form is open. This swaps it for the subscribe path.
      if (requestError instanceof ApiError && requestError.status === 402) {
        setOverview((current) => current && { ...current, canWrite: false });
        return false;
      }

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

  const showAdultGate = overview.canWrite && !overview.adultConfirmed;
  const showForm = overview.canWrite && overview.adultConfirmed;
  const errorMessage = error ? (
    <p
      aria-atomic="true"
      aria-live="assertive"
      className="text-sm text-[var(--danger)]"
      role="alert"
    >
      {error}
    </p>
  ) : null;

  return (
    <AppShell className="space-y-8">
      <PageHeader title="Journal" />

      {showAdultGate ? (
        <section className="surface-panel space-y-6 p-6 sm:p-8">
          <h2 className="type-title-lg text-[var(--text)]">Are you 18 or older?</h2>
          {errorMessage}
          <button
            className={PRIMARY_BUTTON}
            disabled={busy}
            onClick={() => void confirmAdult()}
            type="button"
          >
            {busy ? 'Saving...' : "Yes, I'm 18 or older"}
          </button>
        </section>
      ) : null}

      {!overview.canWrite ? (
        <EmptyState
          ctaHref="/subscribe"
          ctaLabel="Go Premium"
          title="Journal is a Premium feature"
        />
      ) : null}

      {showAdultGate ? null : (
        <section
          className={
            showForm ? 'grid items-start gap-6 xl:grid-cols-[1fr_1fr]' : 'mx-auto max-w-3xl'
          }
        >
          {showForm ? (
            <div className="surface-panel space-y-5 p-5 sm:p-6">
              <h2 className="type-title-lg text-[var(--text)]">New entry</h2>
              <JournalEntryForm
                onSubmit={(payload) => save('/journal', 'POST', payload)}
                submitLabel="Save entry"
              />
              {editingId ? null : errorMessage}
            </div>
          ) : null}

          {overview.entries.length > 0 ? (
            <div className="space-y-4">
              <h2 className="type-title-lg text-[var(--text)]">Your entries</h2>
              {showForm ? null : errorMessage}
              {overview.entries.map((entry) =>
                showForm && editingId === entry.id ? (
                  <div className="surface-panel-muted space-y-5 p-5" key={entry.id}>
                    <h3 className="font-display text-2xl leading-tight text-[var(--text)]">
                      Edit entry
                    </h3>
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
                  </div>
                ) : (
                  <JournalEntryCard
                    actions={
                      deletingId === entry.id ? (
                        <>
                          <span className="type-meta text-[var(--text)]">
                            Delete this entry permanently?
                          </span>
                          <button
                            className={`${SECONDARY_BUTTON} text-[var(--danger)]`}
                            disabled={busy}
                            onClick={() => void remove(entry)}
                            type="button"
                          >
                            Delete
                          </button>
                          <button
                            className={SECONDARY_BUTTON}
                            disabled={busy}
                            onClick={() => setDeletingId(null)}
                            type="button"
                          >
                            Keep
                          </button>
                        </>
                      ) : (
                        <>
                          {showForm ? (
                            <button
                              className={SECONDARY_BUTTON}
                              onClick={() => {
                                setDeletingId(null);
                                setEditingId(entry.id);
                                setError(null);
                              }}
                              type="button"
                            >
                              Edit
                            </button>
                          ) : null}
                          <button
                            className={SECONDARY_BUTTON}
                            onClick={() => {
                              setEditingId(null);
                              setDeletingId(entry.id);
                              setError(null);
                            }}
                            type="button"
                          >
                            Delete
                          </button>
                        </>
                      )
                    }
                    entry={entry}
                    key={entry.id}
                  />
                ),
              )}
            </div>
          ) : showForm ? (
            <EmptyState title="No entries yet" />
          ) : null}
        </section>
      )}
    </AppShell>
  );
}
