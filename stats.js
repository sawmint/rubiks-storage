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
  d.n += 1;
  d.best = d.best == null ? seconds : Math.min(d.best, seconds);
  d.times.push(seconds);
  if (d.times.length > MAX_TIMES) d.times = d.times.slice(-MAX_TIMES);
  d.lastAt = Math.floor(Date.now() / 1000);
  slot.drill = d;
  save();
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
