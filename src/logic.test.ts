import { describe, expect, it } from 'vitest';
import * as T from './logic';
import type { State } from './types';

function fresh(): State {
  const s = T.newState();
  T.setupFromOnboarding(s, {
    rows: [
      { name: 'Push-ups', unit: 'reps', step: 1, start: 20, lifetime: '1700' },
      { name: 'Squats', unit: 'reps', step: 1, start: 20 },
      { name: 'Crunches', unit: 'reps', step: 1, start: 20 },
      { name: 'Run', unit: 'km', step: 0.1, start: 2 },
    ],
    today: '2026-10-22',
  });
  return s;
}

const next = (s: State) => {
  const ex = T.nextExercise(s);
  if (!ex) throw new Error('no next exercise');
  return ex;
};
const name = (s: State) => next(s).name;
function logNext(s: State, date: string, actual?: number) {
  const ex = next(s);
  return T.logSession(s, { exId: ex.id, date, actual: actual ?? T.currentTarget(s, ex) });
}

describe('rotation and progression', () => {
  it('rotates in order and adds one step per completed session of that exercise', () => {
    const s = fresh();
    const seen: string[] = [];
    for (let i = 0; i < 9; i++) {
      const ex = next(s);
      seen.push(`${ex.name}:${T.currentTarget(s, ex)}`);
      logNext(s, T.addDays('2026-10-01', i));
    }
    expect(seen).toEqual(['Push-ups:20', 'Squats:20', 'Crunches:20', 'Run:2', 'Push-ups:21', 'Squats:21', 'Crunches:21', 'Run:2.1', 'Push-ups:22']);
  });

  it('ignores calendar gaps', () => {
    const s = fresh();
    logNext(s, '2026-10-01');
    logNext(s, '2026-10-09');
    expect(name(s)).toBe('Crunches');
  });

  it('does not let decimals drift', () => {
    const s = fresh();
    const run = s.exercises[3]!;
    for (let k = 0; k < 7; k++) T.logSession(s, { exId: run.id, date: T.addDays('2026-09-01', k), actual: 2 });
    expect(T.currentTarget(s, run)).toBe(2.7);
  });

  it('holding a session does not advance the target', () => {
    const s = fresh();
    const e = logNext(s, '2026-10-01', 15);
    T.editEntry(s, e.id, { advance: false });
    expect(T.currentTarget(s, s.exercises[0]!)).toBe(20);
  });

  it('skips a deactivated exercise without breaking the cycle', () => {
    const s = fresh();
    logNext(s, '2026-10-01');
    T.updateExercise(s, s.exercises[1]!.id, { active: false });
    expect(name(s)).toBe('Crunches');
  });

  it('onboarding keeps the cyclic order from the chosen first exercise', () => {
    const s = T.newState();
    const rows = [{ name: 'A', start: 1 }, { name: 'B', start: 1 }, { name: 'C', start: 1 }];
    T.setupFromOnboarding(s, { rows, firstRow: rows[2] });
    expect(s.exercises.map((x) => x.name)).toEqual(['C', 'A', 'B']);
  });
});

describe('backlog and totals', () => {
  it('tracks surplus and deficit against the schedule, not against what you did', () => {
    const s = fresh();
    logNext(s, '2026-10-01', 25);
    logNext(s, '2026-10-02', 18);
    const en = T.enrich(s);
    expect(en.map((e) => e.delta)).toEqual([5, -2]);
    expect(T.exerciseStats(s, s.exercises[0]!, en).surplus).toBe(5);
    expect(T.exerciseStats(s, s.exercises[1]!, en).surplus).toBe(-2);
    expect(T.currentTarget(s, s.exercises[0]!)).toBe(21);
  });

  it('lifetime total includes the opening balance', () => {
    const s = fresh();
    logNext(s, '2026-10-01', 25);
    expect(T.exerciseStats(s, s.exercises[0]!).total).toBe(1725);
  });

  it('accepts typed minus signs, including the unicode one', () => {
    const s = fresh();
    const run = s.exercises[3]!;
    T.updateExercise(s, run.id, { backlog: '−6' });
    expect(run.backlogOffset).toBe(-6);
    T.updateExercise(s, run.id, { backlog: '-6,5' });
    expect(run.backlogOffset).toBe(-6.5);
  });
});

