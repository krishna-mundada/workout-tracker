// Run with: node logic.test.js
var assert = require('assert');
var T = require('./logic.js');

function fresh() {
  var s = T.newState();
  T.setupFromOnboarding(s, {
    rows: [
      { name: 'Push-ups', unit: 'reps', step: 1, start: 20, lifetime: '1700' },
      { name: 'Squats', unit: 'reps', step: 1, start: 20 },
      { name: 'Crunches', unit: 'reps', step: 1, start: 20 },
      { name: 'Run', unit: 'km', step: 0.1, start: 2 }
    ],
    today: '2026-10-22'
  });
  return s;
}
function name(s) { return T.nextExercise(s).name; }
function logNext(s, date, actual) {
  var ex = T.nextExercise(s);
  return T.logSession(s, { exId: ex.id, date: date, actual: actual === undefined ? T.currentTarget(s, ex) : actual });
}

// rotation + one increase per completed session of that exercise
var s = fresh();
assert.strictEqual(name(s), 'Push-ups');
var seq = [];
for (var i = 0; i < 9; i++) { var ex = T.nextExercise(s); seq.push(ex.name + ':' + T.currentTarget(s, ex)); logNext(s, T.addDays('2026-10-01', i)); }
assert.deepStrictEqual(seq, ['Push-ups:20', 'Squats:20', 'Crunches:20', 'Run:2', 'Push-ups:21', 'Squats:21', 'Crunches:21', 'Run:2.1', 'Push-ups:22']);

// calendar gaps change nothing about the rotation
s = fresh();
logNext(s, '2026-10-01'); logNext(s, '2026-10-09');
assert.strictEqual(name(s), 'Crunches');

// backlog: surplus and deficit
s = fresh();
logNext(s, '2026-10-01', 25);          // +5
logNext(s, '2026-10-02', 18);          // -2
var en = T.enrich(s);
assert.strictEqual(en[0].delta, 5); assert.strictEqual(en[1].delta, -2);
assert.strictEqual(T.exerciseStats(s, s.exercises[0], en).surplus, 5);
assert.strictEqual(T.exerciseStats(s, s.exercises[1], en).surplus, -2);
// target advances by schedule, not by what you actually did
assert.strictEqual(T.currentTarget(s, s.exercises[0]), 21);

// lifetime total includes opening balance
assert.strictEqual(T.exerciseStats(s, s.exercises[0], en).total, 1725);

// hold: does not advance the target
s = fresh();
var e1 = logNext(s, '2026-10-01', 15); T.editEntry(s, e1.id, { advance: false });
assert.strictEqual(T.currentTarget(s, s.exercises[0]), 20);

// delete recalculates everything
s = fresh();
var a = logNext(s, '2026-10-01'); logNext(s, '2026-10-02'); logNext(s, '2026-10-03'); logNext(s, '2026-10-04'); logNext(s, '2026-10-05', 30);
assert.strictEqual(T.enrich(s)[4].target, 21);
T.deleteEntry(s, a.id);
assert.strictEqual(T.enrich(s)[3].target, 20);
assert.strictEqual(T.enrich(s)[3].delta, 10);

// backfill with an earlier date slots into the right place
s = fresh();
logNext(s, '2026-10-05');
T.logSession(s, { exId: s.exercises[0].id, date: '2026-10-03', actual: 20 });
var e = T.enrich(s);
assert.strictEqual(e[0].date, '2026-10-03'); assert.strictEqual(e[0].target, 20);
assert.strictEqual(e[1].date, '2026-10-05'); assert.strictEqual(e[1].target, 21);

// decimals do not drift
s = fresh();
var run = s.exercises[3];
for (var k = 0; k < 7; k++) T.logSession(s, { exId: run.id, date: T.addDays('2026-09-01', k), actual: 2 });
assert.strictEqual(T.currentTarget(s, run), 2.7);

// streaks
s = fresh();
T.setStreakSeed(s, 10, '2026-10-22');                      // 10 days up to yesterday
var st = T.streaks(s, '2026-10-22');
assert.strictEqual(st.current, 10); assert.strictEqual(st.todayDone, false);
logNext(s, '2026-10-22');
st = T.streaks(s, '2026-10-22');
assert.strictEqual(st.current, 11); assert.strictEqual(st.todayDone, true); assert.strictEqual(st.longest, 11);
st = T.streaks(s, '2026-10-24');                             // two missed days, streak is gone
assert.strictEqual(st.current, 0); assert.strictEqual(st.longest, 11);
st = T.streaks(s, '2026-10-23');                             // today not yet done, yesterday keeps it alive
assert.strictEqual(st.current, 11);

// plan change keeps history targets intact
s = fresh();
logNext(s, '2026-10-01'); for (var q = 0; q < 3; q++) logNext(s, T.addDays('2026-10-02', q));
logNext(s, '2026-10-06');                                    // push-ups #2 -> target 21
T.resetPlan(s, s.exercises[0].id, { start: 30, step: 2 });
assert.strictEqual(T.currentTarget(s, s.exercises[0]), 30);
assert.strictEqual(T.enrich(s)[4].target, 21);               // history untouched
logNext(s, '2026-10-07'); logNext(s, '2026-10-08'); logNext(s, '2026-10-09'); logNext(s, '2026-10-10');
assert.strictEqual(T.currentTarget(s, s.exercises[0]), 32);

// deactivating an exercise skips it without breaking the cycle
s = fresh();
logNext(s, '2026-10-01');                                    // push-ups done, squats next
T.updateExercise(s, s.exercises[1].id, { active: false });
assert.strictEqual(name(s), 'Crunches');

// onboarding: chosen first exercise keeps the cyclic order
s = T.newState();
var rows = [{ name: 'A', start: 1 }, { name: 'B', start: 1 }, { name: 'C', start: 1 }];
T.setupFromOnboarding(s, { rows: rows, firstRow: rows[2] });
assert.deepStrictEqual(s.exercises.map(function (x) { return x.name; }), ['C', 'A', 'B']);

// backup round trip and validation
s = fresh(); logNext(s, '2026-10-01', 22);
var back = T.migrate(JSON.parse(JSON.stringify(s)));
assert.deepStrictEqual(T.enrich(back), T.enrich(s));
assert.throws(function () { T.migrate({ nope: 1 }); });
assert.throws(function () { T.logSession(s, { exId: 999, actual: 5 }); });
assert.throws(function () { T.logSession(s, { exId: s.exercises[0].id, actual: 'abc' }); });
assert.throws(function () { T.deleteExercise(s, s.exercises[0].id); });

// ids never collide after import
var c1 = logNext(back, '2026-10-02');
assert.ok(!s.log.some(function (l) { return l.id === c1.id; }));

console.log('all logic tests passed');
