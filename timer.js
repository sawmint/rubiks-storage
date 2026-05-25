/* =========================================================
 * timer.js — full CSTimer-style 3x3 speedcubing timer.
 *
 * State machine:
 *   idle
 *     ↓ space held (and inspection on?)
 *   inspecting (15s WCA countdown; +2 at 15-17s; DNF past 17s)
 *     ↓ space held
 *   armed (green; cstimer-style hold-to-arm)
 *     ↓ space released
 *   running
 *     ↓ space pressed (advances phase; final press stops)
 *     ↓ any other key (stops immediately)
 *   stopped → records → back to idle (with new scramble)
 *
 * ESC during running cancels without recording.
 *
 * Touch fallback (no key support):
 *   tap-and-hold tap-zone to arm/start; tap again to stop/split.
 * ========================================================= */

import * as modal from "./modal.js";
import * as sessions from "./sessions.js";
import * as scrambler from "./scramble-3x3.js";
import { vcImage } from "./app.js";
import { renderHtml as colorizeAlg } from "./alg-color.js";

const HOLD_ARM_MS = 300;          // how long space must be held to arm
const INSPECTION_TOTAL_MS = 15000;
const INSPECTION_PLUS2_MS = 17000;
const INSPECTION_DNF_MS   = 17001; // anything past this is DNF on start

let session = null; // active timer session (not a persistent session)
let rafId = null;
let inspectionIntervalId = null;
let unsubSessions = null;
let unsubStatus = null;

/* ---------- public entry ---------- */

export function openTimer() {
  scrambler.warmUp();
  session = {
    state: "idle",
    startMs: 0,
    elapsedMs: 0,
    phases: [],
    inspectionStartMs: 0,
    inspectionPenalty: null,   // null | "+2" | "DNF"
    holdStartMs: 0,
    armReadyTimer: null,
    currentScramble: null,
    pendingScramble: null,
    ui: {},
    keyHandlers: null,
    cleanup: [],
  };

  const body = buildBody();
  modal.open({
    title: "",
    body,
    onClose: closeTimer,
    allowBackdropClose: false,
  });
  // After modal.open, hide the modal header (it's empty title, we don't want the close button to dominate)
  // Actually keep it — useful for closing. Just style accordingly via .timer-modal class.

  attachKeyHandlers();
  attachWindowBlur();
  attachSessionsListener();
  loadNextScramble();
  renderAll();
}

function closeTimer() {
  if (!session) return;
  detachKeyHandlers();
  cancelRaf();
  cancelInspectionInterval();
  if (session.armReadyTimer) clearTimeout(session.armReadyTimer);
  for (const fn of session.cleanup) {
    try { fn(); } catch (e) { console.error("timer cleanup:", e); }
  }
  if (unsubSessions) { unsubSessions(); unsubSessions = null; }
  if (unsubStatus) { unsubStatus(); unsubStatus = null; }
  session = null;
}

/* ---------- DOM ---------- */

