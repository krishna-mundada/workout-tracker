// Entry point: wires the store, the views and the DOM. Rules live in logic.ts, markup in views.ts.
import { CLOUD, CONFIG } from './config';
import { $, $$, buzz, closeModal, download, must, openModal, readForm, readRows, text, toast } from './dom';
import { fmt } from './format';
import * as T from './logic';
import { disableReminders, enableReminders, pushSupported } from './push';
import { createStore } from './store';
import { detectMilestones } from './milestones';
import { createSync } from './sync';
import { blankDraft, celebrationView, entryForm, exerciseForm, templateDraft, viewHistory, viewMore, viewOnboarding, viewProgress, viewToday, type Theme, type UiState, type ViewCtx } from './views';
import './styles.css';

// ---------- setup ----------

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

const store = createStore({
  storage: (() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })(),
  config: CONFIG,
  onError: (message) => toast(message),
});

const sync = createSync({ store, config: { ...CLOUD, url: CLOUD.url, publishableKey: CLOUD.publishableKey }, onChange: () => render() });

const ui: UiState = { tab: 'today', override: null, optOpen: false, histAll: false, range: '90', from: '', to: '', draft: null, draftFirst: 0 };
let installPrompt: InstallPromptEvent | null = null;

// ---------- theme ----------

const THEMES: Theme[] = ['light', 'dark', 'auto'];
const THEME_COLOR: Record<Theme, string> = { light: '#f3eeff', dark: '#0b0a1a', auto: '#f3eeff' };
const savedTheme = (): Theme => {
  const v = store.getFlag(CONFIG.themeKey);
  return THEMES.find((t) => t === v) ?? 'light';
};
function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', THEME_COLOR[theme]);
}
applyTheme(savedTheme());

const isStandalone = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIOS = (): boolean => /iphone|ipad|ipod/i.test(navigator.userAgent);

const reminderHour = (): number | null => {
  const v = store.getFlag(CLOUD.remindHourKey);
  return v === null || v === '' ? null : Number(v);
};

// ---------- rendering ----------

const TABS: Record<UiState['tab'], (ctx: ViewCtx) => string> = {
  today: viewToday,
  history: viewHistory,
  progress: viewProgress,
  more: viewMore,
};

function context(): ViewCtx {
  const today = T.todayISO();
  return {
    theme: savedTheme(),
    sync: sync.view(),
    reminder: { supported: pushSupported(), hour: reminderHour() },
    state: store.state,
    ui,
    en: T.enrich(store.state),
    today,
    now: Date.now(),
    streak: T.streaks(store.state, today),
    install: {
      standalone: isStandalone(),
      canPrompt: installPrompt !== null,
      ios: isIOS(),
      dismissed: store.getFlag(CONFIG.installDismissedKey) === '1',
    },
    snapshots: () => store.snapshots(),
  };
}

function render(): void {
  const app = must('#app');
  const nav = must('#tabs');
  if (!store.state.exercises.length) {
    nav.hidden = true;
    app.innerHTML = viewOnboarding(ui);
    return;
  }
  nav.hidden = false;
  $$('button', nav).forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
  app.innerHTML = TABS[ui.tab](context());
}

store.subscribe(render);

// ---------- helpers ----------

/** Parse a typed number or throw a message the user can act on. */
function numberOrThrow(value: string, message = 'Enter a number.'): number {
  const n = T.toNumber(value);
  if (!Number.isFinite(n)) throw new Error(message);
  return n;
}

const unitLabel = (unit: string): string => (unit === 'reps' ? '' : ` ${unit}`);
const confirmed = (message: string): boolean => window.confirm(message);

function bump(direction: 1 | -1): void {
  const input = must<HTMLInputElement>('[data-f="actual"]');
  const value = parseFloat(input.value.replace(',', '.')) || 0;
  input.value = String(Math.max(0, T.r(value + direction * (Number(input.dataset.step) || 1))));
}

function importFrom(text: string): void {
  if (!confirmed('Replace current data with this backup?')) return;
  store.importJSON(text);
  toast('Backup imported.');
}

async function authenticate(kind: 'signIn' | 'signUp'): Promise<void> {
  const form = readForm(must('#authForm'));
  const email = text(form, 'email');
  const password = text(form, 'password');
  if (!email.includes('@') || password.length < 8) throw new Error('Enter your email and a password of 8 or more characters.');
  await (kind === 'signIn' ? sync.signIn(email, password) : sync.signUp(email, password));
}

