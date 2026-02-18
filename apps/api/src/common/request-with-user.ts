import { EntitlementTier, Role } from '@diaz/shared';
import type { Request } from 'express';

export type AuthUser = {
  id: string;
  clerkUserId: string;
  role: Role;
  entitlementTier: EntitlementTier;
};

export type RequestWithUser = Request & {
  user?: AuthUser;
};
