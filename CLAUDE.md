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
- `timer.js` — CSTimer-style speedcubing timer (header gear → Timer button → fullscreen modal)
- `sessions.js` — timer sessions + solves persistence; WCA stats helpers (ao5/ao12/mean/best)
- `scramble-3x3.js` — random-move 3x3 scramble generator with prefetch hooks
- `batch.js` — chained PLL batch drill (one short scramble + 5 algs, cube ends solved)
- `pll-compose.json` — precomputed PLL composition lookup (288 LL states × 21 PLLs); generated server-side by pycuber
- `rubiks-cube-algorithms.json` — dataset (PLL/OLL include `setup` and OLL has `recognitionGroup`). No `alternates` field — those were removed after a data-quality audit showed 48/66 alternates didn't actually solve their case; only `algorithm` is trusted
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
- `drillable: bool` controls whether selection checkboxes + drill/batch/recognition buttons appear
- `recognitionMode: "text" | "thumbnails"` controls recognition UI
- `shortLabel: string` — optional abbreviated tab label shown on mobile (≤640px). Long `label` shown on desktop. Used for F2L tabs ("F2L+" / "F2L−").
- CSS variables in `:root` + `[data-theme="dark"]` for new themes
- `--card-accent` / `--tab-accent` for per-category color

## UI layout
**Header (consolidated, single bar on desktop)**: brand + 4 tabs (inline) + ⚙ settings gear. Tabs use a left/right fade mask so the user knows there's more to scroll if it overflows. Settings gear opens a small dropdown with a dark-mode checkbox and a "Reset drill + recognition stats" button.

