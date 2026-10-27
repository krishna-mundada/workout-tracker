/**
 * Workout Tracker rules. Pure functions: no DOM, no storage.
 *
 * Everything the app shows is derived from state.log, so editing or deleting
 * an entry can never leave targets, streaks or backlogs out of sync.
 *
 * state = {
 *   version: 1,
 *   exercises: [{ id, name, unit, active, lifetimeOffset, backlogOffset,
 *                 cycles: [{ n, start, step, from }] }],   // last cycle is the live plan
 *   log: [{ id, date: 'YYYY-MM-DD', exId, cycle, actual, advance, note, ts }],
 *   settings: { nextId, streakSeed: { days, endDate } | null, lastBackup: ms | null, restDays: string[] }
 * }
 *
 * Rotation order = order of state.exercises (active ones only).
 * Target = cycle.start + cycle.step * (advancing sessions already logged in that cycle).
 * Backlog = sum of (actual - target) over every session, plus an opening offset.
 *
 * Mutating functions take the state as their first argument and change it in place.
 * The store calls them on a copy, so a function that throws never half-applies.
 */

import { PALETTE, TEMPLATE } from './config';
import type { Cycle, EnrichedEntry, Exercise, ExerciseStats, GridCell, LogEntry, State, Streaks } from './types';

const DAY_MS = 86400000;

// ---------- exercise defaults ----------

export const paletteColor = (index: number): string => (PALETTE[index % PALETTE.length] as { value: string }).value;

/** Sensible set sizes for a unit, so a new exercise works without any extra setup. */
export function exerciseDefaults(unit: string, start: number): { setStep: number; quickSets: number[]; tracksTime: boolean } {
  const u = unit.trim().toLowerCase();
  if (['km', 'mi', 'mile', 'miles'].includes(u)) return { setStep: 0.5, quickSets: [1, 2, 5], tracksTime: true };
  if (u === 'reps' || u === 'rep') return { setStep: 5, quickSets: [10, 20], tracksTime: false };
  const half = Math.max(1, Math.round(start / 2));
  return { setStep: 1, quickSets: [...new Set([half, Math.max(1, Math.round(start))])], tracksTime: false };
}

// ---------- numbers and dates ----------

/** Round to 2 decimals so 0.1 steps never drift. */
export const r = (v: number): number => Math.round(v * 100) / 100;
const pad = (n: number): string => String(n).padStart(2, '0');

/** Lenient parse: accepts a decimal comma and unicode minus signs. Returns NaN when not a number. */
export function toNumber(v: unknown): number {
  return typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.').replace(/[\u2212\u2013]/g, '-'));
}
/** Minutes from "28.5", "28,5" or "28:30" (mm:ss). NaN when not a time. */
export function toMinutes(v: unknown): number {
  const str = String(v).trim();
  const m = /^(\d+):([0-5]?\d)$/.exec(str);
  return m ? Number(m[1]) + Number(m[2]) / 60 : toNumber(str);
}
function optionalMinutes(v: unknown): number | undefined {
  if (v === undefined || v === null || String(v).trim() === '') return undefined;
  const n = toMinutes(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error('Time must be like 28:30 or 28.5 minutes.');
  return r(n);
}
function requireNumber(v: unknown, label: string): number {
  const n = toNumber(v);
  if (!Number.isFinite(n)) throw new Error(`${label} must be a number.`);
  return n;
}

// Dates are 'YYYY-MM-DD' strings in local time.
export const toISO = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayISO = (now: Date = new Date()): string => toISO(now);
export const parseISO = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (iso: string, n: number): string => {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
};
export const diffDays = (a: string, b: string): number => {
  const utc = (iso: string): number => {
    const d = parseISO(iso);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  };
  return Math.round((utc(b) - utc(a)) / DAY_MS);
};
export const isISO = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parseISO(s).getTime());

// ---------- state shape ----------

export const newState = (): State => ({
  version: 1,
  exercises: [],
  log: [],
  settings: { nextId: 1, streakSeed: null, lastBackup: null, restDays: [], settledThrough: null },
  pending: null,
});

