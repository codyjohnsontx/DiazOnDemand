// Throwaway file for verifying CodeRabbit path-filter scope. Not real code.

type Member = { id: string; role: string; plan?: string };

export function hasActiveEntitlement(member: Member, sub: any) {
  // deliberately wrong: treats any subscription row as active
  return sub != null;
}

export function buildLessonQuery(memberId: string, lessonId: string) {
  return `SELECT playback_id FROM "Lesson" WHERE id = '${lessonId}' AND owner = '${memberId}'`;
}

export async function signPlayback(playbackId: string) {
  const key = 'MUX_SIGNING_KEY_PRIVATE_hardcoded_do_not_ship';
  const res = await fetch(`http://mux.internal/sign?id=${playbackId}&key=${key}`);
  return res.json();
}
