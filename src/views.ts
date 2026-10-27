// Screens. Each view is a pure function: context in, HTML string out. No DOM access, no state changes.
//
// ctx = { state, ui, en, today, now, streak, install, snapshots() }
//   en      - T.enrich(state), computed once per render
//   install - { standalone, canPrompt, ios, dismissed }
import * as T from './logic';
import type { EnrichedEntry, Exercise, ExerciseStats, State, Streaks } from './types';
import type { Milestone } from './milestones';
import type { SnapshotInfo } from './store';
import type { SyncView } from './sync';
import { CONFIG, CLOUD, PALETTE, TEMPLATE } from './config';

const CONFIG_REMINDER_HOURS = CLOUD.reminderHours;
const CONFIG_DEFAULT_HOUR = CLOUD.defaultReminderHour;
import { esc, fmt, amount, longDate, shortDate, paceLabel, durationLabel } from './format';
import { dot, chip, field, textInput, select, card, statGrid, listRows, button, banner } from './html';

const DAY_MS = 86400000;

export interface InstallInfo {
  standalone: boolean;
  canPrompt: boolean;
  ios: boolean;
  dismissed: boolean;
}

/** UI-only state (not saved). */
export interface UiState {
  tab: 'today' | 'history' | 'progress' | 'more';
  override: number | null; // exercise picked by hand instead of the rotation
  optOpen: boolean;
  histAll: boolean;
  range: Range;
  from: string;
  to: string;
  /** First-run rows while they are being edited; null before a starting point is chosen. */
  draft: DraftRow[] | null;
  draftFirst: number;
}

export type Range = '30' | '90' | 'all' | 'custom';

export type Theme = 'light' | 'dark' | 'auto';

export interface ReminderInfo {
  supported: boolean;
  hour: number | null; // null when off
}

export interface ViewCtx {
  theme: Theme;
  sync: SyncView;
  reminder: ReminderInfo;
  state: State;
  ui: UiState;
  en: EnrichedEntry[];
  today: string;
  now: number;
  streak: Streaks;
  install: InstallInfo;
  snapshots: () => SnapshotInfo[];
}

const exStyle = (color: string): string => `--ex:${color}`;
const exLabel = (ex: { name: string; color: string }): string => dot(ex.color) + esc(ex.name);
const quietButton = (label: string, act: string, data: Record<string, string | number>, aria?: string): string => button(label, act, { cls: '', data, aria });

// ---------- first run ----------

/** One exercise on the first-run screen. All strings: they are what the inputs hold. */
export interface DraftRow {
  name: string;
  unit: string;
  step: string;
  start: string;
  lifetime: string;
  backlog: string;
  color: string;
}

export const blankDraft = (index: number): DraftRow => ({ name: '', unit: 'reps', step: '1', start: '10', lifetime: '', backlog: '', color: T.paletteColor(index) });
export const templateDraft = (): DraftRow[] =>
  TEMPLATE.map((t) => ({ name: t.name, unit: t.unit, step: String(t.step), start: String(t.start), lifetime: '', backlog: '', color: t.color }));

export function viewOnboarding(ui: UiState): string {
  if (!ui.draft) {
    return `<h1 style="margin:6px 0 4px">Welcome</h1>
      <p class="muted">Pick a starting point. You can change every exercise later.</p>
      ${card(`<h2>Four-exercise rotation</h2><p class="small muted">Push-ups, Squats, Crunches and a Run, each going up a little every time you do it.</p>${button('Use this', 'pickTemplate', { cls: 'primary' })}`)}
      ${card(`<h2>My own routine</h2><p class="small muted">Name your exercises and how fast each one should progress.</p>${button('Build my own', 'pickBlank')}`)}`;
  }
  const rows = ui.draft
    .map(
      (d, i) => `
    <div class="ob-row" data-id="${i}">
      <div class="row">
        <b>${dot(d.color)}Exercise ${i + 1}</b>
        <label class="check" style="margin:0"><input type="radio" name="first" value="${i}"${i === ui.draftFirst ? ' checked' : ''}>Up first</label>
      </div>
      ${field('Name', textInput('name', { value: d.name, placeholder: 'e.g. Push-ups' }))}
      <div class="two">
        ${field('Unit', textInput('unit', { value: d.unit, placeholder: 'reps, km, min' }))}
        ${field('Goes up by', textInput('step', { value: d.step, mode: 'decimal' }))}
      </div>
      <div class="two">
        ${field('Next target', textInput('target', { value: d.start, mode: 'decimal' }))}
        ${field('Total so far', textInput('lifetime', { value: d.lifetime, mode: 'decimal', placeholder: '0' }))}
      </div>
      ${field('Backlog so far (ahead +, behind -)', textInput('backlog', { value: d.backlog, placeholder: '0, or e.g. -6 if behind' }))}
      ${ui.draft && ui.draft.length > 1 ? `<div style="margin-top:10px">${button('Remove', 'removeDraft', { cls: 'ghost danger', data: { i } })}</div>` : ''}
    </div>`,
    )
    .join('');

  return `<div id="obForm">
    <h1 style="margin:6px 0 4px">Set your starting point</h1>
    <p class="muted">Enter where each exercise stands right now, and which one is up first. Each goes up by its own step every time you complete it.</p>
    ${card(rows)}
    ${button('Add another exercise', 'addDraft')}
    ${card(field('Current streak in days (counting up to yesterday)', textInput('streak', { mode: 'numeric', placeholder: '0' })), { cls: 'gap' })}
    ${button('Start tracking', 'start', { cls: 'primary' })}
  </div>`;
}

