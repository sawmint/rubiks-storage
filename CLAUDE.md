# Rubik's Storage

Static web app browsing + drilling the CFOP corpus in `rubiks-cube-algorithms.json` (21 PLL / 57 OLL / 25 F2L-adv / 16 F2L-beg).

## Files
- `index.html` · `styles.css` — shell, theming
- `app.js` — main render loop, CATEGORIES table, image loading
- `selection.js` — cross-tab multi-select state
- `modal.js` — overlay/escape/scroll-lock used by drill + recognition
- `cube-notation.js` — random AUF/Y, scramble builder
- `stats.js` — localStorage (`rs-stats-v2`) per-case stats with reset
- `drill.js` — drill mode (spacebar cstimer-style timer)
- `recognition.js` — recognition trainer (PLL text input, OLL 4-thumbnail picker)
- `rubiks-cube-algorithms.json` — dataset (PLL/OLL include `setup` and OLL has `recognitionGroup`)
- `scripts/compute-setups.py` — one-time pycuber script that generated setup + recognitionGroup
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

## Images
Case visualizations come from VisualCube at `https://visualcube.api.cubing.net/visualcube.php`. URL is built in `vcImage()` (app.js). For PLL/OLL, pass `setup` (forward-applied via `alg=` param). For F2L, pass `caseAlg` (inverse-applied via `case=` param — no setup precomputed because F2L isn't drillable). Click-to-load with retry to avoid flooding the API.

## Preferences
- Honest uncertainty: flag stuff rather than guess silently.
- Design for extension: data-driven configs, CSS tokens, explicit hook comments.
- Working directory is `/home/arjun/WebstormProjects/Rubik's Storage` (quote — apostrophe).
- Spaced repetition is a planned follow-up (Phase F in the plan file).

## Deploy
Site is published to GitHub Pages at https://sawmint.github.io/rubiks-storage/ (repo: sawmint/rubiks-storage). After approved code changes, invoke the `deploy` skill at `.claude/skills/deploy/SKILL.md` to commit, bump the PWA cache version if needed, and push. `git push` works via the SSH alias `github-rubiks` in `~/.ssh/config`; no env vars or `-c` flags needed.
