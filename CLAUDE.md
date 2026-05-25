# Rubik's Storage

Static web app browsing + drilling the CFOP corpus in `rubiks-cube-algorithms.json` (21 PLL / 57 OLL / 25 F2L-adv / 16 F2L-beg).

## Files
- `index.html` · `styles.css` — shell, theming, mobile responsive
- `app.js` — main render loop, CATEGORIES table, image loading, theme toggle
- `selection.js` — cross-tab multi-select state
- `modal.js` — overlay/escape/scroll-lock used by drill + recognition
- `cube-notation.js` — random AUF/Y, scramble builder
- `stats.js` — localStorage (`rs-stats-v2`) per-case stats with reset
- `drill.js` — drill mode (cstimer-style spacebar timer; tap-to-start fallback on touch)
- `recognition.js` — recognition trainer with settings screen, time limit, name-button picker
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

## Preferences
- Honest uncertainty: flag stuff rather than guess silently.
- Design for extension: data-driven configs, CSS tokens, explicit hook comments.
- Working directory is `/home/arjun/WebstormProjects/Rubik's Storage` (quote — apostrophe).
- Spaced repetition is a planned follow-up (Phase F in the plan file).

## Deploy
Site is published to GitHub Pages at https://sawmint.github.io/rubiks-storage/ (repo: sawmint/rubiks-storage). After approved code changes, invoke the `deploy` skill at `.claude/skills/deploy/SKILL.md` to commit, bump the PWA cache version if needed, and push. `git push` works via the SSH alias `github-rubiks` in `~/.ssh/config`; no env vars or `-c` flags needed.

**PWA cache version**: when changing any file in `sw.js`'s `CORE_ASSETS` array, bump `const CACHE_VERSION = "rs-vN"` so installed PWAs refresh on next open. The deploy skill handles this automatically. If a user reports "I pushed but my phone shows old code," check whether CACHE_VERSION was bumped.

**SSH auth**: deploy key at `~/.ssh/rubiks-storage-deploy` (private), corresponding public key registered as a deploy key in the repo with write access. SSH alias `github-rubiks` in `~/.ssh/config` maps to it. If the key file is missing, regenerate with `ssh-keygen -t ed25519 -f ~/.ssh/rubiks-storage-deploy -N ""` and re-add the .pub to https://github.com/sawmint/rubiks-storage/settings/keys.
