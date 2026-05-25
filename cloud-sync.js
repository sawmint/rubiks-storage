/* =========================================================
 * cloud-sync.js — bidirectional sync layer between local stores and Supabase.
 *
 * Hooks the existing stats.subscribe() and sessions.subscribe() channels
 * so neither module needs invasive edits. On each local save:
 *   - diff against last-pushed snapshot
 *   - push only dirty rows to the matching Supabase table
 *   - on push failure or offline, enqueue to rs-sync-queue-v1 for later
 *
 * On sign-in:
 *   - if local has data, ask the user (via auth-ui) whether to upload
 *     local → cloud, or pull cloud → local. ("Ask each time" first-login
 *     policy, per the approved plan.)
 *   - seed the diff snapshots so ongoing pushes only touch what changes.
 *
 * Out of scope for v1: realtime postgres_changes subscriptions (would let
 * other devices' writes appear without a refresh). The single-tab/single-
 * device usage pattern dominates, and a refresh-to-see-other-device
 * works correctly given that pull-on-signin is implemented. Adding it
 * later is a one-call subscribe.
 * ========================================================= */

import * as stats from "./stats.js";
import * as sessions from "./sessions.js";
import * as auth from "./auth.js";

const QUEUE_KEY = "rs-sync-queue-v1";
const PUSH_DEBOUNCE_MS = 250;

let started = false;
let userId = null;
let statsUnsub = null;
let sessionsUnsub = null;
let applyingRemote = false;     // suppress push-loops when we're applying server data locally
let pushTimer = null;
let onlineHandler = null;

// Last-pushed snapshots (one entry per logical row, JSON-stringified for cheap equality)
let lastStats = new Map();      // key: "pll/Aa"        → JSON of {drill,recog,srs}
let lastSessions = new Map();   // key: session.id      → JSON of {name,createdAt,isActive}
let lastSolves = new Map();     // key: solve.id        → JSON of full solve row
let lastPrefs = null;           // JSON of {phaseConfig,inspection,inspectionDurationSec,activeSessionId}

/* ---------- offline queue ---------- */

function getQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); }
  catch { return []; }
}
function setQueue(q) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }
  catch (e) { console.warn("sync queue persist failed:", e); }
}
function enqueue(op) {
  const q = getQueue();
  q.push({ ...op, queuedAt: Date.now() });
  setQueue(q);
}

async function flushQueue() {
  const c = auth.getClient();
  if (!c || !userId || !navigator.onLine) return;
  let q = getQueue();
  if (q.length === 0) return;
  const remaining = [];
  for (const op of q) {
    const res = await execOp(c, op);
    if (!res.ok) {
      if (res.retry) remaining.push(op);
      else console.warn("dropping queued op (non-retryable):", res.error, op);
    }
  }
  setQueue(remaining);
}

/* ---------- single op execution ---------- */

async function execOp(c, op) {
  try {
    if (op.op === "upsert") {
      const onConflict = op.onConflict || "id";
      const { error } = await c.from(op.table).upsert(op.row, { onConflict });
      if (error) {
        const retry = !error.code || String(error.code).startsWith("5") || error.message?.includes("network");
        return { ok: false, retry, error: error.message };
      }
      return { ok: true };
    }
    if (op.op === "delete") {
      const { error } = await c.from(op.table).delete().match(op.where);
      if (error) {
        const retry = !error.code || String(error.code).startsWith("5") || error.message?.includes("network");
        return { ok: false, retry, error: error.message };
      }
      return { ok: true };
    }
    return { ok: false, retry: false, error: "unknown op " + op.op };
  } catch (e) {
    return { ok: false, retry: true, error: e.message };
  }
}

async function pushOrQueue(op) {
  const c = auth.getClient();
  if (!c || !userId || !navigator.onLine) { enqueue(op); return; }
  const res = await execOp(c, op);
  if (!res.ok) {
    if (res.retry) enqueue(op);
    else console.warn("push failed (non-retryable):", res.error, op);
  }
}

/* ---------- row builders ---------- */

function statsRow(caseKey, value) {
  const slash = caseKey.indexOf("/");
  const category = slash >= 0 ? caseKey.slice(0, slash) : caseKey;
  const case_id = slash >= 0 ? caseKey.slice(slash + 1) : "";
  return {
    user_id: userId,
    category,
    case_id,
    drill: value.drill || {},
    recog: value.recog || {},
    srs: value.srs || {},
    updated_at: new Date().toISOString(),
  };
}