/** Copy what is typed on the first-run screen back into ui.draft before it is re-rendered. */
function syncDraft(): void {
  const form = $('#obForm');
  if (!form || !ui.draft) return;
  const rows = $$('.ob-row', form);
  ui.draft = ui.draft.map((d, i) => {
    const row = rows[i];
    if (!row) return d;
    const f = readForm(row);
    return { ...d, name: text(f, 'name'), unit: text(f, 'unit'), step: text(f, 'step'), start: text(f, 'target'), lifetime: text(f, 'lifetime'), backlog: text(f, 'backlog') };
  });
  ui.draftFirst = Number($<HTMLInputElement>('input[name=first]:checked', form)?.value ?? 0);
}

// ---------- actions (data-act="name") ----------

type Action = (el: HTMLElement) => void | Promise<void>;

const actions: Record<string, Action> = {
  tab: (el) => {
    ui.tab = (el.dataset.tab as UiState['tab']) ?? 'today';
    ui.override = null;
    render();
    window.scrollTo(0, 0);
  },
  dec: () => bump(-1),
  inc: () => bump(1),
  closeModal,
  histAll: () => {
    ui.histAll = true;
    render();
  },

  pickTemplate: () => {
    ui.draft = templateDraft();
    ui.draftFirst = 0;
    render();
  },
  pickBlank: () => {
    ui.draft = [blankDraft(0)];
    ui.draftFirst = 0;
    render();
  },
  addDraft: () => {
    syncDraft();
    ui.draft = [...(ui.draft ?? []), blankDraft(ui.draft?.length ?? 0)];
    render();
  },
  removeDraft: (el) => {
    syncDraft();
    const i = Number(el.dataset.i);
    ui.draft = (ui.draft ?? []).filter((_, k) => k !== i);
    ui.draftFirst = Math.min(ui.draftFirst, Math.max(0, ui.draft.length - 1));
    render();
  },
  start: () => {
    syncDraft();
    const draft = ui.draft ?? [];
    const pairs = draft
      .filter((d) => d.name.trim())
      .map((d) => ({
        draft: d,
        row: {
          name: d.name.trim(),
          unit: d.unit.trim() || 'reps',
          step: numberOrThrow(d.step, `Set how much ${d.name.trim()} goes up by.`),
          start: numberOrThrow(d.start, `Enter a next target for ${d.name.trim()}.`),
          lifetime: d.lifetime,
          backlog: d.backlog,
          color: d.color,
        },
      }));
    if (!pairs.length) throw new Error('Add at least one exercise.');
    if (pairs.some((p) => p.row.step <= 0)) throw new Error('"Goes up by" must be more than 0.');
    const firstRow = pairs.find((p) => p.draft === draft[ui.draftFirst])?.row;
    const streakDays = text(readForm(must('#obForm')), 'streak');
    const next = T.setupFromOnboarding(T.newState(), { rows: pairs.map((p) => p.row), firstRow, streakDays });
    ui.tab = 'today';
    ui.draft = null;
    store.replace(next, 'first setup');
  },

  addExercise: () => openModal(exerciseForm(store.state)),
  editExercise: (el) => {
    const ex = T.getEx(store.state, Number(el.dataset.id));
    if (ex) openModal(exerciseForm(store.state, ex));
  },
  saveExercise: (el) => {
    const f = readForm(must('#modal'));
    const id = el.dataset.id ? Number(el.dataset.id) : null;
    const name = text(f, 'name').trim();
    if (!name) throw new Error('Give the exercise a name.');
    const step = numberOrThrow(text(f, 'step'), 'Enter how much it goes up by.');
    const target = numberOrThrow(text(f, 'target'), 'Enter a target.');
    if (step <= 0) throw new Error('"Goes up by" must be more than 0.');
    const unit = text(f, 'unit').trim() || 'reps';
    const color = text(f, 'color');
    if (id === null) {
      store.mutate(
        (s) => T.addExercise(s, { name, unit, step, start: target, color, tracksTime: !!f.time, lifetime: text(f, 'lifetime'), backlog: text(f, 'backlog') }),
        'adding an exercise',
      );
    } else {
      store.mutate((s) => {
        const ex = T.getEx(s, id);
        if (!ex) throw new Error('Exercise not found.');
        const changedPlan = T.currentTarget(s, ex) !== T.r(target) || T.currentCycle(ex).step !== T.r(step);
        T.updateExercise(s, id, { name, unit, color, tracksTime: !!f.time, active: !!f.active });
        if (changedPlan) T.resetPlan(s, id, { start: target, step });
      }, 'editing an exercise');
    }
    closeModal();
  },
  deleteExercise: (el) => {
    if (!confirmed('Delete this exercise?')) return;
    store.mutate((s) => T.deleteExercise(s, Number(el.dataset.id)), 'deleting an exercise');
    closeModal();
  },
  moveUp: (el) => store.mutate((s) => T.moveExercise(s, Number(el.dataset.id), -1), 'reordering'),
  moveDown: (el) => store.mutate((s) => T.moveExercise(s, Number(el.dataset.id), 1), 'reordering'),

  addSet: (el) => {
    const exId = Number(el.dataset.ex);
    const form = readForm(must('#logForm'));
    const amount = numberOrThrow(text(form, 'actual'));
    store.mutate((s) => T.addSet(s, { exId, amount, date: text(form, 'date') || T.todayISO() }), 'adding a set');
    buzz();
    toast(`Added ${fmt(amount)}`, { label: 'Undo', run: () => store.mutate((s) => T.removeSet(s, (s.pending?.sets.length ?? 1) - 1), 'removing a set') });
  },
  quickSet: (el) => {
    const exId = Number(el.dataset.ex);
    const amount = Number(el.dataset.n);
    const form = readForm(must('#logForm'));
    store.mutate((s) => T.addSet(s, { exId, amount, date: text(form, 'date') || T.todayISO() }), 'adding a set');
    buzz();
  },
  restDay: () => {
    store.mutate((s) => T.markRest(s, T.todayISO()), 'taking a rest day');
    toast('Rest day. Streak safe.');
  },
  undoRest: () => store.mutate((s) => T.unmarkRest(s, T.todayISO()), 'undoing a rest day'),
  range: (el) => {
    ui.range = (el.dataset.range as UiState['range']) ?? '90';
    if (ui.range === 'custom' && !ui.from) {
      ui.from = T.addDays(T.todayISO(), -29);
      ui.to = T.todayISO();
    }
    render();
  },
  removeSet: (el) => store.mutate((s) => T.removeSet(s, Number(el.dataset.i)), 'removing a set'),
  discardSets: () => {
    if (confirmed('Throw away the sets so far?')) store.mutate(T.discardSets, 'discarding sets');
  },
  finish: () => {
    const form = readForm(must('#logForm'));
    const exId = store.state.pending?.exId;
    const ex = exId === undefined ? null : T.getEx(store.state, exId);
    const before = store.state;
    const entry = store.mutate((s) => T.finishSession(s, { date: text(form, 'date') || undefined, advance: !form.hold, note: text(form, 'note'), minutes: text(form, 'minutes') }), 'finishing a session');
    buzz(40);
    ui.override = null;
    const cheers = detectMilestones(before, store.state, entry, T.todayISO());
    if (cheers.length) {
      openModal(celebrationView(cheers));
      return;
    }
    toast(`Logged ${ex?.name ?? 'session'} ${fmt(entry.actual)}${unitLabel(ex?.unit ?? 'reps')}`, {
      label: 'Undo',
      run: () => store.mutate((s) => T.deleteEntry(s, entry.id), 'undoing a session'),
    });
  },

  editEntry: (el) => {
    const id = Number(el.dataset.id);
    const entry = T.enrich(store.state).find((e) => e.id === id);
    if (entry) openModal(entryForm({ state: store.state, today: T.todayISO() }, entry));
  },
  addPast: () => openModal(entryForm({ state: store.state, today: T.todayISO() })),
  saveEntry: (el) => {
    const f = readForm(must('#modal'));
    const actual = numberOrThrow(text(f, 'actual'));
    store.mutate((s) => T.editEntry(s, Number(el.dataset.id), { actual, date: text(f, 'date'), advance: !f.hold, note: text(f, 'note'), minutes: text(f, 'minutes') }), 'editing an entry');
    closeModal();
  },
  savePast: () => {
    const f = readForm(must('#modal'));
    const actual = numberOrThrow(text(f, 'actual'));
    store.mutate((s) => T.logSession(s, { exId: Number(text(f, 'exId')), actual, date: text(f, 'date'), advance: !f.hold, note: text(f, 'note'), minutes: text(f, 'minutes') }), 'adding a past entry');
    closeModal();
  },
  delEntry: (el) => {
    if (!confirmed('Delete this entry? Targets and totals will be recalculated.')) return;
    store.mutate((s) => T.deleteEntry(s, Number(el.dataset.id)), 'deleting an entry');
    closeModal();
  },

  saveStart: () => {
    const rows = readRows(must('#startForm'), '.ob-row').map((row) => ({
      id: Number(row.id),
      lifetime: text(row, 'lifetime'),
      backlog: text(row, 'backlog'),
    }));
    store.mutate((s) => rows.forEach(({ id, ...patch }) => T.updateExercise(s, id, patch)), 'editing starting numbers');
    toast('Starting numbers saved.');
  },

  install: async () => {
    if (!installPrompt) return;
    const event = installPrompt;
    installPrompt = null;
    await event.prompt();
    render();
  },
  signIn: () => authenticate('signIn'),
  signUp: () => authenticate('signUp'),
  signOut: () => sync.signOut(),
  syncNow: () => sync.syncNow(),
  useCloud: () => sync.resolve('cloud'),
  useLocal: () => sync.resolve('phone'),
  enableReminders: async () => {
    const userId = sync.userId();
    if (!userId) throw new Error('Sign in first.');
    const hour = Number(text(readForm(must('#app')), 'remindHour')) || CLOUD.defaultReminderHour;
    await enableReminders(sync.client(), userId, CLOUD.vapidPublicKey, hour);
    store.setFlag(CLOUD.remindHourKey, String(hour));
    toast(`Reminder set for ${hour}:00.`);
    render();
  },
  disableReminders: async () => {
    await disableReminders(sync.client());
    store.setFlag(CLOUD.remindHourKey, '');
    toast('Reminders off.');
    render();
  },
  theme: (el) => {
    const theme = THEMES.find((t) => t === el.dataset.theme) ?? 'light';
    store.setFlag(CONFIG.themeKey, theme);
    applyTheme(theme);
    render();
  },
  dismissInstall: () => {
    store.setFlag(CONFIG.installDismissedKey, '1');
    render();
  },

  exportFile: () => {
    download(`workout-backup-${T.todayISO()}.json`, store.exportJSON(true));
    store.markBackup();
    toast('Backup downloaded.');
  },
  copyBackup: async () => {
    try {
      await navigator.clipboard.writeText(store.exportJSON());
      store.markBackup();
      toast('Copied. Paste it somewhere safe, like Notes.');
    } catch {
      toast('Copy was blocked. Use Download instead.');
    }
  },
  importText: () =>
    openModal(
      '<h2>Paste backup text</h2><textarea id="m-text" placeholder="Paste the copied backup here"></textarea>' +
        '<div class="btns"><button class="ghost" data-act="closeModal">Cancel</button><button class="primary" data-act="doImportText">Import</button></div>',
    ),
  doImportText: () => {
    const value = must<HTMLTextAreaElement>('#m-text').value;
    closeModal();
    importFrom(value);
  },
  restore: (el) => {
    if (!confirmed('Restore this snapshot? Your current state is saved as a new snapshot first.')) return;
    store.restoreSnapshot(Number(el.dataset.i));
    toast('Snapshot restored.');
  },
  erase: () => {
    if (!confirmed('Erase all data on this device?')) return;
    if (!confirmed('Really erase everything? A snapshot is kept in Backup > Automatic snapshots until you clear browser data.')) return;
    ui.tab = 'today';
    store.replace(T.newState(), 'erasing everything');
  },
};

