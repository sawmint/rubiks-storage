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
 *   - subscribe to postgres_changes on the four user tables so writes
 *     from other devices/tabs appear here without a refresh.
 * ========================================================= */

import * as stats from "./stats.js";
import * as sessions from "./sessions.js";
import * as auth from "./auth.js";
import { showToast } from "./app.js";

const QUEUE_KEY = "rs-sync-queue-v1";
const PUSH_DEBOUNCE_MS = 250;

// Throttle for failure toasts so a burst of pushes doesn't spam one toast
// per failed op. We only surface the first failure in a window; the next
// "Sync caught up" toast (on a successful flush) clears the dirty flag.
let failedSinceLastOk = false;
let lastFailToastAt = 0;
function notifyFailure(message) {
  failedSinceLastOk = true;
  const now = Date.now();
  if (now - lastFailToastAt < 4000) return;
  lastFailToastAt = now;
  try { showToast(message, "error"); } catch { /* DOM not ready yet */ }
}
function notifyRecovery() {
  if (!failedSinceLastOk) return;
  failedSinceLastOk = false;
  try { showToast("Sync caught up"); } catch { /* DOM not ready */ }
}
// Once-per-session flag for realtime drops so a flaky connection doesn't toast
// repeatedly. Cleared by stop().
let realtimeDropToasted = false;

