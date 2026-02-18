export type ClassBlock = {
  time: string;
  program: string;
  coach: string;
};

export type WeeklySchedule = {
  day: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';
  classes: ClassBlock[];
};

export const weeklySchedule: WeeklySchedule[] = [
  {
    day: 'Monday',
    classes: [
      { time: '6:00 AM', program: 'No-Gi Grappling', coach: 'Coach Marcus' },
      { time: '12:00 PM', program: 'Fundamentals BJJ', coach: 'Coach Miguel' },
      { time: '6:00 PM', program: 'All Levels Gi', coach: 'Coach Miguel' },
      { time: '7:15 PM', program: 'Kids Jiu-Jitsu', coach: 'Coach Elena' },
    ],
  },
  {
    day: 'Tuesday',
    classes: [
      { time: '6:00 AM', program: 'Fundamentals BJJ', coach: 'Coach Elena' },
      { time: '12:00 PM', program: 'No-Gi Grappling', coach: 'Coach Marcus' },
      { time: '6:00 PM', program: 'All Levels Gi', coach: 'Coach Miguel' },
    ],
  },
  {
    day: 'Wednesday',
    classes: [
      { time: '6:00 AM', program: 'No-Gi Grappling', coach: 'Coach Marcus' },
      { time: '12:00 PM', program: 'Fundamentals BJJ', coach: 'Coach Miguel' },
      { time: '6:00 PM', program: 'All Levels Gi', coach: 'Coach Elena' },
      { time: '7:15 PM', program: 'Kids Jiu-Jitsu', coach: 'Coach Elena' },
    ],
  },
  {
    day: 'Thursday',
    classes: [
      { time: '6:00 AM', program: 'Fundamentals BJJ', coach: 'Coach Miguel' },
      { time: '12:00 PM', program: 'No-Gi Grappling', coach: 'Coach Marcus' },
      { time: '6:00 PM', program: 'All Levels Gi', coach: 'Coach Miguel' },
    ],
  },
  {
    day: 'Friday',
    classes: [
      { time: '6:30 AM', program: 'Open Mat', coach: 'Coach Marcus' },
      { time: '5:30 PM', program: 'All Levels Gi', coach: 'Coach Elena' },
    ],
  },
  {
    day: 'Saturday',
    classes: [
      { time: '9:00 AM', program: 'Kids Jiu-Jitsu', coach: 'Coach Elena' },
      { time: '10:30 AM', program: 'Competition Class', coach: 'Coach Miguel' },
      { time: '12:00 PM', program: 'Open Mat', coach: 'Coaching Team' },
    ],
  },
  {
    day: 'Sunday',
    classes: [],
  },
];
