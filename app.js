/* Workout Tracker UI. The plan lives in PLAN below; the rules live in logic.js. */
(function () {
  'use strict';
  var T = window.Tracker;

  // Your routine. Order = rotation order. step = increase per completed session of that exercise.
  // start is only the default shown on the first-run screen.
  var PLAN = [
    { name: 'Push-ups', unit: 'reps', step: 1, start: 20 },
    { name: 'Squats', unit: 'reps', step: 1, start: 20 },
    { name: 'Crunches', unit: 'reps', step: 1, start: 20 },
    { name: 'Run', unit: 'km', step: 0.1, start: 2 }
  ];

  var KEY = 'rotation-tracker-v1';
  var SNAPKEY = 'rotation-tracker-v1-snaps';
  var WEEK = 7 * 86400000;
  var app = document.getElementById('app');

  function $(sel) { return document.querySelector(sel); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n) { return T.r(n).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
  function signed(n) { return (n > 0 ? '+' : '') + fmt(n); }
  function chip(n, unit) {
    var cls = n > 0 ? 'chip' : n < 0 ? 'chip neg' : 'chip zero';
    return '<span class="' + cls + '">' + signed(n) + (unit && unit !== 'reps' ? ' ' + esc(unit) : '') + '</span>';
  }
  function longDate(iso) {
    return T.parseISO(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function shortDate(iso) { return T.parseISO(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); }

  // ---------- storage ----------
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }

  var state = load();
  function load() {
    var raw = lsGet(KEY);
    if (raw) {
      try { return T.migrate(JSON.parse(raw)); }
      catch (e) { console.error(e); lsSet(KEY + '-corrupt-' + Date.now(), raw); }
    }
    return T.newState();
  }
  function persist() { if (!lsSet(KEY, JSON.stringify(state))) toast('Could not save. Storage may be full or blocked.'); }
  function snapshot() {
    if (!state.exercises.length) return;
    try {
      var snaps = JSON.parse(lsGet(SNAPKEY) || '[]');
      snaps.unshift({ ts: Date.now(), data: JSON.stringify(state) });
      while (snaps.length > 6) snaps.pop();
      lsSet(SNAPKEY, JSON.stringify(snaps));
    } catch (e) { /* snapshots are best effort */ }
  }
  function mutate(fn) { snapshot(); var res = fn(state); persist(); render(); return res; }
  function replaceState(next) { snapshot(); state = next; persist(); render(); }

  // ---------- ui state ----------
  var ui = { tab: 'today', override: null, optOpen: false, histAll: false };

  function toast(msg, label, action) {
    var el = $('#toast');
    el.innerHTML = '<span>' + esc(msg) + '</span>' + (label ? '<button id="toastAct">' + esc(label) + '</button>' : '');
    el.classList.add('show');
    if (label) $('#toastAct').onclick = function () { el.classList.remove('show'); action(); };
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { el.classList.remove('show'); }, label ? 7000 : 3200);
  }
  function openModal(html) {
    var m = $('#modal');
    m.innerHTML = '<div class="sheet">' + html + '</div>';
    m.classList.add('open');
    m.onclick = function (e) { if (e.target === m) closeModal(); };
  }
  function closeModal() { var m = $('#modal'); m.classList.remove('open'); m.innerHTML = ''; }

  function numField(id) {
    var v = parseFloat(String(($('#' + id) || {}).value || '').replace(',', '.'));
    return v;
  }

  // ---------- views ----------
  function render() {
    var ctx = { en: T.enrich(state), today: T.todayISO() };
    ctx.st = T.streaks(state, ctx.today);
    var onboarding = !state.exercises.length;
    $('#tabs').hidden = onboarding;
    Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b) {
      b.classList.toggle('on', b.dataset.tab === ui.tab);
    });
    var views = { today: viewToday, history: viewHistory, progress: viewProgress, more: viewMore };
    app.innerHTML = onboarding ? viewOnboarding() : views[ui.tab](ctx);
  }

  function viewOnboarding() {
    var rows = PLAN.map(function (p, i) {
      return '<div class="ob-row"><div class="row"><b>' + esc(p.name) + '</b>' +
        '<label class="check" style="margin:0"><input type="radio" name="first" value="' + i + '"' + (i === 0 ? ' checked' : '') + '>Up first</label></div>' +
        '<div class="two">' +
        '<div><label>Next target (' + esc(p.unit) + ')</label><input type="text" inputmode="decimal" id="ob-t-' + i + '" value="' + p.start + '"></div>' +
        '<div><label>Total so far</label><input type="text" inputmode="decimal" id="ob-l-' + i + '" placeholder="0"></div>' +
        '</div>' +
        '<label>Backlog so far (ahead +, behind -)</label><input type="text" inputmode="decimal" id="ob-b-' + i + '" placeholder="0"></div>';
    }).join('');
    return '<h1 style="margin:6px 0 4px">Set your starting point</h1>' +
      '<p class="muted">One time only. Enter where each exercise stands right now, and which one is next. Targets go up by ' +
      PLAN.map(function (p) { return '+' + fmt(p.step) + ' ' + (p.unit === 'reps' && p.step === 1 ? 'rep' : esc(p.unit)); })
        .filter(function (v, i, a) { return a.indexOf(v) === i; }).join(' or ') +
      ' each time you complete that exercise.</p>' +
      '<div class="card">' + rows + '</div>' +
      '<div class="card"><label style="margin-top:0">Current streak in days (counting up to yesterday)</label>' +
      '<input type="text" inputmode="numeric" id="ob-streak" placeholder="0"></div>' +
      '<button class="primary" data-act="start">Start tracking</button>';
  }

  function viewToday(ctx) {
    var active = T.activeList(state);
    var nextEx = T.nextExercise(state);
    var ex = (ui.override && active.filter(function (e) { return e.id === ui.override; })[0]) || nextEx;
    var st = T.exerciseStats(state, ex, ctx.en);
    var step = ex.step || st.step || 1;
    step = T.currentCycle(ex).step || 1;
    var out = '';

    var lastBackup = state.settings.lastBackup;
    if (state.log.length >= 3 && (!lastBackup || Date.now() - lastBackup > WEEK)) {
      var days = lastBackup ? Math.floor((Date.now() - lastBackup) / 86400000) + ' days' : 'ever';
      out += '<div class="banner">No backup in ' + days + '. <button data-act="tab" data-tab="more">Back up</button></div>';
    }

    var doneToday = ctx.st.todayDone;
    var todays = ctx.en.filter(function (e) { return e.date === ctx.today; });
    if (doneToday && todays.length) {
      out += '<div class="banner ok">Done today: ' + todays.map(function (e) {
        return esc(e.name) + ' ' + fmt(e.actual) + (e.unit === 'reps' ? '' : ' ' + esc(e.unit));
      }).join(', ') + '</div>';
    } else if (doneToday) {
      out += '<div class="banner ok">Today is covered by your streak.</div>';
    }

    out += '<section class="card hero"><div class="eyebrow">' + (doneToday ? 'Up next' : 'Today') + ' &middot; ' + longDate(ctx.today) + '</div>' +
      '<h1>' + esc(ex.name) + '</h1>' +
      '<div class="target"><b id="tnum">' + fmt(st.target) + '</b><span>' + esc(ex.unit) + '</span></div>';
    if (st.last) {
      out += '<div class="muted small">Last time ' + fmt(st.last.actual) + ' ' + esc(ex.unit) + ' on ' + shortDate(st.last.date) +
        ' &nbsp;' + chip(st.last.delta) + '</div>';
    } else {
      out += '<div class="muted small">First session of this exercise.</div>';
    }
    out += '<div class="stepper"><button class="sq" data-act="dec" aria-label="less">-</button>' +
      '<input id="actual" type="text" inputmode="decimal" value="' + st.target + '" data-step="' + step + '">' +
      '<button class="sq" data-act="inc" aria-label="more">+</button></div>' +
      '<button class="primary" data-act="log" data-ex="' + ex.id + '">Log ' + esc(ex.name) + '</button>' +
      '<details id="opts"' + (ui.optOpen ? ' open' : '') + '><summary>Options</summary>' +
      '<label>Exercise</label><select id="exSel">' + active.map(function (e) {
        return '<option value="' + e.id + '"' + (e.id === ex.id ? ' selected' : '') + '>' + esc(e.name) + '</option>';
      }).join('') + '</select>' +
      '<label>Date</label><input type="date" id="logDate" value="' + ctx.today + '">' +
      '<label class="check"><input type="checkbox" id="hold">Hold target next time (do not add the increase)</label>' +
      '<label>Note</label><input type="text" id="note" maxlength="200">' +
      '</details></section>';

    var s = ctx.st;
    out += '<section class="card"><div class="grid3">' +
      '<div><b>' + s.current + '</b><span>day streak</span></div>' +
      '<div><b>' + s.longest + '</b><span>best streak</span></div>' +
      '<div><b>' + s.activeDays + '</b><span>active days</span></div></div></section>';

    var prev = T.rotationPreview(state, active.length).filter(function (p) { return p.ex.id !== ex.id; });
    if (prev.length) {
      out += '<section class="card"><h2>Coming up</h2><div class="list">' + prev.map(function (p) {
        return '<div><span>' + esc(p.ex.name) + '</span><b class="num">' + fmt(p.target) + ' ' + esc(p.ex.unit) + '</b></div>';
      }).join('') + '</div></section>';
    }

    out += '<section class="card"><h2>Backlog</h2><p class="muted small">Actual minus target, all time. Plus means you are ahead.</p><div class="list">' +
      active.map(function (e) {
        var x = T.exerciseStats(state, e, ctx.en);
        return '<div><span>' + esc(e.name) + '</span>' + chip(x.surplus, e.unit) + '</div>';
      }).join('') + '</div></section>';
    return out;
  }

  function viewHistory(ctx) {
    var rows = ctx.en.slice().reverse();
    var shown = ui.histAll ? rows : rows.slice(0, 120);
    var out = '<div class="row" style="margin-bottom:6px"><h2 style="margin:0">History</h2>' +
      '<button class="ghost" data-act="addPast">Add past entry</button></div>';
    if (!rows.length) return out + '<p class="muted">Nothing logged yet.</p>';
    var day = null;
    shown.forEach(function (e) {
      if (e.date !== day) { day = e.date; out += '<div class="hist-day">' + longDate(day) + '</div>'; }
      out += '<button class="hist-row" data-act="editEntry" data-id="' + e.id + '"><span><b>' + esc(e.name) + '</b> ' +
        '<span class="muted num">' + fmt(e.actual) + ' ' + esc(e.unit) + ' of ' + fmt(e.target) + '</span>' +
        (e.advance === false ? ' <span class="muted small">(held)</span>' : '') + '</span>' + chip(e.delta) + '</button>';
    });
    if (!ui.histAll && rows.length > shown.length) {
      out += '<p style="text-align:center;margin-top:12px"><button class="ghost" data-act="histAll">Show all ' + rows.length + '</button></p>';
    }
    return out;
  }

  function chartSVG(entries) {
    var W = 320, H = 150, pl = 36, pr = 10, pt = 12, pb = 22;
    var es = entries.slice(-120), n = es.length;
    var vals = [];
    es.forEach(function (e) { vals.push(e.actual, e.target); });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    if (min === max) { min -= 1; max += 1; }
    var padv = (max - min) * 0.12; min -= padv; max += padv;
    function x(i) { return pl + (n === 1 ? 0.5 : i / (n - 1)) * (W - pl - pr); }
    function y(v) { return pt + (1 - (v - min) / (max - min)) * (H - pt - pb); }
    function path(key) { return es.map(function (e, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(e[key]).toFixed(1); }).join(' '); }
    var ticks = [min + padv, (min + max) / 2, max - padv].map(function (v) {
      return '<line class="gl" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>' +
        '<text class="ax" x="' + (pl - 6) + '" y="' + (y(v) + 3).toFixed(1) + '" text-anchor="end">' + fmt(v) + '</text>';
    }).join('');
    var dots = n <= 60 ? es.map(function (e, i) {
      return '<circle class="dot" cx="' + x(i).toFixed(1) + '" cy="' + y(e.actual).toFixed(1) + '" r="2.6"/>';
    }).join('') : '';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Reps per session against target">' + ticks +
      '<path class="lt" d="' + path('target') + '"/><path class="la" d="' + path('actual') + '"/>' + dots +
      '<text class="ax" x="' + pl + '" y="' + (H - 4) + '">' + shortDate(es[0].date) + '</text>' +
      '<text class="ax" x="' + (W - pr) + '" y="' + (H - 4) + '" text-anchor="end">' + shortDate(es[n - 1].date) + '</text></svg>';
  }

  function viewProgress(ctx) {
    var grid = T.activityGrid(state, ctx.today, 12);
    var out = '<section class="card"><h2>Last 12 weeks</h2><div class="heat">' + grid.map(function (col) {
      return col.map(function (c) {
        return '<div class="cell' + (c.future ? ' future' : c.done ? ' on' : '') + '" title="' + c.date + '"></div>';
      }).join('');
    }).join('') + '</div></section>';
    state.exercises.forEach(function (ex) {
      var x = T.exerciseStats(state, ex, ctx.en);
      out += '<section class="card"><div class="row"><h2 style="margin:0">' + esc(ex.name) + '</h2>' + chip(x.surplus, ex.unit) + '</div>' +
        '<div class="grid3" style="margin:14px 0">' +
        '<div><b>' + fmt(x.total) + '</b><span>total ' + esc(ex.unit) + '</span></div>' +
        '<div><b>' + x.sessions + '</b><span>sessions</span></div>' +
        '<div><b>' + fmt(x.target) + '</b><span>next target</span></div></div>' +
        (x.entries.length >= 2 ? chartSVG(x.entries) + '<p class="muted small" style="margin:6px 0 0">Solid: what you did. Dashed: target.</p>'
          : '<p class="muted small">Log two sessions to see the chart.</p>') + '</section>';
    });
    return out;
  }

  function viewMore() {
    var lb = state.settings.lastBackup;
    var snaps = [];
    try { snaps = JSON.parse(lsGet(SNAPKEY) || '[]'); } catch (e) { snaps = []; }
    var out = '<h2 style="font-size:1.3rem">Backup</h2>' +
      '<p class="muted">Your data lives only on this device. Export a copy now and then, especially before clearing browser data or changing phones.</p>' +
      '<section class="card"><p class="small muted">Last backup: ' + (lb ? new Date(lb).toLocaleString() : 'never') + '</p>' +
      '<div class="two"><button class="primary" data-act="exportFile">Download file</button>' +
      '<button class="ghost" data-act="copyBackup">Copy as text</button></div>' +
      '<div class="two" style="margin-top:10px"><label class="ghost" style="margin:0;text-align:center;color:var(--ink)">Import file' +
      '<input type="file" id="importFile" accept="application/json,.json" hidden></label>' +
      '<button class="ghost" data-act="importText">Paste text</button></div></section>';
    out += '<section class="card"><h2>Automatic snapshots</h2><p class="small muted">The app keeps the last few states before each change, so a bad edit can be undone.</p>';
    if (!snaps.length) out += '<p class="small">None yet.</p>';
    else {
      out += '<div class="list">' + snaps.map(function (s, i) {
        var d;
        try { d = JSON.parse(s.data); } catch (e) { d = { log: [] }; }
        return '<div><span class="small">' + new Date(s.ts).toLocaleString() + '<br><span class="muted">' + d.log.length + ' entries</span></span>' +
          '<button class="ghost" data-act="restore" data-i="' + i + '">Restore</button></div>';
      }).join('') + '</div>';
    }
    out += '</section><section class="card"><button class="ghost danger" data-act="erase">Erase everything</button></section>';
    return out;
  }

  // ---------- modals ----------
  function entryForm(e, ctx) {
    var isNew = !e;
    var active = state.exercises;
    var ex = isNew ? T.nextExercise(state) : T.getEx(state, e.exId);
    return '<h2>' + (isNew ? 'Add past entry' : 'Edit entry') + '</h2>' +
      (isNew ? '<label>Exercise</label><select id="m-ex">' + active.map(function (a) {
        return '<option value="' + a.id + '"' + (a.id === ex.id ? ' selected' : '') + '>' + esc(a.name) + '</option>';
      }).join('') + '</select>' : '<p class="muted">' + esc(ex ? ex.name : '') + '</p>') +
      '<label>Date</label><input type="date" id="m-date" value="' + (isNew ? T.addDays(ctx.today, -1) : e.date) + '">' +
      '<label>Amount</label><input type="text" inputmode="decimal" id="m-actual" value="' + (isNew ? '' : e.actual) + '">' +
      '<label class="check"><input type="checkbox" id="m-hold"' + (!isNew && e.advance === false ? ' checked' : '') + '>Held (did not advance the target)</label>' +
      '<label>Note</label><input type="text" id="m-note" maxlength="200" value="' + (isNew ? '' : esc(e.note || '')) + '">' +
      '<div class="btns">' + (isNew ? '' : '<button class="ghost danger" data-act="delEntry" data-id="' + e.id + '">Delete</button>') +
      '<button class="ghost" data-act="closeModal">Cancel</button>' +
      '<button class="primary" data-act="' + (isNew ? 'savePast' : 'saveEntry') + '"' + (isNew ? '' : ' data-id="' + e.id + '"') + '>Save</button></div>';
  }

  // ---------- actions ----------
  function bump(dir) {
    var inp = $('#actual');
    var v = parseFloat(String(inp.value).replace(',', '.')) || 0;
    inp.value = Math.max(0, T.r(v + dir * (Number(inp.dataset.step) || 1)));
  }

  function download(name, text) {
    var blob = new Blob([text], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function markBackup() { state.settings.lastBackup = Date.now(); persist(); render(); }

  var handlers = {
    tab: function (b) { ui.tab = b.dataset.tab; ui.override = null; render(); window.scrollTo(0, 0); },
    dec: function () { bump(-1); },
    inc: function () { bump(1); },
    closeModal: closeModal,
    histAll: function () { ui.histAll = true; render(); },

    start: function () {
      var rows = PLAN.map(function (p, i) {
        var t = numField('ob-t-' + i);
        if (!isFinite(t)) throw new Error('Enter a next target for ' + p.name + '.');
        var l = ($('#ob-l-' + i).value || '').trim(), bl = ($('#ob-b-' + i).value || '').trim();
        return { name: p.name, unit: p.unit, step: p.step, start: t, lifetime: l, backlog: bl };
      });
      var first = Number((document.querySelector('input[name=first]:checked') || {}).value || 0);
      var streak = ($('#ob-streak').value || '').trim();
      var next = T.newState();
      T.setupFromOnboarding(next, { rows: rows, firstRow: rows[first], streakDays: streak });
      ui.tab = 'today';
      replaceState(next);
    },

    log: function (b) {
      var exId = Number(b.dataset.ex);
      var actual = numField('actual');
      if (!isFinite(actual) || actual < 0) throw new Error('Enter a number.');
      var date = ($('#logDate') || {}).value || T.todayISO();
      var hold = !!($('#hold') || {}).checked;
      var note = ($('#note') || {}).value || '';
      var ex = T.getEx(state, exId);
      var entry = mutate(function (s) { return T.logSession(s, { exId: exId, actual: actual, date: date, advance: !hold, note: note }); });
      ui.override = null;
      toast('Logged ' + ex.name + ' ' + fmt(actual) + (ex.unit === 'reps' ? '' : ' ' + ex.unit), 'Undo', function () {
        mutate(function (s) { T.deleteEntry(s, entry.id); });
      });
    },

    editEntry: function (b) {
      var e = state.log.filter(function (l) { return l.id === Number(b.dataset.id); })[0];
      if (e) openModal(entryForm(e, { today: T.todayISO() }));
    },
    addPast: function () { openModal(entryForm(null, { today: T.todayISO() })); },
    saveEntry: function (b) {
      var a = numField('m-actual');
      if (!isFinite(a)) throw new Error('Enter a number.');
      mutate(function (s) {
        T.editEntry(s, Number(b.dataset.id), { actual: a, date: $('#m-date').value, advance: !$('#m-hold').checked, note: $('#m-note').value });
      });
      closeModal();
    },
    savePast: function () {
      var a = numField('m-actual');
      if (!isFinite(a)) throw new Error('Enter a number.');
      mutate(function (s) {
        T.logSession(s, { exId: Number($('#m-ex').value), actual: a, date: $('#m-date').value, advance: !$('#m-hold').checked, note: $('#m-note').value });
      });
      closeModal();
    },
    delEntry: function (b) {
      if (!confirm('Delete this entry? Targets and totals will be recalculated.')) return;
      mutate(function (s) { T.deleteEntry(s, Number(b.dataset.id)); });
      closeModal();
    },

    exportFile: function () {
      download('workout-backup-' + T.todayISO() + '.json', JSON.stringify(state, null, 2));
      markBackup();
      toast('Backup downloaded.');
    },
    copyBackup: function () {
      var text = JSON.stringify(state);
      var done = function () { markBackup(); toast('Copied. Paste it somewhere safe, like Notes.'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { toast('Copy was blocked. Use Download instead.'); });
      else toast('Copy is not available here. Use Download instead.');
    },
    importText: function () {
      openModal('<h2>Paste backup text</h2><textarea id="m-text" placeholder="Paste the copied backup here"></textarea>' +
        '<div class="btns"><button class="ghost" data-act="closeModal">Cancel</button><button class="primary" data-act="doImportText">Import</button></div>');
    },
    doImportText: function () {
      var next = T.migrate(JSON.parse($('#m-text').value));
      if (!confirm('Replace current data with this backup?')) return;
      closeModal();
      replaceState(next);
      toast('Backup imported.');
    },
    restore: function (b) {
      var snaps = JSON.parse(lsGet(SNAPKEY) || '[]');
      var s = snaps[Number(b.dataset.i)];
      if (!s || !confirm('Restore this snapshot? Your current state is saved as a new snapshot first.')) return;
      replaceState(T.migrate(JSON.parse(s.data)));
      toast('Snapshot restored.');
    },
    erase: function () {
      if (!confirm('Erase all data on this device?')) return;
      if (!confirm('Really erase everything? A snapshot is kept in Backup > Automatic snapshots until you clear browser data.')) return;
      ui.tab = 'today';
      replaceState(T.newState());
    }
  };

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var fn = handlers[b.dataset.act];
    if (!fn) return;
    try { fn(b, e); } catch (err) { toast(err && err.message ? err.message : String(err)); }
  });
  document.addEventListener('change', function (e) {
    if (e.target.id === 'exSel') { ui.override = Number(e.target.value); ui.optOpen = true; render(); }
    if (e.target.id === 'importFile' && e.target.files[0]) {
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var next = T.migrate(JSON.parse(rd.result));
          if (!confirm('Replace current data with this backup?')) return;
          replaceState(next);
          toast('Backup imported.');
        } catch (err) { toast(err.message || 'Could not read that file.'); }
      };
      rd.readAsText(e.target.files[0]);
    }
  });
  document.addEventListener('toggle', function (e) { if (e.target.id === 'opts') ui.optOpen = e.target.open; }, true);

  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
  render();
})();
