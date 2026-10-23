// Things worth cheering about after a session. Pure: compares the state before and after.
import * as T from './logic';
import type { LogEntry, State } from './types';

export interface Milestone {
  icon: string;
  title: string;
  text: string;
}

const REP_TOTALS = [100, 250, 500, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000, 15000, 20000];
const KM_TOTALS = [10, 25, 50, 100, 250, 500, 750, 1000, 1500, 2000];
const STREAKS = [3, 7, 14, 21, 30, 50, 75, 100, 150, 200, 365];

const crossed = (list: number[], before: number, after: number): number | null => {
  const hit = list.filter((t) => before < t && after >= t);
  return hit.length ? (hit[hit.length - 1] as number) : null;
};

/** Cheers for finishing `entry`. Biggest first. `before` and `after` are the states either side of it. */
export function detectMilestones(before: State, after: State, entry: LogEntry, today: string): Milestone[] {
  const out: Milestone[] = [];
  const ex = T.getEx(after, entry.exId);
  const exBefore = T.getEx(before, entry.exId);
  if (!ex || !exBefore) return out;

  const b = T.exerciseStats(before, exBefore);
  const a = T.exerciseStats(after, ex);
  const km = ex.unit !== 'reps';

  const total = crossed(km ? KM_TOTALS : REP_TOTALS, b.total, a.total);
  if (total !== null) {
    out.push({
      icon: km ? '🏃' : '💪',
      title: `${total.toLocaleString()} ${ex.unit} of ${ex.name}!`,
      text: km ? `That's ${total.toLocaleString()} km on the road in total. Your legs are legends!` : `${total.toLocaleString()} lifetime ${ex.name.toLowerCase()}. Absolutely crushing it!`,
    });
  }

  const streak = crossed(STREAKS, T.streaks(before, today).current, T.streaks(after, today).current);
  if (streak !== null) {
    out.push({ icon: '🔥', title: `${streak}-day streak!`, text: `${streak} days in a row. You are on fire, keep it burning!` });
  }

  if (b.surplus < 0 && a.surplus >= 0) {
    out.push({ icon: '🎯', title: `${ex.name} backlog cleared!`, text: 'Back to even, or ahead. What a comeback!' });
  }

  if (b.sessions >= 3 && a.best > b.best) {
    out.push({ icon: '🏆', title: 'New personal best!', text: `${T.r(a.best)} ${ex.unit} in one go, your biggest ${ex.name.toLowerCase()} session yet!` });
  }

  if (before.log.length === 0) {
    out.push({ icon: '🎉', title: 'First session in the books!', text: 'The hardest part is starting, and you just did. Let us go!' });
  }
  return out;
}