/** Validate and normalise untrusted state (saved data or an imported backup). Throws a readable error. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export function migrate(obj: any): State {
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.exercises) || !Array.isArray(obj.log)) {
    throw new Error('This does not look like a Workout Tracker backup.');
  }
  const s = newState();
  let maxId = 0;

  for (const e of obj.exercises as any[]) {
    if (!e || typeof e.id !== 'number' || !e.name || !Array.isArray(e.cycles) || !e.cycles.length) {
      throw new Error('Backup has a broken exercise entry.');
    }
    maxId = Math.max(maxId, e.id);
    const name = String(e.name);
    const unit = String(e.unit || 'reps');
    const tpl = TEMPLATE.find((t) => t.name === name);
    const cycleStart = Number(e.cycles[e.cycles.length - 1]?.start) || 1;
    const def = exerciseDefaults(unit, cycleStart);
    const quick = Array.isArray(e.quickSets) ? e.quickSets.map(Number).filter((n: number) => n > 0) : [];
    s.exercises.push({
      id: e.id,
      name,
      unit,
      active: e.active !== false,
      color: typeof e.color === 'string' && /^#[0-9a-f]{6}$/i.test(e.color) ? e.color : (tpl?.color ?? paletteColor(s.exercises.length)),
      setStep: Number(e.setStep) > 0 ? Number(e.setStep) : (tpl?.setStep ?? def.setStep),
      quickSets: quick.length ? quick : (tpl?.quickSets ?? def.quickSets),
      tracksTime: typeof e.tracksTime === 'boolean' ? e.tracksTime : (tpl?.tracksTime ?? def.tracksTime),
      lifetimeOffset: Number(e.lifetimeOffset) || 0,
      backlogOffset: Number(e.backlogOffset) || 0,
      cycles: e.cycles.map((c: any) => ({ n: Number(c.n), start: Number(c.start), step: Number(c.step), from: c.from || null })),
    });
  }

  for (const l of obj.log as any[]) {
    if (!l || typeof l.id !== 'number' || !isISO(l.date) || !Number.isFinite(Number(l.actual))) {
      throw new Error('Backup has a broken log entry.');
    }
    maxId = Math.max(maxId, l.id);
    s.log.push({
      id: l.id,
      date: l.date,
      exId: l.exId,
      cycle: Number(l.cycle) || 1,
      actual: Number(l.actual),
      advance: l.advance !== false,
      note: l.note ? String(l.note) : '',
      ts: l.ts || 0,
      ...(Array.isArray(l.sets) && l.sets.length > 1 ? { sets: l.sets.map(Number) } : {}),
      ...(Number(l.minutes) > 0 ? { minutes: Number(l.minutes) } : {}),
      ...(l.extra === true ? { extra: true } : {}),
      ...(l.auto === true ? { auto: true } : {}),
      ...(Number(l.skipFor) > 0 ? { skipFor: Number(l.skipFor) } : {}),
    });
  }

  const st = obj.settings || {};
  s.settings.nextId = Math.max(Number(st.nextId) || 1, maxId + 1);
  s.settings.lastBackup = st.lastBackup || null;
  s.settings.restDays = Array.isArray(st.restDays) ? [...new Set<string>(st.restDays.filter(isISO))].sort() : [];
  s.settings.settledThrough = isISO(st.settledThrough) ? st.settledThrough : null;
  const seed = st.streakSeed;
  s.settings.streakSeed = seed && seed.days > 0 && isISO(seed.endDate) ? { days: Number(seed.days), endDate: seed.endDate } : null;
  const p = obj.pending;
  if (p && typeof p.exId === 'number' && isISO(p.date) && Array.isArray(p.sets) && s.exercises.some((e) => e.id === p.exId)) {
    const sets = p.sets.map(Number).filter((n: number) => Number.isFinite(n) && n > 0);
    if (sets.length) s.pending = { exId: p.exId, date: p.date, sets };
  }
  return s;
}

// ---------- lookups ----------

export const getEx = (state: State, id: number): Exercise | null => state.exercises.find((e) => e.id === id) || null;
export const activeList = (state: State): Exercise[] => state.exercises.filter((e) => e.active);
export const currentCycle = (ex: Exercise): Cycle => ex.cycles[ex.cycles.length - 1];
const cycleOf = (ex: Exercise, n: number): Cycle => ex.cycles.find((c) => c.n === n) || currentCycle(ex);

/** Log entries in chronological order (date, then insertion order). */
/** Same-day order: an automatic zero sits just before the session it was passed over for. */
const sortOrder = (l: LogEntry): number => (l.skipFor ? l.skipFor - 0.5 : l.id);
export const sortedLog = (state: State): LogEntry[] =>
  [...state.log].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : sortOrder(a) - sortOrder(b)));

