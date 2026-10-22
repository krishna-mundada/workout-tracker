/*
 * Workout Tracker: core logic (no DOM, no storage).
 * Everything the app shows is derived from state.log, so deleting or editing
 * an entry never leaves targets, streaks or backlogs out of sync.
 *
 * state = {
 *   version: 1,
 *   exercises: [{ id, name, unit, active, lifetimeOffset, backlogOffset,
 *                 cycles: [{ n, start, step, from }] }],   // last cycle is the live plan
 *   log: [{ id, date:'YYYY-MM-DD', exId, cycle, actual, advance, note, ts }],
 *   settings: { nextId, streakSeed:{days,endDate}|null, lastBackup:ms|null }
 * }
 *
 * Rotation order = order of the exercises array (active ones only).
 * Target for an exercise = cycle.start + cycle.step * (advancing sessions already logged in that cycle).
 * Backlog (surplus/deficit) = sum of (actual - target) over every session, plus an opening offset.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Tracker = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var r = function (v) { return Math.round(v * 100) / 100; };
  var pad = function (n) { return String(n).padStart(2, '0'); };

  function toISO(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayISO(now) { return toISO(now || new Date()); }
  function parseISO(s) { var p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function addDays(iso, n) { var d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); }
  function diffDays(a, b) {
    var da = parseISO(a), db = parseISO(b);
    return Math.round((Date.UTC(db.getFullYear(), db.getMonth(), db.getDate()) -
                       Date.UTC(da.getFullYear(), da.getMonth(), da.getDate())) / 86400000);
  }
  function isISO(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(parseISO(s).getTime()); }

  function newState() {
    return { version: 1, exercises: [], log: [], settings: { nextId: 1, streakSeed: null, lastBackup: null } };
  }

  function migrate(obj) {
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.exercises) || !Array.isArray(obj.log)) {
      throw new Error('This does not look like a Workout Tracker backup.');
    }
    var s = newState();
    var maxId = 0;
    obj.exercises.forEach(function (e) {
      if (!e || typeof e.id !== 'number' || !e.name || !Array.isArray(e.cycles) || !e.cycles.length) {
        throw new Error('Backup has a broken exercise entry.');
      }
      maxId = Math.max(maxId, e.id);
      s.exercises.push({
        id: e.id, name: String(e.name), unit: String(e.unit || 'reps'), active: e.active !== false,
        lifetimeOffset: Number(e.lifetimeOffset) || 0, backlogOffset: Number(e.backlogOffset) || 0,
        cycles: e.cycles.map(function (c) {
          return { n: Number(c.n), start: Number(c.start), step: Number(c.step), from: c.from || null };
        })
      });
    });
    obj.log.forEach(function (l) {
      if (!l || typeof l.id !== 'number' || !isISO(l.date) || !isFinite(l.actual)) {
        throw new Error('Backup has a broken log entry.');
      }
      maxId = Math.max(maxId, l.id);
      s.log.push({
        id: l.id, date: l.date, exId: l.exId, cycle: Number(l.cycle) || 1, actual: Number(l.actual),
        advance: l.advance !== false, note: l.note ? String(l.note) : '', ts: l.ts || 0
      });
    });
    var st = obj.settings || {};
    s.settings.nextId = Math.max(Number(st.nextId) || 1, maxId + 1);
    s.settings.streakSeed = st.streakSeed && st.streakSeed.days > 0 && isISO(st.streakSeed.endDate)
      ? { days: Number(st.streakSeed.days), endDate: st.streakSeed.endDate } : null;
    s.settings.lastBackup = st.lastBackup || null;
    return s;
  }

  // ---------- derived data ----------

  function sortedLog(state) {
    return state.log.slice().sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id;
    });
  }
  function getEx(state, id) { return state.exercises.filter(function (e) { return e.id === id; })[0] || null; }
  function currentCycle(ex) { return ex.cycles[ex.cycles.length - 1]; }
  function cycleOf(ex, n) {
    for (var i = 0; i < ex.cycles.length; i++) if (ex.cycles[i].n === n) return ex.cycles[i];
    return currentCycle(ex);
  }

  // Log entries in chronological order, each with its target and delta computed.
  function enrich(state) {
    var counts = {};
    return sortedLog(state).map(function (e) {
      var ex = getEx(state, e.exId);
      if (!ex) return Object.assign({}, e, { name: '(deleted)', unit: '', target: e.actual, delta: 0 });
      var key = e.exId + ':' + e.cycle;
      var n = counts[key] || 0;
      var c = cycleOf(ex, e.cycle);
      var target = r(c.start + c.step * n);
      if (e.advance !== false) counts[key] = n + 1;
      return Object.assign({}, e, { name: ex.name, unit: ex.unit, target: target, delta: r(e.actual - target) });
    });
  }

  function sessionsInCurrentCycle(state, ex) {
    var c = currentCycle(ex);
    return state.log.filter(function (l) { return l.exId === ex.id && l.cycle === c.n && l.advance !== false; }).length;
  }
  function currentTarget(state, ex) {
    var c = currentCycle(ex);
    return r(c.start + c.step * sessionsInCurrentCycle(state, ex));
  }

  function exerciseStats(state, ex, enriched) {
    var es = (enriched || enrich(state)).filter(function (e) { return e.exId === ex.id; });
    var total = ex.lifetimeOffset || 0, surplus = ex.backlogOffset || 0, best = 0;
    es.forEach(function (e) { total += e.actual; surplus += e.delta; if (e.actual > best) best = e.actual; });
    return {
      sessions: es.length, total: r(total), surplus: r(surplus), best: best,
      target: currentTarget(state, ex), step: currentCycle(ex).step, cycleNo: currentCycle(ex).n,
      last: es.length ? es[es.length - 1] : null, entries: es
    };
  }

  function activeList(state) { return state.exercises.filter(function (e) { return e.active; }); }

  function nextExercise(state) {
    var active = activeList(state);
    if (!active.length) return null;
    var log = sortedLog(state);
    if (!log.length) return active[0];
    var lastId = log[log.length - 1].exId;
    var idx = -1;
    active.forEach(function (e, i) { if (e.id === lastId) idx = i; });
    if (idx >= 0) return active[(idx + 1) % active.length];
    // last-trained exercise has since been switched off: continue from its slot
    var all = state.exercises;
    var pos = -1;
    all.forEach(function (e, i) { if (e.id === lastId) pos = i; });
    if (pos >= 0) {
      for (var i = 1; i <= all.length; i++) {
        var e = all[(pos + i) % all.length];
        if (e.active) return e;
      }
    }
    return active[0];
  }

  // The upcoming rotation starting at the next exercise.
  function rotationPreview(state, count) {
    var active = activeList(state);
    var first = nextExercise(state);
    if (!first) return [];
    var start = 0;
    active.forEach(function (e, i) { if (e.id === first.id) start = i; });
    var out = [];
    for (var i = 0; i < Math.min(count, active.length); i++) {
      var ex = active[(start + i) % active.length];
      out.push({ ex: ex, target: currentTarget(state, ex) });
    }
    return out;
  }

  function trainedDates(state) {
    var set = {};
    state.log.forEach(function (l) { set[l.date] = true; });
    var seed = state.settings.streakSeed;
    if (seed && seed.days > 0) for (var i = 0; i < seed.days; i++) set[addDays(seed.endDate, -i)] = true;
    return set;
  }

  function streaks(state, today) {
    var set = trainedDates(state);
    var dates = Object.keys(set).sort();
    var longest = 0, run = 0, prev = null;
    dates.forEach(function (d) {
      run = prev && diffDays(prev, d) === 1 ? run + 1 : 1;
      if (run > longest) longest = run;
      prev = d;
    });
    var cur = 0;
    var d = set[today] ? today : addDays(today, -1);
    while (set[d]) { cur++; d = addDays(d, -1); }
    return {
      current: cur, longest: longest, activeDays: dates.length, todayDone: !!set[today],
      daysSinceLast: dates.length ? diffDays(dates[dates.length - 1], today) : null
    };
  }

  // 7 rows (Mon..Sun) x `weeks` columns ending with the week containing `today`.
  function activityGrid(state, today, weeks) {
    var set = trainedDates(state);
    var counts = {};
    state.log.forEach(function (l) { counts[l.date] = (counts[l.date] || 0) + 1; });
    var dow = (parseISO(today).getDay() + 6) % 7;
    var start = addDays(today, -dow - (weeks - 1) * 7);
    var cols = [];
    for (var w = 0; w < weeks; w++) {
      var col = [];
      for (var d = 0; d < 7; d++) {
        var iso = addDays(start, w * 7 + d);
        col.push({ date: iso, done: !!set[iso], count: counts[iso] || 0, future: iso > today });
      }
      cols.push(col);
    }
    return cols;
  }

  // ---------- mutations (all validate, all take state first) ----------

  function newId(state) { return state.settings.nextId++; }
  function num(v, label) {
    var n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
    if (!isFinite(n)) throw new Error(label + ' must be a number.');
    return n;
  }

  function addExercise(state, o) {
    var name = String(o.name || '').trim();
    if (!name) throw new Error('Give the exercise a name.');
    var step = num(o.step === undefined ? 1 : o.step, 'Step');
    var ex = {
      id: newId(state), name: name, unit: String(o.unit || 'reps').trim() || 'reps', active: o.active !== false,
      lifetimeOffset: o.lifetime ? num(o.lifetime, 'Lifetime total') : 0,
      backlogOffset: o.backlog ? num(o.backlog, 'Backlog') : 0,
      cycles: [{ n: 1, start: r(num(o.start, 'First target')), step: r(step), from: todayISO() }]
    };
    var at = state.exercises.length;
    if (o.afterId != null) {
      state.exercises.forEach(function (e, i) { if (e.id === o.afterId) at = i + 1; });
    }
    state.exercises.splice(at, 0, ex);
    return ex;
  }

  function updateExercise(state, id, o) {
    var ex = getEx(state, id);
    if (!ex) throw new Error('Exercise not found.');
    if (o.name !== undefined) {
      var n = String(o.name).trim();
      if (!n) throw new Error('Give the exercise a name.');
      ex.name = n;
    }
    if (o.unit !== undefined) ex.unit = String(o.unit).trim() || 'reps';
    if (o.active !== undefined) ex.active = !!o.active;
    if (o.lifetime !== undefined) ex.lifetimeOffset = o.lifetime === '' ? 0 : num(o.lifetime, 'Lifetime total');
    if (o.backlog !== undefined) ex.backlogOffset = o.backlog === '' ? 0 : num(o.backlog, 'Backlog');
    return ex;
  }

  // Change the plan going forward. History keeps the old plan's targets.
  function resetPlan(state, id, o) {
    var ex = getEx(state, id);
    if (!ex) throw new Error('Exercise not found.');
    var start = r(num(o.start, 'Next target')), step = r(num(o.step, 'Step'));
    var c = currentCycle(ex);
    if (sessionsInCurrentCycle(state, ex) === 0 && !state.log.some(function (l) { return l.exId === id && l.cycle === c.n; })) {
      c.start = start; c.step = step; // nothing logged on this plan yet, just edit it
    } else {
      ex.cycles.push({ n: c.n + 1, start: start, step: step, from: todayISO() });
    }
    return ex;
  }

  function moveExercise(state, id, dir) {
    var i = -1;
    state.exercises.forEach(function (e, k) { if (e.id === id) i = k; });
    var j = i + dir;
    if (i < 0 || j < 0 || j >= state.exercises.length) return;
    var t = state.exercises[i]; state.exercises[i] = state.exercises[j]; state.exercises[j] = t;
  }

  function deleteExercise(state, id) {
    if (state.log.some(function (l) { return l.exId === id; })) {
      throw new Error('This exercise has history. Switch it off instead of deleting it.');
    }
    state.exercises = state.exercises.filter(function (e) { return e.id !== id; });
  }

  function logSession(state, o) {
    var ex = getEx(state, o.exId);
    if (!ex) throw new Error('Exercise not found.');
    var actual = num(o.actual, 'Amount');
    if (actual < 0) throw new Error('Amount cannot be negative.');
    var date = o.date || todayISO();
    if (!isISO(date)) throw new Error('Pick a valid date.');
    var entry = {
      id: newId(state), date: date, exId: ex.id, cycle: currentCycle(ex).n, actual: r(actual),
      advance: o.advance !== false, note: o.note ? String(o.note).slice(0, 200) : '', ts: Date.now()
    };
    state.log.push(entry);
    return entry;
  }

  function editEntry(state, id, o) {
    var e = state.log.filter(function (l) { return l.id === id; })[0];
    if (!e) throw new Error('Entry not found.');
    if (o.actual !== undefined) {
      var a = num(o.actual, 'Amount');
      if (a < 0) throw new Error('Amount cannot be negative.');
      e.actual = r(a);
    }
    if (o.date !== undefined) {
      if (!isISO(o.date)) throw new Error('Pick a valid date.');
      e.date = o.date;
    }
    if (o.advance !== undefined) e.advance = !!o.advance;
    if (o.note !== undefined) e.note = String(o.note).slice(0, 200);
    return e;
  }

  function deleteEntry(state, id) {
    state.log = state.log.filter(function (l) { return l.id !== id; });
  }

  function setStreakSeed(state, days, today) {
    var d = Math.floor(num(days === '' ? 0 : days, 'Streak'));
    state.settings.streakSeed = d > 0 ? { days: d, endDate: addDays(today, -1) } : null;
  }

  // First-run setup. rows: [{name, unit, start, step, lifetime, backlog}], blank names are skipped.
  function setupFromOnboarding(state, o) {
    var rows = o.rows.filter(function (x) { return String(x.name || '').trim(); });
    if (!rows.length) throw new Error('Add at least one exercise.');
    var made = rows.map(function (x) { return addExercise(state, x); });
    var k = Math.max(0, Math.min(made.length - 1, o.firstIndex || 0));
    var firstRow = rows.indexOf(o.firstRow);
    if (firstRow >= 0) k = firstRow;
    state.exercises = made.slice(k).concat(made.slice(0, k));
    if (o.streakDays) setStreakSeed(state, o.streakDays, o.today || todayISO());
    return state;
  }

  return {
    r: r, toISO: toISO, todayISO: todayISO, parseISO: parseISO, addDays: addDays, diffDays: diffDays, isISO: isISO,
    newState: newState, migrate: migrate, sortedLog: sortedLog, getEx: getEx, currentCycle: currentCycle,
    enrich: enrich, currentTarget: currentTarget, exerciseStats: exerciseStats, activeList: activeList,
    nextExercise: nextExercise, rotationPreview: rotationPreview, streaks: streaks, activityGrid: activityGrid,
    addExercise: addExercise, updateExercise: updateExercise, resetPlan: resetPlan, moveExercise: moveExercise,
    deleteExercise: deleteExercise, logSession: logSession, editEntry: editEntry, deleteEntry: deleteEntry,
    setStreakSeed: setStreakSeed, setupFromOnboarding: setupFromOnboarding
  };
});
