// Screens. Each view is a pure function: context in, HTML string out. No DOM access, no state changes.
//
// ctx = { state, ui, en, today, now, streak, install, snapshots() }
//   en      - T.enrich(state), computed once per render
//   install - { standalone, canPrompt, ios, dismissed }
import * as T from './logic';
import type { EnrichedEntry, Exercise, ExerciseStats, State, Streaks } from './types';
import type { SnapshotInfo } from './store';
import { PLAN, CONFIG, colorOf } from './config';
import { esc, fmt, amount, longDate, shortDate } from './format';
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
}

export interface ViewCtx {
  state: State;
  ui: UiState;
  en: EnrichedEntry[];
  today: string;
  now: number;
  streak: Streaks;
  install: InstallInfo;
  snapshots: () => SnapshotInfo[];
}

const setStepOf = (ex: Exercise): number => PLAN.find((p) => p.name === ex.name)?.setStep ?? 1;
const exStyle = (name: string): string => `--ex:${colorOf(name)}`;
const exLabel = (name: string): string => dot(name) + esc(name);
const quietButton = (label: string, act: string, data: Record<string, string | number>, aria?: string): string => button(label, act, { cls: '', data, aria });

// ---------- first run ----------

export function viewOnboarding(): string {
  const steps = [...new Set(PLAN.map((p) => `+${fmt(p.step)} ${p.unit === 'reps' && p.step === 1 ? 'rep' : esc(p.unit)}`))].join(' or ');
  const rows = PLAN.map(
    (p, i) => `
    <div class="ob-row">
      <div class="row">
        <b>${exLabel(p.name)}</b>
        <label class="check" style="margin:0"><input type="radio" name="first" value="${i}"${i === 0 ? ' checked' : ''}>Up first</label>
      </div>
      <div class="two">
        ${field(`Next target (${esc(p.unit)})`, textInput('target', { value: p.start, mode: 'decimal' }))}
        ${field('Total so far', textInput('lifetime', { mode: 'decimal', placeholder: '0' }))}
      </div>
      ${field('Backlog so far (ahead +, behind -)', textInput('backlog', { placeholder: '0, or e.g. -6 if behind' }))}
    </div>`,
  ).join('');

  return `<div id="obForm">
    <h1 style="margin:6px 0 4px">Set your starting point</h1>
    <p class="muted">One time only. Enter where each exercise stands right now, and which one is next.
      Targets go up by ${steps} each time you complete that exercise.</p>
    ${card(rows)}
    ${card(field('Current streak in days (counting up to yesterday)', textInput('streak', { mode: 'numeric', placeholder: '0' })))}
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
    backupBanner(state, ctx.now),
    doneBanner(
      en.filter((e) => e.date === today),
      streak,
    ),
    hero({ ex, stats: T.exerciseStats(state, ex, en), ui, today, doneToday: streak.todayDone, options: active, sets: state.pending?.sets ?? [], date: state.pending?.date ?? today }),
    card(
      statGrid([
        { value: streak.current, label: 'day streak', color: 'var(--c1)' },
        { value: streak.longest, label: 'best streak', color: 'var(--hot)' },
        { value: streak.activeDays, label: 'active days', color: 'var(--c3)' },
      ]),
    ),
    upcoming.length
      ? card('<h2>Coming up</h2>' + listRows(upcoming.map((p) => [exLabel(p.ex.name), `<b class="num">${amount(p.target, p.ex.unit)}</b>`])))
      : '',
    card(
      '<h2>Backlog</h2><p class="muted small">Actual minus target, all time. Plus means you are ahead.</p>' +
        listRows(active.map((e) => [exLabel(e.name), chip(T.exerciseStats(state, e, en).surplus, e.unit)])),
    ),
  ].join('');
}

function hero({ ex, stats, ui, today, doneToday, options, sets, date }: {
  ex: Exercise;
  stats: ExerciseStats;
  ui: UiState;
  today: string;
  doneToday: boolean;
  options: Exercise[];
  sets: number[];
  date: string;
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
      <div class="stepper">
        <button class="sq" data-act="dec" aria-label="less">-</button>
        ${textInput('actual', { value: suggested, mode: 'decimal', extra: `data-step="${setStepOf(ex)}"` })}
        <button class="sq" data-act="inc" aria-label="more">+</button>
      </div>
      ${buttons}
      <details id="opts"${ui.optOpen ? ' open' : ''}>
        <summary>Options</summary>
        ${inProgress ? '' : field('Exercise', select('exId', exerciseOptions, ex.id))}
        ${field('Date', `<input type="date" data-f="date" value="${date}">`)}
        <label class="check"><input type="checkbox" data-f="hold">Hold target next time (do not add the increase)</label>
        ${field('Note', textInput('note', { maxlength: 200 }))}
      </details>
    </div>`,
    { cls: 'hero', style: exStyle(ex.name) },
  );
}

function installBanner({ standalone, dismissed }: InstallInfo): string {
  if (standalone || dismissed) return '';
  return banner(
    `Install this as an app on your home screen. ${quietButton('How', 'tab', { tab: 'more' })} ${quietButton('x', 'dismissInstall', {}, 'dismiss')}`,
    'ok',
  );
}

