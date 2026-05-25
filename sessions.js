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

export function addSolve({ timeMs, scramble, phases, penalty = null, inspectionPenalty = null }) {
  const s = load();
  const sess = s.sessions[s.activeSessionId];
  if (!sess) return;
  // Round to integer ms. performance.now() returns sub-ms floats; the cloud
  // schema's time_ms column is int. Without rounding, a stray .5 trips
  // Postgres error 22P02 (invalid_text_representation) and the push silently
  // drops. Display only uses .toFixed(2) on (timeMs/1000) anyway, so sub-ms
  // precision was never user-visible — just a foot-gun for the sync path.
  const tMs = Math.round(timeMs);
  const phasesRounded = (phases || [tMs]).map((p) => Math.round(p));
  const solve = {
    id: newId(),
    timeMs: tMs,
    scramble,
    phases: phasesRounded,
    penalty,                 // user-controlled portion (OK / +2 / DNF pills)
    inspectionPenalty,       // locked, set at solve time from inspection overrun
    date: Date.now(),
    comment: "",
  };
  sess.solves.push(solve);
  save();
  return solve;
}

/* Only mutates the user-controlled penalty. The inspection penalty (set at
 * solve time) is immutable — you can't retroactively pretend you didn't
 * blow your 15s inspection. */
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
    inspectionDurationSec: cache.inspectionDurationSec,
    sessions: cache.sessions,
  };
  return JSON.stringify(payload, null, 2);
}

/* Import a JSON export (single session or all-sessions envelope). Imported
 * sessions are added with fresh IDs so they can't collide with existing
 * data — the user keeps their current sessions and gets the imported ones
 * alongside. The imported solve IDs are also regenerated.
 *
 * Returns { ok: true, count } on success or { ok: false, error } on failure.
 * Doesn't merge or replace anything destructively. */
