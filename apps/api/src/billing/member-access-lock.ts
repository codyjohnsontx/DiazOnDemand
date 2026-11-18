import type { Prisma, PrismaClient } from '@diaz/db';

/**
 * Runs `run` in a transaction that first takes this member's access lock, so
 * no two writes to one member's access interleave.
 *
 * Every path that changes what a member can watch goes through here: the admin
 * grant, revoke and restore, and each Stripe webhook that writes a subscription
 * row and re-derives the entitlement. Each of those reads the member's rows,
 * decides, and writes; without the lock a webhook could read before an admin
 * change commits and write after it, which undid the change (a revoked member
 * paid their way back in, a grant was overwritten by a sync, a restored
 * revocation was copied onto a new subscription).
 *
 * The lock is a transaction-scoped Postgres advisory lock keyed on the member
 * id, taken as the first statement so every read after it sees whatever the
 * previous holder committed. It is released at commit or rollback, so nothing
 * can leave it held. It also needs no row to exist, unlike `FOR UPDATE`, which
 * matters for a webhook naming a member before anything else is stored. Two
 * member ids whose hashes collide only wait on each other; that costs time,
 * never correctness.
 *
 * Keep the transaction short: nothing inside may call Stripe or send an alert,
 * because every other write for that member waits on it.
 */
export function withMemberAccessLock<T>(
  client: PrismaClient,
  memberId: string,
  run: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (tx) => {
    // `$executeRaw`, not `$queryRaw`: the lock function returns void, which
    // Prisma cannot deserialize as a result column.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('member-access'), hashtext(${memberId}))`;
    return run(tx);
  });
}
