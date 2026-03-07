import { AccessLevel } from '@prisma/client';

export const fundamentalsProgramId = '11111111-1111-1111-1111-111111111111';

export type FundamentalsPosition =
  | 'guard-retention'
  | 'guard-passing'
  | 'side-control'
  | 'back-control';

export type FundamentalsTrack = 'defense' | 'offense';

export type FundamentalsSkill =
  | 'retention'
  | 'passing'
  | 'control'
  | 'escape'
  | 'submission'
  | 'transition';

export type FundamentalsCurriculumTag =
  | 'block:fundamentals'
  | `position:${FundamentalsPosition}`
  | `track:${FundamentalsTrack}`
  | `skill:${FundamentalsSkill}`;

type FundamentalsLessonSeed = {
  id: string;
  title: string;
  description: string;
  orderIndex: number;
  accessLevel: AccessLevel;
  muxPlaybackId: string;
  tags: FundamentalsCurriculumTag[];
};

type FundamentalsCourseSeed = {
  id: string;
  position: FundamentalsPosition;
  track: FundamentalsTrack;
  title: string;
  description: string;
  orderIndex: number;
  lessons: FundamentalsLessonSeed[];
};

export type FundamentalsCurriculumSeed = {
  program: {
    id: string;
    title: string;
    description: string;
    orderIndex: number;
    isPublished: boolean;
  };
  courses: FundamentalsCourseSeed[];
};

function buildFundamentalsTags(
  position: FundamentalsPosition,
  track: FundamentalsTrack,
  skill?: FundamentalsSkill,
): FundamentalsCurriculumTag[] {
  const tags: FundamentalsCurriculumTag[] = [
    'block:fundamentals',
    `position:${position}`,
    `track:${track}`,
  ];

  if (skill) {
    tags.push(`skill:${skill}`);
  }

  return tags;
}

