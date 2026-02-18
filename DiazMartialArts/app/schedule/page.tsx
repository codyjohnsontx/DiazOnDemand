import { MonthlyCalendarEmbed } from '@/components/MonthlyCalendarEmbed';
import { Section } from '@/components/Section';
import { UpcomingEvents } from '@/components/UpcomingEvents';
import { WeeklyScheduleTable } from '@/components/WeeklyScheduleTable';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'Schedule',
  description:
    'View the weekly BJJ class schedule, monthly Google Calendar, and upcoming events for the next 60 days.',
  path: '/schedule',
});

export default function SchedulePage() {
  return (
    <Section
      title="Schedule"
      eyebrow="Train Smart"
      description="Use the weekly class lineup for your routine, then check the monthly calendar and upcoming events."
    >
      <div className="space-y-8">
        <div>
          <h3 className="mb-4 text-2xl font-bold text-ink">Weekly Class Schedule</h3>
          <WeeklyScheduleTable />
        </div>

        <div>
          <h3 className="mb-4 text-2xl font-bold text-ink">Monthly Calendar</h3>
          <MonthlyCalendarEmbed />
        </div>

        <div>
          <UpcomingEvents />
        </div>
      </div>
    </Section>
  );
}