// ---------- derived data ----------

/** Every log entry in order, with the target it was measured against and the delta. */
export function enrich(state: State): EnrichedEntry[] {
  const counts = new Map<string, number>(); // "exId:cycle" -> advancing sessions so far
  return sortedLog(state).map((entry) => {
    const ex = getEx(state, entry.exId);
    if (!ex) return { ...entry, name: '(deleted)', unit: '', color: paletteColor(0), target: entry.actual, delta: 0 };
    if (entry.extra) return { ...entry, name: ex.name, unit: ex.unit, color: ex.color, target: 0, delta: entry.actual };
    const key = `${entry.exId}:${entry.cycle}`;
    const done = counts.get(key) || 0;
    const cycle = cycleOf(ex, entry.cycle);
    const target = r(cycle.start + cycle.step * done);
    if (entry.advance !== false) counts.set(key, done + 1);
    return { ...entry, name: ex.name, unit: ex.unit, color: ex.color, target, delta: r(entry.actual - target) };
  });
}

const advancingSessions = (state: State, ex: Exercise): number => {
  const { n } = currentCycle(ex);
  return state.log.filter((l) => l.exId === ex.id && l.cycle === n && l.advance !== false).length;
};

export function currentTarget(state: State, ex: Exercise): number {
  const { start, step } = currentCycle(ex);
  return r(start + step * advancingSessions(state, ex));
}

export function exerciseStats(state: State, ex: Exercise, enriched: EnrichedEntry[] = enrich(state)): ExerciseStats {
  const all = enriched.filter((e) => e.exId === ex.id);
  const entries = all.filter((e) => !e.extra); // real sessions: extras only move totals and backlog
  const cycle = currentCycle(ex);
  return {
    entries,
    sessions: entries.length,
    total: r(all.reduce((sum, e) => sum + e.actual, ex.lifetimeOffset || 0)),
    surplus: r(all.reduce((sum, e) => sum + e.delta, ex.backlogOffset || 0)),
    best: entries.reduce((max, e) => Math.max(max, e.actual), 0),
    target: currentTarget(state, ex),
    step: cycle.step,
    cycleNo: cycle.n,
    last: entries.length ? entries[entries.length - 1] : null,
  };
}

/** Which exercise is next in the rotation. */
// ---------- period totals and pace ----------

export interface PeriodTotals {
  week: number;
  lastWeek: number;
  month: number;
}

/** Totals for one exercise: this week (Mon-Sun), last week, and this calendar month. Opening balance excluded. */
export function periodTotals(entries: LogEntry[], exId: number, today: string): PeriodTotals {
  const weekStart = addDays(today, -((parseISO(today).getDay() + 6) % 7));
  const lastWeekStart = addDays(weekStart, -7);
  const monthStart = `${today.slice(0, 8)}01`;
  const out: PeriodTotals = { week: 0, lastWeek: 0, month: 0 };
  for (const e of entries) {
    if (e.exId !== exId || e.date > today) continue;
    if (e.date >= weekStart) out.week += e.actual;
    else if (e.date >= lastWeekStart) out.lastWeek += e.actual;
    if (e.date >= monthStart) out.month += e.actual;
  }
  return { week: r(out.week), lastWeek: r(out.lastWeek), month: r(out.month) };
}

/** Minutes per unit for one session, or null when no time was recorded. */
export const paceOf = (e: Pick<LogEntry, 'actual' | 'minutes'>): number | null => (e.minutes && e.actual > 0 ? e.minutes / e.actual : null);

export interface PaceStats {
  avg: number;
  best: number;
  last: number;
  timed: number;
}