**Toolbar**: search input + filter chips + match count. The "Load all images" button was removed; `loadAllImages()` now runs automatically after every `render()` (concurrency-capped at 4, SW caches each response so tab/filter switches don't re-fetch).

**Selection toolbar** (always visible — Timer needs to always be reachable): Timer button | divider | drillable-only group (Select all, Clear, count, Drill, Batch (5), Train recognition). The drillable-only group hides when the current tab isn't drillable (F2L tabs).

**Mobile (≤640px)**: header wraps to two rows — brand+gear on row 1, the 4 tabs as a full-width segmented bar on row 2. Each tab gets ~85px so all 4 fit without scrolling. Filter chips switch to a single horizontal-scroll row. Cards compact: image max-height 110px, tighter padding, ~300px total height (vs ~400+ on desktop).

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
F2L algorithms sourced from **rubiksplace.com** (algdb.net was down at generation time). All 119 main algorithms (21 PLL + 57 OLL + 25 F2L-adv + 16 F2L-beg) **verified via pycuber** — apply each alg's inverse to a solved cube, then check the result satisfies category-specific state constraints. Validator script is reusable; see `scripts/compute-setups.py` for the pattern. OLL `name` field uses `(a)/(b)/(c)/(d)/(e)` suffixes to disambiguate the 46 entries whose shape categories repeat (e.g., "Awkward (a)" through "Awkward (e)").

**V-perm fix**: the original V-perm algorithm had a non-canceling `y` mid-alg, so its net rotation was non-identity AND `setup + alg` didn't actually solve. Patched by prepending `y'` to both V-perm's main alg and its (now-removed) alternate so `setup + alg` solves and the cube ends at canonical orientation.

**Alternates removed**: audit showed 48/66 algorithm `alternates` didn't solve their case (looked like mirror-case algs in the wrong slot). Rather than fix each one, the entire `alternates` field was stripped from all PLL+OLL entries. Only the verified `algorithm` field remains.

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
WCA averages computed in `sessions.js`: `trimmedAverage(solves, n)` (drop best+worst, mean middle; ≥2 DNFs in window → DNF), `mean(solves)` (skips DNFs from the calculation, only DNF if every solve is a DNF — deviates from strict WCA mo3 to match cstimer's session-mean behavior), `bestSingle`, `bestAverage(solves, n)`. `effectiveMs(solve)` applies the +2 penalty (`Infinity` for DNF). Display via `fmtMs`/`fmtSolve`. The reset-stats action in the settings gear only touches `rs-stats-v2`, not `rs-sessions-v1` — they're independent stores.

**Font for timer/stats displays**: switched from `--font-mono` to `--font-sans` with `font-variant-numeric: tabular-nums`. JetBrains Mono (default in the mono stack) renders `0` with a dot inside which a user complained about. Sans-with-tabular-nums gives plain zeros that still align column-perfectly. `--font-mono` itself was also changed to `ui-monospace, "SF Mono", Menlo, Consolas, "Courier New", monospace` (no more JetBrains Mono) for scramble text.

## Batch mode (chained 5-alg PLL drill)
Lives in `batch.js`. Picks 5 random PLLs from selection, then **looks up the equivalent single PLL+AUF** that 5 setups compose to, and uses that PLL's *short* setup (~15-25 moves) as the initial scramble — instead of literally concatenating 5 setups (~73-100 moves, which the user understandably disliked).

How: `pll-compose.json` (34KB) is precomputed by a Python/pycuber script and ships with the site. It holds:
- `plls`: array of the 21 PLL IDs (order matters for table indexing)
- `scrambles`: array of 288 short scramble strings, indexed by state ID. Each is `U_pre + setup + U_post` (no `y` rotations — y would rotate the cube body and break the user's subsequent algs, which are interpreted in canonical orientation).
- `table`: 288×21 composition lookup. `table[state_id][pll_index] = new_state_id`. Walking this in reverse queue order (`setup_5 setup_4 ... setup_1` is the chained scramble, so apply queue.reverse() against `solved` state) gives the equivalent state.
- `solved`: the state ID for solved.

Math verified on 200 random 5-PLL batches (200/200 end solved). All 288 LL permutations are reachable via `U_pre + setup + U_post` over the 21 PLLs.

OLLs are silently filtered out — chained OLL would need a larger composition table (orientation matters, ~216 OLL states × AUFs).

To regenerate `pll-compose.json` (if PLL setups change or new ones are added), see the Python block in batch-related commits — runs against `/tmp/cubevenv/bin/python` with pycuber installed.

## Preferences
- Honest uncertainty: flag stuff rather than guess silently.
- Design for extension: data-driven configs, CSS tokens, explicit hook comments.
- Working directory is `/home/arjun/WebstormProjects/Rubik's Storage` (quote — apostrophe).
- The user is impatient with reverts/misinterpretation. When they say "X is supposed to do Y", believe them and don't second-guess. If a request seems mathematically impossible, push back specifically rather than implementing the wrong thing twice.

## Planned (user-requested, not yet built)
- **Suggest weak cases** (a.k.a. "today's drill"): use existing `rs-stats-v2` to surface the N cases practiced least or with the slowest `best`. Open them in drill or batch directly. Foundation for spaced repetition.
- **Per-solve comments + session export**: click a row in the timer solves table to add a note string (already in the schema as `comment: ""`). Add an "Export session as JSON" button so sessions can be backed up or migrated between devices.
- **Color-coded algorithm text**: render each move's face letter in a color so algs are easier to scan. User-specified palette:
  - `D` = green, `R` = orange, `U` = blue, `L` = white, `F` = yellow, `B` = purple
  - `M` = turquoise, `E` = lavender, `S` = scarlet
  - `x` = red, `y` = pink, `z` = brown
  - Lowercase (wide moves) use the same color as their uppercase counterpart.
  - Implementation: tokenize algorithm strings in `algRow()` (app.js) and the batch.js alg display, wrap each token's leading face letter in a `<span>` with a class like `move-letter move-R`. Modifiers (`'`, `2`) inherit the surrounding color or stay neutral.

## Deploy
Site is published to GitHub Pages at https://sawmint.github.io/rubiks-storage/ (repo: sawmint/rubiks-storage). After approved code changes, invoke the `deploy` skill at `.claude/skills/deploy/SKILL.md` to commit, bump the PWA cache version if needed, and push. `git push` works via the SSH alias `github-rubiks` in `~/.ssh/config`; no env vars or `-c` flags needed.

**PWA cache version**: when changing any file in `sw.js`'s `CORE_ASSETS` array, bump `const CACHE_VERSION = "rs-vN"` so installed PWAs refresh on next open. The deploy skill handles this automatically. If a user reports "I pushed but my phone shows old code," check whether CACHE_VERSION was bumped.

**SSH auth**: deploy key at `~/.ssh/rubiks-storage-deploy` (private), corresponding public key registered as a deploy key in the repo with write access. SSH alias `github-rubiks` in `~/.ssh/config` maps to it. If the key file is missing, regenerate with `ssh-keygen -t ed25519 -f ~/.ssh/rubiks-storage-deploy -N ""` and re-add the .pub to https://github.com/sawmint/rubiks-storage/settings/keys.