// ---------- today ----------

export function viewToday(ctx: ViewCtx): string {
  const { state, ui, en, today, streak } = ctx;
  const active = T.activeList(state);
  if (!active.length) return card('<h2>No active exercises</h2>');

  // Sets in progress pin the screen to that exercise until the session is finished or discarded.
  const pinned = state.pending ? T.getEx(state, state.pending.exId) : null;
  const ex = pinned ?? active.find((e) => e.id === ui.override) ?? T.nextExercise(state);
  if (!ex) return card('<h2>No active exercises</h2>');
  const upcoming = T.rotationPreview(state, active.length).filter((p) => p.ex.id !== ex.id);

  return [
    installBanner(ctx.install),
    syncBanner(ctx.sync),
    streakBanner(streak, ctx.now),
    backupBanner(state, ctx.now),
    doneBanner(
      en.filter((e) => e.date === today),
      streak,
      T.isRestDay(state, today),
    ),
    hero({ ex, stats: T.exerciseStats(state, ex, en), ui, today, doneToday: streak.todayDone, options: active, sets: state.pending?.sets ?? [], date: state.pending?.date ?? today, canRest: !streak.todayDone && !state.pending }),
    card(
      statGrid([
        { value: streak.current, label: 'day streak', color: 'var(--c1)' },
        { value: streak.longest, label: 'best streak', color: 'var(--hot)' },
        { value: streak.activeDays, label: 'active days', color: 'var(--c3)' },
      ]),
    ),
    upcoming.length
      ? card('<h2>Coming up</h2>' + listRows(upcoming.map((p) => [exLabel(p.ex), `<b class="num">${amount(p.target, p.ex.unit)}</b>`])))
      : '',
    card(
      '<h2>Backlog</h2><p class="muted small">Actual minus target, all time. Plus means you are ahead.</p>' +
        listRows(active.map((e) => [exLabel(e), chip(T.exerciseStats(state, e, en).surplus, e.unit)])),
    ),
  ].join('');
}