// ---------- events ----------

async function run(fn: Action, el: HTMLElement): Promise<void> {
  try {
    await fn(el);
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err));
  }
}

document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
  const fn = el && actions[el.dataset.act ?? ''];
  if (el && fn) void run(fn, el);
});

document.addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement | HTMLSelectElement;
  if ((el.dataset.f === 'from' || el.dataset.f === 'to') && el.closest('#rangeForm')) {
    if (el.dataset.f === 'from') ui.from = el.value;
    else ui.to = el.value;
    render();
  } else if (el.dataset.f === 'exId' && el.closest('#logForm')) {
    ui.override = Number(el.value);
    ui.optOpen = true;
    render();
  } else if (el.id === 'importFile' && el instanceof HTMLInputElement && el.files?.[0]) {
    void el.files[0].text().then((content) => run(() => importFrom(content), el), () => toast('Could not read that file.'));
  }
});

// toggle does not bubble, so listen in the capture phase.
document.addEventListener(
  'toggle',
  (e) => {
    const el = e.target as HTMLDetailsElement;
    if (el.id === 'opts') ui.optOpen = el.open;
  },
  true,
);

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e as InstallPromptEvent;
  render();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  render();
});

// ---------- boot ----------

void navigator.storage?.persist?.().catch(() => {});
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
render();
void sync.init();
