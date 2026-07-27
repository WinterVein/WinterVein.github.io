# Study Split Timer

Split-screen timer: total study session on the left, a continuous
adjustable Pomodoro loop (default 45 min focus / 5 min break) on the
right.

## Run it

```
npm install
npm run dev
```

Then open the local URL it prints (usually `http://localhost:5173`).

## Deploying to GitHub Pages

```
npm run build:pages
```

This runs `build.mjs`, which wraps Vite's build with the right base
path for GitHub Pages and writes static output to `./docs` by default
(so you can just point Pages at the `docs/` folder on your main branch
— no extra branch or workflow needed, though it also works fine in a
CI workflow).

Base-path detection, in order:
- `BASE_PATH` env var, if you set one explicitly (e.g. `BASE_PATH=/foo/`)
- else, if running in GitHub Actions, derived from `GITHUB_REPOSITORY`:
  - `owner/some-repo` → base `/some-repo/`
  - `owner/owner.github.io` → base `/` (user/org root site)
- else → base `/`

Override the output folder with `OUT_DIR` (e.g. `OUT_DIR=dist` if your
workflow deploys from `dist/` to a `gh-pages` branch instead).

Example GitHub Actions step:
```yaml
- run: npm ci
- run: npm run build:pages
  env:
    OUT_DIR: dist
- uses: actions/upload-pages-artifact@v3
  with:
    path: dist
```

The script also drops a `.nojekyll` file in the output so GitHub Pages
doesn't run its Jekyll processing over the build.

## About "continuing while the computer is asleep"

Being fully honest about what's possible: **no web page can execute
JavaScript while the computer is actually asleep.** That's a hardware/OS
limit, not something any code — mine or anyone else's — can get around.
When the machine suspends, every timer, interval, and running tab is
frozen, full stop.

What this version does instead — which is the standard, correct way to
handle this — is never count time by ticking. Every timer stores a
real timestamp (`Date.now()`) for when it was started, plus a banked
total from any previous runs. The time shown on screen is always
recalculated fresh as `banked + (now − startedAt)`. So the instant your
laptop wakes up and the tab repaints, it immediately shows the correct
elapsed time and current Pomodoro phase — as if it had been running the
whole time — even though no code ran while it was asleep. A refresh or
reopening the tab also picks up exactly where it left off, since state
is saved to `localStorage`.

In short: it won't literally beep at you while your laptop lid is
closed, but it will never drift, lose time, or lose your place — it
always self-corrects the moment you look at it again.

If you specifically need alerts to fire while your computer is
sleeping, that's outside what any browser tab can do — you'd want your
OS's own sleep/wake or Do Not Disturb settings, or a native
menu-bar app, instead of a web page.

## Notes

- Desktop notifications: the first time you hit Start, the page will
  ask for notification permission. If granted, phase changes (and
  session completion) also fire a system notification — useful if
  you've alt-tabbed away, though same sleep caveat as above applies.
- Both timers persist independently in `localStorage`, so closing and
  reopening the tab won't reset them.
- Focus/break minutes and the total session length are editable while
  a timer is stopped; they lock while running.