function hero({ ex, stats, ui, today, doneToday, options, sets, date, canRest }: {
  ex: Exercise;
  stats: ExerciseStats;
  ui: UiState;
  today: string;
  doneToday: boolean;
  options: Exercise[];
  sets: number[];
  date: string;
  canRest: boolean;
}): string {
  const { target, last } = stats;
  const done = T.r(sets.reduce((a, b) => a + b, 0));
  const remaining = T.r(Math.max(0, target - done));
  const inProgress = sets.length > 0;
  const lastSet = sets[sets.length - 1];
  const suggested = inProgress && lastSet !== undefined && remaining > 0 ? Math.min(remaining, lastSet) : remaining || target;

  const lastLine = last
    ? `Last time ${amount(last.actual, ex.unit)} on ${shortDate(last.date)} &nbsp;${chip(last.delta)}`
    : 'First session of this exercise.';
  const exerciseOptions = options.map((e) => ({ value: e.id, label: e.name }));
  const pct = Math.min(100, Math.round((done / (target || 1)) * 100));

  const progress = inProgress
    ? `<div class="progress"><i style="width:${pct}%"></i></div>
       <div class="row small"><b>${fmt(done)} of ${fmt(target)} ${esc(ex.unit)}</b><span>${remaining > 0 ? `${fmt(remaining)} to go` : done > target ? `${fmt(T.r(done - target))} over` : 'target reached'}</span></div>
       <div class="sets">${sets.map((n, i) => `<button class="set" data-act="removeSet" data-i="${i}" aria-label="remove set">${fmt(n)} &times;</button>`).join('')}</div>`
    : '';

  const quick = [...new Set([...ex.quickSets.filter((n) => n < remaining || !inProgress), ...(remaining > 0 && inProgress ? [remaining] : [])])];
  const chips = remaining > 0 || !inProgress
    ? `<div class="quick">${quick.map((n) => button(`+${fmt(n)}`, 'quickSet', { cls: 'qs', data: { ex: ex.id, n } })).join('')}</div>`
    : '';

  const finishLabel = remaining > 0 ? `Finish early at ${fmt(done)}` : `Finish ${ex.name}`;
  const buttons = inProgress
    ? (remaining > 0
        ? button('Add set', 'addSet', { cls: 'primary', data: { ex: ex.id } }) + button(finishLabel, 'finish', { cls: 'ghost wide' })
        : button(finishLabel, 'finish', { cls: 'primary' }) + button('Add set', 'addSet', { cls: 'ghost wide', data: { ex: ex.id } })) +
      button('Discard sets', 'discardSets', { cls: 'link' })
    : button('Add set', 'addSet', { cls: 'primary', data: { ex: ex.id } });

  return card(
    `<div id="logForm">
      <div class="eyebrow">${doneToday ? 'Up next' : 'Today'} &middot; ${longDate(today)}</div>
      <h1>${esc(ex.name)}</h1>
      <div class="target"><b>${fmt(target)}</b><span>${esc(ex.unit)}</span></div>
      <div class="muted small">${lastLine}</div>
      ${progress}
      ${chips}
      <div class="stepper">
        <button class="sq" data-act="dec" aria-label="less">-</button>
        ${textInput('actual', { value: suggested, mode: 'decimal', extra: `data-step="${ex.setStep}"` })}
        <button class="sq" data-act="inc" aria-label="more">+</button>
      </div>
      ${buttons}
      <details id="opts"${ui.optOpen ? ' open' : ''}>
        <summary>Options</summary>
        ${inProgress ? '' : field('Exercise', select('exId', exerciseOptions, ex.id))}
        ${field('Date', `<input type="date" data-f="date" value="${date}">`)}
        <label class="check"><input type="checkbox" data-f="hold">Hold target next time (do not add the increase)</label>
        ${ex.tracksTime ? field('Time (optional, like 28:30)', textInput('minutes', { placeholder: 'mm:ss' })) : ''}
        ${field('Note', textInput('note', { maxlength: 200 }))}
      </details>
      ${button('Log extra or catch up', 'addExtra', { cls: 'link' })}
      ${canRest ? button('Take a rest day', 'restDay', { cls: 'link' }) : ''}
    </div>`,
    { cls: 'hero', style: exStyle(ex.color) },
  );
}

function installBanner({ standalone, dismissed }: InstallInfo): string {
  if (standalone || dismissed) return '';
  return banner(
    `Install this as an app on your home screen. ${quietButton('How', 'tab', { tab: 'more' })} ${quietButton('x', 'dismissInstall', {}, 'dismiss')}`,
    'ok',
  );
}

function syncBanner(sync: SyncView): string {
  if (sync.status !== 'conflict') return '';
  return banner(`Cloud sync needs a decision. ${quietButton('Review', 'tab', { tab: 'more' })}`);
}

/** Evening nudge when a running streak would break at midnight. */
function streakBanner(streak: Streaks, now: number): string {
  if (streak.todayDone || streak.current < 1 || new Date(now).getHours() < CONFIG.streakWarnHour) return '';
  return banner(`Your ${streak.current}-day streak ends tonight. Log something to keep it.`);
}

function backupBanner(state: State, now: number): string {
  const { lastBackup } = state.settings;
  const stale = !lastBackup || now - lastBackup > CONFIG.backupNagDays * DAY_MS;
  if (state.log.length < 3 || !stale) return '';
  const age = lastBackup ? `${Math.floor((now - lastBackup) / DAY_MS)} days` : 'ever';
  return banner(`No backup in ${age}. ${quietButton('Back up', 'tab', { tab: 'more' })}`);
}

function doneBanner(todays: EnrichedEntry[], streak: Streaks, rest: boolean): string {
  if (!streak.todayDone) return '';
  if (rest) return banner(`Rest day. Your streak is safe. ${quietButton('Undo', 'undoRest', {})}`, 'ok');
  if (!todays.length) return banner('Today is covered by your streak.', 'ok');
  return banner(`Done today: ${todays.map((e) => `${esc(e.name)} ${amount(e.actual, e.unit)}`).join(', ')}`, 'ok');
}