/** Pace summary over the entries that have a time, or null when none do. */
export function paceStats(entries: LogEntry[]): PaceStats | null {
  const timed = entries.filter((e) => paceOf(e) !== null);
  if (!timed.length) return null;
  const paces = timed.map((e) => paceOf(e) as number);
  const minutes = timed.reduce((a, e) => a + (e.minutes ?? 0), 0);
  const distance = timed.reduce((a, e) => a + e.actual, 0);
  return { avg: minutes / distance, best: Math.min(...paces), last: paces[paces.length - 1] as number, timed: timed.length };
}

export function nextExercise(state: State, from: LogEntry[] = sortedLog(state)): Exercise | null {
  const active = activeList(state);
  if (!active.length) return null;
  const log = from.filter((l) => !l.extra); // extras never move the rotation
  if (!log.length) return active[0];

  const lastId = log[log.length - 1].exId;
  const idx = active.findIndex((e) => e.id === lastId);
  if (idx >= 0) return active[(idx + 1) % active.length];

  // The last-trained exercise has been switched off: carry on from its slot in the full list.
  const all = state.exercises;
  const pos = all.findIndex((e) => e.id === lastId);
  if (pos >= 0) {
    for (let i = 1; i <= all.length; i++) {
      const candidate = all[(pos + i) % all.length];
      if (candidate.active) return candidate;
    }
  }
  return active[0];
}

/** The upcoming rotation starting at the next exercise, with each target. */
export function rotationPreview(state: State, count: number): { ex: Exercise; target: number }[] {
  const active = activeList(state);
  const first = nextExercise(state);
  if (!first) return [];
  const start = active.findIndex((e) => e.id === first.id);
  return Array.from({ length: Math.min(count, active.length) }, (_, i) => {
    const ex = active[(start + i) % active.length];
    return { ex, target: currentTarget(state, ex) };
  });
}

/** Set of 'YYYY-MM-DD' days with any activity, including days covered by the setup streak. */
function trainedDates(state: State): Set<string> {
  const set = new Set<string>(state.log.filter((l) => !l.auto).map((l) => l.date));
  const seed = state.settings.streakSeed;
  if (seed && seed.days > 0) for (let i = 0; i < seed.days; i++) set.add(addDays(seed.endDate, -i));
  for (const d of state.settings.restDays) set.add(d);
  return set;
}

export function streaks(state: State, today: string): Streaks {
  const set = trainedDates(state);
  const dates = [...set].sort();

  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of dates) {
    run = prev && diffDays(prev, d) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }

  // Today not trained yet keeps the streak alive; it only breaks once a whole day is missed.
  let current = 0;
  let d = set.has(today) ? today : addDays(today, -1);
  while (set.has(d)) {
    current++;
    d = addDays(d, -1);
  }

  return {
    current,
    longest,
    activeDays: dates.length,
    todayDone: set.has(today),
    daysSinceLast: dates.length ? diffDays(dates[dates.length - 1], today) : null,
  };
}

/** Columns of 7 days (Mon..Sun), `weeks` columns, ending with the week that contains `today`. */
export function activityGrid(state: State, today: string, weeks: number): GridCell[][] {
  const set = trainedDates(state);
  const counts = new Map<string, number>();
  for (const l of state.log) if (!l.auto) counts.set(l.date, (counts.get(l.date) || 0) + 1);
  const monday = (parseISO(today).getDay() + 6) % 7;
  const start = addDays(today, -monday - (weeks - 1) * 7);
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = addDays(start, w * 7 + d);
      return { date, done: set.has(date), rest: state.settings.restDays.includes(date) && !counts.has(date), count: counts.get(date) || 0, future: date > today };
    }),
  );
}

// ---------- rest days ----------

export const isRestDay = (state: State, date: string): boolean => state.settings.restDays.includes(date);

/** Mark a day as rest so it keeps the streak going. Does not touch the rotation. */
export function markRest(state: State, date: string): void {
  if (!isISO(date)) throw new Error('Pick a valid date.');
  if (!isRestDay(state, date)) state.settings.restDays = [...state.settings.restDays, date].sort();
}

