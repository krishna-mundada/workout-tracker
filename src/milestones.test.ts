import { describe, expect, it } from 'vitest';
import * as T from './logic';
import { detectMilestones } from './milestones';

function setup() {
  const s = T.newState();
  T.setupFromOnboarding(s, {
    rows: [
      { name: 'Push-ups', unit: 'reps', step: 1, start: 20, lifetime: '990' },
      { name: 'Run', unit: 'km', step: 0.1, start: 2, backlog: '-1' },
    ],
    today: '2026-10-22',
  });
  return s;
}

function finish(s: ReturnType<typeof setup>, exId: number, amount: number, date: string) {
  const before = structuredClone(s);
  const entry = T.logSession(s, { exId, actual: amount, date });
  return detectMilestones(before, s, entry, date);
}

describe('milestones', () => {
  it('cheers when a lifetime total crosses a round number', () => {
    const s = setup();
    const cheers = finish(s, s.exercises[0]!.id, 20, '2026-10-22');
    expect(cheers.map((m) => m.title)).toContain('1,000 reps of Push-ups!');
  });

  it('cheers a cleared backlog', () => {
    const s = setup();
    const run = s.exercises[1]!;
    const cheers = finish(s, run.id, 3.5, '2026-10-22');
    expect(cheers.some((m) => m.title.includes('backlog cleared'))).toBe(true);
  });

  it('cheers streak milestones', () => {
    const s = setup();
    T.setStreakSeed(s, 6, '2026-10-22');
    const cheers = finish(s, s.exercises[0]!.id, 20, '2026-10-22');
    expect(cheers.some((m) => m.title === '7-day streak!')).toBe(true);
  });

  it('stays quiet on an ordinary session', () => {
    const s = setup();
    finish(s, s.exercises[0]!.id, 20, '2026-10-01');
    const cheers = finish(s, s.exercises[1]!.id, 2, '2026-10-02');
    expect(cheers.filter((m) => m.title.startsWith('New personal'))).toEqual([]);
  });
});