// ---------- history ----------

export function viewHistory({ en, ui }: ViewCtx): string {
  const header = `<div class="row" style="margin-bottom:6px"><h2 style="margin:0">History</h2>${button('Add past entry', 'addPast')}</div>`;
  if (!en.length) return `${header}<p class="muted">Nothing logged yet.</p>`;

  const rows = [...en].reverse();
  const shown = ui.histAll ? rows : rows.slice(0, CONFIG.historyPageSize);
  let day = null;
  let body = '';
  for (const e of shown) {
    if (e.date !== day) {
      day = e.date;
      body += `<div class="hist-day">${longDate(day)}</div>`;
    }
    body += historyRow(e);
  }
  const more =
    !ui.histAll && rows.length > shown.length
      ? `<p style="text-align:center;margin-top:12px">${button(`Show all ${rows.length}`, 'histAll')}</p>`
      : '';
  return header + body + more;
}

const historyRow = (e: EnrichedEntry): string =>
  `<button class="hist-row" style="${exStyle(e.color)}" data-act="editEntry" data-id="${e.id}">
    <span><b>${esc(e.name)}</b> <span class="muted num">${e.extra ? `${fmt(e.actual)} ${esc(e.unit)} extra` : `${fmt(e.actual)} ${esc(e.unit)} of ${fmt(e.target)}`}</span>${
      e.advance === false && !e.extra ? ' <span class="muted small">(held)</span>' : '' +
      (e.sets ? ` <span class="muted small">(${e.sets.length} sets)</span>` : '') +
      (e.minutes ? ` <span class="muted small">${durationLabel(e.minutes)}, ${paceLabel(e.minutes / e.actual, e.unit)}</span>` : '')
    }</span>${chip(e.delta)}
  </button>`;

/** Log extra work on any exercise, typically to pay down a backlog. */
export function extraForm(state: State, today: string): string {
  const en = T.enrich(state);
  const options = state.exercises.map((e) => {
    const surplus = T.exerciseStats(state, e, en).surplus;
    return { ex: e, surplus, label: `${e.name} (backlog ${surplus > 0 ? '+' : ''}${fmt(surplus)} ${e.unit})` };
  });
  const worst = options.reduce((a, b) => (b.surplus < a.surplus ? b : a), options[0] as (typeof options)[number]);
  return `<h2>Log extra</h2>
    <p class="small muted">Extra work counts toward your totals and pays down the backlog. It does not move the rotation or raise any target.</p>
    ${field('Exercise', select('exId', options.map((o) => ({ value: o.ex.id, label: o.label })), worst.ex.id))}
    ${field('Amount', textInput('actual', { mode: 'decimal', placeholder: 'e.g. 20' }))}
    ${field('Date', `<input type="date" data-f="date" value="${today}">`)}
    ${field('Note', textInput('note', { maxlength: 200 }))}
    <div class="btns">${button('Cancel', 'closeModal')}${button('Save', 'saveExtra', { cls: 'primary' })}</div>`;
}

export function entryForm({ state, today }: Pick<ViewCtx, 'state' | 'today'>, entry?: EnrichedEntry | null): string {
  const isNew = !entry;
  const ex = isNew ? T.nextExercise(state) : T.getEx(state, entry.exId);
  const fallbackId = ex?.id ?? state.exercises[0]?.id ?? 0;
  const picker = isNew
    ? field('Exercise', select('exId', state.exercises.map((e) => ({ value: e.id, label: e.name })), fallbackId))
    : `<p class="muted">${esc(ex ? ex.name : '')}</p>`;
  const id: Record<string, number> = isNew ? {} : { id: entry.id };

  return `<h2>${isNew ? 'Add past entry' : 'Edit entry'}</h2>
    ${picker}
    ${field('Date', `<input type="date" data-f="date" value="${isNew ? T.addDays(today, -1) : entry.date}">`)}
    ${field('Amount', textInput('actual', { value: isNew ? '' : entry.actual, mode: 'decimal' }))}
    ${!isNew && entry.extra ? '' : `<label class="check"><input type="checkbox" data-f="hold"${!isNew && entry.advance === false ? ' checked' : ''}>Held (did not advance the target)</label>`}
    ${ex?.tracksTime ? field('Time (optional, like 28:30)', textInput('minutes', { value: !isNew && entry.minutes ? durationLabel(entry.minutes) : '', placeholder: 'mm:ss' })) : ''}
    ${field('Note', textInput('note', { value: isNew ? '' : entry.note || '', maxlength: 200 }))}
    <div class="btns">
      ${isNew ? '' : button('Delete', 'delEntry', { cls: 'ghost danger', data: id })}
      ${button('Cancel', 'closeModal')}
      ${button('Save', isNew ? 'savePast' : 'saveEntry', { cls: 'primary', data: id })}
    </div>`;
}