let started = false;
let userId = null;
let statsUnsub = null;
let sessionsUnsub = null;
let applyingRemote = false;     // suppress push-loops when we're applying server data locally
let pushTimer = null;
let onlineHandler = null;
let realtimeChannel = null;

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
  if (q.length === 0) {
    notifyRecovery();
    return;
  }
  const remaining = [];
  let anyFail = false;
  for (const op of q) {
    const res = await execOp(c, op);
    if (!res.ok) {
      anyFail = true;
      if (res.retry) remaining.push(op);
      else console.warn("dropping queued op (non-retryable):", res.error, op);
    }
  }
  setQueue(remaining);
  if (!anyFail && remaining.length === 0) notifyRecovery();
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
  if (!c || !userId || !navigator.onLine) {
    enqueue(op);
    if (!navigator.onLine) notifyFailure("Offline — sync paused");
    return;
  }
  const res = await execOp(c, op);
  if (!res.ok) {
    if (res.retry) {
      enqueue(op);
      notifyFailure("Sync failed — will retry");
    } else {
      console.warn("push failed (non-retryable):", res.error, op);
      notifyFailure("Sync failed: " + (res.error || "server rejected"));
    }
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
  // Defensive cast: time_ms is `int` in Postgres but local solves authored
  // before the addSolve rounding fix may still carry sub-ms floats from
  // performance.now(). Sending one trips Postgres 22P02 and pushOrQueue
  // drops the op (400s aren't retried). Math.round here ensures every
  // upload path — schedulePush diff + uploadAllLocal — sends ints, so a
  // sign-out/sign-in cycle with "use this device's data" recovers any
  // stranded solves. Phases gets the same treatment for consistency
  // (jsonb accepts floats but keeping types tidy avoids future surprises).
  return {
    user_id: userId,
    id: solve.id,
    session_id: sessionId,
    time_ms: Math.round(solve.timeMs),
    scramble: solve.scramble || "",
    phases: (solve.phases || []).map((p) => Math.round(p)),
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

/* ---------- realtime ----------
 *
 * Supabase Realtime → postgres_changes streams INSERT/UPDATE/DELETE events
 * for the four user tables, filtered server-side by user_id (RLS also
 * scopes reads, but the filter prevents wasted broadcasts).
 *
 * Each handler:
 *   1. flips applyingRemote=true so our own stats/sessions subscribers don't
 *      schedule a push for the apply we're about to do.
 *   2. mutates local state via the applyRemote* helpers (per-row patches —
 *      no full snapshot replace, which would re-render everything).
 *   3. updates the diff snapshot (lastStats/lastSessions/...) to match the
 *      remote row, so the next local edit only pushes its own delta.
 *
 * Echoes of our own writes also arrive here; they no-op because the local
 * state already matches the echoed row and applyingRemote suppresses any
 * push attempt.
 *
 * Tables must be in the supabase_realtime publication for events to fire —
 * see SETUP.md's SQL block. Default REPLICA IDENTITY (= primary key) is
 * enough; our delete handlers only need PK columns from the old row.
 */
function subscribeRealtime() {
  const c = auth.getClient();
  if (!c || !userId) return null;

  const channel = c.channel(`rs-user-${userId}`);
  const filter = `user_id=eq.${userId}`;

  channel.on("postgres_changes",
    { event: "*", schema: "public", table: "case_stats", filter },
    (payload) => {
      const ev = payload.eventType;
      const row = payload.new;
      const oldRow = payload.old;
      applyingRemote = true;
      try {
        if (ev === "DELETE") {
          const cat = oldRow?.category;
          const cid = oldRow?.case_id;
          if (cat == null || cid == null) return;
          stats.applyRemoteCase(cat, cid, null);
          lastStats.delete(`${cat}/${cid}`);
        } else if (row) {
          const value = {
            drill: row.drill || {},
            recog: row.recog || {},
            srs:   row.srs   || {},
          };
          stats.applyRemoteCase(row.category, row.case_id, value);
          lastStats.set(`${row.category}/${row.case_id}`, JSON.stringify(value));
        }
      } catch (e) {
        console.error("realtime case_stats apply failed:", e, payload);
      } finally {
        applyingRemote = false;
      }
    }
  );

  channel.on("postgres_changes",
    { event: "*", schema: "public", table: "sessions", filter },
    (payload) => {
      const ev = payload.eventType;
      const row = payload.new;
      const oldRow = payload.old;
      applyingRemote = true;
      try {
        if (ev === "DELETE") {
          const id = oldRow?.id;
          if (!id) return;
          sessions.applyRemoteSession(id, null);
          lastSessions.delete(id);
        } else if (row) {
          sessions.applyRemoteSession(row.id, {
            name: row.name,
            createdAt: row.created_at,
            isActive: !!row.is_active,
          });
          lastSessions.set(row.id, JSON.stringify({
            name: row.name,
            createdAt: row.created_at,
            isActive: !!row.is_active,
          }));
        }
      } catch (e) {
        console.error("realtime sessions apply failed:", e, payload);
      } finally {
        applyingRemote = false;
      }
    }
  );

  channel.on("postgres_changes",
    { event: "*", schema: "public", table: "solves", filter },
    (payload) => {
      const ev = payload.eventType;
      const row = payload.new;
      const oldRow = payload.old;
      applyingRemote = true;
      try {
        if (ev === "DELETE") {
          const id = oldRow?.id;
          if (!id) return;
          sessions.applyRemoteSolve(id, null);
          lastSolves.delete(id);
        } else if (row) {
          const solveObj = {
            id: row.id,
            timeMs: row.time_ms,
            scramble: row.scramble || "",
            phases: row.phases || [row.time_ms],
            penalty: row.penalty,
            inspectionPenalty: row.inspection_penalty,
            date: row.date,
            comment: row.comment || "",
          };
          sessions.applyRemoteSolve(row.id, { ...solveObj, sessionId: row.session_id });
          lastSolves.set(row.id, JSON.stringify(solveObj));
        }
      } catch (e) {
        console.error("realtime solves apply failed:", e, payload);
      } finally {
        applyingRemote = false;
      }
    }
  );

  channel.on("postgres_changes",
    { event: "*", schema: "public", table: "user_prefs", filter },
    (payload) => {
      const ev = payload.eventType;
      const row = payload.new;
      if (ev === "DELETE" || !row) return;  // we never delete prefs rows
      applyingRemote = true;
      try {
        const prefs = row.prefs || {};
        sessions.applyRemotePrefs(prefs);
        lastPrefs = JSON.stringify({
          phaseConfig: prefs.phaseConfig,
          inspection: prefs.inspection,
          inspectionDurationSec: prefs.inspectionDurationSec,
          activeSessionId: prefs.activeSessionId,
        });
      } catch (e) {
        console.error("realtime user_prefs apply failed:", e, payload);
      } finally {
        applyingRemote = false;
      }
    }
  );

  channel.subscribe((status, err) => {
    if (err) {
      console.warn("realtime channel error:", err);
      if (!realtimeDropToasted) {
        realtimeDropToasted = true;
        notifyFailure("Live-sync dropped — changes from other devices may lag");
      }
    }
  });

  return channel;
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
    notifyFailure("Couldn't load cloud data");
    return;
  }

  const cloudHas = cloud.stats.length || cloud.sessions.length || cloud.solves.length || cloud.prefs;
  const local = localHasData();

  if (cloudHas) {
    // Always pull from cloud silently — cloud wins. No conflict prompt.
    // If the device has uncommitted local edits, they're overwritten; this
    // matches the user's instruction to "always default to the cloud."
    applyCloudToLocal(cloud);
  } else if (local) {
    // First-ever sign-in on a device with data, cloud empty — silently upload.
    await uploadAllLocal();
  }
  // else: nothing on either side, nothing to do.

  seedSnapshots();

  // Wire up ongoing sync
  statsUnsub    = stats.subscribe(()    => { if (!applyingRemote) schedulePush(); });
  sessionsUnsub = sessions.subscribe(() => { if (!applyingRemote) schedulePush(); });

  // Realtime — patch local state when another device writes.
  realtimeChannel = subscribeRealtime();

  // Flush any leftover queue from a previous offline session
  onlineHandler = () => flushQueue();
  window.addEventListener("online", onlineHandler);
  flushQueue();

  started = true;
}

function stop() {
  if (statsUnsub)    { statsUnsub();    statsUnsub = null; }
  if (sessionsUnsub) { sessionsUnsub(); sessionsUnsub = null; }
  if (realtimeChannel) {
    const c = auth.getClient();
    try {
      if (c?.removeChannel) c.removeChannel(realtimeChannel);
      else realtimeChannel.unsubscribe?.();
    } catch (e) {
      console.warn("realtime teardown failed:", e);
    }
    realtimeChannel = null;
  }
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
  failedSinceLastOk = false;
  lastFailToastAt = 0;
  realtimeDropToasted = false;
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
