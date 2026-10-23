// Shared data shapes. state is plain JSON so it can be saved, exported and diffed.

export interface Cycle {
  n: number;
  start: number;
  step: number;
  from: string | null;
}

export interface Exercise {
  id: number;
  name: string;
  unit: string;
  active: boolean;
  color: string;
  /** Stepper size when adding a set. */
  setStep: number;
  /** One-tap set sizes on the Today screen. */
  quickSets: number[];
  /** Ask for a duration and show pace. */
  tracksTime: boolean;
  lifetimeOffset: number;
  backlogOffset: number;
  /** Plan versions; the last one is live. */
  cycles: Cycle[];
}

export interface LogEntry {
  id: number;
  date: string; // YYYY-MM-DD, local
  exId: number;
  cycle: number;
  actual: number;
  advance: boolean;
  note: string;
  ts: number;
  /** The individual sets, when the session was logged in batches. */
  sets?: number[];
  /** Duration in minutes, for exercises that track time (runs). */
  minutes?: number;
}

export interface Settings {
  nextId: number;
  streakSeed: { days: number; endDate: string } | null;
  lastBackup: number | null;
  /** Days marked as rest: they keep the streak alive without a session. */
  restDays: string[];
}

/** A session being built up set by set. It becomes a log entry when finished. */
export interface PendingSession {
  exId: number;
  date: string;
  sets: number[];
}

export interface State {
  version: 1;
  exercises: Exercise[];
  log: LogEntry[];
  settings: Settings;
  pending: PendingSession | null;
}

/** A log entry with the target it was measured against. */
export interface EnrichedEntry extends LogEntry {
  name: string;
  unit: string;
  color: string;
  target: number;
  delta: number;
}

export interface ExerciseStats {
  entries: EnrichedEntry[];
  sessions: number;
  total: number;
  surplus: number;
  best: number;
  target: number;
  step: number;
  cycleNo: number;
  last: EnrichedEntry | null;
}

export interface Streaks {
  current: number;
  longest: number;
  activeDays: number;
  todayDone: boolean;
  daysSinceLast: number | null;
}

export interface GridCell {
  date: string;
  done: boolean;
  rest: boolean;
  count: number;
  future: boolean;
}

