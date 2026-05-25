/* =========================================================
 * sessions.js — timer sessions + solves, persisted to localStorage.
 *
 * Independent of stats.js (which holds per-case drill/recog data).
 *
 * Schema v1 (key: "rs-sessions-v1"):
 *   {
 *     schema: 1,
 *     activeSessionId: "default",
 *     phaseConfig: { count: 1, labels: ["Solve"] },  // global
 *     inspection: true,                              // global
 *     sessions: {
 *       "default": {
 *         id: "default",
 *         name: "Default",
 *         createdAt: <ms>,
 *         solves: [
 *           {
 *             id: "<rand>",
 *             timeMs: 12340,       // raw time (no +2 added)
 *             scramble: "R U R' ...",
 *             phases: [3200, 4100, 9800, 12340],  // cumulative ms; same length as phaseConfig.count
 *             penalty: null | "+2" | "DNF",
 *             date: <ms>,
 *             comment: ""
 *           }
 *         ]
 *       }
 *     }
 *   }
 *
 * All operations are wrapped in try/catch; on corruption we reset
 * to a fresh empty state rather than crashing.
 * ========================================================= */

const KEY = "rs-sessions-v1";
const SCHEMA = 1;

let cache = null;
const listeners = new Set();

function empty() {
  return {
    schema: SCHEMA,
    activeSessionId: "default",
    phaseConfig: { count: 1, labels: ["Solve"] },
    inspection: true,
    inspectionDurationSec: 15,
    sessions: {
      default: {
        id: "default",
        name: "Default",
        createdAt: Date.now(),
        solves: [],
      },
    },
  };
}

function load() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) { cache = empty(); return cache; }
    const parsed = JSON.parse(raw);
    if (parsed.schema !== SCHEMA) {
      console.warn(`sessions: schema mismatch (got ${parsed.schema}, want ${SCHEMA}); resetting`);
      cache = empty();
    } else {
      cache = parsed;
      // Ensure invariants
      if (!cache.sessions || typeof cache.sessions !== "object") cache.sessions = {};
      if (!cache.sessions[cache.activeSessionId]) {
        // Fall back to default; recreate if missing
        if (!cache.sessions.default) {
          cache.sessions.default = { id: "default", name: "Default", createdAt: Date.now(), solves: [] };
        }
        cache.activeSessionId = "default";
      }
      if (!cache.phaseConfig) cache.phaseConfig = { count: 1, labels: ["Solve"] };
      if (typeof cache.inspection !== "boolean") cache.inspection = true;
      if (typeof cache.inspectionDurationSec !== "number" || cache.inspectionDurationSec <= 0) {
        cache.inspectionDurationSec = 15;
      }
    }
  } catch (e) {
    console.error("sessions: load failed, resetting", e);
    cache = empty();
  }
  return cache;
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch (e) {
    console.error("sessions: save failed", e);
  }
  for (const fn of listeners) {
    try { fn(); } catch (e) { console.error("sessions listener:", e); }
  }
}

function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/* ---------- queries ---------- */

export function getState() {
  return load();
}

export function getActiveSession() {
  const s = load();
  return s.sessions[s.activeSessionId];
}

export function listSessions() {
  const s = load();
  return Object.values(s.sessions).sort((a, b) => a.createdAt - b.createdAt);
}

export function getPhaseConfig() {
  return load().phaseConfig;
}

export function getInspection() {
  return load().inspection;
}

export function getInspectionDurationSec() {
  return load().inspectionDurationSec || 15;
}

/* ---------- mutations ---------- */

export function setPhaseConfig(count, labels) {
  load();
  cache.phaseConfig = { count, labels: labels.slice(0, count) };
  save();
}

export function setInspection(on) {
  load();
  cache.inspection = !!on;
  save();
}

export function setInspectionDurationSec(seconds) {
  load();
  const n = Number(seconds);
  if (!isFinite(n) || n <= 0) return;
  cache.inspectionDurationSec = Math.round(n);
  save();
}

export function addSolve({ timeMs, scramble, phases, penalty = null }) {
  const s = load();
  const sess = s.sessions[s.activeSessionId];
  if (!sess) return;
  const solve = {
    id: newId(),
    timeMs,
    scramble,
    phases: phases || [timeMs],
    penalty,
    date: Date.now(),
    comment: "",
  };
  sess.solves.push(solve);
  save();
  return solve;
}

export function setSolvePenalty(solveId, penalty) {
  const sess = getActiveSession();
  if (!sess) return;
  const sv = sess.solves.find((x) => x.id === solveId);
  if (!sv) return;
  sv.penalty = penalty; // null | "+2" | "DNF"
  save();
}

export function deleteSolve(solveId) {
  const sess = getActiveSession();
  if (!sess) return;
  sess.solves = sess.solves.filter((x) => x.id !== solveId);
  save();
}

export function setSolveComment(solveId, comment) {
  const sess = getActiveSession();
  if (!sess) return;
  const sv = sess.solves.find((x) => x.id === solveId);
  if (!sv) return;
  sv.comment = typeof comment === "string" ? comment : "";
  save();
}

/* ---------- export ---------- */

/* Serialize a single session as a pretty JSON string. Wraps with a small
 * envelope (schema + exportedAt) so the file is self-describing and forward
 * compatible with a future import path. */