function sessionRow(sess, isActive) {
  return {
    user_id: userId,
    id: sess.id,
    name: sess.name,
    created_at: sess.createdAt,
    is_active: !!isActive,
    updated_at: new Date().toISOString(),
  };
}

function solveRow(solve, sessionId) {
  return {
    user_id: userId,
    id: solve.id,
    session_id: sessionId,
    time_ms: solve.timeMs,
    scramble: solve.scramble || "",
    phases: solve.phases || [],
    penalty: solve.penalty,
    inspection_penalty: solve.inspectionPenalty,
    comment: solve.comment || "",
    date: solve.date,
    updated_at: new Date().toISOString(),
  };
}

function prefsRow(state) {
  return {
    user_id: userId,
    prefs: {
      phaseConfig: state.phaseConfig,
      inspection: state.inspection,
      inspectionDurationSec: state.inspectionDurationSec,
      activeSessionId: state.activeSessionId,
    },
    updated_at: new Date().toISOString(),
  };
}

/* ---------- diff + push ---------- */

function pushStatsDiff() {
  const all = stats.getAll();
  const newKeys = new Set();
  for (const [key, value] of Object.entries(all)) {
    newKeys.add(key);
    const json = JSON.stringify(value);
    if (lastStats.get(key) !== json) {
      lastStats.set(key, json);
      pushOrQueue({
        table: "case_stats",
        op: "upsert",
        onConflict: "user_id,category,case_id",
        row: statsRow(key, value),
      });
    }
  }
  for (const oldKey of [...lastStats.keys()]) {
    if (!newKeys.has(oldKey)) {
      lastStats.delete(oldKey);
      const slash = oldKey.indexOf("/");
      pushOrQueue({
        table: "case_stats",
        op: "delete",
        where: {
          user_id: userId,
          category: slash >= 0 ? oldKey.slice(0, slash) : oldKey,
          case_id: slash >= 0 ? oldKey.slice(slash + 1) : "",
        },
      });
    }
  }
}

function pushSessionsDiff() {
  const state = sessions.getState();
  const sessionIds = new Set();
  const solveIds = new Set();

  for (const sess of Object.values(state.sessions)) {
    sessionIds.add(sess.id);
    const isActive = sess.id === state.activeSessionId;
    const sessSnap = JSON.stringify({ name: sess.name, createdAt: sess.createdAt, isActive });
    if (lastSessions.get(sess.id) !== sessSnap) {
      lastSessions.set(sess.id, sessSnap);
      pushOrQueue({
        table: "sessions",
        op: "upsert",
        onConflict: "user_id,id",
        row: sessionRow(sess, isActive),
      });
    }
    for (const sv of sess.solves) {
      solveIds.add(sv.id);
      const svSnap = JSON.stringify(sv);
      if (lastSolves.get(sv.id) !== svSnap) {
        lastSolves.set(sv.id, svSnap);
        pushOrQueue({
          table: "solves",
          op: "upsert",
          onConflict: "user_id,id",
          row: solveRow(sv, sess.id),
        });
      }
    }
  }

  // Solve deletions — fire before session deletions so the ON DELETE CASCADE
  // doesn't make the targeted row look mysteriously already-gone.
  for (const oldId of [...lastSolves.keys()]) {
    if (!solveIds.has(oldId)) {
      lastSolves.delete(oldId);
      pushOrQueue({
        table: "solves",
        op: "delete",
        where: { user_id: userId, id: oldId },
      });
    }
  }
  for (const oldId of [...lastSessions.keys()]) {
    if (!sessionIds.has(oldId)) {
      lastSessions.delete(oldId);
      pushOrQueue({
        table: "sessions",
        op: "delete",
        where: { user_id: userId, id: oldId },
      });
    }
  }

  // Prefs
  const prefsSnap = JSON.stringify({
    phaseConfig: state.phaseConfig,
    inspection: state.inspection,
    inspectionDurationSec: state.inspectionDurationSec,
    activeSessionId: state.activeSessionId,
  });
  if (prefsSnap !== lastPrefs) {
    lastPrefs = prefsSnap;
    pushOrQueue({
      table: "user_prefs",
      op: "upsert",
      onConflict: "user_id",
      row: prefsRow(state),
    });
  }
}

