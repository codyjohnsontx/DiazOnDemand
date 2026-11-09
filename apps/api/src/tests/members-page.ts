import { NotFoundException } from '@nestjs/common';
import type {
  AdminGrantMemberAccessDto,
  AdminRestoreMemberAccessDto,
  AdminRevokeMemberAccessDto,
} from '@diaz/shared';
import type { AdminMembersService } from '../admin/admin-members.service.js';
import type { AuthUser } from '../common/request-with-user.js';

type WithoutVersion<T> = Omit<T, 'accessVersion'> & { accessVersion?: string };

/**
 * The members screen as an admin uses it: load the member, then confirm against
 * what loaded. Every access change has to name the `accessVersion` it was
 * confirmed against, and most tests are about the change rather than that
 * check, so this supplies the current one unless a test passes its own.
 *
 * A member that cannot be loaded gets a version that can never match, which
 * leaves the service's own 404 to answer first.
 */
export function membersPage(service: AdminMembersService) {
  const versionOf = async (memberId: string, given: string | undefined) => {
    if (given !== undefined) {
      return given;
    }

    try {
      return (await service.getMember(memberId)).accessVersion;
    } catch (error) {
      if (error instanceof NotFoundException) {
        return 'member-not-loaded';
      }
      throw error;
    }
  };

  return {
    getMember: service.getMember.bind(service),
    listMembers: service.listMembers.bind(service),
    grantAccess: async (
      actor: AuthUser,
      memberId: string,
      payload: WithoutVersion<AdminGrantMemberAccessDto>,
    ) =>
      service.grantAccess(actor, memberId, {
        ...payload,
        accessVersion: await versionOf(memberId, payload.accessVersion),
      }),
    revokeAccess: async (
      actor: AuthUser,
      memberId: string,
      payload: WithoutVersion<AdminRevokeMemberAccessDto>,
    ) =>
      service.revokeAccess(actor, memberId, {
        ...payload,
        accessVersion: await versionOf(memberId, payload.accessVersion),
      }),
    restoreAccess: async (
      actor: AuthUser,
      memberId: string,
      payload: WithoutVersion<AdminRestoreMemberAccessDto>,
    ) =>
      service.restoreAccess(actor, memberId, {
        ...payload,
        accessVersion: await versionOf(memberId, payload.accessVersion),
      }),
  };
}