function buildBody() {
  const root = document.createElement("div");
  root.className = "timer-body";

  // Mark the modal panel as fullscreen via a class on the parent on next frame.
  // We use a queueMicrotask so the panel already exists.
  queueMicrotask(() => {
    const panel = root.closest(".modal-panel");
    if (panel) panel.classList.add("timer-modal");
  });

  // Top bar: session dropdown + settings button (right-aligned)
  const topBar = document.createElement("div");
  topBar.className = "timer-topbar";

  const sessionWrap = document.createElement("div");
  sessionWrap.className = "timer-session-wrap";
  session.ui.sessionLabel = document.createElement("button");
  session.ui.sessionLabel.type = "button";
  session.ui.sessionLabel.className = "timer-session-btn";
  session.ui.sessionLabel.addEventListener("click", openSessionManager);
  sessionWrap.appendChild(session.ui.sessionLabel);
  topBar.appendChild(sessionWrap);

  const topSpacer = document.createElement("div");
  topSpacer.style.flex = "1";
  topBar.appendChild(topSpacer);

  const settingsBtn = document.createElement("button");
  settingsBtn.type = "button";
  settingsBtn.className = "timer-icon-btn";
  settingsBtn.title = "Settings";
  settingsBtn.setAttribute("aria-label", "Timer settings");
  settingsBtn.textContent = "⚙"; // ⚙
  settingsBtn.addEventListener("click", openSettingsPanel);
  topBar.appendChild(settingsBtn);

  root.appendChild(topBar);

  // Scramble bar
  const scrambleRow = document.createElement("div");
  scrambleRow.className = "timer-scramble-row";

  session.ui.scramble = document.createElement("div");
  session.ui.scramble.className = "timer-scramble";
  session.ui.scramble.textContent = "Loading scramble…";
  scrambleRow.appendChild(session.ui.scramble);

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "btn btn-small";
  nextBtn.textContent = "↻ New scramble";
  nextBtn.addEventListener("click", () => loadNextScramble(true));
  scrambleRow.appendChild(nextBtn);

  root.appendChild(scrambleRow);

  // Cube preview + main timer area side-by-side on wide screens
  const main = document.createElement("div");
  main.className = "timer-main";

  // Preview
  const preview = document.createElement("div");
  preview.className = "timer-preview";
  session.ui.preview = preview;
  main.appendChild(preview);

  // Tap zone (tap-anywhere-in-here to control timer on touch)
  const tapZone = document.createElement("div");
  tapZone.className = "timer-tapzone";
  tapZone.setAttribute("role", "button");
  tapZone.setAttribute("aria-label", "Tap and hold to start, tap to stop");
  tapZone.tabIndex = 0;

  session.ui.timeDisplay = document.createElement("div");
  session.ui.timeDisplay.className = "timer-time";
  session.ui.timeDisplay.textContent = "0.00";
  tapZone.appendChild(session.ui.timeDisplay);

  session.ui.hint = document.createElement("div");
  session.ui.hint.className = "timer-hint";
  session.ui.hint.textContent = "Hold space (or tap and hold) to arm.";
  tapZone.appendChild(session.ui.hint);

  // Touch handlers
  tapZone.addEventListener("touchstart", onTouchStart, { passive: false });
  tapZone.addEventListener("touchend", onTouchEnd, { passive: false });
  tapZone.addEventListener("touchcancel", onTouchEnd, { passive: false });

  // Mouse: hold-down also arms (so users without a keyboard can still arm-and-release)
  tapZone.addEventListener("mousedown", onPointerDown);
  tapZone.addEventListener("mouseup", onPointerUp);
  tapZone.addEventListener("mouseleave", onPointerCancel);

  session.ui.tapZone = tapZone;
  main.appendChild(tapZone);

  root.appendChild(main);

  // Stats footer
  const statsFooter = document.createElement("div");
  statsFooter.className = "timer-stats-footer";
  session.ui.statsFooter = statsFooter;
  root.appendChild(statsFooter);

  // Solves table
  const solvesWrap = document.createElement("div");
  solvesWrap.className = "timer-solves";
  const solvesHeader = document.createElement("div");
  solvesHeader.className = "timer-solves-header";
  solvesHeader.innerHTML =
    `<div>#</div><div>Time</div><div>ao5</div><div>ao12</div><div></div>`;
  solvesWrap.appendChild(solvesHeader);
  session.ui.solvesList = document.createElement("div");
  session.ui.solvesList.className = "timer-solves-list";
  solvesWrap.appendChild(session.ui.solvesList);
  root.appendChild(solvesWrap);

  return root;
}

/* ---------- render ---------- */

function renderAll() {
  if (!session) return;
  renderSessionLabel();
  renderStatsFooter();
  renderSolvesList();
}

function renderSessionLabel() {
  const sess = sessions.getActiveSession();
  if (!sess) return;
  session.ui.sessionLabel.textContent = `◉ ${sess.name} ▾`;
}

