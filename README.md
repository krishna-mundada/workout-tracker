# Workout Tracker

A small offline-capable web app (PWA) for one specific routine: four exercises in rotation, and each exercise goes up by one step every time you complete it.

Push-ups, squats, crunches, run, repeat. Push-ups 20 today, squats 20 tomorrow, crunches 20, run 2 km, then push-ups 21.

## What it tracks

- Today's exercise and target, with a stepper to log what you actually did
- Backlog per exercise: actual minus target, all time (plus means ahead)
- Day streak, best streak, active days, 12-week activity grid
- Per-exercise lifetime total, session count, next target, and a chart of actual vs target
- Full history, with edit and delete (targets and totals recalculate)

Everything is derived from the log. Missed days do not shift the rotation or the targets, and fixing a wrong entry never leaves the numbers out of sync.

## Files

| File | What it does |
|---|---|
| `index.html` | Page shell and all styling |
| `app.js` | Screens and buttons. The routine itself is the `PLAN` list at the top |
| `logic.js` | The rules: rotation, targets, backlog, streaks. No UI, no storage |
| `logic.test.js` | Tests for the rules. Run `node logic.test.js` |
| `sw.js`, `manifest.webmanifest`, icons | Make it installable and usable offline |

## Run it locally

```
python3 -m http.server 8000
```

Open http://localhost:8000. Plain `file://` will not work for installing or offline use.

## Put it on your phone

Any static host works, no build step. Pick one:

- Vercel: run `npx vercel` in this folder, or import the folder as a project
- Netlify: drag the folder onto https://app.netlify.com/drop
- GitHub Pages: push the folder to a repo and enable Pages

Then open the URL on your phone and add it to the home screen (Share > Add to Home Screen on iPhone, menu > Install app on Android).

## Your data

Data is stored in the browser on your device (localStorage). There is no server and no account. That keeps it private and free, but it means:

- Clearing browser data or switching phones loses it unless you have a backup
- Use Backup > Download file, or Copy as text and paste it into Notes, every week or so. The app nags after 7 days
- The app also keeps its last 6 states automatically (Backup > Automatic snapshots) so a mistake can be rolled back
- Installing to the home screen matters on iPhone: Safari can clear storage for sites you have not opened in a while, but installed apps are exempt

## Changing the routine later

Open this folder in Claude Code and describe the change. Examples:

- "Add diamond push-ups to the rotation after push-ups"
- "Run should go up by 0.2 km instead of 0.1"
- "Add a weekly total chart"

For a new exercise, add a line to `PLAN` in `app.js`. Existing saved data keeps working, but a new exercise needs to be added to the saved state too, so ask Claude Code to include a small migration that adds it with your starting numbers. Run `node logic.test.js` after any change to `logic.js`.