export function unmarkRest(state: State, date: string): void {
  state.settings.restDays = state.settings.restDays.filter((d) => d !== date);
}

// ---------- mutations ----------

const newId = (state: State): number => state.settings.nextId++;

export interface NewExercise {
  name: string;
  unit?: string;
  active?: boolean;
  lifetime?: number | string;
  backlog?: number | string;
  start: number | string;
  step?: number | string;
  afterId?: number | null;
  color?: string;
  setStep?: number;
  quickSets?: number[];
  tracksTime?: boolean;
}

export function addExercise(state: State, o: NewExercise): Exercise {
  const name = String(o.name || '').trim();
  if (!name) throw new Error('Give the exercise a name.');
  const unit = String(o.unit || 'reps').trim() || 'reps';
  const start = r(requireNumber(o.start, 'First target'));
  const def = exerciseDefaults(unit, start);
  const ex: Exercise = {
    id: newId(state),
    name,
    unit,
    active: o.active !== false,
    color: o.color ?? paletteColor(state.exercises.length),
    setStep: o.setStep ?? def.setStep,
    quickSets: o.quickSets?.length ? o.quickSets : def.quickSets,
    tracksTime: o.tracksTime ?? def.tracksTime,
    lifetimeOffset: o.lifetime ? requireNumber(o.lifetime, 'Total') : 0,
    backlogOffset: o.backlog ? requireNumber(o.backlog, 'Backlog') : 0,
    cycles: [{
      n: 1,
      start,
      step: r(requireNumber(o.step === undefined ? 1 : o.step, 'Step')),
      from: todayISO(),
    }],
  };
  const after = o.afterId == null ? -1 : state.exercises.findIndex((e) => e.id === o.afterId);
  state.exercises.splice(after >= 0 ? after + 1 : state.exercises.length, 0, ex);
  return ex;
}

/** Rename, change unit, switch on/off, or correct the opening totals. Blank totals mean 0. */
export interface ExercisePatch {
  name?: string;
  unit?: string;
  active?: boolean;
  color?: string;
  tracksTime?: boolean;
  lifetime?: number | string;
  backlog?: number | string;
}

export function updateExercise(state: State, id: number, o: ExercisePatch): Exercise {
  const ex = getEx(state, id);
  if (!ex) throw new Error('Exercise not found.');
  if (o.name !== undefined) {
    const name = String(o.name).trim();
    if (!name) throw new Error('Give the exercise a name.');
    ex.name = name;
  }
  if (o.unit !== undefined) ex.unit = String(o.unit).trim() || 'reps';
  if (o.active !== undefined) ex.active = Boolean(o.active);
  if (o.color !== undefined) ex.color = o.color;
  if (o.tracksTime !== undefined) ex.tracksTime = Boolean(o.tracksTime);
  if (o.lifetime !== undefined) ex.lifetimeOffset = o.lifetime === '' ? 0 : requireNumber(o.lifetime, 'Total');
  if (o.backlog !== undefined) ex.backlogOffset = o.backlog === '' ? 0 : requireNumber(o.backlog, 'Backlog');
  return ex;
}

/** Change the plan going forward. Past entries keep the targets from the plan they were logged under. */
export function resetPlan(state: State, id: number, o: { start: number | string; step: number | string }): Exercise {
  const ex = getEx(state, id);
  if (!ex) throw new Error('Exercise not found.');
  const start = r(requireNumber(o.start, 'Next target'));
  const step = r(requireNumber(o.step, 'Step'));
  const cycle = currentCycle(ex);
  const hasHistory = state.log.some((l) => l.exId === id && l.cycle === cycle.n);
  if (hasHistory) ex.cycles.push({ n: cycle.n + 1, start, step, from: todayISO() });
  else Object.assign(cycle, { start, step }); // nothing logged on this plan yet, just edit it
  return ex;
}

export function moveExercise(state: State, id: number, dir: -1 | 1): void {
  const i = state.exercises.findIndex((e) => e.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= state.exercises.length) return;
  [state.exercises[i], state.exercises[j]] = [state.exercises[j], state.exercises[i]];
}

export function deleteExercise(state: State, id: number): void {
  if (state.log.some((l) => l.exId === id)) throw new Error('This exercise has history. Switch it off instead of deleting it.');
  state.exercises = state.exercises.filter((e) => e.id !== id);
}