function renderStatsFooter() {
  const sess = sessions.getActiveSession();
  if (!sess) { session.ui.statsFooter.textContent = ""; return; }
  const solves = sess.solves;
  const cur = solves.length > 0 ? sessions.fmtSolve(solves[solves.length - 1]) : "-";
  const ao5  = sessions.fmtMs(sessions.trimmedAverage(solves, 5));
  const ao12 = sessions.fmtMs(sessions.trimmedAverage(solves, 12));
  const meanV = sessions.fmtMs(sessions.mean(solves));
  const bestS = sessions.fmtMs(sessions.bestSingle(solves));
  const bestAo5  = sessions.fmtMs(sessions.bestAverage(solves, 5));
  const bestAo12 = sessions.fmtMs(sessions.bestAverage(solves, 12));

  session.ui.statsFooter.innerHTML = `
    <div class="timer-stat"><div class="timer-stat-label">solve</div><div class="timer-stat-val">${cur}</div></div>
    <div class="timer-stat"><div class="timer-stat-label">ao5</div><div class="timer-stat-val">${ao5}</div></div>
    <div class="timer-stat"><div class="timer-stat-label">ao12</div><div class="timer-stat-val">${ao12}</div></div>
    <div class="timer-stat"><div class="timer-stat-label">mean</div><div class="timer-stat-val">${meanV}</div></div>
    <div class="timer-stat"><div class="timer-stat-label">best</div><div class="timer-stat-val">${bestS}</div></div>
    <div class="timer-stat"><div class="timer-stat-label">best ao5</div><div class="timer-stat-val">${bestAo5}</div></div>
    <div class="timer-stat"><div class="timer-stat-label">best ao12</div><div class="timer-stat-val">${bestAo12}</div></div>
    <div class="timer-stat"><div class="timer-stat-label">count</div><div class="timer-stat-val">${solves.length}</div></div>
  `;
}

function renderSolvesList() {
  const sess = sessions.getActiveSession();
  if (!sess) { session.ui.solvesList.innerHTML = ""; return; }
  const solves = sess.solves;
  const list = session.ui.solvesList;
  list.innerHTML = "";

  // Show most recent first
  for (let i = solves.length - 1; i >= 0; i--) {
    const s = solves[i];
    const idx = i + 1;
    const ao5  = sessions.fmtMs(sessions.trimmedAverage(solves.slice(0, i + 1), 5));
    const ao12 = sessions.fmtMs(sessions.trimmedAverage(solves.slice(0, i + 1), 12));
    const row = document.createElement("div");
    row.className = "timer-solve-row";
    row.dataset.id = s.id;

    const num = document.createElement("div"); num.textContent = idx; row.appendChild(num);

    const t = document.createElement("div");
    t.className = "timer-solve-time";
    t.textContent = sessions.fmtSolve(s);
    if (s.phases && s.phases.length > 1) {
      t.title = s.phases.map((cum, idx) => `${labelForPhaseIndex(idx)}: ${(cum / 1000).toFixed(2)}`).join("\n");
    }
    t.title = (t.title ? t.title + "\n\n" : "") + `Scramble: ${s.scramble}`;
    if (s.comment) t.title += `\n\nNote: ${s.comment}`;
    row.appendChild(t);

    const a5 = document.createElement("div"); a5.textContent = ao5; row.appendChild(a5);
    const a12 = document.createElement("div"); a12.textContent = ao12; row.appendChild(a12);

    // Penalty menu
    const menuWrap = document.createElement("div");
    menuWrap.className = "timer-solve-menu";
    const okBtn = mkPenaltyBtn("OK", null, s);
    const p2Btn = mkPenaltyBtn("+2", "+2", s);
    const dnfBtn = mkPenaltyBtn("DNF", "DNF", s);
    const noteBtn = document.createElement("button");
    noteBtn.type = "button";
    noteBtn.className = "timer-pill timer-pill-note" + (s.comment ? " active" : "");
    noteBtn.textContent = "✎"; // ✎
    noteBtn.title = s.comment ? `Edit note: ${s.comment}` : "Add note";
    noteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openCommentPopover(noteBtn, s);
    });
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "timer-pill timer-pill-del";
    delBtn.textContent = "×";
    delBtn.title = "Delete this solve";
    delBtn.addEventListener("click", () => sessions.deleteSolve(s.id));
    menuWrap.append(okBtn, p2Btn, dnfBtn, noteBtn, delBtn);
    row.appendChild(menuWrap);

    list.appendChild(row);
  }
}

/* ---------- per-solve comment popover ---------- */

