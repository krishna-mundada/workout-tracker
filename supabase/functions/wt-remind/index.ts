// Hourly job (pg_cron -> pg_net). For each reminder subscription whose local time has reached the chosen
// hour and which has nothing logged today, send one Web Push naming the next exercise.
// Deployed to the Supabase project; kept here so it can be edited and redeployed later.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const VAPID_PUBLIC = 'BLLSB4yxKbdVcNqEnPi8pJd9vebDebbTzPDV1Y44MO3VowE70_49SWaIhoZaVqFJH6mO7lZYXmTixlzCO1bdvAk';

interface Cycle { n: number; start: number; step: number }
interface Exercise { id: number; name: string; unit: string; active: boolean; cycles: Cycle[] }
interface Entry { id: number; date: string; exId: number; cycle: number; advance: boolean; extra?: boolean }
interface State { exercises: Exercise[]; log: Entry[] }

/** Local date (YYYY-MM-DD) and hour in a time zone. */
function localNow(tz: string, now = new Date()): { date: string; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/** Same rule as the app: the exercise after the last one logged, skipping inactive ones. */
function nextExercise(state: State): Exercise | null {
  const active = state.exercises.filter((e) => e.active);
  if (!active.length) return null;
  const log = state.log.filter((l) => !l.extra).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
  const lastId = log.at(-1)?.exId;
  if (lastId === undefined) return active[0];
  const idx = active.findIndex((e) => e.id === lastId);
  if (idx >= 0) return active[(idx + 1) % active.length];
  const all = state.exercises;
  const pos = all.findIndex((e) => e.id === lastId);
  for (let i = 1; pos >= 0 && i <= all.length; i++) {
    const candidate = all[(pos + i) % all.length];
    if (candidate.active) return candidate;
  }
  return active[0];
}

function target(state: State, ex: Exercise): number {
  const cycle = ex.cycles[ex.cycles.length - 1];
  const done = state.log.filter((l) => l.exId === ex.id && l.cycle === cycle.n && l.advance !== false).length;
  return Math.round((cycle.start + cycle.step * done) * 100) / 100;
}

Deno.serve(async () => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: cfg } = await admin.from('wt_config').select('value').eq('key', 'vapid_private').maybeSingle();
  if (!cfg) return Response.json({ error: 'VAPID key missing' }, { status: 500 });
  webpush.setVapidDetails('mailto:mundada.krishna27@gmail.com', VAPID_PUBLIC, cfg.value as string);

  const { data: subs, error } = await admin.from('wt_push_subscriptions').select('*');
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const result = { checked: subs?.length ?? 0, sent: 0, removed: 0, skipped: 0 };
  for (const sub of subs ?? []) {
    const { date, hour } = localNow(sub.tz);
    if (sub.last_sent_on === date || hour < sub.remind_hour) {
      result.skipped++;
      continue;
    }
    const { data: row } = await admin.from('wt_state').select('state').eq('user_id', sub.user_id).maybeSingle();
    const state = row?.state as State | undefined;
    if (!state || state.log.some((l) => l.date === date)) {
      result.skipped++;
      continue;
    }
    const ex = nextExercise(state);
    const body = ex ? `${ex.name}: ${target(state, ex)} ${ex.unit} is up next. Nothing logged today yet.` : 'Nothing logged today yet.';
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify({ title: 'Workout time', body }));
      await admin.from('wt_push_subscriptions').update({ last_sent_on: date }).eq('endpoint', sub.endpoint);
      result.sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await admin.from('wt_push_subscriptions').delete().eq('endpoint', sub.endpoint);
        result.removed++;
      }
    }
  }
  return Response.json(result);
});
