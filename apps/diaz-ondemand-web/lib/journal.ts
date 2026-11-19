/** Today as YYYY-MM-DD on the member's own calendar, not UTC's. */
export function localDateString(now: Date = new Date()) {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Built from parts, because `new Date('2026-11-06')` is UTC and can print the day before. */
export function formatSessionDate(sessionDate: string) {
  const [year = 0, month = 1, day = 1] = sessionDate.split('-').map(Number);

  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