function schedulePush() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    pushStatsDiff();
    pushSessionsDiff();
    flushQueue();    // opportunistic
  }, PUSH_DEBOUNCE_MS);
}

/* ---------- initial pull / merge ---------- */

async function fetchAllFromCloud() {
  const c = auth.getClient();
  if (!c) return null;
  const [statsRes, sessRes, solveRes, prefsRes] = await Promise.all([
    c.from("case_stats").select("*").eq("user_id", userId),
    c.from("sessions").select("*").eq("user_id", userId),
    c.from("solves").select("*").eq("user_id", userId),
    c.from("user_prefs").select("*").eq("user_id", userId).maybeSingle(),
  ]);
  if (statsRes.error) throw statsRes.error;
  if (sessRes.error)  throw sessRes.error;
  if (solveRes.error) throw solveRes.error;
  if (prefsRes.error) throw prefsRes.error;
  return {
    stats: statsRes.data || [],
    sessions: sessRes.data || [],
    solves: solveRes.data || [],
    prefs: prefsRes.data?.prefs || null,
  };
}

function localHasData() {
  const s = stats.getAll();
  if (Object.keys(s).length > 0) return true;
  const sess = sessions.getState();
  for (const ss of Object.values(sess.sessions)) {
    if (ss.solves && ss.solves.length > 0) return true;
  }
  return false;
}

/* Push the entire local state up. Bypasses the diff snapshots (intentional
 * — caller seeds them from local state right after). */
async function uploadAllLocal() {
  const c = auth.getClient();
  if (!c) return;

  // case_stats
  const statsRows = Object.entries(stats.getAll()).map(([k, v]) => statsRow(k, v));
  if (statsRows.length > 0) {
    const { error } = await c.from("case_stats").upsert(statsRows, { onConflict: "user_id,category,case_id" });
    if (error) console.warn("uploadAllLocal stats error:", error);
  }

  // sessions + solves
  const state = sessions.getState();
  const sessionRows = Object.values(state.sessions).map((s) => sessionRow(s, s.id === state.activeSessionId));
  if (sessionRows.length > 0) {
    const { error } = await c.from("sessions").upsert(sessionRows, { onConflict: "user_id,id" });
    if (error) console.warn("uploadAllLocal sessions error:", error);
  }
  const solveRows = [];
  for (const s of Object.values(state.sessions)) {
    for (const sv of s.solves) solveRows.push(solveRow(sv, s.id));
  }
  if (solveRows.length > 0) {
    const { error } = await c.from("solves").upsert(solveRows, { onConflict: "user_id,id" });
    if (error) console.warn("uploadAllLocal solves error:", error);
  }

  // prefs
  const { error: pe } = await c.from("user_prefs").upsert(prefsRow(state), { onConflict: "user_id" });
  if (pe) console.warn("uploadAllLocal prefs error:", pe);
}

/* Replace local stores with the cloud snapshot. Sets applyingRemote so the
 * subscribe listeners don't push the freshly-pulled rows right back up. */
function applyCloudToLocal(cloud) {
  applyingRemote = true;
  try {
    // stats — rebuild the cases map and write it back
    const cases = {};
    for (const row of cloud.stats) {
      cases[`${row.category}/${row.case_id}`] = {
        drill: row.drill || {},
        recog: row.recog || {},
        srs:   row.srs   || {},
      };
    }
    stats.replaceAll(cases);

    // sessions — build the {sessions, activeSessionId, phaseConfig, inspection, ...} state
    const sessionsMap = {};
    for (const row of cloud.sessions) {
      sessionsMap[row.id] = {
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
        solves: [],
      };
    }
    for (const row of cloud.solves) {
      const s = sessionsMap[row.session_id];
      if (!s) continue;     // orphan — skip
      s.solves.push({
        id: row.id,
        timeMs: row.time_ms,
        scramble: row.scramble || "",
        phases: row.phases || [row.time_ms],
        penalty: row.penalty,
        inspectionPenalty: row.inspection_penalty,
        date: row.date,
        comment: row.comment || "",
      });
    }
    // Sort solves within each session by date so cstimer-style chronology holds
    for (const s of Object.values(sessionsMap)) {
      s.solves.sort((a, b) => a.date - b.date);
    }

    const prefs = cloud.prefs || {};
    const activeFromPrefs = prefs.activeSessionId;
    const firstSessionId = Object.keys(sessionsMap)[0];
    const activeSessionId = activeFromPrefs && sessionsMap[activeFromPrefs]
      ? activeFromPrefs
      : (firstSessionId || "default");

    // If the cloud has zero sessions, fall back to a fresh empty Default so
    // the timer doesn't crash on a missing active session.
    if (!sessionsMap[activeSessionId]) {
      sessionsMap["default"] = { id: "default", name: "Default", createdAt: Date.now(), solves: [] };
    }

    sessions.replaceAll({
      schema: 1,
      activeSessionId,
      phaseConfig: prefs.phaseConfig || { count: 1, labels: ["Solve"] },
      inspection: prefs.inspection !== false,
      inspectionDurationSec: prefs.inspectionDurationSec || 15,
      sessions: sessionsMap,
    });
  } finally {
    applyingRemote = false;
  }
}