export interface SessionInput {
  exId: number;
  actual: number | string;
  date?: string;
  advance?: boolean;
  note?: string;
  minutes?: number | string;
}

export function logSession(state: State, { exId, actual, date, advance, note, minutes }: SessionInput): LogEntry {
  const ex = getEx(state, exId);
  if (!ex) throw new Error('Exercise not found.');
  const amount = requireNumber(actual, 'Amount');
  if (amount < 0) throw new Error('Amount cannot be negative.');
  const day = date || todayISO();
  if (!isISO(day)) throw new Error('Pick a valid date.');
  const entry: LogEntry = {
    id: newId(state),
    date: day,
    exId: ex.id,
    cycle: currentCycle(ex).n,
    actual: r(amount),
    advance: advance !== false,
    note: note ? String(note).slice(0, 200) : '',
    ts: Date.now(),
  };
  const mins = optionalMinutes(minutes);
  if (mins !== undefined) entry.minutes = mins;
  state.log.push(entry);
  return entry;
}

// ---------- sets (logging a session in batches) ----------

export const pendingTotal = (state: State): number => r((state.pending?.sets ?? []).reduce((a, b) => a + b, 0));

/** Add one set to the session in progress, starting it if needed. */
export function addSet(state: State, { exId, amount, date }: { exId: number; amount: number | string; date?: string }): void {
  if (!getEx(state, exId)) throw new Error('Exercise not found.');
  const n = requireNumber(amount, 'Amount');
  if (n <= 0) throw new Error('A set needs more than 0.');
  if (state.pending && state.pending.exId !== exId) throw new Error('Finish or discard the sets in progress first.');
  if (!state.pending) {
    const day = date || todayISO();
    if (!isISO(day)) throw new Error('Pick a valid date.');
    state.pending = { exId, date: day, sets: [] };
  }
  state.pending.sets.push(r(n));
}

export function removeSet(state: State, index: number): void {
  const p = state.pending;
  if (!p || index < 0 || index >= p.sets.length) throw new Error('Set not found.');
  p.sets.splice(index, 1);
  if (!p.sets.length) state.pending = null;
}

export function discardSets(state: State): void {
  state.pending = null;
}

/** The exercise that was due but not done, when `entry` was trained instead (one session per day, so only that one is owed). */
function passedOver(state: State, entry: LogEntry): Exercise[] {
  const before = sortedLog(state).filter((l) => l !== entry && !l.extra && (l.date < entry.date || (l.date === entry.date && sortOrder(l) < sortOrder(entry))));
  if (!before.length) return [];
  const due = nextExercise(state, before);
  return due && due.id !== entry.exId ? [due] : [];
}

/**
 * Close out finished days. Nothing is logged until a day is over:
 *  - a day with no session counts as a zero for the exercise that was due (unless it was a rest day);
 *  - a day where another exercise was done instead gives zeros to the ones passed over.
 * The rotation then moves on regardless, and the shortfall lands in the backlog. Returns the zero sessions added.
 */
export function settleDays(state: State, today: string): LogEntry[] {
  const yesterday = addDays(today, -1);
  const done = state.settings.settledThrough;
  if (!done) {
    state.settings.settledThrough = yesterday; // never rewrite history from before this rule existed
    return [];
  }
  const added: LogEntry[] = [];
  const first = sortedLog(state).find((l) => !l.extra && !l.auto)?.date;
  if (first) {
    for (let d = addDays(done, 1); d <= yesterday; d = addDays(d, 1)) {
      const real = sortedLog(state).filter((l) => l.date === d && !l.extra && !l.auto);
      if (real.length) {
        for (const entry of real) {
          for (const ex of passedOver(state, entry)) added.push(autoZero(state, ex, d, 'Skipped, moved to backlog', entry.id));
        }
      } else if (d > first && !isRestDay(state, d)) {
        const due = nextExercise(state);
        if (due) added.push(autoZero(state, due, d, 'No session, moved to backlog'));
      }
    }
  }
  state.settings.settledThrough = yesterday;
  return added;
}

