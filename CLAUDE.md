# Rubik's Storage

Static web app browsing + drilling the CFOP corpus in `rubiks-cube-algorithms.json` (21 PLL / 57 OLL / 25 F2L-adv / 16 F2L-beg).

## Files
- `index.html` · `styles.css` — shell, theming, mobile responsive
- `app.js` — main render loop, CATEGORIES table, image loading, theme toggle, header buttons
- `selection.js` — cross-tab multi-select state
- `modal.js` — overlay/escape/scroll-lock used by drill, recognition, and timer
- `cube-notation.js` — random AUF/Y, scramble builder
- `stats.js` — localStorage (`rs-stats-v2`) per-case stats + Leitner spaced repetition scheduler
- `drill.js` — drill mode (cstimer-style spacebar timer; tap-to-start fallback on touch)
- `recognition.js` — recognition trainer with settings screen, time limit, name-button picker
- `timer.js` — CSTimer-style speedcubing timer (header gear → Timer button → fullscreen modal)
- `sessions.js` — timer sessions + solves persistence; WCA stats helpers (ao5/ao12/mean/best)
- `scramble-3x3.js` — random-move 3x3 scramble generator with prefetch hooks
- `batch.js` — chained PLL batch drill (one short scramble + 5 algs, cube ends solved)
- `weak-cases.js` — "Today's drill" modal: ranks drillable cases by weakness, delegates to drill/batch
- `auth.js` · `auth-ui.js` · `cloud-sync.js` · `supabase-config.js` · `vendor/supabase.js` — optional Supabase account + cloud sync (see Account system section). All UI is hidden when `supabase-config.js` is empty.
- `SETUP.md` — user-facing one-time setup guide for the account system (Supabase project, SQL schema, redirect URL allow-list, Google OAuth client)
- `alg-color.js` — tokenizer + colorizer for cube notation (used everywhere algs are displayed)
- `pll-compose.json` — precomputed PLL composition lookup (288 LL states × 21 PLLs); generated server-side by pycuber
- `rubiks-cube-algorithms.json` — dataset (PLL/OLL include `setup` and OLL has `recognitionGroup`). No `alternates` field — those were removed after a data-quality audit showed 48/66 alternates didn't actually solve their case; only `algorithm` is trusted
- `scripts/compute-setups.py` — one-time pycuber script that generated setup + recognitionGroup
- `sw.js` · `manifest.webmanifest` · `logo.png` · `logo-cube.png` · `favicon.png` · `apple-touch-icon.png` — PWA: offline support, installable. `logo.png` is the full brand asset (cube + "rubik's storage" text below). `logo-cube.png` is the cropped cube-only variant used in the header alongside HTML/CSS-rendered themed text (so dark mode can flip text color via `var(--text)`). `favicon.png` is the cube padded to square (265×265, transparent margins) — browsers stretching the non-square `logo-cube.png` to fit a favicon slot was making the tab-bar icon look squished. `apple-touch-icon.png` is a 180×180 downscale of the square padded version (Apple's recommended size). The conic-gradient brand square + `icon.svg` are gone.
- `.claude/skills/deploy/SKILL.md` — deploy workflow skill (auto-loaded each session)
- `rubiks-cube-storage-prompt.md` — original generation prompt

## Run
`npm start` → `http://localhost:8000`. Needs HTTP (file:// blocks fetch). No deps, no build.

## Architecture
Single `CATEGORIES` table in `app.js` drives tabs, search, filters, cards, and **feature gating** via per-category flags (`drillable`, `recognitionMode`). Adding a category (ZBLL, COLL, scrambles, etc.) = one new row + matching data in the JSON.

The **Notation** tab is a reference grid built off the same machinery — it has its own row in `CATEGORIES` (`key: "notation"`, `drillable: false`) and pulls items from a hardcoded `NOTATION_DATA` array in `app.js` instead of the JSON dataset. Each notation entry is shaped like a regular algorithm item (`id`, `name`, `algorithm`, `setup`), so the existing card renderer + colorizer work without changes — the move letter renders with the same face-coloring used everywhere, and the cube preview shows the state after applying the move from solved (WCA scheme). Entries are tagged with `category: "Face turn" | "Wide" | "Slice" | "Rotation" | "Modifier"`, which drives a single filter chip group at the top of the grid.

Extension hooks:
- `extraBadges` / `metaRows` / `filterFacets` per category
- `drillable: bool` controls whether selection checkboxes + drill/batch/recognition buttons appear
- `recognitionMode: "text" | "thumbnails"` controls recognition UI
- `shortLabel: string` — optional abbreviated tab label shown on mobile (≤640px). Long `label` shown on desktop. Used for F2L tabs ("F2L+" / "F2L−").
- CSS variables in `:root` + `[data-theme="dark"]` for new themes
- `--card-accent` / `--tab-accent` for per-category color

## UI layout
**Header (consolidated, single bar on desktop)**: brand + 4 tabs (inline) + optional **Sign in** chip + ⚙ settings gear. Tabs use a left/right fade mask so the user knows there's more to scroll if it overflows. Settings gear opens a small dropdown with a dark-mode checkbox, a "Reset drill + recognition stats" button, and (when cloud sync is configured) an Account section with the current email + Sign out. The Sign in chip is hidden when `supabase-config.js` is empty; once filled, it shows "Sign in" (logged out) or the email-prefix with a green dot (logged in).

**Toolbar**: search input + filter chips + match count. The "Load all images" button was removed; `loadAllImages()` now runs automatically after every `render()` (concurrency-capped at 4, SW caches each response so tab/filter switches don't re-fetch).

**Selection toolbar** (always visible — Timer needs to always be reachable): Timer button | divider | drillable-only group (Select all, Clear, count, Drill, Batch (5), Train recognition). The drillable-only group hides when the current tab isn't drillable (F2L tabs).

**Mobile (≤640px)**: header wraps to two rows — brand+gear on row 1, the 5 tabs as a full-width row 2 with horizontal scroll + fade mask. Filter chips switch to a single horizontal-scroll row. Cards: image max-height 120px (image dominates the visual weight at smaller card sizes), `var(--space-3)` padding for breathing room, 14px title, alg-block 12px with 1.45 line-height for wrap readability. **Grid is two columns** on portrait phones (`repeat(2, minmax(0, 1fr))`) so a glance shows multiple cases at once — at 375px that's ~172px per card. **Landscape phones (orientation landscape AND max-height 500)** bump to **three columns** (~252px each at 844 wide); card padding/font stay at desktop sizing since each card is still wide enough.

**Card-meta truncation + toggle (`metaRowWithToggle` in app.js)**: each meta row (Recognition / Description / state) is line-clamped to 2 lines at 10.5px on portrait mobile. Silent truncation is bad UX, so a `more`/`collapse` button appears below the clamped text ONLY when truncation is real (post-layout `scrollHeight > clientHeight + 1` check). Click `more` to drop the clamp and show the full text; `collapse` folds it back. The full text also goes into the meta's `title` attribute so tap-and-hold reveals it via the browser's native tooltip — backup for when the toggle is missed. Detection uses `setTimeout(0)` twice (not `requestAnimationFrame`) because RAF doesn't fire in headless rendering contexts (preview/screenshot tools), and a 0ms timeout still defers past the current sync render so layout is settled before the scrollHeight read.

**Card accent stripe clip**: each card has a 3px left-side colored stripe (`.card::before`, color = `--card-accent`). The stripe is `top:0; bottom:0` (straight from edge to edge) while the card has `border-radius: 14px`, so without clipping the stripe pokes past the rounded corners. `.card { overflow: hidden }` clips the stripe to the card's curve. The stripe's own `border-radius` was dropped since the parent now does the clipping.

**Selection-toolbar action buttons (Timer / Today's drill / Drill selected / Batch (5) / Train recognition)** all use plain `.btn` styling (white-ish elevated background + border), not `.btn-primary`. The blue primary look was loud for what's essentially a row of navigation actions, and consistency across the row reads better than one-or-two highlighted-blue buttons.

## Drill + recognition data model
Each PLL and OLL entry carries a precomputed `setup` field (forward-applied to a solved cube produces the case state in canonical orientation; rotation tokens at the end cancel any net rotation from the alg). Each OLL also has `recognitionGroup` — a canonicalized hash of the U-layer yellow pattern under all 4 y-rotations, so recognition-trainer distractors avoid rotationally-equivalent cases.

Drill scrambles = `randomY + randomAUF + setup` (cube-notation.js). The setup field means the user gets a clean, executable scramble regardless of whether the original solution alg contains `x`, `y`, wide, or slice moves.

Recognition images use `setup + randomAUF + nonIdentityY` (rotation appended at end, in recognition.js). The terminal y is always one of `y / y2 / y'` — never identity — so the case is never displayed in canonical orientation. Rotation at the end is a pure viewer-angle change (case state unchanged, just rotated for display) so headlights/bars visibly land on different sides each draw.

**Case picker** (both drill + recognition): shuffled-bag, not naive `Math.random()`. `drawFromBag()` Fisher-Yates-shuffles the index list on exhaustion and swaps the first slot if it would duplicate the previous draw. Guarantees every case appears once before repeats; eliminates back-to-back duplicates.

Stats schema (`rs-stats-v2` in localStorage):
```js
{
  schema: 2,
  cases: {
    "pll/Aa": {
      drill: {n,best,times,lastAt},
      recog: {n,correct,avgMs,lastAt},
      srs:   {box,lastAt,dueAt}   // spaced repetition state (see below)
    }
  }
}
```
Per-case reset via the ↺ button on the card badge; reset-all via header button. All reads wrapped in try/catch.

**Spaced repetition** (Leitner, 5 boxes — `stats.js`): every drill rep calls `updatedSrs(prevSrs, seconds, prevBest)` which (1) auto-rates the rep from time vs prior personal best (`<= 1.3x` best = "easy", `> 3x` best = "again", else "good"), (2) advances the box (`good` +1, `easy` +2, `again` resets to 1), (3) schedules `dueAt` from the new box's interval — 1/3/7/14/30 days for boxes 1-5. First-ever drill always lands in box 1 regardless of rating so a single fast first rep can't shortcut to box 3. Box advancement is capped at `SRS_MAX_BOX = 5`. Day math uses epoch-second arithmetic with a `DAY_SEC = 86400` multiplier (DST-safe; we never read wall-clock dates). `stats.getSrs(category, id)` is the read accessor.

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

Inspection uses `setInterval(100ms)` not RAF, because RAF gets throttled when the tab is unfocused — `+2` at the limit and auto-DNF at limit+2s must still fire so the user can't game inspection by alt-tabbing. The run-time counter still uses RAF (it's display-only; the recorded time always comes from `performance.now()` at stop).

**Inspection ticker keeps firing through the entire pre-solve cycle** (preInspectArm/inspecting/arming/armed), not just "inspecting". Two reasons: (1) the displayed countdown stays visible while the user holds space to arm, and (2) the +2/DNF threshold checks still fire during hold — otherwise a user holding past the DNF threshold would silently bypass the penalty. The className is gated by state so the green arm color from the state-transition handler isn't overwritten; only `textContent` updates every tick.

**Inspection duration is configurable**: `inspectionDurationSec` in the sessions schema (default 15). UI exposes 8/15/30/60s preset pills AND a free-form number input (1–999s) below the inspection checkbox in the timer settings popover. Pills fill the input + mark themselves active; typing a custom value clears any pill-active state and persists immediately on change/Enter. Thresholds derive from the configured duration (`+2` at `duration*1000`, DNF at `duration*1000 + 2000`); warn/bad color bands scale to it as well.

**Landscape phones get a dedicated layout** via `@media (orientation: landscape) and (max-height: 500px)` near the bottom of styles.css. The standard `max-width: 640px` mobile rules don't fire (landscape iPhone is ~844 wide), so without this override landscape phones would inherit desktop CSS — which leaves the 280px solves list eating most of the 390px viewport. The landscape block: re-enables side-by-side `120px 1fr` preview+timer, uses `clamp(56px, 22vh, 140px)` so the timer text scales to viewport height not width, keeps the 8-col stats footer in one row, caps solves at 130px, and tightens vertical padding throughout so a few solve rows + the whole timer area + scramble all stay on screen at the same time. The PWA manifest no longer locks `orientation: portrait`, so iPhone users can rotate into this layout for solving and back for browsing.

Scrambles: `scramble-3x3.js` generates random-move sequences with same-face and same-axis-triple cancellation guards (`R R'` and `R L R` forbidden). The plan originally called for cubing.js WCA random-state scrambles via CDN, but the WASM worker init failed under cross-origin loading in our environment. Random-move scrambles produce fully-scrambled states; the file API is stable so a future swap to a Kociemba JS port is a drop-in.

Stats schema (`rs-sessions-v1` in localStorage):
```js
{
  schema: 1,
  activeSessionId: "default",
  phaseConfig: { count: 1, labels: ["Solve"] },   // global, applies to all new solves
  inspection: true,                               // global
  inspectionDurationSec: 15,                      // global; 8/15/30/60 selectable
  sessions: {
    "default": {
      id, name, createdAt,
      solves: [{ id, timeMs, scramble, phases: [cumMs, ...], penalty: null|"+2"|"DNF", inspectionPenalty: null|"+2"|"DNF", date, comment }]
    }
  }
}
```
WCA averages computed in `sessions.js`: `trimmedAverage(solves, n)` (drop best+worst, mean middle; ≥2 DNFs in window → DNF), `mean(solves)` (skips DNFs from the calculation, only DNF if every solve is a DNF — deviates from strict WCA mo3 to match cstimer's session-mean behavior), `bestSingle`, `bestAverage(solves, n)`. `effectiveMs(solve)` stacks BOTH penalty sources (`inspectionPenalty + penalty`) so a +2 from inspection + a manual +2 = +4 total; either being DNF makes the whole solve DNF. Display via `fmtMs`/`fmtSolve` (suffix `+` = one +2, `++` = stacked +4). The reset-stats action in the settings gear only touches `rs-stats-v2`, not `rs-sessions-v1` — they're independent stores.

**Two penalty sources stack**: `inspectionPenalty` is the LOCKED penalty set at solve time from inspection overrun (15s → +2, 17s → DNF, scaled by the configured `inspectionDurationSec`). `penalty` is the USER-EDITABLE penalty controlled by the OK / +2 / DNF pills in the solves row. `setSolvePenalty` only mutates the manual half — you can't retroactively unblow your inspection. The solve row shows a `+2 insp` chip alongside the time when the inspection portion is set, and the title-tooltip names every source ("+2 from inspection · +2 manual → total +4"). Without this split, a user who blew inspection AND then clicked +2 for missing a turn would only see a single +2 recorded instead of the correct +4.

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

## Color-coded algorithm text
`alg-color.js` tokenizes cube notation and returns colored HTML. Used by `algRow()` (app.js), `renderCurrent()` + initial scramble (batch.js), the drill+timer scramble displays, and recognition feedback. Palette is theme-aware CSS vars in `:root` and `[data-theme="dark"]`:
- `D` green, `R` orange, `U` blue, `L` "white" (dark-gray in light mode for readability), `F` yellow (mustard in light), `B` purple
- `M` turquoise, `E` lavender (lighter purple, distinct from B), `S` scarlet (darker red, distinct from x)
- `x` red, `y` pink, `z` brown
- Lowercase wide moves (r, l, u, d, f, b) share the color of their uppercase face.

Tokenizer uses a regex negative lookahead `(?![A-Za-z])` plus a MANUAL lookbehind (index check inside the tokenize loop) so prose like "fix" or "Right" doesn't get partially colored. Regex literals with `(?<=...)` are a SyntaxError on iOS Safari < 16.4 — using one would kill the module at parse time and cascade-blank the whole PWA on older phones, so the lookbehind is done in JS. The post-modifier lookahead is also dropped when a non-empty modifier matched (`'` and `2` are unambiguous move terminators), so `R'U` tokenizes cleanly as `R'` + `U` even without a space. Whitespace, parens, and unknown chars fall through as raw escaped text.

## Solve info editor (per-row "info" pill)
`info` text pill in each timer-solves row opens a backdrop-overlaid editor card (`.timer-comment-backdrop` / `.timer-comment-pop`) attached to `document.body` with z-index 1000, sitting above the timer modal. The card title is `Solve info · 12.34s`. Three sections: the colored scramble notation, a VisualCube preview of the scrambled state (white-on-top WCA orientation), and a multi-line note textarea. Ctrl/⌘+Enter saves, Esc cancels, backdrop click closes. The note persists at `sess.solves[i].comment` (schema was already in place); pill gets an `.active` class when a note exists.

Key architectural note: the editor lives on `document.body`, NOT inside the solves list. The timer's sessions listener runs `renderSolvesList` (which does `list.innerHTML = ""`) on every solve/penalty/comment change — if the editor were inside the list, it would be wiped along with the user's in-progress typing. Same reason any popover spawned from inside the timer modal should follow this pattern. The backdrop also tracks `mousedown` target: it only closes on click if BOTH mousedown and click landed on the backdrop, so a text-selection drag from the textarea to outside the card doesn't throw away the user's typing.

`attachPopoverDismiss(pop, anchor)` in timer.js pairs `pop.remove()` with `removeEventListener("click")`, returning a `close()` function used by every dismissal path. Applied to session-manager and settings popovers (the comment editor uses backdrop-click only) — without it the document-level click listeners leaked. The setTimeout-deferred `addEventListener` checks a `closed` flag before adding, so a popover dismissed in the same tick doesn't leak the listener. No scroll-close: the modal panel scrolls internally on small viewports, so a scroll-close handler would snap-close the popover the moment the user scrolled the modal content underneath.

## Session export + import
`sessions.exportSession(id)` and `sessions.exportAll()` return pretty-printed JSON envelopes (`{kind, schema, exportedAt, ...}`). Triggered from the session-manager popover: per-session `export` pill, `Export all` footer button. Download via Blob + `<a download>` (`downloadJson`, `slugify`, `dateStamp` helpers in timer.js). Filenames: `{slugified-name}-{YYYY-MM-DD}.json` per session, `rubiks-storage-sessions-{date}.json` for all.

`sessions.importJson(text)` is the counterpart, triggered by the `Import` footer button (hidden file input). Validates the envelope (must be `rs-session-export` or `rs-sessions-export` with matching schema version), then **non-destructively** adds each imported session with a fresh ID — never overwrites existing sessions. Imported solve IDs are also regenerated so they can't collide. **Auto-activates the first imported session** so the user immediately sees their data after import (without this, the import looks like a no-op because the active session doesn't change). Returns `{ok:true,count}` or `{ok:false,error}`; the UI alerts on error. Imported session names get a ` (imported)` suffix to make the source obvious.

**deleteSession invariant**: deleting the active session switches to the OLDEST surviving session, NOT a recreated empty "Default". The old behavior unconditionally recreated `default` after deletion, which silently dropped the user onto an empty session (especially confusing right after an import, where they'd just deleted the original to clean up and ended up on a blank slate instead of the imported one). Only when NO sessions remain at all does a fresh Default get created.

## Weak cases ("Today's drill")
`weak-cases.js` is a small modal that surfaces drillable cases the user should practice next. It reads `stats.getAll()` for both per-case drill data and SRS state, then ranks in three tiers:
1. **SR-overdue** (`srs.dueAt <= now`), sorted by most-overdue first.
2. **Never drilled** (no SRS record), sorted by id.
3. **Practiced but not yet due**, sorted by slowest `best` descending (tiebreak oldest `lastAt`).

Each row shows a status badge: `due Xd ago · box N` for overdue, `never drilled` for new, `best 2.34s · 5d ago · n=12 · next 3d` for future. Due rows get a warn-tinted row background; new rows get an accent-tinted one. The blurb at the top of the modal counts the FULL candidate pool (`X due now · Y never drilled · N total in selected categories`) so the user sees the actual queue depth, not just the displayed top N.

UI: category toggles (PLL/OLL — both default on), count selector (5/10/20, default 10). Two action buttons:
- `Drill these` — passes the ranked keys to `drill.start(data, keys)`.
- `Batch (5)` — filters to PLL-only keys and passes to `batch.start`.

Entry point: `#open-weak-cases` button in the selection toolbar (next to Timer, always visible). Settings persist at `rs-weak-settings-v1`. No new drill/batch code — this module is pure case selection.

## Account system + cloud sync (optional, lazy-loaded)
Optional Supabase-backed sync for `rs-stats-v2` (drill + SRS state) and `rs-sessions-v1` (timer sessions + solves). When `supabase-config.js`'s `SUPABASE_URL` and `SUPABASE_ANON_KEY` are empty, the entire account UI is hidden and the app behaves identically to the no-account version — zero regression for users who never sign in. The moment both values are filled in, a **Sign in** chip activates next to the ⚙ gear and `cloud-sync.init()` wires up.

**Files**:
- `supabase-config.js` — `SUPABASE_URL` + `SUPABASE_ANON_KEY` exports; `CLOUD_ENABLED` derived. Both the new `sb_publishable_...` keys (Supabase 2024+ format) and legacy `eyJ...` JWT-style anon keys are accepted by supabase-js v2.
- `auth.js` — singleton client + thin wrappers (`signInWithMagicLink`, `signInWithGoogle`, `signOut`, `currentUser`, `onAuthChange`, `boot`). Lazy-loads the UMD bundle at `vendor/supabase.js` via injected `<script>` (NOT `type=module` — the UMD wraps `var supabase = (function(){...})()` which only attaches to `window.supabase` when run as a classic script). Persists session in localStorage with `detectSessionInUrl:true` so magic-link returns + OAuth returns just work.
- `auth-ui.js` — sign-in modal (email magic-link form + Google button) + first-login conflict prompt. Built on existing `modal.js`. Inline Google "G" SVG so the button renders offline.
- `cloud-sync.js` — hooks `stats.subscribe()` and `sessions.subscribe()`, diffs against last-pushed snapshot, pushes deltas with a 250ms debounce. Failed or offline pushes queue to `rs-sync-queue-v1` and flush on the next `online` event. Owns the `applyingRemote` flag to suppress feedback loops when applying pulled data locally.
- `vendor/supabase.js` — UMD bundle of `@supabase/supabase-js@2` (~200KB raw, ~50KB gz). Committed to the repo so the PWA is fully offline-capable with no CDN runtime dependency. Re-download: `curl -sSL -o vendor/supabase.js https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js`.

**Postgres schema** (full version with RLS policies in `SETUP.md`):
- `case_stats(user_id, category, case_id, drill, recog, srs, updated_at)` PK `(user_id, category, case_id)` — mirrors `rs-stats-v2`.
- `sessions(user_id, id, name, created_at, is_active, updated_at)` PK `(user_id, id)`. The `id` is TEXT (not uuid) so local session ids like `"default"` and base36 random strings round-trip without conversion.
- `solves(user_id, id, session_id, time_ms, scramble, phases, penalty, inspection_penalty, comment, date, updated_at)` PK `(user_id, id)`, FK `(user_id, session_id) → sessions ON DELETE CASCADE`. Session delete cascades to solves server-side, so client doesn't need to manually delete solves first.
- `user_prefs(user_id, prefs, updated_at)` — top-level `{phaseConfig, inspection, inspectionDurationSec, activeSessionId}` as jsonb.
- All four tables have RLS enabled with policy `auth.uid() = user_id` (both USING and WITH CHECK) — each user reads/writes only their own rows. The Supabase anon key is publishable; RLS is what actually enforces isolation.

**Sync model: local-first, cloud-mirror**. localStorage stays the working copy (reads instant, offline-safe). When signed in, every local `save()` pushes a diff up. On sign-in, `startForUser` compares local vs cloud presence:
- local empty + cloud has data → silent pull (apply cloud to local).
- local has data + cloud empty → silent upload.
- both non-empty → modal `askConflict` asks **Use this device's data** / **Use the cloud data** / **Cancel**. Cancel calls `signOut`.
- both empty → no-op.

Diff tracking uses per-row `JSON.stringify` against `lastStats` / `lastSessions` / `lastSolves` / `lastPrefs` snapshots, seeded from local state right after the initial reconcile. This keeps ongoing pushes minimal — only rows that genuinely changed get upserted. Diff loop also detects deletions (key in last-snapshot but not in current state) and queues server-side deletes.

**Additive exports `stats.replaceAll(cases)` / `sessions.replaceAll(state)`** were added to each module so `cloud-sync.js` can apply a pulled snapshot wholesale. They go through the existing `save()` path (so listeners fire and the UI re-renders), and `cloud-sync` sets `applyingRemote=true` around the call so its own subscribe-listener doesn't push the freshly-pulled rows right back up.

**Critical Supabase dashboard setup** (must do or sign-in breaks silently): Authentication → URL Configuration:
- **Site URL** = production URL (e.g. `https://sawmint.github.io/rubiks-storage/`). New projects default to `http://localhost:3000`.
- **Redirect URLs** allow-list — paste each line:
  ```
  https://sawmint.github.io/rubiks-storage/**
  https://*.pages.dev/**
  http://localhost:8000/**
  http://localhost:8765/**
  ```
Without this, Supabase ignores the `redirectTo` we pass from `signInWith*` and falls back to Site URL, so both Google OAuth return and the magic-link landing fail with `ERR_CONNECTION_REFUSED` on the wrong port.

**Google OAuth requires its own setup** (~10 min in https://console.cloud.google.com): OAuth consent screen + Web application credential. Authorized JavaScript origins must include the prod URL(s) + `http://localhost:8000`; authorized redirect URI must be Supabase's `https://<project>.supabase.co/auth/v1/callback`. Client ID + secret then go into Supabase Authentication → Providers → Google. Magic-link works with zero extra config (Supabase ships a default `noreply@mail.app.supabase.io` sender).

**Realtime cross-device sync**: `subscribeRealtime()` in `cloud-sync.js` opens a per-user channel and listens for `postgres_changes` on all four user tables (filter `user_id=eq.<uid>`). Each handler patches local state via `stats.applyRemoteCase` / `sessions.applyRemoteSession` / `applyRemoteSolve` / `applyRemotePrefs` (per-row patches, not a full `replaceAll`) under `applyingRemote=true`, and also updates the corresponding `lastStats`/`lastSessions`/`lastSolves`/`lastPrefs` diff snapshot so the next local edit only emits its own delta. Echoes of our own writes arrive too but no-op because the local row already matches and `applyingRemote` blocks the push.

For events to fire, the four tables must be in the `supabase_realtime` publication — handled by the `alter publication` statement at the bottom of `SETUP.md`'s SQL block. Default `REPLICA IDENTITY` (= primary key) is sufficient because delete handlers only need PK columns from `payload.old` (`category`+`case_id` for case_stats; `id` for sessions/solves).

`applyRemoteSession` deliberately never deactivates locally from a remote `is_active=false` write — the local user might be mid-something. Active flips only when the remote asserts `is_active=true`. `applyRemoteSolve` skips orphan rows (parent session not yet streamed in) rather than crashing.

## Deploy
Site is published to GitHub Pages at https://sawmint.github.io/rubiks-storage/ (repo: sawmint/rubiks-storage). After approved code changes, invoke the `deploy` skill at `.claude/skills/deploy/SKILL.md` to commit, bump the PWA cache version if needed, and push. `git push` works via the SSH alias `github-rubiks` in `~/.ssh/config`; no env vars or `-c` flags needed.

**Cloudflare Pages mirror**: the repo is also connected to Cloudflare Pages (configured by the user separately, lives at a `*.pages.dev` URL). Cloudflare watches the GitHub repo server-side and auto-rebuilds on every push to `master` — **no separate deploy step is needed from this side**. A single `git push` triggers both GitHub Pages AND Cloudflare Pages rebuilds. Useful because the user's work computer blocks `github.io` but allows `pages.dev`. If the user reports the Cloudflare URL is stale while GitHub is fresh, check whether the Cloudflare deployment failed at https://dash.cloudflare.com.

**PWA cache version**: when changing any file in `sw.js`'s `CORE_ASSETS` array, bump `const CACHE_VERSION = "rs-vN"` so installed PWAs refresh on next open. The deploy skill handles this automatically. If a user reports "I pushed but my phone shows old code," check whether CACHE_VERSION was bumped.

**SW update strategy**: same-origin shell assets use stale-while-revalidate (return cache instantly, fetch in background, next reload gets fresh). VisualCube images stay cache-first (URL-keyed, effectively immutable). Navigation requests are network-first. On top of all that, `index.html`'s SW registration calls `reg.update()` after `register()`, forcing the browser to re-fetch `sw.js` on every page load — without this, the browser's natural recheck interval (up to 24h) was leaving installed mobile PWAs pinned to an old SW for an entire day after a deploy.

**SSH auth**: deploy key at `~/.ssh/rubiks-storage-deploy` (private), corresponding public key registered as a deploy key in the repo with write access. SSH alias `github-rubiks` in `~/.ssh/config` maps to it. If the key file is missing, regenerate with `ssh-keygen -t ed25519 -f ~/.ssh/rubiks-storage-deploy -N ""` and re-add the .pub to https://github.com/sawmint/rubiks-storage/settings/keys.
