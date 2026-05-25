# Rubik's Storage

Static web app browsing + drilling the CFOP corpus in `rubiks-cube-algorithms.json` (21 PLL / 57 OLL / 25 F2L-adv / 16 F2L-beg).

## Files
- `index.html` · `styles.css` — shell, theming, mobile responsive
- `app.js` — main render loop, CATEGORIES table, image loading, theme toggle, header buttons
- `selection.js` — cross-tab multi-select state
- `modal.js` — overlay/escape/scroll-lock used by drill, recognition, and timer
- `cube-notation.js` — random AUF/Y, scramble builder
- `stats.js` — localStorage (`rs-stats-v2`) per-case stats with reset
- `drill.js` — drill mode (cstimer-style spacebar timer; tap-to-start fallback on touch)
- `recognition.js` — recognition trainer with settings screen, time limit, name-button picker
- `timer.js` — CSTimer-style speedcubing timer (header button → fullscreen modal)
- `sessions.js` — timer sessions + solves persistence; WCA stats helpers (ao5/ao12/mean/best)
- `scramble-3x3.js` — random-move 3x3 scramble generator with prefetch hooks
- `rubiks-cube-algorithms.json` — dataset (PLL/OLL include `setup` and OLL has `recognitionGroup`)
- `scripts/compute-setups.py` — one-time pycuber script that generated setup + recognitionGroup
- `sw.js` · `manifest.webmanifest` · `icon.svg` — PWA: offline support, installable
- `.claude/skills/deploy/SKILL.md` — deploy workflow skill (auto-loaded each session)
- `rubiks-cube-storage-prompt.md` — original generation prompt

