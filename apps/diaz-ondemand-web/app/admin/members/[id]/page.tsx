'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { AdminMemberDetail, AdminMemberSubscription } from '@diaz/shared';
import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardActions } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/field';
import { useApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-shared';
import {
  describeAccess,
  describeAuditAction,
  describeAuditChange,
  endOfDayIso,
  formatDate,
} from '@/lib/member-access';

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

/** Which access change is open for confirmation; the page opens one at a time. */
type Confirming = { open: boolean; onOpen: () => void; onClose: () => void };

/**
 * An access change: a reason, then a second, explicit confirmation that says
 * what will happen before anything is sent.
 */
function ConfirmedAction({
  label,
  confirmation,
  onConfirm,
  confirming: { open: confirming, onOpen, onClose },
  confirmDisabled = false,
  reasonRequired = false,
}: {
  label: string;
  confirmation: string;
  onConfirm: (reason: string) => Promise<void>;
  confirming: Confirming;
  confirmDisabled?: boolean;
  reasonRequired?: boolean;
}) {
  const reasonId = useId();
  const [reason, setReason] = useState('');
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
      onClose();
    } catch (error) {
      // The page reports the failure. A 409 means the member changed and the page
      // has reloaded them, so this confirmation may now do something else: close it,
      // reason and all, so the admin reopens it against the new wording. Otherwise
      // keep the reason so a retry need not retype it.
      if (error instanceof ApiError && error.status === 409) {
        setReason('');
        onClose();
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  if (!confirming) {
    return (
      <CardActions>
        <Button onClick={onOpen} variant="secondary">
          {label}
        </Button>
      </CardActions>
    );
  }

  return (
    <Card
      aria-label={`Confirm: ${label}`}
      className="flex flex-col gap-400"
      padding="compact"
      role="group"
      variant="raised"
    >
      <p className="text-body-200">{confirmation}</p>
      <Field htmlFor={reasonId} label={reasonRequired ? 'Reason' : 'Reason (optional)'}>
        <Textarea
          id={reasonId}
          maxLength={500}
          required={reasonRequired}
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      <CardActions>
        <Button
          disabled={submitting || confirmDisabled || (reasonRequired && !reason.trim())}
          onClick={confirm}
          variant="primary"
        >
          {submitting ? 'Saving...' : 'Confirm'}
        </Button>
        <Button disabled={submitting} onClick={onClose} variant="secondary">
          Cancel
        </Button>
      </CardActions>
    </Card>
  );
}

function SubscriptionRow({
  subscription,
  banned,
  onRestore,
  confirming,
}: {
  subscription: AdminMemberSubscription;
  banned: boolean;
  onRestore: (subscription: AdminMemberSubscription, reason: string) => Promise<void>;
  confirming: Confirming;
}) {
  const periodEnd = subscription.currentPeriodEnd
    ? formatDate(subscription.currentPeriodEnd)
    : null;
  const periodOver =
    subscription.currentPeriodEnd !== null && new Date(subscription.currentPeriodEnd) <= new Date();
  const status = subscription.status.replace(/_/g, ' ');
  const revocation = subscription.revokedAt
    ? `Revoked by ${subscription.revokedReason ?? 'unknown reason'} on ${formatDate(subscription.revokedAt)}`
    : null;
  const whyNoAccess = banned
    ? 'The member is banned'
    : periodOver
      ? `Its paid period ended ${periodEnd}`
      : `The subscription is ${status}`;

  return (
    <Card className="flex flex-col gap-400" padding="compact" variant="raised">
      <div className="flex flex-col gap-200">
        <div className="flex flex-wrap items-center gap-200">
          <h3 className="break-all text-body-300 font-semibold">
            {subscription.stripeSubscriptionId}
          </h3>
          <Badge label={status} />
        </div>
        <p className="text-body-200 text-foreground-faint">
          {revocation
            ? revocation
            : periodEnd
              ? `Paid period ends ${periodEnd}`
              : 'No paid period recorded'}
        </p>
      </div>
      {subscription.restorable ? (
        <ConfirmedAction
          confirmation={
            subscription.restoreGivesAccess
              ? `Clear the ${subscription.revokedReason} revocation on ${subscription.stripeSubscriptionId}? Access returns at once${periodEnd ? ` and runs until ${periodEnd}` : ''}.`
              : `Clear the ${subscription.revokedReason} revocation on ${subscription.stripeSubscriptionId}? ${whyNoAccess}, so this clears the record but gives no access back.`
          }
          confirming={confirming}
          label="Restore access"
          onConfirm={(reason) => onRestore(subscription, reason)}
        />
      ) : null}
    </Card>
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
  const [openAction, setOpenAction] = useState<string | null>(null);
  const confirming = (action: string): Confirming => ({
    open: openAction === action,
    onOpen: () => setOpenAction(action),
    onClose: () => setOpenAction((current) => (current === action ? null : current)),
  });

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

  /**
   * Every action answers with the member as they now stand; adopt it. Each one
   * carries the `accessVersion` of the member this page showed, and the API
   * refuses with a 409 when their access has changed since - another admin, or
   * a Stripe event. Reload then, so the open confirmation describes the member
   * as they are before the admin confirms again.
   */
  const act = async (path: string, body: object, done: string, failed: string) => {
    setActionError(null);
    setStatus(null);

    try {
      setMember(
        await apiFetch<AdminMemberDetail>(`/admin/members/${memberId}/${path}`, {
          method: 'POST',
          body: JSON.stringify({ ...body, accessVersion: member?.accessVersion }),
        }),
      );
      setStatus(done);
    } catch (requestError) {
      setActionError(messageFrom(requestError, failed));

      if (requestError instanceof ApiError && requestError.status === 409) {
        await load();
      }

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
        <p className="text-body-200 text-foreground-faint">Loading member...</p>
      </AppShell>
    );
  }

  const hasManualGrant = member.access.kind === 'manual-grant';
  const ban = member.access.kind === 'banned' ? member.access : null;
  const stripeAccess = member.stripeAccess;

  return (
    <AppShell>
      <div className="flex flex-col items-start gap-400">
        <Link
          className="text-body-200 font-semibold text-foreground-faint transition-colors duration-fast hover:text-foreground-primary"
          href="/admin/members"
        >
          Members
        </Link>
        <div className="flex min-w-0 flex-wrap items-center gap-300">
          <h1 className="type-display-700 break-all">{member.clerkUserId}</h1>
          {member.role === 'STUDENT' ? null : <Badge label={member.role} />}
        </div>
      </div>

      <section className="grid items-start gap-600 xl:grid-cols-split">
        <Card className="flex flex-col gap-600">
          <div className="flex flex-col gap-200">
            <h2 className="type-display-500">
              {ban ? 'Banned' : member.hasAccess ? 'Premium access' : 'No access'}
            </h2>
            <p className="text-body-200 text-foreground-faint">
              {describeAccess(member.access)}
              {ban?.reason ? <>: &ldquo;{ban.reason}&rdquo;</> : null}
            </p>
            {ban ? (
              <p className="text-body-200 text-foreground-faint">
                They cannot start a new subscription until the ban is lifted.
              </p>
            ) : null}
          </div>

          {actionError ? (
            <p
              aria-atomic="true"
              aria-live="assertive"
              className="text-body-200 text-foreground-critical"
              role="alert"
            >
              {actionError}
            </p>
          ) : null}
          {status ? (
            <p aria-live="polite" className="text-body-200 text-foreground-success">
              {status}
            </p>
          ) : null}

          {ban ? null : member.canRemove ? (
            <div className="flex flex-col gap-400 border-t border-border-primary pt-600">
              <h3 className="type-display-400">Remove access</h3>
              <ConfirmedAction
                confirmation={
                  member.accessAfterRemove?.hasAccess
                    ? `End the access an admin granted? Their Stripe subscription still gives them access${member.accessAfterRemove.validUntil ? ` until ${formatDate(member.accessAfterRemove.validUntil)}` : ''}.`
                    : 'End the access an admin granted? They will have no premium access until they subscribe or an admin grants it again.'
                }
                confirming={confirming('revoke')}
                label="Remove access"
                onConfirm={(reason) =>
                  act('revoke', { reason }, 'Access removed.', 'Access could not be removed.')
                }
              />
            </div>
          ) : stripeAccess ? (
            <div className="flex flex-col gap-400 border-t border-border-primary pt-600">
              <h3 className="type-display-400">Remove access</h3>
              <p className="text-body-200 text-foreground-faint">
                Their access comes from Stripe subscription{' '}
                <span className="break-all">{stripeAccess.stripeSubscriptionId}</span> (
                {stripeAccess.status.replace(/_/g, ' ')}). To end it now, cancel the subscription in
                Stripe; access ends when Stripe confirms, and they get back in by subscribing again.
              </p>
            </div>
          ) : null}

          {ban ? null : (
            <div className="flex flex-col gap-400 border-t border-border-primary pt-600">
              <h3 className="type-display-400">
                {hasManualGrant ? 'Change access end date' : 'Grant access'}
              </h3>
              {stripeAccess ? (
                <p className="text-body-200 text-foreground-faint">
                  {stripeAccess.validUntil
                    ? `Their Stripe subscription runs until ${formatDate(stripeAccess.validUntil)}, so a grant has to end later.`
                    : 'Their Stripe subscription has no end date on record, so only a grant with no end date can outlast it.'}
                </p>
              ) : null}
              <Field htmlFor={validUntilId} label="Access ends (leave empty for no end date)">
                <Input
                  id={validUntilId}
                  max="9999-12-31"
                  type="date"
                  value={grantUntil}
                  onChange={(event) => setGrantUntil(event.target.value)}
                />
              </Field>
              <ConfirmedAction
                confirmation={
                  grantDateInvalid
                    ? 'That end date is not a real date. Fix it or clear it to continue.'
                    : grantUntilIso
                      ? `Grant premium access until ${formatDate(grantUntilIso)}?`
                      : 'Grant premium access with no end date?'
                }
                confirmDisabled={grantDateInvalid}
                confirming={confirming('grant')}
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
          )}

          <div className="flex flex-col gap-400 border-t border-border-primary pt-600">
            <h3 className="type-display-400">{ban ? 'Lift ban' : 'Ban member'}</h3>
            {ban ? (
              <ConfirmedAction
                confirmation={
                  stripeAccess
                    ? `Lift the ban? Their Stripe subscription gives access back right away${stripeAccess.validUntil ? `, until ${formatDate(stripeAccess.validUntil)}` : ''}.`
                    : 'Lift the ban? They have no subscription, so they get no access until they subscribe or an admin grants it.'
                }
                confirming={confirming('unban')}
                label="Lift ban"
                onConfirm={(reason) =>
                  act('unban', { reason }, 'Ban lifted.', 'The ban could not be lifted.')
                }
              />
            ) : (
              <ConfirmedAction
                confirmation="Ban this member? They lose premium access now, it stays off no matter what Stripe sends, and they cannot subscribe until the ban is lifted here. This does not cancel their subscription or stop billing; do that in Stripe."
                confirming={confirming('ban')}
                label="Ban member"
                onConfirm={(reason) =>
                  act('ban', { reason }, 'Member banned.', 'The member could not be banned.')
                }
                reasonRequired
              />
            )}
          </div>
        </Card>

        <div className="flex flex-col gap-600">
          <Card className="flex flex-col gap-400">
            <h2 className="type-display-500">Subscriptions</h2>
            {member.subscriptions.length === 0 ? (
              <p className="text-body-200 text-foreground-faint">No Stripe subscriptions.</p>
            ) : (
              <div className="flex flex-col gap-300">
                {member.subscriptions.map((subscription) => (
                  <SubscriptionRow
                    confirming={confirming(`restore:${subscription.id}`)}
                    key={subscription.id}
                    banned={ban !== null}
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
          </Card>

          <Card className="flex flex-col gap-400">
            <h2 className="type-display-500">History</h2>
            {member.history.length === 0 ? (
              <p className="text-body-200 text-foreground-faint">
                No admin has changed this member&apos;s access.
              </p>
            ) : (
              <ol className="flex flex-col gap-300">
                {member.history.map((entry) => (
                  <li key={entry.id}>
                    <Card className="flex flex-col gap-100" padding="compact" variant="raised">
                      <p className="text-body-200 font-semibold">
                        {describeAuditAction(entry)} - {entry.actorClerkUserId},{' '}
                        {formatDate(entry.createdAt)}
                      </p>
                      <p className="text-body-200 text-foreground-faint">
                        {describeAuditChange(entry)}
                      </p>
                      {entry.stripeSubscriptionId ? (
                        <p className="break-all text-body-200 text-foreground-faint">
                          {entry.stripeSubscriptionId}
                        </p>
                      ) : null}
                      {entry.reason ? (
                        <p className="text-body-200 text-foreground-faint">
                          &ldquo;{entry.reason}&rdquo;
                        </p>
                      ) : null}
                    </Card>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </section>
    </AppShell>
  );
}
