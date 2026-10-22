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
  start: number;
  color: string;
}

export const PLAN: PlanItem[] = [
  { name: 'Push-ups', unit: 'reps', step: 1, start: 20, color: '#ff4f7b' },
  { name: 'Squats', unit: 'reps', step: 1, start: 20, color: '#9b6bff' },
  { name: 'Crunches', unit: 'reps', step: 1, start: 20, color: '#ffb81c' },
  { name: 'Run', unit: 'km', step: 0.1, start: 2, color: '#18c5e8' },
];

export const CONFIG = {
  // Keys kept from the app's first name so data saved before the rename keeps loading. Do not change.
  storageKey: 'rotation-tracker-v1',
  snapshotKey: 'rotation-tracker-v1-snaps',
  installDismissedKey: 'wt-install-dismissed',

  maxSnapshots: 6, // automatic undo points kept before each change
  backupNagDays: 7, // banner after this many days without a backup
  historyPageSize: 120, // history rows shown before "Show all"
  heatmapWeeks: 12,
  fallbackColor: '#ff4f7b',

  chart: { width: 320, height: 150, padLeft: 36, padRight: 10, padTop: 12, padBottom: 22, maxPoints: 120, dotsUpTo: 60 },
};

export const colorOf = (name: string): string => PLAN.find((p) => p.name === name)?.color ?? CONFIG.fallbackColor;