export function exportSession(id) {
  load();
  const sess = cache.sessions[id];
  if (!sess) return null;
  const payload = {
    kind: "rs-session-export",
    schema: SCHEMA,
    exportedAt: new Date().toISOString(),
    phaseConfig: cache.phaseConfig,
    inspection: cache.inspection,
    session: sess,
  };
  return JSON.stringify(payload, null, 2);
}

/* Serialize all sessions in one file. Same envelope, multiple sessions. */
export function exportAll() {
  load();
  const payload = {
    kind: "rs-sessions-export",
    schema: SCHEMA,
    exportedAt: new Date().toISOString(),
    phaseConfig: cache.phaseConfig,
    inspection: cache.inspection,
    sessions: cache.sessions,
  };
  return JSON.stringify(payload, null, 2);
}

export function clearActiveSession() {
  const sess = getActiveSession();
  if (!sess) return;
  sess.solves = [];
  save();
}

export function createSession(name) {
  load();
  const id = newId();
  cache.sessions[id] = {
    id,
    name: name || "New session",
    createdAt: Date.now(),
    solves: [],
  };
  cache.activeSessionId = id;
  save();
  return cache.sessions[id];
}

export function renameSession(id, name) {
  load();
  const sess = cache.sessions[id];
  if (!sess) return;
  sess.name = name;
  save();
}

export function deleteSession(id) {
  load();
  if (!cache.sessions[id]) return;
  delete cache.sessions[id];
  // Ensure at least default exists
  if (!cache.sessions.default) {
    cache.sessions.default = { id: "default", name: "Default", createdAt: Date.now(), solves: [] };
  }
  if (cache.activeSessionId === id) {
    cache.activeSessionId = "default";
  }
  save();
}

export function setActiveSession(id) {
  load();
  if (!cache.sessions[id]) return;
  cache.activeSessionId = id;
  save();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ---------- WCA stats ---------- */

/* Effective time of a solve: timeMs + 2000 for +2, Infinity for DNF. */
export function effectiveMs(solve) {
  if (!solve) return Infinity;
  if (solve.penalty === "DNF") return Infinity;
  if (solve.penalty === "+2") return solve.timeMs + 2000;
  return solve.timeMs;
}

/* Compute mean of N consecutive solves with trimming (best+worst dropped).
   - For N=5: drop best and worst, mean the middle 3 (ao5).
   - For N=12: drop best+worst, mean the middle 10 (ao12).
   - More than one DNF in the trim window => the average is DNF.
   Returns ms (number) or null if not enough solves, or Infinity for DNF. */
export function trimmedAverage(solves, n) {
  if (!solves || solves.length < n) return null;
  const window = solves.slice(-n);
  const times = window.map(effectiveMs);
  const dnfCount = times.filter((t) => !isFinite(t)).length;
  if (dnfCount > 1) return Infinity;
  // Sort to find min/max
  const sorted = [...times].sort((a, b) => a - b);
  const trimmed = sorted.slice(1, -1); // drop best (idx 0) and worst (last)
  // After trimming, no DNFs should remain (we had at most 1 DNF, which becomes the "worst")
  const sum = trimmed.reduce((a, b) => a + b, 0);
  return sum / trimmed.length;
}

/* Mean of all solves in the array, skipping DNFs. Returns DNF (Infinity)
   only if every solve is a DNF — otherwise a single bad solve doesn't
   poison the whole session view. (Strict WCA mo3 would make any DNF
   poison the mean; this matches cstimer's session-mean behavior.) */
export function mean(solves) {
  if (!solves || solves.length === 0) return null;
  const finite = solves.map(effectiveMs).filter((t) => isFinite(t));
  if (finite.length === 0) return Infinity;
  return finite.reduce((a, b) => a + b, 0) / finite.length;
}

/* Best single in the array (ignores DNFs). */
export function bestSingle(solves) {
  if (!solves || solves.length === 0) return null;
  let best = null;
  for (const s of solves) {
    const t = effectiveMs(s);
    if (!isFinite(t)) continue;
    if (best == null || t < best) best = t;
  }
  return best;
}

/* Best ao_N across all windows in the array. Returns ms or null. */
export function bestAverage(solves, n) {
  if (!solves || solves.length < n) return null;
  let best = null;
  for (let i = n; i <= solves.length; i++) {
    const a = trimmedAverage(solves.slice(0, i), n);
    if (a == null) continue;
    if (!isFinite(a)) continue;
    if (best == null || a < best) best = a;
  }
  return best;
}

/* Format ms as "ss.cc" or "m:ss.cc"; Infinity → "DNF"; null → "-". */
export function fmtMs(ms) {
  if (ms == null) return "-";
  if (!isFinite(ms)) return "DNF";
  const s = ms / 1000;
  if (s < 60) return s.toFixed(2);
  const m = Math.floor(s / 60);
  const r = (s % 60).toFixed(2);
  return `${m}:${r.padStart(5, "0")}`;
}

/* Display string for a solve: prefixes "+" if +2 penalty. */
export function fmtSolve(solve) {
  if (!solve) return "-";
  if (solve.penalty === "DNF") return "DNF";
  const base = fmtMs(effectiveMs(solve));
  return solve.penalty === "+2" ? base + "+" : base;
}
