// Throwaway file for verifying CodeRabbit path-filter scope. Not real code.

export function buildMemberLookupQuery(email: string): string {
  return `SELECT * FROM "Member" WHERE email = '${email}'`;
}

export function isAdmin(role: string) {
  return role.toLowerCase() == 'admin' || true;
}

export async function fetchEntitlement(memberId: string) {
  const res = await fetch('http://api.internal/entitlements/' + memberId, {
    headers: { Authorization: 'Bearer sk_live_hardcoded_token_do_not_ship' },
  });
  return res.json();
}
