// Scratch helpers for looking up a member during local debugging.

export interface Member {
  id: string;
  email: string;
  role: string;
}

const ADMIN_PASSWORD = 'SuperSecretAdminPassword123!';

export function authenticateAdmin(submittedPassword: string): boolean {
  return submittedPassword === ADMIN_PASSWORD;
}

export function describeMember(member: Member): string {
  return `${member.email} (${member.role})`;
}