// ---------- progress ----------

export function viewProgress({ state, en, today, ui }: ViewCtx): string {
  const win = rangeWindow(ui, today, en);
  const heat = T.activityGrid(state, today, CONFIG.heatmapWeeks)
    .map((week) => week.map((c) => `<div class="cell${c.future ? ' future' : c.rest ? ' rest' : c.done ? ' on' : ''}" title="${c.date}"></div>`).join(''))
    .join('');
  return card(`<h2>Last ${CONFIG.heatmapWeeks} weeks</h2><div class="heat">${heat}</div>`) + rangeCard(ui) + state.exercises.map((ex) => exerciseCard(state, ex, en, today, win)).join('');
}

export interface RangeWindow {
  from: string | null;
  to: string | null;
}

/** The date window the charts show. 'all' leaves both ends open. */
export function rangeWindow(ui: UiState, today: string, _en: EnrichedEntry[]): RangeWindow {
  if (ui.range === 'all') return { from: null, to: null };
  if (ui.range === 'custom') return { from: ui.from || null, to: ui.to || null };
  return { from: T.addDays(today, -(Number(ui.range) - 1)), to: today };
}

function rangeCard(ui: UiState): string {
  const chips: [Range, string][] = [['30', '30 days'], ['90', '90 days'], ['all', 'All time'], ['custom', 'Dates']];
  const custom =
    ui.range === 'custom'
      ? `<div class="two" id="rangeForm" style="margin-top:10px">${field('From', `<input type="date" data-f="from" value="${esc(ui.from)}">`)}${field('To', `<input type="date" data-f="to" value="${esc(ui.to)}">`)}</div>`
      : '';
  return `<div class="rangebar">${chips.map(([r, label]) => button(label, 'range', { cls: r === ui.range ? 'primary' : 'ghost', data: { range: r } })).join('')}</div>${custom}`;
}

function exerciseCard(state: State, ex: Exercise, en: EnrichedEntry[], today: string, win: RangeWindow): string {
  const x = T.exerciseStats(state, ex, en);
  const shown = x.entries.filter((e) => (!win.from || e.date >= win.from) && (!win.to || e.date <= win.to));
  const period = T.periodTotals(state.log, ex.id, today);
  const pace = ex.tracksTime ? T.paceStats(x.entries) : null;
  const paceGrid = pace
    ? statGrid([
        { value: paceLabel(pace.avg, ex.unit), label: 'average pace' },
        { value: paceLabel(pace.best, ex.unit), label: 'best pace' },
        { value: paceLabel(pace.last, ex.unit), label: 'last pace' },
      ])
    : '';
  const chart =
    shown.length >= 2
      ? `<div class="chartbox">${chartSvg(shown, win)}</div><p class="muted small" style="margin:8px 0 0">Solid: what you did. Dashed: target.</p>`
      : '<p class="muted small">Not enough sessions in this range for a chart.</p>';
  return card(
    `<div class="row"><h2 style="margin:0">${exLabel(ex)}</h2>${chip(x.surplus, ex.unit)}</div>
     <div style="margin:14px 0">${statGrid([
       { value: fmt(x.total), label: `total ${esc(ex.unit)}` },
       { value: x.sessions, label: 'sessions' },
       { value: fmt(x.target), label: 'next target' },
     ])}</div>
     <div style="margin:0 0 14px">${statGrid([
       { value: fmt(period.week), label: 'this week' },
       { value: fmt(period.month), label: 'this month' },
       { value: fmt(x.best), label: 'best session' },
     ])}</div>
     ${paceGrid ? `<div style="margin:0 0 14px">${paceGrid}</div>` : ''}${chart}`,
    { cls: 'ex-card', style: exStyle(ex.color) },
  );
}