## Run
`npm start` → `http://localhost:8000`. Needs HTTP (file:// blocks fetch). No deps, no build.

## Architecture
Single `CATEGORIES` table in `app.js` drives tabs, search, filters, cards, and **feature gating** via per-category flags (`drillable`, `recognitionMode`). Adding a category (ZBLL, COLL, scrambles, etc.) = one new row + matching data in the JSON.

Extension hooks:
- `extraBadges` / `metaRows` / `filterFacets` per category
- `drillable: bool` controls whether selection checkboxes + drill/recognition buttons appear
- `recognitionMode: "text" | "thumbnails"` controls recognition UI
- CSS variables in `:root` + `[data-theme="dark"]` for new themes
- `--card-accent` / `--tab-accent` for per-category color

## Drill + recognition data model
Each PLL and OLL entry carries a precomputed `setup` field (forward-applied to a solved cube produces the case state in canonical orientation; rotation tokens at the end cancel any net rotation from the alg). Each OLL also has `recognitionGroup` — a canonicalized hash of the U-layer yellow pattern under all 4 y-rotations, so recognition-trainer distractors avoid rotationally-equivalent cases.

Drill scrambles = `randomY + randomAUF + setup` (cube-notation.js). The setup field means the user gets a clean, executable scramble regardless of whether the original solution alg contains `x`, `y`, wide, or slice moves.

Recognition images use `setup + randomAUF + nonIdentityY` (rotation appended at end, in recognition.js). The terminal y is always one of `y / y2 / y'` — never identity — so the case is never displayed in canonical orientation. Rotation at the end is a pure viewer-angle change (case state unchanged, just rotated for display) so headlights/bars visibly land on different sides each draw.

**Case picker** (both drill + recognition): shuffled-bag, not naive `Math.random()`. `drawFromBag()` Fisher-Yates-shuffles the index list on exhaustion and swaps the first slot if it would duplicate the previous draw. Guarantees every case appears once before repeats; eliminates back-to-back duplicates.

Stats schema (`rs-stats-v2` in localStorage):
```js
{ schema: 2, cases: { "pll/Aa": { drill: {n,best,times,lastAt}, recog: {n,correct,avgMs,lastAt} } } }
```
Per-case reset via the ↺ button on the card badge; reset-all via header button. All reads wrapped in try/catch.

## Recognition trainer
Clicking "Train recognition" opens a settings screen FIRST, not the trainer. Settings persist at `rs-recog-settings-v1`:
- OLL choice count (2/4/6) — only shown if any OLL selected
- Auto-advance after correct (toggle)
- Auto-advance delay (Fast / Normal / Slow)
- Show algorithm in feedback (toggle)
- Time limit per case (Off / 3s / 5s / 10s / 20s) — countdown bar at top, expiration counts as wrong

OLL options are **text buttons with name + #id**, NOT thumbnails. (Thumbnails were too easy because user could pixel-match.) PLL uses a free-text input with normalization: lowercase, strip non-alphanumeric, accept trailing "perm".

## Data provenance + validation
F2L algorithms sourced from **rubiksplace.com** (algdb.net was down at generation time). All 119 algorithms (21 PLL + 57 OLL + 25 F2L-adv + 16 F2L-beg) **verified via pycuber** — apply each alg's inverse to a solved cube, then check the result satisfies category-specific state constraints. Validator script is reusable; see `scripts/compute-setups.py` for the pattern. OLL `name` field uses `(a)/(b)/(c)/(d)/(e)` suffixes to disambiguate the 46 entries whose shape categories repeat (e.g., "Awkward (a)" through "Awkward (e)").

## Images
Case visualizations come from VisualCube at `https://visualcube.api.cubing.net/visualcube.php`. URL is built in `vcImage()` (app.js). For PLL/OLL, pass `setup` (forward-applied via `alg=` param). For F2L, pass `caseAlg` (inverse-applied via `case=` param — no setup precomputed because F2L isn't drillable). Click-to-load with retry to avoid flooding the API.

`vcImage` also accepts an optional `sch` param (6-letter VisualCube color scheme, order **U R F D L B**). Timer scramble preview passes `sch: "wrgyob"` to render with white-on-top WCA orientation (white up, red right, green front, yellow down, orange left, blue back) — matching how a cuber physically holds the cube while scrambling. PLL/OLL/F2L cards leave `sch` unset and use the VisualCube default (yellow-up) since the existing card visuals were designed against that.

## Timer
Header **Timer** button (`#open-timer`) lazy-imports `timer.js` and opens a fullscreen modal — that's why `index.html`'s modal-panel grows a `.timer-modal` class when the timer is up (added inside `timer.js` via `queueMicrotask` after `modal.open`). The timer is independent of the algorithm browser and the per-case stats store.

State machine (in `timer.js`): `idle → preInspectArm → inspecting → arming → armed → running → stopped`. `idle` enters `preInspectArm` on space-down if WCA inspection is enabled (default on); otherwise skips straight to `arming`. `armed` requires `HOLD_ARM_MS = 300ms` of space hold; release fires `startRun`. During `running`, each space press records a phase split via `splitOrStop`; the press that triggers the last phase stops the timer. Any non-space key during running also stops (cstimer behavior). ESC cancels at any pre-stop stage without recording.

Inspection uses `setInterval(100ms)` not RAF, because RAF gets throttled when the tab is unfocused — `+2` at 15s and auto-DNF at 17s must still fire so the user can't game inspection by alt-tabbing. The run-time counter still uses RAF (it's display-only; the recorded time always comes from `performance.now()` at stop).

Scrambles: `scramble-3x3.js` generates random-move sequences with same-face and same-axis-triple cancellation guards (`R R'` and `R L R` forbidden). The plan originally called for cubing.js WCA random-state scrambles via CDN, but the WASM worker init failed under cross-origin loading in our environment. Random-move scrambles produce fully-scrambled states; the file API is stable so a future swap to a Kociemba JS port is a drop-in.

Stats schema (`rs-sessions-v1` in localStorage):
```js
{
  schema: 1,
  activeSessionId: "default",
  phaseConfig: { count: 1, labels: ["Solve"] },   // global, applies to all new solves
  inspection: true,                               // global
  sessions: {
    "default": {
      id, name, createdAt,
      solves: [{ id, timeMs, scramble, phases: [cumMs, ...], penalty: null|"+2"|"DNF", date, comment }]
    }
  }
}
```
WCA averages computed in `sessions.js`: `trimmedAverage(solves, n)` (drop best+worst, mean middle; ≥2 DNFs in window → DNF), `mean(solves)` (any DNF → DNF), `bestSingle`, `bestAverage(solves, n)`. `effectiveMs(solve)` applies the +2 penalty (`Infinity` for DNF). Display via `fmtMs`/`fmtSolve`. The reset-stats header button only touches `rs-stats-v2`, not `rs-sessions-v1` — they're independent stores.

## Preferences
- Honest uncertainty: flag stuff rather than guess silently.
- Design for extension: data-driven configs, CSS tokens, explicit hook comments.
- Working directory is `/home/arjun/WebstormProjects/Rubik's Storage` (quote — apostrophe).
- Spaced repetition is a planned follow-up (Phase F in the plan file).

## Deploy
Site is published to GitHub Pages at https://sawmint.github.io/rubiks-storage/ (repo: sawmint/rubiks-storage). After approved code changes, invoke the `deploy` skill at `.claude/skills/deploy/SKILL.md` to commit, bump the PWA cache version if needed, and push. `git push` works via the SSH alias `github-rubiks` in `~/.ssh/config`; no env vars or `-c` flags needed.

**PWA cache version**: when changing any file in `sw.js`'s `CORE_ASSETS` array, bump `const CACHE_VERSION = "rs-vN"` so installed PWAs refresh on next open. The deploy skill handles this automatically. If a user reports "I pushed but my phone shows old code," check whether CACHE_VERSION was bumped.

**SSH auth**: deploy key at `~/.ssh/rubiks-storage-deploy` (private), corresponding public key registered as a deploy key in the repo with write access. SSH alias `github-rubiks` in `~/.ssh/config` maps to it. If the key file is missing, regenerate with `ssh-keygen -t ed25519 -f ~/.ssh/rubiks-storage-deploy -N ""` and re-add the .pub to https://github.com/sawmint/rubiks-storage/settings/keys.
