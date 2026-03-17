import { AccessLevel, Discipline, VideoProvider } from '@prisma/client';
import type {
  CurriculumDiscipline,
  CurriculumLevel,
  CurriculumMetadata,
} from '@diaz/shared';

type LessonSeed = {
  id: string;
  title: string;
  description: string;
  orderIndex: number;
  accessLevel: AccessLevel;
  videoProvider: VideoProvider;
  muxPlaybackId?: string | null;
  youtubeVideoId?: string | null;
  durationSeconds: number;
  curriculum: CurriculumMetadata;
};

type CourseSeed = {
  id: string;
  title: string;
  description: string;
  orderIndex: number;
  lessons: LessonSeed[];
};

export type ProgramSeed = {
  id: string;
  title: string;
  description: string;
  orderIndex: number;
  discipline: Discipline;
  isFeaturedDemo: boolean;
  isPublished: boolean;
  courses: CourseSeed[];
};

function createUuid(seed: number) {
  const head = seed.toString(16).padStart(8, '0');
  const tail = seed.toString(16).padStart(12, '0');
  return `${head}-0000-4000-8000-${tail}`;
}

function createIdGenerator(start: number) {
  let current = start;
  return () => createUuid(current++);
}

type LessonSpec = Omit<LessonSeed, 'id' | 'orderIndex' | 'curriculum'> & {
  skill?: string;
  level: CurriculumLevel;
};

type CourseSpec = {
  title: string;
  description: string;
  track: string;
  lessons: LessonSpec[];
};

function buildProgram(options: {
  id: string;
  title: string;
  description: string;
  orderIndex: number;
  discipline: Discipline;
  disciplineSlug: CurriculumDiscipline;
  phase: string;
  isFeaturedDemo?: boolean;
  courseStartSeed: number;
  lessonStartSeed: number;
  courses: CourseSpec[];
}): ProgramSeed {
  const nextCourseId = createIdGenerator(options.courseStartSeed);
  const nextLessonId = createIdGenerator(options.lessonStartSeed);

  return {
    id: options.id,
    title: options.title,
    description: options.description,
    orderIndex: options.orderIndex,
    discipline: options.discipline,
    isFeaturedDemo: options.isFeaturedDemo ?? false,
    isPublished: true,
    courses: options.courses.map((course, courseIndex) => ({
      id: nextCourseId(),
      title: course.title,
      description: course.description,
      orderIndex: courseIndex + 1,
      lessons: course.lessons.map((lesson, lessonIndex) => ({
        id: nextLessonId(),
        title: lesson.title,
        description: lesson.description,
        orderIndex: lessonIndex + 1,
        accessLevel: lesson.accessLevel,
        videoProvider: lesson.videoProvider,
        muxPlaybackId: lesson.muxPlaybackId ?? null,
        youtubeVideoId: lesson.youtubeVideoId ?? null,
        durationSeconds: lesson.durationSeconds,
        curriculum: {
          discipline: options.disciplineSlug,
          phase: options.phase,
          track: course.track,
          ...(lesson.skill ? { skill: lesson.skill } : {}),
          level: lesson.level,
        },
      })),
    })),
  };
}

export const bjjFundamentalsProgramId = '11111111-1111-1111-1111-111111111111';

