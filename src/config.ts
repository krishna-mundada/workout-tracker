// The one file to edit when the routine or the app's tuning changes.

/**
 * The routine. Order is the rotation order.
 *   step  - increase each time that exercise is completed (reps, km, whatever the unit is)
 *   start - only the default shown on the first-run screen
 *   color - tags the exercise across the whole app
 * Adding a line here changes the first-run screen. For data that already exists on a device,
 * a new exercise also needs adding to the saved state (see README, "Changing the routine").
 */
export interface PlanItem {
  name: string;
  unit: string;
  step: number;
  /** Stepper size when adding a set. */
  setStep: number;
  start: number;
  color: string;
  /** Ask for a duration and show pace (minutes per unit). */
  tracksTime?: boolean;
}

export const PLAN: PlanItem[] = [
  { name: 'Push-ups', unit: 'reps', step: 1, setStep: 5, start: 20, color: '#ff4f7b' },
  { name: 'Squats', unit: 'reps', step: 1, setStep: 5, start: 20, color: '#9b6bff' },
  { name: 'Crunches', unit: 'reps', step: 1, setStep: 5, start: 20, color: '#ffb81c' },
  { name: 'Run', unit: 'km', step: 0.1, setStep: 0.5, start: 2, color: '#18c5e8', tracksTime: true },
];

export const CONFIG = {
  // Keys kept from the app's first name so data saved before the rename keeps loading. Do not change.
  storageKey: 'rotation-tracker-v1',
  snapshotKey: 'rotation-tracker-v1-snaps',
  installDismissedKey: 'wt-install-dismissed',
  themeKey: 'wt-theme',

  maxSnapshots: 6, // automatic undo points kept before each change
  streakWarnHour: 18, // local hour after which an unlogged day warns about the streak
  backupNagDays: 7, // banner after this many days without a backup
  historyPageSize: 120, // history rows shown before "Show all"
  heatmapWeeks: 12,
  fallbackColor: '#ff4f7b',

  chart: { width: 320, height: 150, padLeft: 36, padRight: 10, padTop: 12, padBottom: 22, maxPoints: 120, dotsUpTo: 60 },
};

export const tracksTime = (name: string): boolean => PLAN.find((p) => p.name === name)?.tracksTime === true;

export const colorOf = (name: string): string => PLAN.find((p) => p.name === name)?.color ?? CONFIG.fallbackColor;

/** Public values only (the publishable key is safe in the browser; row-level security guards the data). */
export const CLOUD = {
  url: 'https://jkqfmeiuwlhtvelxllfu.supabase.co',
  publishableKey: 'sb_publishable_SLkrLcFMbTvxfShg2mrGDg_EcTvqY0P',
  vapidPublicKey: 'BLLSB4yxKbdVcNqEnPi8pJd9vebDebbTzPDV1Y44MO3VowE70_49SWaIhoZaVqFJH6mO7lZYXmTixlzCO1bdvAk',
  dirtyKey: 'wt-sync-dirty',
  remoteTsKey: 'wt-sync-remote-ts',
  lastSyncKey: 'wt-sync-last',
  remindHourKey: 'wt-remind-hour',
  pushDelayMs: 1500, // wait this long after a change before uploading
  reminderHours: [17, 18, 19, 20, 21],
  defaultReminderHour: 19,
};