function backupBanner(state: State, now: number): string {
  const { lastBackup } = state.settings;
  const stale = !lastBackup || now - lastBackup > CONFIG.backupNagDays * DAY_MS;
  if (state.log.length < 3 || !stale) return '';
  const age = lastBackup ? `${Math.floor((now - lastBackup) / DAY_MS)} days` : 'ever';
  return banner(`No backup in ${age}. ${quietButton('Back up', 'tab', { tab: 'more' })}`);
}

function doneBanner(todays: EnrichedEntry[], streak: Streaks): string {
  if (!streak.todayDone) return '';
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
  `<button class="hist-row" style="${exStyle(e.name)}" data-act="editEntry" data-id="${e.id}">
    <span><b>${esc(e.name)}</b> <span class="muted num">${fmt(e.actual)} ${esc(e.unit)} of ${fmt(e.target)}</span>${
      e.advance === false ? ' <span class="muted small">(held)</span>' : '' +
      (e.sets ? ` <span class="muted small">(${e.sets.length} sets)</span>` : '')
    }</span>${chip(e.delta)}
  </button>`;

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
    <label class="check"><input type="checkbox" data-f="hold"${!isNew && entry.advance === false ? ' checked' : ''}>Held (did not advance the target)</label>
    ${field('Note', textInput('note', { value: isNew ? '' : entry.note || '', maxlength: 200 }))}
    <div class="btns">
      ${isNew ? '' : button('Delete', 'delEntry', { cls: 'ghost danger', data: id })}
      ${button('Cancel', 'closeModal')}
      ${button('Save', isNew ? 'savePast' : 'saveEntry', { cls: 'primary', data: id })}
    </div>`;
}

// ---------- progress ----------

export function viewProgress({ state, en, today }: ViewCtx): string {
  const heat = T.activityGrid(state, today, CONFIG.heatmapWeeks)
    .map((week) => week.map((c) => `<div class="cell${c.future ? ' future' : c.done ? ' on' : ''}" title="${c.date}"></div>`).join(''))
    .join('');
  return card(`<h2>Last ${CONFIG.heatmapWeeks} weeks</h2><div class="heat">${heat}</div>`) + state.exercises.map((ex) => exerciseCard(state, ex, en)).join('');
}

function exerciseCard(state: State, ex: Exercise, en: EnrichedEntry[]): string {
  const x = T.exerciseStats(state, ex, en);
  const chart =
    x.entries.length >= 2
      ? `<div class="chartbox">${chartSvg(x.entries)}</div><p class="muted small" style="margin:8px 0 0">Solid: what you did. Dashed: target.</p>`
      : '<p class="muted small">Log two sessions to see the chart.</p>';
  return card(
    `<div class="row"><h2 style="margin:0">${exLabel(ex.name)}</h2>${chip(x.surplus, ex.unit)}</div>
     <div style="margin:14px 0">${statGrid([
       { value: fmt(x.total), label: `total ${esc(ex.unit)}` },
       { value: x.sessions, label: 'sessions' },
       { value: fmt(x.target), label: 'next target' },
     ])}</div>${chart}`,
    { cls: 'ex-card', style: exStyle(ex.name) },
  );
}

/** Line chart of what was done against the target, last N sessions. */
function chartSvg(entries: EnrichedEntry[]): string {
  const { width: W, height: H, padLeft: pl, padRight: pr, padTop: pt, padBottom: pb, maxPoints, dotsUpTo } = CONFIG.chart;
  const es = entries.slice(-maxPoints);
  const n = es.length;
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

  const x = (i: number): number => pl + (n === 1 ? 0.5 : i / (n - 1)) * (W - pl - pr);
  const y = (v: number): number => pt + (1 - (v - min) / (max - min)) * (H - pt - pb);
  const path = (key: 'actual' | 'target'): string => es.map((e, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(e[key]).toFixed(1)}`).join(' ');

  const grid = [min + margin, (min + max) / 2, max - margin]
    .map(
      (v) =>
        `<line class="gl" x1="${pl}" x2="${W - pr}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>` +
        `<text class="ax" x="${pl - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${fmt(v)}</text>`,
    )
    .join('');
  const dots = n <= dotsUpTo ? es.map((e, i) => `<circle class="dot" cx="${x(i).toFixed(1)}" cy="${y(e.actual).toFixed(1)}" r="2.6"/>`).join('') : '';

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Amount per session against target">${grid}
    <path class="lt" d="${path('target')}"/><path class="la" d="${path('actual')}"/>${dots}
    <text class="ax" x="${pl}" y="${H - 4}">${shortDate(es[0].date)}</text>
    <text class="ax" x="${W - pr}" y="${H - 4}" text-anchor="end">${shortDate(es[n - 1].date)}</text></svg>`;
}

// ---------- backup ----------

export function viewMore(ctx: ViewCtx): string {
  const { state } = ctx;
  const last = state.settings.lastBackup;
  return [
    installCard(ctx.install),
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
        <b>${exLabel(e.name)} (${esc(e.unit)})</b>
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

function snapshotsCard(snapshots: SnapshotInfo[]): string {
  const body = snapshots.length
    ? listRows(
        snapshots.map((s, i) => [
          `<span class="small">${new Date(s.ts).toLocaleString()}<br><span class="muted">${s.entries} entries</span></span>`,
          button('Restore', 'restore', { data: { i } }),
        ]),
      )
    : '<p class="small">None yet.</p>';
  return card(`<h2>Automatic snapshots</h2><p class="small muted">The app keeps the last few states before each change, so a bad edit can be undone.</p>${body}`);
}