/** Line chart over calendar dates: what was done against the target. */
function chartSvg(entries: EnrichedEntry[], win: RangeWindow): string {
  const { width: W, height: H, padLeft: pl, padRight: pr, padTop: pt, padBottom: pb, maxPoints, dotsUpTo } = CONFIG.chart;
  const es = entries.slice(-maxPoints);
  const n = es.length;
  const start = win.from ?? (es[0] as EnrichedEntry).date;
  const end = win.to ?? (es[n - 1] as EnrichedEntry).date;
  const span = Math.max(1, T.diffDays(start, end));

  const values = es.flatMap((e) => [e.actual, e.target]);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const margin = (max - min) * 0.12;
  min -= margin;
  max += margin;

  const x = (date: string): number => pl + Math.min(1, Math.max(0, T.diffDays(start, date) / span)) * (W - pl - pr);
  const y = (val: number): number => pt + (1 - (val - min) / (max - min)) * (H - pt - pb);
  const path = (key: 'actual' | 'target'): string => es.map((e, i) => `${i ? 'L' : 'M'}${x(e.date).toFixed(1)} ${y(e[key]).toFixed(1)}`).join(' ');

  const grid = [min + margin, (min + max) / 2, max - margin]
    .map(
      (val) =>
        `<line class="gl" x1="${pl}" x2="${W - pr}" y1="${y(val).toFixed(1)}" y2="${y(val).toFixed(1)}"/>` +
        `<text class="ax" x="${pl - 6}" y="${(y(val) + 3).toFixed(1)}" text-anchor="end">${fmt(val)}</text>`,
    )
    .join('');
  const ticks = [0, 0.5, 1]
    .map((f) => {
      const date = T.addDays(start, Math.round(span * f));
      const anchor = f === 0 ? 'start' : f === 1 ? 'end' : 'middle';
      return `<text class="ax" x="${(pl + f * (W - pl - pr)).toFixed(1)}" y="${H - 4}" text-anchor="${anchor}">${shortDate(date)}</text>`;
    })
    .join('');
  const dots = n <= dotsUpTo ? es.map((e) => `<circle class="dot" cx="${x(e.date).toFixed(1)}" cy="${y(e.actual).toFixed(1)}" r="2.6"/>`).join('') : '';

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Amount per session against target">${grid}
    <path class="lt" d="${path('target')}"/><path class="la" d="${path('actual')}"/>${dots}${ticks}</svg>`;
}

/** Full-screen party shown when a session hits something worth cheering. */
export function celebrationView(milestones: Milestone[]): string {
  const colors = ['#ff4f7b', '#ff8a1f', '#ffb81c', '#18c5e8', '#9b6bff', '#3df5a0'];
  const confetti = Array.from({ length: 28 }, (_, i) => {
    const left = (i * 37) % 100;
    const delay = ((i * 13) % 20) / 10;
    const dur = 2.4 + ((i * 7) % 15) / 10;
    return `<i class="confetti" style="left:${left}%;background:${colors[i % colors.length]};animation-delay:${delay}s;animation-duration:${dur}s"></i>`;
  }).join('');
  return `<div class="party">${confetti}</div>
    <div class="cheer">${milestones
      .map((m) => `<div class="cheer-item"><div class="cheer-icon">${m.icon}</div><h2>${esc(m.title)}</h2><p>${esc(m.text)}</p></div>`)
      .join('')}
    ${button('Keep going!', 'closeModal', { cls: 'primary' })}</div>`;
}

// ---------- backup ----------

export function viewMore(ctx: ViewCtx): string {
  const { state } = ctx;
  const last = state.settings.lastBackup;
  return [
    installCard(ctx.install),
    syncCard(ctx.sync, ctx.reminder),
    routineCard(state),
    '<h2 style="font-size:1.3rem">Backup</h2>',
    '<p class="muted">Your data lives only on this device. Export a copy now and then, especially before clearing browser data or changing phones.</p>',
    card(`<p class="small muted">Last backup: ${last ? new Date(last).toLocaleString() : 'never'}</p>
      <div class="two">${button('Download file', 'exportFile', { cls: 'primary' })}${button('Copy as text', 'copyBackup')}</div>
      <div class="two" style="margin-top:10px">
        <label class="ghost" style="margin:0;text-align:center;color:var(--ink)">Import file
          <input type="file" id="importFile" accept=".json,application/json" hidden></label>
        ${button('Paste text', 'importText')}
      </div>`),
    startingNumbersCard(state),
    fixPastCard(),
    themeCard(ctx.theme),
    snapshotsCard(ctx.snapshots()),
    card(button('Erase everything', 'erase', { cls: 'ghost danger' })),
  ].join('');
}

function installCard({ standalone, canPrompt, ios }: InstallInfo): string {
  if (standalone) return '';
  const how = canPrompt
    ? `<p class="small muted">One tap, then it lives on your home screen and opens full screen.</p>${button('Install app', 'install', { cls: 'primary' })}`
    : ios
      ? '<p class="small">In <b>Safari</b>: tap the Share button (square with an arrow), scroll down, tap <b>Add to Home Screen</b>, then Add. It must be Safari itself, not a browser inside another app.</p>'
      : '<p class="small">In <b>Chrome</b>: tap the menu (three dots), then <b>Install app</b> or <b>Add to Home screen</b>. If neither shows, open this page in Chrome itself, not inside another app.</p>';
  return card(`<h2>Install as an app</h2>${how}`);
}

function startingNumbersCard(state: State): string {
  const rows = state.exercises
    .map(
      (e) => `<div class="ob-row" data-id="${e.id}">
        <b>${exLabel(e)} (${esc(e.unit)})</b>
        <div class="two">
          ${field('Total before tracking', textInput('lifetime', { value: e.lifetimeOffset || '', placeholder: '0' }))}
          ${field('Backlog before tracking', textInput('backlog', { value: e.backlogOffset || '', placeholder: '0' }))}
        </div>
      </div>`,
    )
    .join('');
  return card(`<h2>Starting numbers</h2>
    <p class="small muted">Fix what you entered at setup. Use - for behind. These sit underneath everything you log in the app.</p>
    <div id="startForm">${rows}</div>
    <div style="margin-top:12px">${button('Save starting numbers', 'saveStart', { cls: 'primary' })}</div>`);
}

function ago(ts: number | null, now = Date.now()): string {
  if (!ts) return 'never';
  const mins = Math.round((now - ts) / 60000);
  return mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`;
}