export function importJson(jsonText) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    return { ok: false, error: "File isn't valid JSON" };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, error: "File isn't a Rubik's Storage export" };
  }
  if (parsed.kind !== "rs-session-export" && parsed.kind !== "rs-sessions-export") {
    return { ok: false, error: "File isn't a Rubik's Storage session export" };
  }
  if (parsed.schema !== SCHEMA) {
    return {
      ok: false,
      error: `Export is from schema v${parsed.schema}; this app uses v${SCHEMA}`,
    };
  }
  const sourceSessions = parsed.session
    ? [parsed.session]
    : (parsed.sessions ? Object.values(parsed.sessions) : []);
  if (sourceSessions.length === 0) {
    return { ok: false, error: "No sessions found in file" };
  }

  load();
  let count = 0;
  let firstImportedId = null;
  for (const src of sourceSessions) {
    if (!src || !Array.isArray(src.solves)) continue;
    const id = newId();
    cache.sessions[id] = {
      id,
      name: (src.name || "Imported") + " (imported)",
      createdAt: Date.now(),
      solves: src.solves.map((s) => ({
        ...s,
        id: newId(), // fresh ID so it can't collide with anything existing
      })),
    };
    if (firstImportedId == null) firstImportedId = id;
    count++;
  }
  if (count === 0) return { ok: false, error: "No valid sessions in file" };
  // Auto-activate the first imported session so the user immediately sees
  // their data — otherwise the import appears to do nothing visible.
  if (firstImportedId) cache.activeSessionId = firstImportedId;
  save();
  return { ok: true, count };
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
  const wasActive = cache.activeSessionId === id;
  delete cache.sessions[id];
  // If the user just deleted the session they were on, switch to ANY
  // surviving session (oldest first) rather than blindly recreating an
  // empty "Default". The previous behavior left the user staring at a
  // blank session after deleting the original following an import.
  if (wasActive) {
    const remaining = Object.values(cache.sessions).sort((a, b) => a.createdAt - b.createdAt);
    if (remaining.length > 0) {
      cache.activeSessionId = remaining[0].id;
    } else {
      // Only when no sessions remain at all — create a fresh Default.
      cache.sessions.default = { id: "default", name: "Default", createdAt: Date.now(), solves: [] };
      cache.activeSessionId = "default";
    }
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

/* Apply a single remote session-row mutation (realtime echo). row=null
 * means the row was deleted; otherwise pass {name, createdAt, isActive}.
 * Deleting the currently-active session falls back to the oldest survivor
 * (same invariant as deleteSession), so a remote tab tidying up doesn't
 * strand us on a missing activeSessionId. */
export function applyRemoteSession(id, row) {
  load();
  if (row == null) {
    if (!cache.sessions[id]) return;
    const wasActive = cache.activeSessionId === id;
    delete cache.sessions[id];
    if (wasActive) {
      const remaining = Object.values(cache.sessions).sort((a, b) => a.createdAt - b.createdAt);
      if (remaining.length > 0) {
        cache.activeSessionId = remaining[0].id;
      } else {
        cache.sessions.default = { id: "default", name: "Default", createdAt: Date.now(), solves: [] };
        cache.activeSessionId = "default";
      }
    }
    save();
    return;
  }
  const existing = cache.sessions[id];
  if (existing) {
    existing.name = row.name;
    existing.createdAt = row.createdAt;
  } else {
    cache.sessions[id] = {
      id,
      name: row.name,
      createdAt: row.createdAt,
      solves: [],
    };
  }
  // is_active on the remote row only flips us if the remote is asserting
  // active=true; we never deactivate locally from a remote write (the local
  // user might be mid-something).
  if (row.isActive) cache.activeSessionId = id;
  save();
}

/* Apply a single remote solve-row mutation. row=null means delete. For
 * upserts, row carries {sessionId, timeMs, scramble, phases, penalty,
 * inspectionPenalty, date, comment}. If a solve moves between sessions
 * (rare; would require manual SQL), we remove from any session that has
 * it before inserting into the new target. */
export function applyRemoteSolve(id, row) {
  load();
  if (row == null) {
    for (const sess of Object.values(cache.sessions)) {
      const idx = sess.solves.findIndex((s) => s.id === id);
      if (idx >= 0) { sess.solves.splice(idx, 1); save(); return; }
    }
    return;
  }
  const target = cache.sessions[row.sessionId];
  if (!target) return; // orphan — the parent session hasn't synced yet
  for (const sess of Object.values(cache.sessions)) {
    if (sess === target) continue;
    const idx = sess.solves.findIndex((s) => s.id === id);
    if (idx >= 0) sess.solves.splice(idx, 1);
  }
  const solveObj = {
    id,
    timeMs: row.timeMs,
    scramble: row.scramble || "",
    phases: row.phases || [row.timeMs],
    penalty: row.penalty,
    inspectionPenalty: row.inspectionPenalty,
    date: row.date,
    comment: row.comment || "",
  };
  const existingIdx = target.solves.findIndex((s) => s.id === id);
  if (existingIdx >= 0) {
    target.solves[existingIdx] = solveObj;
  } else {
    target.solves.push(solveObj);
    target.solves.sort((a, b) => a.date - b.date);
  }
  save();
}

/* Apply a remote prefs payload (the jsonb blob from user_prefs.prefs).
 * Only flips activeSessionId if the target session actually exists locally
 * — otherwise we'd risk pointing at a session that hasn't streamed in yet. */
export function applyRemotePrefs(prefs) {
  if (!prefs || typeof prefs !== "object") return;
  load();
  if (prefs.phaseConfig) cache.phaseConfig = prefs.phaseConfig;
  if (typeof prefs.inspection === "boolean") cache.inspection = prefs.inspection;
  if (typeof prefs.inspectionDurationSec === "number" && prefs.inspectionDurationSec > 0) {
    cache.inspectionDurationSec = prefs.inspectionDurationSec;
  }
  if (prefs.activeSessionId && cache.sessions[prefs.activeSessionId]) {
    cache.activeSessionId = prefs.activeSessionId;
  }
  save();
}

/* Wholesale replacement — used by cloud-sync to apply a pulled snapshot.
 * Mirrors stats.replaceAll. Validates invariants the same way load() does
 * (activeSessionId points to a real session; phaseConfig/inspection
 * defaults if missing) so a partial cloud row can't break the timer. */
export function replaceAll(next) {
  if (!next || typeof next !== "object") return;
  const out = {
    schema: SCHEMA,
    activeSessionId: next.activeSessionId || "default",
    phaseConfig: next.phaseConfig || { count: 1, labels: ["Solve"] },
    inspection: typeof next.inspection === "boolean" ? next.inspection : true,
    inspectionDurationSec: typeof next.inspectionDurationSec === "number" && next.inspectionDurationSec > 0
      ? next.inspectionDurationSec : 15,
    sessions: next.sessions && typeof next.sessions === "object" ? next.sessions : {},
  };
  if (!out.sessions[out.activeSessionId]) {
    if (!out.sessions.default) {
      out.sessions.default = { id: "default", name: "Default", createdAt: Date.now(), solves: [] };
    }
    out.activeSessionId = "default";
  }
  cache = out;
  save();
}

/* ---------- WCA stats ---------- */

/* Effective time of a solve, stacking BOTH penalty sources:
 *   - inspectionPenalty: locked, from blowing inspection (15s/17s thresholds)
 *   - penalty: user-controlled manual penalty from the OK/+2/DNF pills
 * Either being DNF makes the whole solve DNF. Two +2s stack to +4. */
export function effectiveMs(solve) {
  if (!solve) return Infinity;
  if (solve.penalty === "DNF" || solve.inspectionPenalty === "DNF") return Infinity;
  let ms = solve.timeMs;
  if (solve.inspectionPenalty === "+2") ms += 2000;
  if (solve.penalty === "+2") ms += 2000;
  return ms;
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

/* Display string for a solve. Penalty markers:
 *   "+"  = one +2 (either inspection OR manual)
 *   "++" = both +2s applied (+4 total) — disambiguated via tooltip in UI
 *   "DNF" if either source is DNF.
 */
export function fmtSolve(solve) {
  if (!solve) return "-";
  if (solve.penalty === "DNF" || solve.inspectionPenalty === "DNF") return "DNF";
  const base = fmtMs(effectiveMs(solve));
  const plusCount = (solve.inspectionPenalty === "+2" ? 1 : 0) + (solve.penalty === "+2" ? 1 : 0);
  if (plusCount === 2) return base + "++";
  if (plusCount === 1) return base + "+";
  return base;
}
