# Workout Tracker

Personal installable PWA. Four exercises in strict rotation (Push-ups, Squats, Crunches, Run). Each exercise's target goes up one step every time that exercise is completed. Tracks streaks, backlog (actual minus target, all time), lifetime totals, history and charts.

TypeScript (strict), Vite, Vitest. No framework, no runtime dependencies. Data lives in the browser's localStorage.

## Commands

```
npm install
npm run dev        # local dev server
npm test           # vitest
npm run typecheck
npm run build      # typecheck + production build into dist/
```

Pushing to `master` redeploys on Vercel (framework preset: Vite, output `dist`).

## Layout

| File | Job |
| --- | --- |
| `src/config.ts` | The routine (`PLAN`) and tuning numbers. The one file to edit for most changes. |
| `src/types.ts` | Data shapes. |
| `src/logic.ts` | All rules, pure functions, no DOM or storage. Everything shown is derived from the log. |
| `src/store.ts` | Persistence, undo snapshots, import and export. Storage is injected so tests use a fake. |
| `src/views.ts` | Screens as pure functions returning HTML. |
| `src/html.ts`, `src/format.ts` | Small markup and formatting helpers shared by the views. |
| `src/sync.ts` | Cloud sync (Supabase). `planSync` is the pure decision logic and is unit tested. |
| `src/push.ts` | Web Push subscription for the daily reminder. |
| `supabase/functions/wt-remind/` | Hourly reminder function. Deployed copy lives in the Supabase project; redeploy after editing. |
| `src/dom.ts` | Form reading, toast, modal, download. |
| `src/app.ts` | Wiring: state, rendering, the `actions` map (`data-act="name"`), events. |
| `src/styles.css` | Theme variables at the top; per-exercise colours come from `PLAN`. |
| `public/` | Service worker (network first), manifest, icons. |

## Changing things

- Routines are data now: edit exercises in the app under Backup, Routine (name, unit, step, colour, order, pause). `TEMPLATE` in `config.ts` only feeds the first-run "four-exercise rotation" option and defaults for older saved data.
- Rules (rotation, targets, streaks): `logic.ts`, then add a test in `logic.test.ts`.
- New button or screen action: add a function to `actions` in `app.ts` and a `data-act` in the view.
- Do not change `storageKey` or `snapshotKey` in `config.ts`: they match the data already on the phone.

## Install on a phone

iPhone: open the site in Safari, Share, Add to Home Screen. Android: Chrome menu, Install app. It must be the browser itself, not a link opened inside another app. The app also shows an install card under Backup.

## Backups

Data is per browser. Use Backup > Download file or Copy as text now and then. The app also keeps the last few states automatically (Backup > Automatic snapshots).

## Cloud (Supabase, kancess project)

Tables, all prefixed `wt_`: `wt_state` (one JSON document per user), `wt_push_subscriptions`, `wt_config` (VAPID private key, no client access). Row-level security allows only the owner's email. An hourly pg_cron job calls the `wt-remind` edge function. Sync is last-write-wins with a prompt when both sides changed; the phone copy always works offline.

Public values (project URL, publishable key, VAPID public key) are in `CLOUD` in `src/config.ts`.