describe('editing history', () => {
  it('deleting an entry recalculates every later target', () => {
    const s = fresh();
    const first = logNext(s, '2026-10-01');
    for (const d of ['02', '03', '04']) logNext(s, `2026-10-${d}`);
    logNext(s, '2026-10-05', 30);
    expect(T.enrich(s)[4]!.target).toBe(21);
    T.deleteEntry(s, first.id);
    expect(T.enrich(s)[3]!.target).toBe(20);
    expect(T.enrich(s)[3]!.delta).toBe(10);
  });

  it('an earlier-dated backfill slots into the right place', () => {
    const s = fresh();
    logNext(s, '2026-10-05');
    T.logSession(s, { exId: s.exercises[0]!.id, date: '2026-10-03', actual: 20 });
    const e = T.enrich(s);
    expect([e[0]!.date, e[0]!.target]).toEqual(['2026-10-03', 20]);
    expect([e[1]!.date, e[1]!.target]).toEqual(['2026-10-05', 21]);
  });

  it('changing the plan keeps old targets intact', () => {
    const s = fresh();
    logNext(s, '2026-10-01');
    for (let q = 0; q < 3; q++) logNext(s, T.addDays('2026-10-02', q));
    logNext(s, '2026-10-06');
    T.resetPlan(s, s.exercises[0]!.id, { start: 30, step: 2 });
    expect(T.currentTarget(s, s.exercises[0]!)).toBe(30);
    expect(T.enrich(s)[4]!.target).toBe(21);
    for (const d of ['07', '08', '09', '10']) logNext(s, `2026-10-${d}`);
    expect(T.currentTarget(s, s.exercises[0]!)).toBe(32);
  });
});

describe('streaks', () => {
  it('counts the seed, keeps today open, and breaks after a missed day', () => {
    const s = fresh();
    T.setStreakSeed(s, 10, '2026-10-22');
    let st = T.streaks(s, '2026-10-22');
    expect([st.current, st.todayDone]).toEqual([10, false]);
    logNext(s, '2026-10-22');
    st = T.streaks(s, '2026-10-22');
    expect([st.current, st.todayDone, st.longest]).toEqual([11, true, 11]);
    st = T.streaks(s, '2026-10-24');
    expect([st.current, st.longest]).toEqual([0, 11]);
    expect(T.streaks(s, '2026-10-23').current).toBe(11);
  });
});

describe('backup and validation', () => {
  it('round-trips through migrate and rejects bad input', () => {
    const s = fresh();
    logNext(s, '2026-10-01', 22);
    const back = T.migrate(JSON.parse(JSON.stringify(s)));
    expect(T.enrich(back)).toEqual(T.enrich(s));
    expect(() => T.migrate({ nope: 1 })).toThrow();
    expect(() => T.logSession(s, { exId: 999, actual: 5 })).toThrow();
    expect(() => T.logSession(s, { exId: s.exercises[0]!.id, actual: 'abc' })).toThrow();
    expect(() => T.deleteExercise(s, s.exercises[0]!.id)).toThrow();
  });

  it('never reuses ids after an import', () => {
    const s = fresh();
    logNext(s, '2026-10-01');
    const back = T.migrate(JSON.parse(JSON.stringify(s)));
    const added = logNext(back, '2026-10-02');
    expect(s.log.some((l) => l.id === added.id)).toBe(false);
  });
});

