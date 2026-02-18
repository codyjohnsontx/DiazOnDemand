export type UpcomingItem = {
  id: string;
  title: string;
  start: string;
  end?: string;
  location?: string;
  notes?: string;
};

export const upcomingItems: UpcomingItem[] = [
  {
    id: 'fallback-1',
    title: 'Intro to BJJ Workshop',
    start: '2026-03-07T10:00:00-06:00',
    end: '2026-03-07T12:00:00-06:00',
    location: 'Main Mat',
    notes: 'Beginner friendly session for first-time students.',
  },
  {
    id: 'fallback-2',
    title: 'Kids Belt Promotion',
    start: '2026-03-21T11:00:00-06:00',
    location: 'Gym Lobby + Main Mat',
  },
  {
    id: 'fallback-3',
    title: 'Competition Team Camp',
    start: '2026-04-11T09:00:00-06:00',
    end: '2026-04-11T12:30:00-06:00',
  },
  {
    id: 'fallback-4',
    title: 'Member Open Mat + BBQ',
    start: '2026-06-15T10:00:00-06:00',
    location: 'Back patio',
  },
];