function openCommentPopover(anchor, solve) {
  // Close any existing popover first (also closes if user re-clicks the same pill)
  const existing = document.querySelector(".timer-comment-pop");
  if (existing) {
    const wasSameAnchor = existing.dataset.solveId === solve.id;
    existing.remove();
    if (wasSameAnchor) return;
  }

  const pop = document.createElement("div");
  pop.className = "timer-comment-pop";
  pop.dataset.solveId = solve.id;

  const head = document.createElement("div");
  head.className = "timer-comment-head";
  head.textContent = `Note · ${sessions.fmtSolve(solve)}`;
  pop.appendChild(head);

  const scrambleRow = document.createElement("div");
  scrambleRow.className = "timer-comment-scramble";
  scrambleRow.innerHTML = colorizeAlg(solve.scramble || "");
  pop.appendChild(scrambleRow);

  const textarea = document.createElement("textarea");
  textarea.className = "timer-comment-textarea";
  textarea.rows = 3;
  textarea.placeholder = "Note for this solve (e.g. \"messed up PLL recognition\")";
  textarea.value = solve.comment || "";
  pop.appendChild(textarea);

  const actions = document.createElement("div");
  actions.className = "timer-comment-actions";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn btn-primary btn-small";
  saveBtn.textContent = "Save";
  saveBtn.addEventListener("click", () => {
    sessions.setSolveComment(solve.id, textarea.value.trim());
    pop.remove();
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn btn-small";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => pop.remove());

  actions.append(cancelBtn, saveBtn);
  pop.appendChild(actions);

  // Ctrl/Cmd+Enter to save, Esc to cancel
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      saveBtn.click();
    } else if (e.key === "Escape") {
      e.preventDefault();
      pop.remove();
    }
  });

  // Click outside to close
  const onDocClick = (e) => {
    if (!pop.contains(e.target) && e.target !== anchor) {
      pop.remove();
      document.removeEventListener("click", onDocClick);
    }
  };
  setTimeout(() => document.addEventListener("click", onDocClick), 0);

  anchor.insertAdjacentElement("afterend", pop);
  setTimeout(() => textarea.focus(), 0);
}

function mkPenaltyBtn(label, value, s) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "timer-pill";
  b.textContent = label;
  if (s.penalty === value) b.classList.add("active");
  b.addEventListener("click", () => sessions.setSolvePenalty(s.id, value));
  return b;
}

function labelForPhaseIndex(i) {
  const cfg = sessions.getPhaseConfig();
  return cfg.labels[i] || `Phase ${i + 1}`;
}

/* ---------- scramble ---------- */

async function loadNextScramble(force = false) {
  session.ui.scramble.textContent = "Generating…";
  session.ui.preview.innerHTML = "";
  try {
    const scr = await scrambler.nextScramble();
    if (!session) return; // closed mid-load
    session.currentScramble = scr;
    session.ui.scramble.innerHTML = colorizeAlg(scr);
    // Render preview via VisualCube. The 3x3 stage "image" gives a full cube view.
    // WCA scheme: white-up, red-right, green-front, yellow-down, orange-left, blue-back
    const url = vcImage({ setup: scr, view: "trans", size: 140, sch: "wrgyob" });
    const img = new Image();
    img.alt = "Scramble preview";
    img.className = "timer-preview-img";
    img.src = url;
    session.ui.preview.replaceChildren(img);
  } catch (err) {
    if (!session) return;
    session.ui.scramble.textContent = "Scramble unavailable (offline?). Tap New scramble to retry.";
  }
}

/* ---------- timer state machine ---------- */

function resetToIdle() {
  cancelRaf();
  cancelInspectionInterval();
  if (session.armReadyTimer) { clearTimeout(session.armReadyTimer); session.armReadyTimer = null; }
  session.state = "idle";
  session.phases = [];
  session.inspectionPenalty = null;
  session.inspectionStartMs = 0;
  session.ui.timeDisplay.textContent = "0.00";
  session.ui.timeDisplay.className = "timer-time";
  session.ui.hint.textContent = "Hold space (or tap and hold) to arm.";
}

function beginHold() {
  if (!session) return;
  if (session.state === "running") return; // shouldn't reach here
  if (session.state === "stopped") resetToIdle();
  if (session.state === "idle") {
    if (sessions.getInspection()) {
      // Hold to enter inspection
      session.state = "preInspectArm";
      session.holdStartMs = performance.now();
      session.ui.timeDisplay.className = "timer-time timer-pending";
      session.ui.hint.textContent = "Release to start inspection.";
    } else {
      // No inspection: hold to arm directly
      session.state = "arming";
      session.holdStartMs = performance.now();
      session.ui.timeDisplay.className = "timer-time timer-pending";
      session.ui.hint.textContent = "Hold to arm…";
      session.armReadyTimer = setTimeout(() => {
        if (!session || session.state !== "arming") return;
        session.state = "armed";
        session.ui.timeDisplay.className = "timer-time timer-armed";
        session.ui.hint.textContent = "Release to start.";
      }, HOLD_ARM_MS);
    }
    return;
  }
  if (session.state === "inspecting") {
    // Re-arm from inspection
    session.state = "arming";
    session.holdStartMs = performance.now();
    session.ui.timeDisplay.className = "timer-time timer-pending";
    session.armReadyTimer = setTimeout(() => {
      if (!session || session.state !== "arming") return;
      session.state = "armed";
      session.ui.timeDisplay.className = "timer-time timer-armed";
      session.ui.hint.textContent = "Release to start.";
    }, HOLD_ARM_MS);
  }
}