/* Seed the diff snapshots from whatever's currently in local storage. After
 * this, schedulePush() will only emit upserts for genuinely changed rows. */
function seedSnapshots() {
  lastStats.clear();
  for (const [k, v] of Object.entries(stats.getAll())) {
    lastStats.set(k, JSON.stringify(v));
  }
  lastSessions.clear();
  lastSolves.clear();
  const state = sessions.getState();
  for (const sess of Object.values(state.sessions)) {
    lastSessions.set(sess.id, JSON.stringify({
      name: sess.name,
      createdAt: sess.createdAt,
      isActive: sess.id === state.activeSessionId,
    }));
    for (const sv of sess.solves) lastSolves.set(sv.id, JSON.stringify(sv));
  }
  lastPrefs = JSON.stringify({
    phaseConfig: state.phaseConfig,
    inspection: state.inspection,
    inspectionDurationSec: state.inspectionDurationSec,
    activeSessionId: state.activeSessionId,
  });
}

/* ---------- lifecycle ---------- */

/* Called on SIGNED_IN. Decides whether to ask the conflict prompt, then
 * runs the initial reconcile + starts ongoing sync. */
async function startForUser(user) {
  if (started) return;
  userId = user.id;

  let cloud;
  try {
    cloud = await fetchAllFromCloud();
  } catch (e) {
    console.error("cloud sync: initial fetch failed", e);
    return;
  }

  const cloudHas = cloud.stats.length || cloud.sessions.length || cloud.solves.length || cloud.prefs;
  const local = localHasData();

  if (local && cloudHas) {
    // Conflict — ask the user (delegated to auth-ui to avoid a circular dep)
    const choice = await new Promise((resolve) => {
      import("./auth-ui.js").then((m) => m.askConflict(resolve));
    });
    if (choice === "upload") {
      await uploadAllLocal();
      // After upload, cloud === local; seed from local.
    } else if (choice === "cloud") {
      applyCloudToLocal(cloud);
    } else {
      // cancelled — sign out and bail
      await auth.signOut();
      return;
    }
  } else if (local && !cloudHas) {
    // First-ever sign-in on a device with data — silently upload.
    await uploadAllLocal();
  } else if (!local && cloudHas) {
    // Fresh device — pull silently.
    applyCloudToLocal(cloud);
  }
  // else: nothing on either side, nothing to do.

  seedSnapshots();

  // Wire up ongoing sync
  statsUnsub    = stats.subscribe(()    => { if (!applyingRemote) schedulePush(); });
  sessionsUnsub = sessions.subscribe(() => { if (!applyingRemote) schedulePush(); });

  // Flush any leftover queue from a previous offline session
  onlineHandler = () => flushQueue();
  window.addEventListener("online", onlineHandler);
  flushQueue();

  started = true;
}

function stop() {
  if (statsUnsub)    { statsUnsub();    statsUnsub = null; }
  if (sessionsUnsub) { sessionsUnsub(); sessionsUnsub = null; }
  if (onlineHandler) {
    window.removeEventListener("online", onlineHandler);
    onlineHandler = null;
  }
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
  userId = null;
  lastStats.clear();
  lastSessions.clear();
  lastSolves.clear();
  lastPrefs = null;
  started = false;
}

/* Entry point — call once at app startup. Hooks auth state changes; on
 * sign-in, starts sync. On sign-out, stops. Idempotent. */
export function init() {
  auth.onAuthChange((user, event) => {
    if (user) {
      startForUser(user);
    } else if (event === "SIGNED_OUT" || event === "INITIAL") {
      // INITIAL with null user means logged-out boot — just ensure clean.
      if (started) stop();
    }
  });
}