// These IDs stay stable because seeded demo routes and review walkthroughs reference them directly.
export const bjjFundamentalsProgram: ProgramSeed = {
  id: bjjFundamentalsProgramId,
  title: 'BJJ Fundamentals',
  description: 'Positional fundamentals organized into clear defensive and offensive tracks for guided progression.',
  orderIndex: 1,
  discipline: Discipline.BJJ,
  isFeaturedDemo: false,
  isPublished: true,
  courses: [
    {
      id: '22222222-2222-2222-2222-222222222222',
      title: 'Guard Retention - Defense',
      description: 'Frames, hip movement, and early recovery habits for preserving guard under pressure.',
      orderIndex: 1,
      lessons: [
        {
          id: '33333333-3333-3333-3333-333333333331',
          title: 'Frame Fundamentals',
          description: 'Build foundational frames to deny immediate guard passes and create recovery space.',
          orderIndex: 1,
          accessLevel: AccessLevel.FREE,
          videoProvider: VideoProvider.MUX,
          muxPlaybackId: 'seedgrddef101',
          durationSeconds: 540,
          curriculum: {
            discipline: 'bjj',
            phase: 'fundamentals',
            track: 'guard-retention-defense',
            skill: 'retention',
            level: 'core',
          },
        },
        {
          id: '33333333-3333-3333-3333-333333333332',
          title: 'Hip Escape Recovery Chain',
          description: 'Use coordinated hip escapes and angle changes to recover guard under pressure.',
          orderIndex: 2,
          accessLevel: AccessLevel.PAID,
          videoProvider: VideoProvider.MUX,
          muxPlaybackId: 'seedgrddef102',
          durationSeconds: 620,
          curriculum: {
            discipline: 'bjj',
            phase: 'fundamentals',
            track: 'guard-retention-defense',
            skill: 'escape',
            level: 'core',
          },
        },
      ],
    },
    {
      id: '22222222-2222-2222-2222-222222222223',
      title: 'Guard Retention - Offense',
      description: 'Turn stable guard retention into sweeps, attacks, and threatening inside position.',
      orderIndex: 2,
      lessons: [
        {
          id: '33333333-3333-3333-3333-333333333333',
          title: 'Inside Position Entry from Guard',
          description: 'Convert stable retention into inside position for immediate offensive threats.',
          orderIndex: 1,
          accessLevel: AccessLevel.FREE,
          videoProvider: VideoProvider.MUX,
          muxPlaybackId: 'seedgrdoff201',
          durationSeconds: 510,
          curriculum: {
            discipline: 'bjj',
            phase: 'fundamentals',
            track: 'guard-retention-offense',
            skill: 'transition',
            level: 'core',
          },
        },
        {
          id: '33333333-3333-3333-3333-333333333334',
          title: 'Retention to Triangle Entry',
          description: 'Chain retention cues directly into a high-percentage triangle setup.',
          orderIndex: 2,
          accessLevel: AccessLevel.PAID,
          videoProvider: VideoProvider.MUX,
          muxPlaybackId: 'seedgrdoff202',
          durationSeconds: 580,
          curriculum: {
            discipline: 'bjj',
            phase: 'fundamentals',
            track: 'guard-retention-offense',
            skill: 'submission',
            level: 'core',
          },
        },
      ],
    },
    {
      id: '22222222-2222-2222-2222-222222222224',
      title: 'Guard Passing - Defense',
      description: 'Recognize and recover from common top pressure passing sequences.',
      orderIndex: 3,
      lessons: [
        {
          id: '33333333-3333-3333-3333-333333333335',
          title: 'Early Pass Defense Frames',
          description: 'Recognize passing entries early and reinforce frame structure before pressure settles.',
          orderIndex: 1,
          accessLevel: AccessLevel.FREE,
          videoProvider: VideoProvider.MUX,
          muxPlaybackId: 'seedgpsdef301',
          durationSeconds: 505,
          curriculum: {
            discipline: 'bjj',
            phase: 'fundamentals',
            track: 'guard-passing-defense',
            skill: 'escape',
            level: 'core',
          },
        },
        {
          id: '33333333-3333-3333-3333-333333333336',
          title: 'Re-Guard vs Knee Cut Pressure',
          description: 'Recover guard from knee cut passing chains with timing-based counters.',
          orderIndex: 2,
          accessLevel: AccessLevel.PAID,
          videoProvider: VideoProvider.MUX,
          muxPlaybackId: 'seedgpsdef302',
          durationSeconds: 610,
          curriculum: {
            discipline: 'bjj',
            phase: 'fundamentals',
            track: 'guard-passing-defense',
            skill: 'retention',
            level: 'core',
          },
        },
      ],
    },
    {
      id: '22222222-2222-2222-2222-222222222225',
      title: 'Guard Passing - Offense',
      description: 'Pressure-based passing structure for breaking alignment and stabilizing top position.',
      orderIndex: 4,
      lessons: [
        {
          id: '33333333-3333-3333-3333-333333333337',
          title: 'Knee Cut Passing Fundamentals',
          description: 'Learn clean entries, angle control, and pressure lines for a reliable knee cut pass.',
          orderIndex: 1,
          accessLevel: AccessLevel.FREE,
          videoProvider: VideoProvider.MUX,
          muxPlaybackId: 'seedgpsoff401',
          durationSeconds: 550,
          curriculum: {
            discipline: 'bjj',
            phase: 'fundamentals',
            track: 'guard-passing-offense',
            skill: 'passing',
            level: 'core',
          },
        },
        {
          id: '33333333-3333-3333-3333-333333333338',
          title: 'Body Lock Pass to Side Control',
          description: 'Connect body lock pressure to stable side control with proper hip and shoulder control.',
          orderIndex: 2,
          accessLevel: AccessLevel.PAID,
          videoProvider: VideoProvider.MUX,
          muxPlaybackId: 'seedgpsoff402',
          durationSeconds: 645,
          curriculum: {
            discipline: 'bjj',
            phase: 'fundamentals',
            track: 'guard-passing-offense',
            skill: 'passing',
            level: 'core',
          },
        },
      ],
    },
    {
      id: '22222222-2222-2222-2222-222222222226',
      title: 'Side Control - Defense',
      description: 'Survival structure and escape layers from bottom side control.',
      orderIndex: 5,
      lessons: [
        {
          id: '33333333-3333-3333-3333-333333333339',
          title: 'Bottom Frames from Side Control',
          description: 'Apply frame placement and elbow alignment to prevent flattening under top pressure.',
          orderIndex: 1,
          accessLevel: AccessLevel.FREE,
          videoProvider: VideoProvider.MUX,
          muxPlaybackId: 'seedscddef501',
          durationSeconds: 525,
          curriculum: {
            discipline: 'bjj',
            phase: 'fundamentals',
            track: 'side-control-defense',
            skill: 'escape',
            level: 'core',
          },
        },
        {
          id: '33333333-3333-3333-3333-333333333340',
          title: 'Underhook Escape to Guard',
          description: 'Use the underhook line to create elevation and recover guard efficiently.',
          orderIndex: 2,
          accessLevel: AccessLevel.PAID,
          videoProvider: VideoProvider.MUX,
          muxPlaybackId: 'seedscddef502',
          durationSeconds: 605,
          curriculum: {
            discipline: 'bjj',
            phase: 'fundamentals',
            track: 'side-control-defense',
            skill: 'escape',
            level: 'core',
          },
        },
      ],
    },
    {
      id: '22222222-2222-2222-2222-222222222227',
      title: 'Side Control - Offense',
      description: 'Top side control pressure, isolation, and finishing entries.',
      orderIndex: 6,
      lessons: [
        {
          id: '33333333-3333-3333-3333-333333333341',
          title: 'Crossface and Hip Control Basics',
          description: 'Establish top control points that prevent escapes and open positional attacks.',
          orderIndex: 1,
          accessLevel: AccessLevel.FREE,
          videoProvider: VideoProvider.MUX,
          muxPlaybackId: 'seedscdoff601',
          durationSeconds: 500,
          curriculum: {
            discipline: 'bjj',
            phase: 'fundamentals',
            track: 'side-control-offense',
            skill: 'control',
            level: 'core',
          },
        },
        {
          id: '33333333-3333-3333-3333-333333333342',
          title: 'Americana Isolation Sequence',
          description: 'Build arm isolation from side control and chain finishing details under resistance.',
          orderIndex: 2,
          accessLevel: AccessLevel.PAID,
          videoProvider: VideoProvider.MUX,
          muxPlaybackId: 'seedscdoff602',
          durationSeconds: 640,
          curriculum: {
            discipline: 'bjj',
            phase: 'fundamentals',
            track: 'side-control-offense',
            skill: 'submission',
            level: 'core',
          },
        },
      ],
    },
    {
      id: '22222222-2222-2222-2222-222222222228',
      title: 'Back Control - Defense',
      description: 'Defensive awareness and recovery from controlled back positions.',
      orderIndex: 7,
      lessons: [
        {
          id: '33333333-3333-3333-3333-333333333343',
          title: 'Back Escape Hand Fighting Fundamentals',
          description: 'Use hand fighting priorities to stay safe and deny immediate submissions.',
          orderIndex: 1,
          accessLevel: AccessLevel.FREE,
          videoProvider: VideoProvider.MUX,
          muxPlaybackId: 'seedbcddef701',
          durationSeconds: 515,
          curriculum: {
            discipline: 'bjj',
            phase: 'fundamentals',
            track: 'back-control-defense',
            skill: 'escape',
            level: 'core',
          },
        },
        {
          id: '33333333-3333-3333-3333-333333333344',
          title: 'Shoulder Escape to Half Guard',
          description: 'Create shoulder angle and clear hooks to recover safer half guard positions.',
          orderIndex: 2,
          accessLevel: AccessLevel.PAID,
          videoProvider: VideoProvider.MUX,
          muxPlaybackId: 'seedbcddef702',
          durationSeconds: 590,
          curriculum: {
            discipline: 'bjj',
            phase: 'fundamentals',
            track: 'back-control-defense',
            skill: 'escape',
            level: 'core',
          },
        },
      ],
    },
    {
      id: '22222222-2222-2222-2222-222222222229',
      title: 'Back Control - Offense',
      description: 'Control and submission chains from dominant back positions.',
      orderIndex: 8,
      lessons: [
        {
          id: '33333333-3333-3333-3333-333333333345',
          title: 'Seatbelt and Hook Control Basics',
          description: 'Establish stable control from the back before progressing to attack chains.',
          orderIndex: 1,
          accessLevel: AccessLevel.FREE,
          videoProvider: VideoProvider.MUX,
          muxPlaybackId: 'seedbcdoff801',
          durationSeconds: 520,
          curriculum: {
            discipline: 'bjj',
            phase: 'fundamentals',
            track: 'back-control-offense',
            skill: 'control',
            level: 'core',
          },
        },
        {
          id: '33333333-3333-3333-3333-333333333346',
          title: 'Rear Naked Choke Finishing Details',
          description: 'Refine choking mechanics and grip transitions to finish from back control.',
          orderIndex: 2,
          accessLevel: AccessLevel.PAID,
          videoProvider: VideoProvider.MUX,
          muxPlaybackId: 'seedbcdoff802',
          durationSeconds: 655,
          curriculum: {
            discipline: 'bjj',
            phase: 'fundamentals',
            track: 'back-control-offense',
            skill: 'submission',
            level: 'core',
          },
        },
      ],
    },
  ],
};