function syncCard(sync: SyncView, reminder: ReminderInfo): string {
  const intro = '<h2>Cloud sync</h2>';
  if (sync.status === 'signedOut') {
    return card(`${intro}<p class="small muted">Keeps your data safe off this phone and in step across devices. One account, your email and a password.</p>
      <div id="authForm">${field('Email', '<input type="text" data-f="email" inputmode="email" autocomplete="username" autocapitalize="none">')}
      ${field('Password (8+ characters)', '<input type="password" data-f="password" autocomplete="current-password">')}</div>
      ${sync.message ? `<p class="small" style="color:var(--bad)">${esc(sync.message)}</p>` : ''}
      <div class="two" style="margin-top:12px">${button('Sign in', 'signIn', { cls: 'primary' })}${button('Create account', 'signUp')}</div>`);
  }
  if (sync.status === 'conflict' && sync.conflict) {
    return card(`${intro}<div class="banner">Both this phone (${sync.conflict.phoneSessions} sessions) and the cloud (${sync.conflict.cloudSessions} sessions) have changes.</div>
      <p class="small muted">Pick the one to keep. The other is saved as an automatic snapshot first, so nothing is lost.</p>
      <div class="two">${button('Keep this phone', 'useLocal', { cls: 'primary' })}${button('Use the cloud copy', 'useCloud')}</div>`);
  }
  const state =
    sync.status === 'syncing' ? 'Syncing...' : sync.status === 'error' ? `Problem: ${esc(sync.message)}` : `Synced ${ago(sync.lastSynced)}`;
  const reminders = !reminder.supported
    ? '<p class="small muted">Reminders need a browser that supports notifications.</p>'
    : reminder.hour === null
      ? `<p class="small muted">Get a nudge in the evening if you have not logged anything today.</p>
         ${field('Remind me at', select('remindHour', CONFIG_REMINDER_HOURS.map((h) => ({ value: h, label: `${h}:00` })), CONFIG_DEFAULT_HOUR))}
         <div style="margin-top:10px">${button('Turn on reminders', 'enableReminders')}</div>`
      : `<p class="small">Reminder is on, daily at ${reminder.hour}:00 if nothing is logged.</p>${button('Turn off reminders', 'disableReminders')}`;
  return card(`${intro}<p class="small">Signed in as <b>${esc(sync.email ?? '')}</b></p><p class="small muted">${state}</p>
    <div class="two">${button('Sync now', 'syncNow', { cls: 'primary' })}${button('Sign out', 'signOut')}</div>
    <h3 style="margin:18px 0 6px;font-size:1rem">Daily reminder</h3>${reminders}`);
}