export const fundamentalsCurriculumSeed: FundamentalsCurriculumSeed = {
  program: {
    id: fundamentalsProgramId,
    title: 'Fundamentals',
    description: 'Primary positional foundations with separate offense and defense tracks.',
    orderIndex: 1,
    isPublished: true,
  },
  courses: [
    {
      id: '22222222-2222-2222-2222-222222222222',
      position: 'guard-retention',
      track: 'defense',
      title: 'Guard Retention - Defense',
      description: 'Core defensive guard retention layers: frames, hip movement, and recovery timing.',
      orderIndex: 1,
      lessons: [
        {
          id: '33333333-3333-3333-3333-333333333331',
          title: 'Frame Fundamentals',
          description: 'Build foundational frames to deny immediate guard passes and create recovery space.',
          orderIndex: 1,
          accessLevel: AccessLevel.FREE,
          muxPlaybackId: 'seedgrddef101',
          tags: buildFundamentalsTags('guard-retention', 'defense', 'retention'),
        },
        {
          id: '33333333-3333-3333-3333-333333333332',
          title: 'Hip Escape Recovery Chain',
          description: 'Use coordinated hip escapes and angle changes to recover guard under pressure.',
          orderIndex: 2,
          accessLevel: AccessLevel.PAID,
          muxPlaybackId: 'seedgrddef102',
          tags: buildFundamentalsTags('guard-retention', 'defense', 'escape'),
        },
      ],
    },
    {
      id: '22222222-2222-2222-2222-222222222223',
      position: 'guard-retention',
      track: 'offense',
      title: 'Guard Retention - Offense',
      description: 'Turn retained guard positions into sweeps, attacks, and transitions.',
      orderIndex: 2,
      lessons: [
        {
          id: '33333333-3333-3333-3333-333333333333',
          title: 'Inside Position Entry from Guard',
          description: 'Convert stable guard retention into inside position for immediate offensive threats.',
          orderIndex: 1,
          accessLevel: AccessLevel.FREE,
          muxPlaybackId: 'seedgrdoff201',
          tags: buildFundamentalsTags('guard-retention', 'offense', 'transition'),
        },
        {
          id: '33333333-3333-3333-3333-333333333334',
          title: 'Retention to Triangle Entry',
          description: 'Chain guard retention cues directly into high-percentage triangle setups.',
          orderIndex: 2,
          accessLevel: AccessLevel.PAID,
          muxPlaybackId: 'seedgrdoff202',
          tags: buildFundamentalsTags('guard-retention', 'offense', 'submission'),
        },
      ],
    },
    {
      id: '22222222-2222-2222-2222-222222222224',
      position: 'guard-passing',
      track: 'defense',
      title: 'Guard Passing - Defense',
      description: 'Defensive responses to stop or reverse common passing attempts.',
      orderIndex: 3,
      lessons: [
        {
          id: '33333333-3333-3333-3333-333333333335',
          title: 'Early Pass Defense Frames',
          description: 'Recognize passing entries early and reinforce frame structure before pressure settles.',
          orderIndex: 1,
          accessLevel: AccessLevel.FREE,
          muxPlaybackId: 'seedgpsdef301',
          tags: buildFundamentalsTags('guard-passing', 'defense', 'escape'),
        },
        {
          id: '33333333-3333-3333-3333-333333333336',
          title: 'Re-Guard vs Knee Cut Pressure',
          description: 'Recover guard from knee cut passing chains with timing-based counters.',
          orderIndex: 2,
          accessLevel: AccessLevel.PAID,
          muxPlaybackId: 'seedgpsdef302',
          tags: buildFundamentalsTags('guard-passing', 'defense', 'retention'),
        },
      ],
    },
    {
      id: '22222222-2222-2222-2222-222222222225',
      position: 'guard-passing',
      track: 'offense',
      title: 'Guard Passing - Offense',
      description: 'Passing structure for breaking alignment and controlling top progression.',
      orderIndex: 4,
      lessons: [
        {
          id: '33333333-3333-3333-3333-333333333337',
          title: 'Knee Cut Passing Fundamentals',
          description: 'Learn clean entries, angle control, and pressure lines for a reliable knee cut pass.',
          orderIndex: 1,
          accessLevel: AccessLevel.FREE,
          muxPlaybackId: 'seedgpsoff401',
          tags: buildFundamentalsTags('guard-passing', 'offense', 'passing'),
        },
        {
          id: '33333333-3333-3333-3333-333333333338',
          title: 'Body Lock Pass to Side Control',
          description: 'Connect body lock passing to stable side control with proper hip and shoulder control.',
          orderIndex: 2,
          accessLevel: AccessLevel.PAID,
          muxPlaybackId: 'seedgpsoff402',
          tags: buildFundamentalsTags('guard-passing', 'offense', 'passing'),
        },
      ],
    },
    {
      id: '22222222-2222-2222-2222-222222222226',
      position: 'side-control',
      track: 'defense',
      title: 'Side Control - Defense',
      description: 'Defensive survival and escape layers from bottom side control.',
      orderIndex: 5,
      lessons: [
        {
          id: '33333333-3333-3333-3333-333333333339',
          title: 'Bottom Frames from Side Control',
          description: 'Apply frame placement and elbow alignment to prevent flattening under top pressure.',
          orderIndex: 1,
          accessLevel: AccessLevel.FREE,
          muxPlaybackId: 'seedscddef501',
          tags: buildFundamentalsTags('side-control', 'defense', 'escape'),
        },
        {
          id: '33333333-3333-3333-3333-333333333340',
          title: 'Underhook Escape to Guard',
          description: 'Use the underhook line to create elevation and recover guard efficiently.',
          orderIndex: 2,
          accessLevel: AccessLevel.PAID,
          muxPlaybackId: 'seedscddef502',
          tags: buildFundamentalsTags('side-control', 'defense', 'escape'),
        },
      ],
    },
    {
      id: '22222222-2222-2222-2222-222222222227',
      position: 'side-control',
      track: 'offense',
      title: 'Side Control - Offense',
      description: 'Top side control pressure, isolation, and attack entries.',
      orderIndex: 6,
      lessons: [
        {
          id: '33333333-3333-3333-3333-333333333341',
          title: 'Crossface and Hip Control Basics',
          description: 'Establish control points that prevent escapes and open positional attacks.',
          orderIndex: 1,
          accessLevel: AccessLevel.FREE,
          muxPlaybackId: 'seedscdoff601',
          tags: buildFundamentalsTags('side-control', 'offense', 'control'),
        },
        {
          id: '33333333-3333-3333-3333-333333333342',
          title: 'Americana Isolation Sequence',
          description: 'Build arm isolation from side control and chain finishing details under resistance.',
          orderIndex: 2,
          accessLevel: AccessLevel.PAID,
          muxPlaybackId: 'seedscdoff602',
          tags: buildFundamentalsTags('side-control', 'offense', 'submission'),
        },
      ],
    },
    {
      id: '22222222-2222-2222-2222-222222222228',
      position: 'back-control',
      track: 'defense',
      title: 'Back Control - Defense',
      description: 'Defensive awareness and survival to escape from controlled back positions.',
      orderIndex: 7,
      lessons: [
        {
          id: '33333333-3333-3333-3333-333333333343',
          title: 'Back Escape Hand Fighting Fundamentals',
          description: 'Use hand fighting priorities to stay safe and deny immediate submissions.',
          orderIndex: 1,
          accessLevel: AccessLevel.FREE,
          muxPlaybackId: 'seedbcddef701',
          tags: buildFundamentalsTags('back-control', 'defense', 'escape'),
        },
        {
          id: '33333333-3333-3333-3333-333333333344',
          title: 'Shoulder Escape to Half Guard',
          description: 'Create shoulder angle and clear hooks to recover safer half guard positions.',
          orderIndex: 2,
          accessLevel: AccessLevel.PAID,
          muxPlaybackId: 'seedbcddef702',
          tags: buildFundamentalsTags('back-control', 'defense', 'escape'),
        },
      ],
    },
    {
      id: '22222222-2222-2222-2222-222222222229',
      position: 'back-control',
      track: 'offense',
      title: 'Back Control - Offense',
      description: 'Offensive control and finishing chains from dominant back positions.',
      orderIndex: 8,
      lessons: [
        {
          id: '33333333-3333-3333-3333-333333333345',
          title: 'Seatbelt and Hook Control Basics',
          description: 'Establish stable control from the back before progressing to attack chains.',
          orderIndex: 1,
          accessLevel: AccessLevel.FREE,
          muxPlaybackId: 'seedbcdoff801',
          tags: buildFundamentalsTags('back-control', 'offense', 'control'),
        },
        {
          id: '33333333-3333-3333-3333-333333333346',
          title: 'Rear Naked Choke Finishing Details',
          description: 'Refine choking mechanics and grip transitions to finish from back control.',
          orderIndex: 2,
          accessLevel: AccessLevel.PAID,
          muxPlaybackId: 'seedbcdoff802',
          tags: buildFundamentalsTags('back-control', 'offense', 'submission'),
        },
      ],
    },
  ],
};