const muayThaiProgram = buildProgram({
  id: createUuid(6000),
  title: 'Muay Thai Foundations',
  description: 'A representative demo syllabus for stance, striking, defense, and combination work.',
  orderIndex: 2,
  discipline: Discipline.MUAY_THAI,
  disciplineSlug: 'muay-thai',
  phase: 'foundations',
  courseStartSeed: 6100,
  lessonStartSeed: 6200,
  courses: [
    {
      title: 'Stance, Guard & Footwork',
      description: 'Base posture, balance, and movement habits that support every striking exchange.',
      track: 'stance-guard-footwork',
      lessons: [
        { title: 'Fighting Stance Setup', description: 'Build a stable, mobile stance with relaxed shoulders and clean weight distribution.', accessLevel: AccessLevel.FREE, videoProvider: VideoProvider.NONE, durationSeconds: 430, skill: 'balance', level: 'intro' },
        { title: 'Guard Position and Elbow Line', description: 'Align your guard so it protects while still allowing clean punching and defense.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 520, skill: 'defense', level: 'core' },
        { title: 'Step and Slide Footwork', description: 'Move forward, back, and off line without crossing your feet or losing balance.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 545, skill: 'balance', level: 'core' },
        { title: 'Pivot and Exit Timing', description: 'Layer pivots and angle exits into simple movement patterns for cleaner resets.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 600, skill: 'timing', level: 'advanced' },
      ],
    },
    {
      title: 'Straight Punches & Returns',
      description: 'Jab-cross structure, return lines, and early defensive responsibility after striking.',
      track: 'straight-punches-and-returns',
      lessons: [
        { title: 'Jab Mechanics from Guard', description: 'Drive a straight jab without compromising stance or defensive coverage.', accessLevel: AccessLevel.FREE, videoProvider: VideoProvider.NONE, durationSeconds: 460, skill: 'timing', level: 'intro' },
        { title: 'Cross Alignment and Hip Rotation', description: 'Use hip and shoulder rotation to produce straight-line power on the cross.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 530, skill: 'combination', level: 'core' },
        { title: 'Two-Beat Return to Guard', description: 'Recover safely after punches so your defense resets before the counter arrives.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 560, skill: 'defense', level: 'core' },
        { title: 'Jab-Cross-Counter Rhythm', description: 'Build a simple return-counter rhythm without overextending on straight punches.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 620, skill: 'countering', level: 'advanced' },
      ],
    },
    {
      title: 'Teeps, Round Kicks & Checks',
      description: 'Long-range striking structure for push kicks, round kicks, and basic checking reactions.',
      track: 'teeps-round-kicks-and-checks',
      lessons: [
        { title: 'Lead Teep Balance Line', description: 'Use the lead teep to manage range while preserving balance and recovery posture.', accessLevel: AccessLevel.FREE, videoProvider: VideoProvider.NONE, durationSeconds: 455, skill: 'balance', level: 'intro' },
        { title: 'Rear Round Kick Chamber', description: 'Build a clean round-kick chamber and return line without falling off position.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 575, skill: 'combination', level: 'core' },
        { title: 'Basic Kick Check Timing', description: 'Recognize kick timing early and turn the shin into a reliable first defensive answer.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 540, skill: 'defense', level: 'core' },
        { title: 'Teep to Kick Transition', description: 'Use the teep to create a second beat for follow-up kicks and angle changes.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 635, skill: 'timing', level: 'advanced' },
      ],
    },
    {
      title: 'Knees, Elbows & Entry Range',
      description: 'Short-range striking entries with careful attention to range management and posture.', 
      track: 'knees-elbows-and-entry-range',
      lessons: [
        { title: 'Long Knee Entry Basics', description: 'Enter knee range cleanly without collapsing posture or exposing your head line.', accessLevel: AccessLevel.FREE, videoProvider: VideoProvider.NONE, durationSeconds: 470, skill: 'clinch-entry', level: 'intro' },
        { title: 'Horizontal Elbow Mechanics', description: 'Generate short-range elbow power while keeping your frame tight and recoverable.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 515, skill: 'combination', level: 'core' },
        { title: 'Collar Tie to Knee Timing', description: 'Use a simple collar tie to enter knees with better structure and rhythm.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 590, skill: 'clinch-entry', level: 'core' },
        { title: 'Elbow-Knee Exit Sequence', description: 'Chain short-range offense into a clean exit rather than lingering in danger range.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 650, skill: 'countering', level: 'advanced' },
      ],
    },
    {
      title: 'Defensive Shells & Counters',
      description: 'Defensive structures for covering, returning fire, and stabilizing under pressure.',
      track: 'defensive-shells-and-counters',
      lessons: [
        { title: 'High Shell Fundamentals', description: 'Use a compact shell to absorb straight-line pressure while staying ready to answer.', accessLevel: AccessLevel.FREE, videoProvider: VideoProvider.NONE, durationSeconds: 445, skill: 'defense', level: 'intro' },
        { title: 'Parry and Return Jab', description: 'Parry basic punches and answer immediately with a controlled jab return.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 530, skill: 'countering', level: 'core' },
        { title: 'Kick Catch Safety Rules', description: 'Introduce simple kick catches while staying disciplined about posture and exit routes.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 610, skill: 'timing', level: 'core' },
        { title: 'Shell to Cross Counter', description: 'Convert defensive shelling into a compact cross counter when the lane opens.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 675, skill: 'countering', level: 'advanced' },
      ],
    },
    {
      title: 'Combination Building & Pad Flow',
      description: 'Progress from isolated strikes into repeatable combinations and pad-round rhythm.',
      track: 'combination-building-and-pad-flow',
      lessons: [
        { title: 'Two-Strike Combination Basics', description: 'Build clean two-strike combinations with balance, return discipline, and timing.', accessLevel: AccessLevel.FREE, videoProvider: VideoProvider.NONE, durationSeconds: 450, skill: 'combination', level: 'intro' },
        { title: 'Punch-Kick Linking', description: 'Move from hands to kicks without freezing in the middle or overcommitting your base.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 555, skill: 'combination', level: 'core' },
        { title: 'Three-Count Pad Flow', description: 'Work a repeatable three-count flow that teaches rhythm, breathing, and control.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 605, skill: 'timing', level: 'core' },
        { title: 'Pressure-Response Combo Layer', description: 'Add a simple defensive response inside your combination flow to simulate a live round.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 690, skill: 'countering', level: 'advanced' },
      ],
    },
  ],
});

const haganahProgram = buildProgram({
  id: createUuid(7000),
  title: 'Haganah Foundations',
  description: 'A representative self-protection curriculum showing awareness, releases, and escape-first sequencing.',
  orderIndex: 3,
  discipline: Discipline.HAGANAH,
  disciplineSlug: 'haganah',
  phase: 'foundations',
  courseStartSeed: 7100,
  lessonStartSeed: 7200,
  courses: [
    {
      title: 'Ready Stance & Burst Movement',
      description: 'Build a stable ready stance, verbal boundary posture, and decisive burst movement.',
      track: 'ready-stance-and-burst-movement',
      lessons: [
        { title: 'Ready Stance Setup', description: 'Set a posture that communicates awareness while preserving movement and protection.', accessLevel: AccessLevel.FREE, videoProvider: VideoProvider.NONE, durationSeconds: 420, skill: 'awareness', level: 'intro' },
        { title: 'Hands-Up Boundary Cues', description: 'Use a conversational hands-up frame to create a safer starting position under pressure.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 500, skill: 'awareness', level: 'core' },
        { title: 'Burst Step to Safe Angle', description: 'Explode off line and create an immediate safe angle instead of backing straight up.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 560, skill: 'burst-entry', level: 'core' },
        { title: 'Reset After the Exit', description: 'Recover, scan, and stabilize after the initial burst so the sequence does not stop too early.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 620, skill: 'awareness', level: 'advanced' },
      ],
    },
    {
      title: 'Striking Under Pressure',
      description: 'Simple gross-motor striking responses that prioritize disruption and escape opportunities.',
      track: 'striking-under-pressure',
      lessons: [
        { title: 'Palm Strike Line', description: 'Build a direct palm-strike line from the ready stance without winding up or freezing.', accessLevel: AccessLevel.FREE, videoProvider: VideoProvider.NONE, durationSeconds: 430, skill: 'burst-entry', level: 'intro' },
        { title: 'Elbow and Cover Response', description: 'Use a short elbow line with immediate cover when the space collapses suddenly.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 525, skill: 'threat-management', level: 'core' },
        { title: 'Burst-Strike-Exit Sequence', description: 'Disrupt, create a path, and leave rather than staying in a prolonged exchange.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 585, skill: 'escape-priority', level: 'core' },
        { title: 'Multiple-Strike Pressure Drill', description: 'Layer brief repeated strikes into an exit-focused response under close pressure.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 645, skill: 'threat-management', level: 'advanced' },
      ],
    },
    {
      title: 'Wrist Releases & Clothing Grabs',
      description: 'Release-first responses to common grips before transitioning to escape and movement.',
      track: 'wrist-releases-and-clothing-grabs',
      lessons: [
        { title: 'Single Wrist Release Basics', description: 'Use angle and weak-line mechanics to strip a single wrist grab quickly.', accessLevel: AccessLevel.FREE, videoProvider: VideoProvider.NONE, durationSeconds: 415, skill: 'release', level: 'intro' },
        { title: 'Two-Hand Clothing Grab Response', description: 'Break a frontal clothing grab and reestablish movement without stalling in place.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 505, skill: 'release', level: 'core' },
        { title: 'Release into Burst Exit', description: 'Connect the release directly into movement so the sequence does not end at separation.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 560, skill: 'burst-entry', level: 'core' },
        { title: 'Close-Range Grip Reaction Drill', description: 'Pressure-test release choices against tighter, more disruptive starting positions.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 625, skill: 'threat-management', level: 'advanced' },
      ],
    },
    {
      title: 'Front & Side Choke Responses',
      description: 'Immediate escape-priority responses to common choking threats at conversational distance.',
      track: 'front-side-choke-responses',
      lessons: [
        { title: 'Front Choke Pluck and Step', description: 'Clear the choke line and move decisively to a safer angle as fast as possible.', accessLevel: AccessLevel.FREE, videoProvider: VideoProvider.NONE, durationSeconds: 440, skill: 'escape-priority', level: 'intro' },
        { title: 'Front Choke with Pressure Response', description: 'Handle a stronger front choke entry by combining pluck mechanics with body movement.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 520, skill: 'escape-priority', level: 'core' },
        { title: 'Side Choke Frame and Turn', description: 'Use framing and rotation to recover posture and create an immediate route out.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 575, skill: 'release', level: 'core' },
        { title: 'Choke to Exit Decision Drill', description: 'Tie front and side choke responses into clear exit-focused decision making.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 650, skill: 'threat-management', level: 'advanced' },
      ],
    },
    {
      title: 'Ground Survival & Technical Stand-Up',
      description: 'Ground survival priorities centered on protection, space creation, and returning to standing.',
      track: 'ground-survival-and-technical-stand-up',
      lessons: [
        { title: 'Protective Ground Posture', description: 'Create structure on the ground that shields the head and supports movement.', accessLevel: AccessLevel.FREE, videoProvider: VideoProvider.NONE, durationSeconds: 435, skill: 'technical-stand-up', level: 'intro' },
        { title: 'Kick-Off and Frame Space', description: 'Use the legs and frames to create enough distance to start a safe recovery.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 510, skill: 'escape-priority', level: 'core' },
        { title: 'Technical Stand-Up Mechanics', description: 'Stand without crossing your base or sacrificing awareness of the threat line.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 565, skill: 'technical-stand-up', level: 'core' },
        { title: 'Ground Exit Sequence Under Pressure', description: 'Link posture, space creation, stand-up, and movement into one coherent exit.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 635, skill: 'threat-management', level: 'advanced' },
      ],
    },
    {
      title: 'Weapon Threat Principles',
      description: 'High-level principle-based responses emphasizing awareness, disruption, and escape-first thinking.',
      track: 'weapon-threat-principles',
      lessons: [
        { title: 'Threat Recognition Priorities', description: 'Identify the immediate problem, the line of danger, and the first movement goal.', accessLevel: AccessLevel.FREE, videoProvider: VideoProvider.NONE, durationSeconds: 400, skill: 'threat-management', level: 'intro' },
        { title: 'Distance and Line Management', description: 'Understand how line control and distance affect your survival options.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 495, skill: 'awareness', level: 'core' },
        { title: 'Burst and Redirect Principle Drill', description: 'Use a simple burst and redirect concept to break the problem into an exit opportunity.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 570, skill: 'burst-entry', level: 'core' },
        { title: 'Scenario Exit Framework', description: 'Frame weapon-threat responses as principle-driven scenario work rather than static choreography.', accessLevel: AccessLevel.PAID, videoProvider: VideoProvider.NONE, durationSeconds: 660, skill: 'threat-management', level: 'advanced' },
      ],
    },
  ],
});

const showcaseProgram = buildProgram({
  id: createUuid(8000),
  title: 'Instructor Showcase',
  description: 'A short, presentation-ready Haganah click-through for demonstrating the guided student experience.',
  orderIndex: 0,
  discipline: Discipline.HAGANAH,
  disciplineSlug: 'haganah',
  phase: 'foundations',
  isFeaturedDemo: true,
  courseStartSeed: 8100,
  lessonStartSeed: 8200,
  courses: [
    {
      title: 'Haganah Essentials Demo Track',
      description: 'A concise walkthrough showing how a student moves through a guided self-protection track.',
      track: 'front-side-choke-responses',
      lessons: [
        {
          title: 'Verbal Boundary and Ready Stance',
          description: 'A showcase lesson that demonstrates verbal framing, ready posture, and the opening of the student experience.',
          accessLevel: AccessLevel.FREE,
          videoProvider: VideoProvider.YOUTUBE,
          youtubeVideoId: 'M7lc1UVf-VE',
          durationSeconds: 360,
          skill: 'awareness',
          level: 'intro',
        },
        {
          title: 'Burst Movement to Exit',
          description: 'A polished demo lesson focused on decisive movement, separation, and clean exit decision making.',
          accessLevel: AccessLevel.FREE,
          videoProvider: VideoProvider.YOUTUBE,
          youtubeVideoId: 'aqz-KE-bpKQ',
          durationSeconds: 390,
          skill: 'burst-entry',
          level: 'core',
        },
        {
          title: 'Front Choke Response Flow',
          description: 'A sample guided-path lesson that closes the demo click-through with an escape-priority sequence.',
          accessLevel: AccessLevel.FREE,
          videoProvider: VideoProvider.YOUTUBE,
          youtubeVideoId: 'ysz5S6PUM-U',
          durationSeconds: 420,
          skill: 'escape-priority',
          level: 'core',
        },
      ],
    },
  ],
});

export const curriculumProgramsSeed: ProgramSeed[] = [
  showcaseProgram,
  bjjFundamentalsProgram,
  muayThaiProgram,
  haganahProgram,
];
