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
}

export interface Settings {
  nextId: number;
  streakSeed: { days: number; endDate: string } | null;
  lastBackup: number | null;
}

export interface State {
  version: 1;
  exercises: Exercise[];
  log: LogEntry[];
  settings: Settings;
}

/** A log entry with the target it was measured against. */
export interface EnrichedEntry extends LogEntry {
  name: string;
  unit: string;
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
  count: number;
  future: boolean;
}

export interface OnboardingRow {
  name: string;
  unit?: string;
  start: number | string;
  step?: number | string;
  lifetime?: number | string;
  backlog?: number | string;
}