function releaseHold() {
  if (!session) return;
  if (session.state === "preInspectArm") {
    // Start inspection
    if (session.armReadyTimer) { clearTimeout(session.armReadyTimer); session.armReadyTimer = null; }
    session.state = "inspecting";
    session.inspectionStartMs = performance.now();
    session.ui.timeDisplay.className = "timer-time timer-inspecting";
    session.ui.hint.textContent = "Inspect. Hold space again to arm.";
    startInspectionInterval();
    return;
  }
  if (session.state === "arming") {
    // Released too early — back to previous state
    if (session.armReadyTimer) { clearTimeout(session.armReadyTimer); session.armReadyTimer = null; }
    // If inspection is on and inspection was running, return to inspecting; else idle
    if (sessions.getInspection() && session.inspectionStartMs > 0) {
      session.state = "inspecting";
      session.ui.timeDisplay.className = "timer-time timer-inspecting";
      session.ui.hint.textContent = "Inspect. Hold space again to arm.";
      startInspectionInterval();
    } else {
      resetToIdle();
    }
    return;
  }
  if (session.state === "armed") {
    // Start!
    startRun();
  }
}

function startInspectionInterval() {
  cancelInspectionInterval();
  inspectionTick();
  inspectionIntervalId = setInterval(inspectionTick, 100);
}

function cancelInspectionInterval() {
  if (inspectionIntervalId) { clearInterval(inspectionIntervalId); inspectionIntervalId = null; }
}

function inspectionTick() {
  if (!session || session.state !== "inspecting") { cancelInspectionInterval(); return; }
  const elapsed = performance.now() - session.inspectionStartMs;
  const remaining = Math.max(0, INSPECTION_TOTAL_MS - elapsed);
  if (elapsed >= INSPECTION_PLUS2_MS) {
    // Past 17s → automatic DNF on the upcoming solve
    cancelInspectionInterval();
    session.inspectionPenalty = "DNF";
    autoStartDnf();
    return;
  } else if (elapsed >= INSPECTION_TOTAL_MS) {
    // 15-17s → +2 penalty banked; keep showing countdown of overflow
    session.inspectionPenalty = "+2";
    session.ui.timeDisplay.textContent = "+2";
    session.ui.timeDisplay.className = "timer-time timer-inspecting timer-bad";
  } else {
    const secsLeft = Math.ceil(remaining / 1000);
    session.ui.timeDisplay.textContent = String(secsLeft);
    let cls = "timer-time timer-inspecting";
    if (elapsed >= 12000) cls += " timer-bad";
    else if (elapsed >= 8000) cls += " timer-warn";
    session.ui.timeDisplay.className = cls;
  }
}

function autoStartDnf() {
  // Record a DNF solve immediately for inspection overrun.
  if (!session) return;
  cancelRaf();
  const phases = sessions.getPhaseConfig().count;
  const dummy = new Array(phases).fill(0);
  recordAndReset({ timeMs: 0, phases: dummy, penalty: "DNF" });
}

function startRun() {
  session.state = "running";
  session.startMs = performance.now();
  session.phases = [];
  session.ui.timeDisplay.className = "timer-time timer-running";
  session.ui.hint.textContent =
    sessions.getPhaseConfig().count > 1
      ? "Press space to split. Final press stops."
      : "Press space (or any key) to stop.";
  runTick();
}

function runTick() {
  if (!session || session.state !== "running") return;
  const elapsed = performance.now() - session.startMs;
  session.ui.timeDisplay.textContent = (elapsed / 1000).toFixed(2);
  rafId = requestAnimationFrame(runTick);
}

function cancelRaf() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
}

function splitOrStop() {
  if (!session || session.state !== "running") return;
  const now = performance.now();
  const elapsed = now - session.startMs;
  session.phases.push(elapsed);
  const totalPhases = sessions.getPhaseConfig().count;
  if (session.phases.length >= totalPhases) {
    finishRun(elapsed);
  } else {
    // Could flash the time briefly here; keep minimal for now.
  }
}