describe('sets in batches', () => {
  it('sums sets into one session and advances the target once', () => {
    const s = fresh();
    const id = next(s).id;
    for (const n of [20, 20, 5]) T.addSet(s, { exId: id, amount: n, date: '2026-10-01' });
    expect(T.pendingTotal(s)).toBe(45);
    const entry = T.finishSession(s, {});
    expect([entry.actual, entry.date, entry.sets]).toEqual([45, '2026-10-01', [20, 20, 5]]);
    expect(s.pending).toBeNull();
    expect(T.enrich(s)[0]!.delta).toBe(25);
    expect(name(s)).toBe('Squats');
    expect(T.currentTarget(s, s.exercises[0]!)).toBe(21);
  });

  it('removes sets, and clears the session when the last one goes', () => {
    const s = fresh();
    const id = next(s).id;
    T.addSet(s, { exId: id, amount: 10 });
    T.addSet(s, { exId: id, amount: 5 });
    T.removeSet(s, 0);
    expect(s.pending?.sets).toEqual([5]);
    T.removeSet(s, 0);
    expect(s.pending).toBeNull();
  });

  it('refuses a second exercise while sets are pending, and bad amounts', () => {
    const s = fresh();
    T.addSet(s, { exId: s.exercises[0]!.id, amount: 10 });
    expect(() => T.addSet(s, { exId: s.exercises[1]!.id, amount: 10 })).toThrow();
    expect(() => T.addSet(s, { exId: s.exercises[0]!.id, amount: 0 })).toThrow();
    expect(() => T.finishSession(T.newState())).toThrow();
  });

  it('survives a backup round trip', () => {
    const s = fresh();
    T.addSet(s, { exId: s.exercises[0]!.id, amount: 12, date: '2026-10-01' });
    const back = T.migrate(JSON.parse(JSON.stringify(s)));
    expect(back.pending).toEqual(s.pending);
    const entry = T.finishSession(T.migrate(JSON.parse(JSON.stringify(s))));
    expect(entry.actual).toBe(12);
  });
});

describe('run time, pace and period totals', () => {
  it('parses times and computes pace', () => {
    expect(T.toMinutes('28:30')).toBe(28.5);
    expect(T.toMinutes('28,5')).toBe(28.5);
    const s = fresh();
    const run = s.exercises[3]!;
    T.logSession(s, { exId: run.id, date: '2026-10-01', actual: 5, minutes: '25:00' });
    T.logSession(s, { exId: run.id, date: '2026-10-02', actual: 4, minutes: '22:00' });
    T.logSession(s, { exId: run.id, date: '2026-10-03', actual: 3 });
    const stats = T.paceStats(T.enrich(s).filter((e) => e.exId === run.id))!;
    expect(stats.timed).toBe(2);
    expect(stats.best).toBe(5); // 25/5
    expect(stats.last).toBe(5.5); // 22/4
    expect(stats.avg).toBeCloseTo(47 / 9);
    expect(() => T.logSession(s, { exId: run.id, actual: 1, minutes: 'fast' })).toThrow();
  });

  it('keeps and clears minutes through edits and backups', () => {
    const s = fresh();
    const e = T.logSession(s, { exId: s.exercises[3]!.id, date: '2026-10-01', actual: 2, minutes: 12 });
    expect(T.migrate(JSON.parse(JSON.stringify(s))).log[0]!.minutes).toBe(12);
    T.editEntry(s, e.id, { minutes: '' });
    expect(s.log[0]!.minutes).toBeUndefined();
  });

  it('totals this week (Mon-Sun), last week and this month', () => {
    const s = fresh();
    const id = s.exercises[0]!.id;
    // 2026-10-22 is a Thursday: week starts Mon 10-19, last week starts 10-12
    for (const [d, n] of [['2026-10-22', 10], ['2026-10-19', 5], ['2026-10-18', 7], ['2026-10-12', 3], ['2026-10-02', 4], ['2026-09-30', 9]] as const) {
      T.logSession(s, { exId: id, date: d, actual: n });
    }
    expect(T.periodTotals(s.log, id, '2026-10-22')).toEqual({ week: 15, lastWeek: 10, month: 29 });
  });
});
