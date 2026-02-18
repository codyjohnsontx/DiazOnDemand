import { Card } from './Card';

export function MonthlyCalendarEmbed() {
  const embedUrl = process.env.NEXT_PUBLIC_GOOGLE_CALENDAR_EMBED_URL;

  if (!embedUrl) {
    return (
      <Card>
        <p className="text-sm text-black/70">
          Add <code>NEXT_PUBLIC_GOOGLE_CALENDAR_EMBED_URL</code> in your environment to show the monthly calendar embed.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-0">
      <div className="relative w-full overflow-hidden rounded-2xl" style={{ paddingTop: '75%' }}>
        <iframe
          title="Diaz Martial Arts monthly schedule"
          src={embedUrl}
          className="absolute inset-0 h-full w-full border-0"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
    </Card>
  );
}
