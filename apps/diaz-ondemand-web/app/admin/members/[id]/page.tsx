'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { AdminMemberDetail, AdminMemberSubscription } from '@diaz/shared';
import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/empty-state';
import { PremiumBadge } from '@/components/premium-badge';
import { useApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-shared';
import {
  describeAccess,
  describeAuditAction,
  describeAuditChange,
  endOfDayIso,
  formatDate,
  isCheckoutBarred,
  restoreKeepsCheckoutBar,
} from '@/lib/member-access';

const PRIMARY_BUTTON =
  'inline-flex items-center rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-[var(--accent-strong)] disabled:opacity-60';
const SECONDARY_BUTTON =
  'inline-flex items-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-white/10 disabled:opacity-60';
const FIELD =
  'w-full rounded-[20px] border border-white/10 bg-[var(--surface-2)] px-4 py-3 text-[var(--text)]';

/** The API's own refusal, which names the rule, or a generic line when it gave none. */
function messageFrom(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    try {
      const body = JSON.parse(error.detail) as { message?: unknown };
      if (typeof body.message === 'string') {
        return body.message;
      }
    } catch {
      // Not JSON; fall through to the generic line.
    }
  }

  return fallback;
}

/**
 * An access change: a reason, then a second, explicit confirmation that says
 * what will happen before anything is sent.
 */
