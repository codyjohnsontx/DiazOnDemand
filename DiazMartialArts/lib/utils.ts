export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function toAbsoluteUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  return new URL(path, base).toString();
}

export function formatDateTimeRange(start: Date, end?: Date): string {
  const dateFmt = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  const timeFmt = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  if (!end) {
    return `${dateFmt.format(start)} at ${timeFmt.format(start)}`;
  }

  return `${dateFmt.format(start)} · ${timeFmt.format(start)}-${timeFmt.format(end)}`;
}