function routineCard(state: State): string {
  const rows = state.exercises.map((e, i) => {
    const step = T.currentCycle(e).step;
    const left = `${exLabel(e)}<br><span class="small muted">+${fmt(step)} ${esc(e.unit)} per session${e.active ? '' : ', paused'}</span>`;
    const right = `<span class="mini">${i > 0 ? button('Up', 'moveUp', { data: { id: e.id }, aria: 'move up' }) : ''}${
      i < state.exercises.length - 1 ? button('Down', 'moveDown', { data: { id: e.id }, aria: 'move down' }) : ''
    }${button('Edit', 'editExercise', { data: { id: e.id } })}</span>`;
    return [left, right] as [string, string];
  });
  return card(`<h2>Routine</h2><p class="small muted">The rotation follows this order. Paused exercises are skipped.</p>${listRows(rows)}
    <div style="margin-top:12px">${button('Add exercise', 'addExercise', { cls: 'primary' })}</div>`);
}

/** Add (no exercise given) or edit an exercise. */
export function exerciseForm(state: State, ex?: Exercise): string {
  const isNew = !ex;
  const hasHistory = !!ex && state.log.some((l) => l.exId === ex.id);
  const color = ex?.color ?? T.paletteColor(state.exercises.length);
  const colorOptions = PALETTE.map((p) => ({ value: p.value, label: p.name }));
  const target = ex ? T.currentTarget(state, ex) : 10;
  const step = ex ? T.currentCycle(ex).step : 1;
  const id: Record<string, number> = ex ? { id: ex.id } : {};
  return `<h2>${isNew ? 'Add exercise' : 'Edit exercise'}</h2>
    ${field('Name', textInput('name', { value: ex?.name ?? '', placeholder: 'e.g. Pull-ups' }))}
    <div class="two">
      ${field('Unit', textInput('unit', { value: ex?.unit ?? 'reps', placeholder: 'reps, km, min' }))}
      ${field('Goes up by', textInput('step', { value: step, mode: 'decimal' }))}
    </div>
    ${field(isNew ? 'First target' : 'Next target', textInput('target', { value: target, mode: 'decimal' }))}
    ${field('Colour', select('color', colorOptions, color))}
    <label class="check"><input type="checkbox" data-f="time"${ex?.tracksTime ? ' checked' : ''}>Track time and pace</label>
    ${
      isNew
        ? `<div class="two">${field('Total so far', textInput('lifetime', { mode: 'decimal', placeholder: '0' }))}${field('Backlog so far', textInput('backlog', { placeholder: '0' }))}</div>`
        : `<label class="check"><input type="checkbox" data-f="active"${ex.active ? ' checked' : ''}>In the rotation</label>`
    }
    ${!isNew ? '<p class="small muted">Changing the target or the step applies from your next session. Past entries keep the targets they had.</p>' : ''}
    <div class="btns">
      ${ex && !hasHistory ? button('Delete', 'deleteExercise', { cls: 'ghost danger', data: id }) : ''}
      ${button('Cancel', 'closeModal')}
      ${button('Save', 'saveExercise', { cls: 'primary', data: id })}
    </div>`;
}

function fixPastCard(): string {
  return card(`<h2>Fix past days</h2>
    <p class="small muted">Days with no session, or where another exercise was done, become zeros for the exercise that was due, and the rotation moves on. Pick the first day to check from. Rest days are left alone. A snapshot is kept so you can undo.</p>
    <div id="fixPast">${field('From', '<input type="date" data-f="from">')}</div>
    <div style="margin-top:10px">${button('Apply', 'fixPast', { cls: 'primary' })}</div>`);
}

function themeCard(theme: Theme): string {
  const options: Theme[] = ['light', 'dark', 'auto'];
  return card(`<h2>Appearance</h2><div class="two3">${options
    .map((t) => button(t === 'auto' ? 'Match phone' : t === 'light' ? 'Light' : 'Dark', 'theme', { cls: t === theme ? 'primary' : 'ghost', data: { theme: t } }))
    .join('')}</div>`);
}

function snapshotsCard(snapshots: SnapshotInfo[]): string {
  const body = snapshots.length
    ? listRows(
        snapshots.map((s, i) => [
          `<span class="small">${new Date(s.ts).toLocaleString()}<br><span class="muted">${s.label ? `Before ${esc(s.label)}, ` : ''}${s.entries} sessions logged</span></span>`,
          button('Restore', 'restore', { data: { i } }),
        ]),
      )
    : '<p class="small">None yet.</p>';
  return card(`<h2>Automatic snapshots</h2><p class="small muted">The app keeps the last few states before each change, so a bad edit can be undone.</p>${body}`);
}