function ConfirmedAction({
  label,
  confirmation,
  onConfirm,
  confirmDisabled = false,
  reasonRequired = false,
}: {
  label: string;
  confirmation: string;
  onConfirm: (reason: string) => Promise<void>;
  confirmDisabled?: boolean;
  reasonRequired?: boolean;
}) {
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Refuses a second submit while one is in flight, before React re-renders.
  const inFlight = useRef(false);

  const confirm = async () => {
    if (inFlight.current) {
      return;
    }

    inFlight.current = true;
    setSubmitting(true);

    try {
      await onConfirm(reason);
      setReason('');
      setConfirming(false);
    } catch {
      // The page reports the failure; keep the reason so a retry need not retype it.
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  if (!confirming) {
    return (
      <button className={SECONDARY_BUTTON} onClick={() => setConfirming(true)} type="button">
        {label}
      </button>
    );
  }

  return (
    <div
      className="surface-panel-muted space-y-4 p-4"
      role="group"
      aria-label={`Confirm: ${label}`}
    >
      <p className="text-sm text-[var(--text)]">{confirmation}</p>
      <div className="space-y-2">
        <label className="type-kicker text-[var(--text-muted)]" htmlFor={reasonId}>
          {reasonRequired ? 'Reason' : 'Reason (optional)'}
        </label>
        <textarea
          id={reasonId}
          className={`${FIELD} min-h-[80px]`}
          maxLength={500}
          required={reasonRequired}
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-3">
        <button
          className={PRIMARY_BUTTON}
          disabled={submitting || confirmDisabled || (reasonRequired && !reason.trim())}
          onClick={confirm}
          type="button"
        >
          {submitting ? 'Saving...' : 'Confirm'}
        </button>
        <button
          className={SECONDARY_BUTTON}
          disabled={submitting}
          onClick={() => setConfirming(false)}
          type="button"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function SubscriptionRow({
  subscription,
  keepsCheckoutBar,
  onRestore,
}: {
  subscription: AdminMemberSubscription;
  keepsCheckoutBar: boolean;
  onRestore: (subscription: AdminMemberSubscription, reason: string) => Promise<void>;
}) {
  const periodEnd = subscription.currentPeriodEnd
    ? formatDate(subscription.currentPeriodEnd)
    : null;
  const periodOver =
    subscription.currentPeriodEnd !== null && new Date(subscription.currentPeriodEnd) <= new Date();
  const status = subscription.status.replace(/_/g, ' ');
  const revocations = [
    subscription.adminRevokedAt
      ? `Revoked by an admin on ${formatDate(subscription.adminRevokedAt)}`
      : null,
    subscription.revokedAt
      ? `Revoked by ${subscription.revokedReason ?? 'unknown reason'} on ${formatDate(subscription.revokedAt)}`
      : null,
  ].filter(Boolean);
  const clearing = subscription.adminRevokedAt ? 'admin' : subscription.revokedReason;
  const whyNoAccess =
    subscription.adminRevokedAt && subscription.revokedAt
      ? `It stays revoked by ${subscription.revokedReason}`
      : periodOver
        ? `Its paid period ended ${periodEnd}`
        : `The subscription is ${status}`;
  const barStays = keepsCheckoutBar
    ? ' Another subscription keeps an admin revocation, so they still cannot start a new subscription.'
    : '';

  return (
    <div className="surface-panel-muted space-y-4 p-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="break-all font-display text-xl leading-tight text-[var(--text)]">
            {subscription.stripeSubscriptionId}
          </h3>
          <PremiumBadge label={status} />
        </div>
        <p className="text-sm text-[var(--text-muted)]">
          {revocations.length > 0
            ? revocations.join('. ')
            : periodEnd
              ? `Paid period ends ${periodEnd}`
              : 'No paid period recorded'}
        </p>
      </div>
      {subscription.restorable ? (
        <ConfirmedAction
          confirmation={
            subscription.restoreGivesAccess
              ? `Clear the ${clearing} revocation on ${subscription.stripeSubscriptionId}? Access returns at once${periodEnd ? ` and runs until ${periodEnd}` : ''}.${barStays}`
              : `Clear the ${clearing} revocation on ${subscription.stripeSubscriptionId}? ${whyNoAccess}, so this clears the record but gives no access back.${subscription.restoreOpensCheckout ? ' They will be able to start a new subscription.' : barStays}`
          }
          label="Restore access"
          onConfirm={(reason) => onRestore(subscription, reason)}
        />
      ) : null}
    </div>
  );
}

export default function AdminMemberPage() {
  const params = useParams<{ id: string }>();
  const memberId = params.id;
  const apiFetch = useApiClient();
  const validUntilId = useId();
  const [member, setMember] = useState<AdminMemberDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [grantUntil, setGrantUntil] = useState('');

  const load = useCallback(async () => {
    try {
      setMember(await apiFetch<AdminMemberDetail>(`/admin/members/${memberId}`));
      setLoadError(null);
    } catch (requestError) {
      setLoadError(
        requestError instanceof ApiError && requestError.status === 403
          ? 'You do not have admin access for this area.'
          : requestError instanceof ApiError && requestError.status === 404
            ? 'This member could not be found.'
            : 'This member could not be loaded right now.',
      );
    }
  }, [apiFetch, memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Every action answers with the member as they now stand; adopt it. */
  const act = async (path: string, body: object, done: string, failed: string) => {
    setActionError(null);
    setStatus(null);

    try {
      setMember(
        await apiFetch<AdminMemberDetail>(`/admin/members/${memberId}/${path}`, {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      );
      setStatus(done);
    } catch (requestError) {
      setActionError(messageFrom(requestError, failed));
      throw requestError;
    }
  };

  const grantUntilIso = endOfDayIso(grantUntil);
  const grantDateInvalid = grantUntil !== '' && grantUntilIso === null;

  if (loadError) {
    return (
      <AppShell>
        <EmptyState
          ctaHref="/admin/members"
          ctaLabel="Back to members"
          description={loadError}
          title="Member unavailable"
        />
      </AppShell>
    );
  }

  if (!member) {
    return (
      <AppShell>
        <p className="text-sm text-[var(--text-muted)]">Loading member...</p>
      </AppShell>
    );
  }

  const hasManualGrant = member.access.kind === 'manual-grant';

  return (
    <AppShell className="space-y-8">
      <div className="space-y-4">
        <Link
          className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
          href="/admin/members"
        >
          Members
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="break-all font-display text-3xl leading-none text-[var(--text)] sm:text-4xl">
            {member.clerkUserId}
          </h1>
          {member.role === 'STUDENT' ? null : <PremiumBadge label={member.role} />}
        </div>
      </div>

      <section className="grid items-start gap-6 xl:grid-cols-[1fr_1fr]">
        <div className="surface-panel space-y-6 p-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="type-title-lg text-[var(--text)]">
                {member.hasAccess ? 'Premium access' : 'No access'}
              </h2>
            </div>
            <p className="text-sm text-[var(--text-muted)]">{describeAccess(member.access)}</p>
            {isCheckoutBarred(member.subscriptions) ? (
              <p className="text-sm text-[var(--text-muted)]">
                They cannot start a new subscription until every admin revocation is restored.
              </p>
            ) : null}
          </div>

          {actionError ? (
            <p
              aria-atomic="true"
              aria-live="assertive"
              className="text-sm text-[var(--danger)]"
              role="alert"
            >
              {actionError}
            </p>
          ) : null}
          {status ? (
            <p aria-live="polite" className="text-sm text-[var(--progress)]">
              {status}
            </p>
          ) : null}

          {member.canRevoke ? (
            <div className="space-y-4 border-t border-white/10 pt-6">
              <h3 className="font-display text-2xl leading-tight text-[var(--text)]">
                Revoke access
              </h3>
              <ConfirmedAction
                confirmation={
                  member.revokeRequiresReason
                    ? 'Withdraw their Stripe access? It ends at once and stays off through renewals, and they cannot start a new subscription, until restored here. This does not cancel the subscription or stop billing; do that in Stripe.'
                    : member.accessAfterRevoke?.hasAccess
                      ? `End this manual grant? Their Stripe subscription still gives them access${member.accessAfterRevoke.validUntil ? ` until ${formatDate(member.accessAfterRevoke.validUntil)}` : ''}.`
                      : 'End this manual grant? They will have no premium access.'
                }
                label="Revoke access"
                onConfirm={(reason) =>
                  act('revoke', { reason }, 'Access revoked.', 'Access could not be revoked.')
                }
                reasonRequired={member.revokeRequiresReason}
              />
            </div>
          ) : null}

          <div className="space-y-4 border-t border-white/10 pt-6">
            <h3 className="font-display text-2xl leading-tight text-[var(--text)]">
              {hasManualGrant ? 'Change access end date' : 'Grant access'}
            </h3>
            {member.stripeAccess ? (
              <p className="text-sm text-[var(--text-muted)]">
                {member.stripeAccess.validUntil
                  ? `Their Stripe subscription runs until ${formatDate(member.stripeAccess.validUntil)}, so a grant has to end later.`
                  : 'Their Stripe subscription has no end date on record, so only a grant with no end date can outlast it.'}
              </p>
            ) : null}
            <div className="space-y-2">
              <label className="type-kicker text-[var(--text-muted)]" htmlFor={validUntilId}>
                Access ends (leave empty for no end date)
              </label>
              <input
                id={validUntilId}
                className={FIELD}
                max="9999-12-31"
                type="date"
                value={grantUntil}
                onChange={(event) => setGrantUntil(event.target.value)}
              />
            </div>
            <ConfirmedAction
              confirmation={
                grantDateInvalid
                  ? 'That end date is not a real date. Fix it or clear it to continue.'
                  : grantUntilIso
                    ? `Grant premium access until ${formatDate(grantUntilIso)}?`
                    : 'Grant premium access with no end date?'
              }
              confirmDisabled={grantDateInvalid}
              label={hasManualGrant ? 'Update access' : 'Grant access'}
              onConfirm={async (reason) => {
                await act(
                  'grant',
                  { validUntil: grantUntilIso, reason },
                  'Access granted.',
                  'Access could not be granted.',
                );
                setGrantUntil('');
              }}
            />
          </div>
        </div>

        <div className="space-y-6">
          <div className="surface-panel space-y-4 p-6">
            <h2 className="type-title-lg text-[var(--text)]">Subscriptions</h2>
            {member.subscriptions.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No Stripe subscriptions.</p>
            ) : (
              <div className="space-y-3">
                {member.subscriptions.map((subscription) => (
                  <SubscriptionRow
                    key={subscription.id}
                    keepsCheckoutBar={restoreKeepsCheckoutBar(subscription, member.subscriptions)}
                    onRestore={(row, reason) =>
                      act(
                        'restore',
                        { subscriptionId: row.id, reason },
                        'Revocation cleared.',
                        'The revocation could not be cleared.',
                      )
                    }
                    subscription={subscription}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="surface-panel space-y-4 p-6">
            <h2 className="type-title-lg text-[var(--text)]">History</h2>
            {member.history.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">
                No admin has changed this member&apos;s access.
              </p>
            ) : (
              <ol className="space-y-3">
                {member.history.map((entry) => (
                  <li className="surface-panel-muted space-y-1 p-4" key={entry.id}>
                    <p className="text-sm font-semibold text-[var(--text)]">
                      {describeAuditAction(entry)} - {entry.actorClerkUserId},{' '}
                      {formatDate(entry.createdAt)}
                    </p>
                    <p className="text-sm text-[var(--text-muted)]">{describeAuditChange(entry)}</p>
                    {entry.stripeSubscriptionId ? (
                      <p className="break-all text-sm text-[var(--text-muted)]">
                        {entry.stripeSubscriptionId}
                      </p>
                    ) : null}
                    {entry.reason ? (
                      <p className="text-sm text-[var(--text-muted)]">
                        &ldquo;{entry.reason}&rdquo;
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </section>
    </AppShell>
  );
}
