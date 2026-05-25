/* =========================================================
 * stats.js — per-case practice stats, persisted to localStorage.
 *
 * Schema v2:
 *   {
 *     "schema": 2,
 *     "cases": {
 *       "pll/Aa": {
 *         "drill": { "n": 5, "best": 2.34, "times": [...last 50...], "lastAt": <epoch_s> },
 *         "recog": { "n": 12, "correct": 10, "avgMs": 1850, "lastAt": <epoch_s> }
 *       }
 *     }
 *   }
 *
 * All reads/writes wrapped in try/catch — corruption resets to empty,
 * never crashes the app.
 * ========================================================= */

const KEY = "rs-stats-v2";
const SCHEMA = 2;
const MAX_TIMES = 50;

/* Spaced repetition: Leitner-box schedule, 5 boxes, day-based intervals.
 * Each box's interval is "how long to wait before showing this case again
 * after a successful drill in that box." Box 1 = drill it tomorrow, box 5
 * = comes back roughly monthly.
 *
 * The box advances on "good" reps, double-jumps on "easy" reps, and resets
 * to box 1 on "again" reps. Auto-rating is derived from drill time vs the
 * user's previous best for that case (see rateDrill below) — no manual
 * "good/again" button needed.
 *
 * Day in seconds = 86400; epoch-seconds math is DST-safe (we never look
 * at wall-clock dates, just elapsed seconds since the unix epoch).
 */
const SRS_BOX_INTERVAL_DAYS = [null, 1, 3, 7, 14, 30]; // 1-indexed; box 0 unused
const SRS_MIN_BOX = 1;
const SRS_MAX_BOX = 5;
const DAY_SEC = 86400;

// Auto-rating thresholds. Tuned conservatively: "again" only fires when
// the rep was DRAMATICALLY worse than the user's best (3x slower), and
// "easy" requires the rep to be within 30% of best. Everything in
// between is "good", which is the most common outcome.
const SRS_AGAIN_RATIO = 3.0;
const SRS_EASY_RATIO  = 1.3;

function nowSec() { return Math.floor(Date.now() / 1000); }

function rateDrill(seconds, prevBest) {
  if (prevBest == null || !isFinite(prevBest) || prevBest <= 0) return "good";
  if (seconds > prevBest * SRS_AGAIN_RATIO) return "again";
  if (seconds <= prevBest * SRS_EASY_RATIO) return "easy";
  return "good";
}

function nextBox(currentBox, rating) {
  // First drill ever (no prior SRS state) → start at box 1 regardless of
  // rating. This prevents a fast first rep from launching straight to
  // box 3 with no calibration.
  if (!currentBox || currentBox < SRS_MIN_BOX) return SRS_MIN_BOX;
  if (rating === "again") return SRS_MIN_BOX;
  if (rating === "easy")  return Math.min(currentBox + 2, SRS_MAX_BOX);
  return Math.min(currentBox + 1, SRS_MAX_BOX);
}

function updatedSrs(prevSrs, drillSeconds, prevBest) {
  const prevBox = prevSrs?.box || 0;
  const rating = rateDrill(drillSeconds, prevBest);
  const box = nextBox(prevBox, rating);
  const intervalDays = SRS_BOX_INTERVAL_DAYS[box] || 1;
  const now = nowSec();
  return {
    box,
    lastAt: now,
    dueAt: now + intervalDays * DAY_SEC,
  };
}

let cache = null;
const listeners = new Set();

function load() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) { cache = empty(); return cache; }
    const parsed = JSON.parse(raw);
    if (parsed.schema !== SCHEMA) {
      console.warn(`stats: schema mismatch (got ${parsed.schema}, want ${SCHEMA}); resetting`);
      cache = empty();
    } else {
      cache = parsed;
    }
  } catch (e) {
    console.error("stats: load failed, resetting", e);
    cache = empty();
  }
  return cache;
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch (e) {
    console.error("stats: save failed", e);
  }
  for (const fn of listeners) {
    try { fn(); } catch (e) { console.error("stats listener error:", e); }
  }
}

function empty() {
  return { schema: SCHEMA, cases: {} };
}

function caseKey(category, id) {
  return `${category}/${id}`;
}

function ensure(key) {
  load();
  if (!cache.cases[key]) cache.cases[key] = {};
  return cache.cases[key];
}

/* ---------- drill ---------- */

export function recordDrill(category, id, seconds) {
  const k = caseKey(category, id);
  const slot = ensure(k);
  const d = slot.drill || { n: 0, best: null, times: [], lastAt: 0 };
  const prevBest = d.best; // capture BEFORE this rep updates best, for SRS rating
  d.n += 1;
  d.best = d.best == null ? seconds : Math.min(d.best, seconds);
  d.times.push(seconds);
  if (d.times.length > MAX_TIMES) d.times = d.times.slice(-MAX_TIMES);
  d.lastAt = Math.floor(Date.now() / 1000);
  slot.drill = d;
  // SRS update piggybacks on every drill — auto-rated, no extra UI required.
  slot.srs = updatedSrs(slot.srs, seconds, prevBest);
  save();
}

export function getSrs(category, id) {
  load();
  return cache.cases[caseKey(category, id)]?.srs || null;
}

export function getDrill(category, id) {
  load();
  return cache.cases[caseKey(category, id)]?.drill || null;
}

/* ---------- recognition ---------- */

export function recordRecognition(category, id, correct, reactionMs) {
  const k = caseKey(category, id);
  const slot = ensure(k);
  const r = slot.recog || { n: 0, correct: 0, avgMs: 0, lastAt: 0 };
  r.n += 1;
  if (correct) r.correct += 1;
  // Running mean of reaction time over all attempts (correct or not).
  r.avgMs = Math.round(((r.avgMs * (r.n - 1)) + reactionMs) / r.n);
  r.lastAt = Math.floor(Date.now() / 1000);
  slot.recog = r;
  save();
}

export function getRecog(category, id) {
  load();
  return cache.cases[caseKey(category, id)]?.recog || null;
}

/* ---------- aggregate / reset ---------- */

export function getAll() {
  load();
  return cache.cases;
}

export function resetCase(category, id) {
  load();
  delete cache.cases[caseKey(category, id)];
  save();
}

export function resetAll() {
  cache = empty();
  save();
}

/* Wholesale replacement — used by cloud-sync to apply a pulled snapshot.
 * Going through save() still fires listeners (so the UI re-renders); the
 * sync layer guards against feedback loops via its own applyingRemote flag. */
export function replaceAll(cases) {
  cache = { schema: SCHEMA, cases: cases || {} };
  save();
}

/* Apply a single remote case mutation (realtime postgres_changes echo from
 * another device). Pass `value` as {drill, recog, srs} for insert/update,
 * or null to delete the row. Same listener-fire path as the regular write
 * accessors; cloud-sync gates its own subscriber with applyingRemote to
 * keep the echo from being pushed back up. */
export function applyRemoteCase(category, id, value) {
  load();
  const k = caseKey(category, id);
  if (value == null) {
    delete cache.cases[k];
  } else {
    cache.cases[k] = {
      drill: value.drill || {},
      recog: value.recog || {},
      srs:   value.srs   || {},
    };
  }
  save();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* Format helpers for display */
export function fmtTime(seconds) {
  if (seconds == null) return "-";
  if (seconds < 60) return `${seconds.toFixed(2)}s`;
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(2);
  return `${m}:${s.padStart(5, "0")}`;
}

export function fmtAccuracy(recog) {
  if (!recog || recog.n === 0) return "-";
  return `${Math.round((recog.correct / recog.n) * 100)}%`;
}