function finishRun(totalMs) {
  cancelRaf();
  session.state = "stopped";
  session.ui.timeDisplay.className = "timer-time timer-stopped";
  session.ui.timeDisplay.textContent = (totalMs / 1000).toFixed(2);
  const penalty = session.inspectionPenalty || null;
  recordAndReset({
    timeMs: totalMs,
    phases: session.phases.slice(),
    penalty,
  });
}

function recordAndReset({ timeMs, phases, penalty }) {
  sessions.addSolve({
    timeMs,
    scramble: session.currentScramble || "",
    phases,
    penalty,
  });
  // Pull next scramble for the next solve
  loadNextScramble();
  // Brief pause on the displayed time, then reset
  setTimeout(() => {
    if (!session) return;
    resetToIdle();
  }, 600);
}

function cancelRun() {
  cancelRaf();
  if (!session) return;
  if (session.armReadyTimer) { clearTimeout(session.armReadyTimer); session.armReadyTimer = null; }
  resetToIdle();
}

/* ---------- input ---------- */

function isEditing(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

function attachKeyHandlers() {
  const onKeyDown = (e) => {
    if (!session) return;
    if (e.isComposing) return;
    if (e.repeat) return;
    if (isEditing(e.target)) return;

    if (e.code === "Escape") {
      if (session.state === "running" || session.state === "armed" ||
          session.state === "arming" || session.state === "preInspectArm" ||
          session.state === "inspecting") {
        e.preventDefault();
        cancelRun();
      }
      return;
    }

    if (e.code === "Space") {
      e.preventDefault();
      if (session.state === "running") {
        splitOrStop();
        return;
      }
      beginHold();
      return;
    }

    // Any non-space key during run stops the timer (cstimer behavior)
    if (session.state === "running") {
      e.preventDefault();
      // Treat as full stop: complete remaining phases as zero-duration
      const cfg = sessions.getPhaseConfig();
      while (session.phases.length < cfg.count - 1) {
        session.phases.push(performance.now() - session.startMs);
      }
      splitOrStop();
    }
  };

  const onKeyUp = (e) => {
    if (!session) return;
    if (e.isComposing) return;
    if (isEditing(e.target)) return;
    if (e.code === "Space") {
      e.preventDefault();
      releaseHold();
    }
  };

  session.keyHandlers = { onKeyDown, onKeyUp };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
}

function detachKeyHandlers() {
  if (!session || !session.keyHandlers) return;
  const { onKeyDown, onKeyUp } = session.keyHandlers;
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
}

function attachWindowBlur() {
  const fn = () => cancelRun();
  window.addEventListener("blur", fn);
  session.cleanup.push(() => window.removeEventListener("blur", fn));
}

function attachSessionsListener() {
  unsubSessions = sessions.subscribe(() => renderAll());
}

/* ---------- pointer/touch ---------- */

function onPointerDown(e) {
  if (!session) return;
  if (isEditing(e.target)) return;
  if (session.state === "running") { splitOrStop(); return; }
  beginHold();
}
function onPointerUp(e) {
  if (!session) return;
  releaseHold();
}
function onPointerCancel() {
  if (!session) return;
  if (session.state === "arming" || session.state === "preInspectArm") {
    if (session.armReadyTimer) { clearTimeout(session.armReadyTimer); session.armReadyTimer = null; }
    // Don't change state; releaseHold semantics will apply
  }
}
function onTouchStart(e) {
  e.preventDefault();
  onPointerDown(e);
}
function onTouchEnd(e) {
  e.preventDefault();
  onPointerUp(e);
}

/* ---------- session manager popover ---------- */

function openSessionManager() {
  // Tiny inline popover anchored under the button.
  const existing = document.querySelector(".timer-session-pop");
  if (existing) { existing.remove(); return; }

  const pop = document.createElement("div");
  pop.className = "timer-session-pop";

  const list = sessions.listSessions();
  const active = sessions.getActiveSession();

  for (const s of list) {
    const row = document.createElement("div");
    row.className = "timer-session-pop-row";
    if (active && s.id === active.id) row.classList.add("active");
    const name = document.createElement("button");
    name.type = "button";
    name.className = "timer-session-pop-name";
    name.textContent = s.name + ` (${s.solves.length})`;
    name.addEventListener("click", () => {
      sessions.setActiveSession(s.id);
      pop.remove();
    });
    row.appendChild(name);

    const rename = document.createElement("button");
    rename.type = "button";
    rename.className = "timer-pill";
    rename.textContent = "rename";
    rename.addEventListener("click", () => {
      const next = prompt("Rename session:", s.name);
      if (next != null && next.trim()) sessions.renameSession(s.id, next.trim());
    });
    row.appendChild(rename);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "timer-pill timer-pill-del";
    del.textContent = "delete";
    del.addEventListener("click", () => {
      if (confirm(`Delete "${s.name}" and all its solves?`)) {
        sessions.deleteSession(s.id);
        pop.remove();
      }
    });
    row.appendChild(del);

    pop.appendChild(row);
  }

  const newBtn = document.createElement("button");
  newBtn.type = "button";
  newBtn.className = "btn btn-small";
  newBtn.textContent = "+ New session";
  newBtn.addEventListener("click", () => {
    const name = prompt("Session name:", "New session");
    if (name != null && name.trim()) {
      sessions.createSession(name.trim());
      pop.remove();
    }
  });
  pop.appendChild(newBtn);

  // Click outside to close
  const onDocClick = (e) => {
    if (!pop.contains(e.target) && e.target !== session.ui.sessionLabel) {
      pop.remove();
      document.removeEventListener("click", onDocClick);
    }
  };
  setTimeout(() => document.addEventListener("click", onDocClick), 0);

  session.ui.sessionLabel.insertAdjacentElement("afterend", pop);
}

/* ---------- settings panel ---------- */

function openSettingsPanel() {
  const existing = document.querySelector(".timer-settings-pop");
  if (existing) { existing.remove(); return; }

  const cfg = sessions.getPhaseConfig();

  const pop = document.createElement("div");
  pop.className = "timer-settings-pop";

  const inspectLabel = document.createElement("label");
  inspectLabel.className = "timer-settings-row";
  const inspectCb = document.createElement("input");
  inspectCb.type = "checkbox";
  inspectCb.checked = sessions.getInspection();
  inspectCb.addEventListener("change", () => sessions.setInspection(inspectCb.checked));
  inspectLabel.appendChild(inspectCb);
  inspectLabel.appendChild(document.createTextNode(" WCA inspection (15s)"));
  pop.appendChild(inspectLabel);

  const phaseLabel = document.createElement("div");
  phaseLabel.className = "timer-settings-section";
  phaseLabel.textContent = "Phases";
  pop.appendChild(phaseLabel);

  const phaseGroup = document.createElement("div");
  phaseGroup.className = "timer-settings-row";
  for (const n of [1, 2, 3, 4]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "timer-pill";
    if (cfg.count === n) b.classList.add("active");
    b.textContent = n;
    b.addEventListener("click", () => {
      const labels = defaultLabelsFor(n);
      sessions.setPhaseConfig(n, labels);
      pop.remove();
      openSettingsPanel(); // re-open to refresh
    });
    phaseGroup.appendChild(b);
  }
  pop.appendChild(phaseGroup);

  // Editable labels for each phase
  for (let i = 0; i < cfg.count; i++) {
    const row = document.createElement("label");
    row.className = "timer-settings-row";
    row.appendChild(document.createTextNode(`Phase ${i + 1}: `));
    const input = document.createElement("input");
    input.type = "text";
    input.value = cfg.labels[i] || "";
    input.className = "timer-settings-input";
    input.addEventListener("change", () => {
      const next = cfg.labels.slice();
      next[i] = input.value.trim() || `Phase ${i + 1}`;
      sessions.setPhaseConfig(cfg.count, next);
    });
    row.appendChild(input);
    pop.appendChild(row);
  }

  // Click outside to close
  const onDocClick = (e) => {
    if (!pop.contains(e.target)) {
      pop.remove();
      document.removeEventListener("click", onDocClick);
    }
  };
  setTimeout(() => document.addEventListener("click", onDocClick), 0);

  // Anchor: append to topbar (right side)
  const topbar = document.querySelector(".timer-topbar");
  if (topbar) topbar.appendChild(pop);
}

function defaultLabelsFor(n) {
  if (n === 1) return ["Solve"];
  if (n === 2) return ["F2L", "LL"];
  if (n === 3) return ["Cross+F2L", "OLL", "PLL"];
  if (n === 4) return ["Cross", "F2L", "OLL", "PLL"];
  return new Array(n).fill(0).map((_, i) => `Phase ${i + 1}`);
}