function autoZero(state: State, ex: Exercise, date: string, note: string, skipFor?: number): LogEntry {
  const entry = logSession(state, { exId: ex.id, actual: 0, date, note });
  entry.auto = true;
  if (skipFor !== undefined) entry.skipFor = skipFor;
  return entry;
}

/** Turn the sets in progress into one logged session (the sum of the sets). */
export function finishSession(state: State, { date, advance, note, minutes }: { date?: string; advance?: boolean; note?: string; minutes?: number | string } = {}): LogEntry {
  const p = state.pending;
  if (!p) throw new Error('No sets to finish.');
  const entry = logSession(state, { exId: p.exId, actual: pendingTotal(state), date: date || p.date, advance, note, minutes });
  if (p.sets.length > 1) entry.sets = [...p.sets];
  state.pending = null;
  return entry;
}

/** Extra work on any exercise, e.g. paying back a backlog. Credits the backlog; no target or rotation change. */
export function logExtra(state: State, { exId, actual, date, note }: { exId: number; actual: number | string; date?: string; note?: string }): LogEntry {
  if (requireNumber(actual, 'Amount') <= 0) throw new Error('Enter more than 0.');
  const entry = logSession(state, { exId, actual, date, note, advance: false });
  entry.extra = true;
  return entry;
}

/** A session left open from an earlier day is closed as it stands, so the shortfall lands in the backlog. */
export function settleStale(state: State, today: string): LogEntry | null {
  const p = state.pending;
  if (!p || p.date >= today) return null;
  return finishSession(state, { note: 'Closed automatically at the end of the day' });
}

export function editEntry(state: State, id: number, patch: Partial<Pick<SessionInput, 'actual' | 'date' | 'advance' | 'note' | 'minutes'>>): LogEntry {
  const entry = state.log.find((l) => l.id === id);
  if (!entry) throw new Error('Entry not found.');
  if (patch.actual !== undefined) {
    const amount = requireNumber(patch.actual, 'Amount');
    if (amount < 0) throw new Error('Amount cannot be negative.');
    entry.actual = r(amount);
  }
  if (patch.date !== undefined) {
    if (!isISO(patch.date)) throw new Error('Pick a valid date.');
    entry.date = patch.date;
  }
  if (patch.advance !== undefined) entry.advance = Boolean(patch.advance);
  if (patch.note !== undefined) entry.note = String(patch.note).slice(0, 200);
  if (patch.minutes !== undefined) {
    const mins = optionalMinutes(patch.minutes);
    if (mins === undefined) delete entry.minutes;
    else entry.minutes = mins;
  }
  return entry;
}

export function deleteEntry(state: State, id: number): void {
  state.log = state.log.filter((l) => l.id !== id && l.skipFor !== id);
}

/** Record a streak you already had before using the app: `days` days ending yesterday. */
export function setStreakSeed(state: State, days: number | string, today: string): void {
  const n = Math.floor(requireNumber(days === '' ? 0 : days, 'Streak'));
  state.settings.streakSeed = n > 0 ? { days: n, endDate: addDays(today, -1) } : null;
}

/**
 * First-run setup. rows: [{ name, unit, start, step, lifetime, backlog }]; blank names are skipped.
 * `firstRow` (one of the row objects) or `firstIndex` picks the exercise that is up first.
 * The cyclic order is preserved, only the starting point moves.
 */
export function setupFromOnboarding(
  state: State,
  { rows, firstRow, firstIndex = 0, streakDays, today }: { rows: NewExercise[]; firstRow?: NewExercise; firstIndex?: number; streakDays?: number | string; today?: string },
): State {
  const chosen = rows.filter((x) => String(x.name || '').trim());
  if (!chosen.length) throw new Error('Add at least one exercise.');
  const made = chosen.map((x) => addExercise(state, x));
  const byRef = firstRow ? chosen.indexOf(firstRow) : -1;
  const k = byRef >= 0 ? byRef : Math.max(0, Math.min(made.length - 1, firstIndex));
  state.exercises = [...made.slice(k), ...made.slice(0, k)];
  if (streakDays) setStreakSeed(state, streakDays, today || todayISO());
  return state;
}
