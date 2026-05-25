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
const PLUS2_GRACE_MS = 2000;      // WCA: +2 if start is within 2s past the limit; DNF beyond

/* Read the user's configured inspection duration in ms.
 * `sessions.getInspectionDurationSec()` defaults to 15 if unset. */
function inspectionTotalMs() { return sessions.getInspectionDurationSec() * 1000; }
function inspectionDnfMs()   { return inspectionTotalMs() + PLUS2_GRACE_MS; }

let session = null; // active timer session (not a persistent session)
let rafId = null;
let inspectionIntervalId = null;
let unsubSessions = null;
let unsubStatus = null;
let activeCommentPopover = null; // { pop, anchor, solveId, close } | null

/* Pairs a popover element with an outside-click handler so every dismissal
 * path (click-outside, Save, Cancel, etc.) detaches the same document
 * listener when it removes the pop. Without this, popovers leak listeners.
 * Returns `{ close }` — call it from every close path.
 *
 * No scroll-close: both current callers (session-manager + settings popover)
 * are anchored inside the timer modal panel, which itself scrolls on small
 * viewports. A capture-phase scroll listener fires for the panel's internal
 * scroll, which would snap-close the popover on any modal-content scroll.
 *
 * setTimeout-with-closed-guard: the addEventListener is deferred so the
 * click that OPENED the popover doesn't immediately re-trigger close.
 * If `close()` runs before the timer fires, we must NOT add the listener
 * (the matching removeEventListener has already run and the orphan would
 * leak forever).
 */
function attachPopoverDismiss(pop, anchor) {
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener("click", onDocClick);
    pop.remove();
  }
  function onDocClick(e) {
    if (!pop.contains(e.target) && e.target !== anchor) close();
  }
  setTimeout(() => {
    if (closed) return;
    document.addEventListener("click", onDocClick);
  }, 0);
  return { close };
}

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
  // Close any open popovers so their body-attached DOM nodes don't outlive
  // the modal, and so their dismiss listeners are removed.
  if (activeCommentPopover) { activeCommentPopover.close(); activeCommentPopover = null; }
  if (activeSessionPop)     { activeSessionPop.close();     activeSessionPop = null; }
  if (activeSettingsPop)    { activeSettingsPop.close();    activeSettingsPop = null; }
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
    // Time + small inspection-penalty chip rendered inline next to the time
    // so the user immediately sees that part of the penalty was locked-in
    // from inspection (vs. the user-clicked manual portion controlled by
    // the OK/+2/DNF pills).
    t.appendChild(document.createTextNode(sessions.fmtSolve(s)));
    if (s.inspectionPenalty === "+2" || s.inspectionPenalty === "DNF") {
      const chip = document.createElement("span");
      chip.className = "timer-insp-chip";
      chip.textContent = s.inspectionPenalty === "DNF" ? "insp DNF" : "+2 insp";
      t.appendChild(chip);
    }
    // Build a clear tooltip that names every penalty source contributing
    if (s.phases && s.phases.length > 1) {
      t.title = s.phases.map((cum, phaseIdx) => `${labelForPhaseIndex(phaseIdx)}: ${(cum / 1000).toFixed(2)}`).join("\n");
    }
    t.title = (t.title ? t.title + "\n\n" : "") + `Scramble: ${s.scramble}`;
    t.title += `\n\nPenalty: ${penaltySummary(s)}`;
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
    noteBtn.textContent = "info";
    noteBtn.title = s.comment
      ? `Solve info — note: ${s.comment}`
      : "Solve info — view scramble, add note";
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
  // Re-clicking the same pill toggles closed; clicking a different pill
  // closes the previous popover before opening the new one.
  if (activeCommentPopover) {
    const wasSame = activeCommentPopover.solveId === solve.id;
    activeCommentPopover.close();
    activeCommentPopover = null;
    if (wasSame) return;
  }

  // Backdrop overlay sits at top of stacking — clicking it closes the editor
  // while clicking inside the card doesn't. This sidesteps the z-index dance
  // with the timer modal entirely (the backdrop is body-attached and above
  // everything in the timer UI) and dims the timer content so the note
  // editor visually pops as the foreground task.
  const backdrop = document.createElement("div");
  backdrop.className = "timer-comment-backdrop";

  const card = document.createElement("div");
  card.className = "timer-comment-pop";
  card.dataset.solveId = solve.id;
  backdrop.appendChild(card);

  // Header: title + close button
  const head = document.createElement("div");
  head.className = "timer-comment-head";
  const headTitle = document.createElement("div");
  headTitle.className = "timer-comment-title";
  headTitle.textContent = `Solve info · ${sessions.fmtSolve(solve)}`;
  head.appendChild(headTitle);
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "timer-comment-close";
  closeBtn.setAttribute("aria-label", "Close solve info");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", () => closeAndForget());
  head.appendChild(closeBtn);
  card.appendChild(head);

  // Scramble section: notation + cube-state preview
  const scrambleLabel = document.createElement("div");
  scrambleLabel.className = "timer-comment-section-label";
  scrambleLabel.textContent = "Scramble";
  card.appendChild(scrambleLabel);
  const scrambleRow = document.createElement("div");
  scrambleRow.className = "timer-comment-scramble";
  scrambleRow.innerHTML = solve.scramble
    ? colorizeAlg(solve.scramble)
    : '<span style="color:var(--text-faint)">(no scramble recorded)</span>';
  card.appendChild(scrambleRow);

  if (solve.scramble) {
    const previewWrap = document.createElement("div");
    previewWrap.className = "timer-comment-preview-wrap";
    const previewImg = document.createElement("img");
    previewImg.className = "timer-comment-preview";
    previewImg.alt = "Scrambled cube state";
    previewImg.loading = "lazy";
    previewImg.decoding = "async";
    // White-on-top WCA orientation, same as the timer's main scramble preview.
    previewImg.src = vcImage({
      setup: solve.scramble,
      view: "trans",
      size: 160,
      sch: "wrgyob",
    });
    previewWrap.appendChild(previewImg);
    card.appendChild(previewWrap);
  }

  // Note section
  const noteLabel = document.createElement("div");
  noteLabel.className = "timer-comment-section-label";
  noteLabel.textContent = "Note";
  card.appendChild(noteLabel);
  const textarea = document.createElement("textarea");
  textarea.className = "timer-comment-textarea";
  textarea.rows = 6;
  textarea.placeholder = "e.g. \"locked up on PLL recognition\", \"bad cross — should drill that case\"";
  textarea.value = solve.comment || "";
  card.appendChild(textarea);

  // Hint row (keyboard shortcuts)
  const hint = document.createElement("div");
  hint.className = "timer-comment-hint";
  hint.textContent = "Ctrl/⌘+Enter to save · Esc to cancel";
  card.appendChild(hint);

  // Actions
  const actions = document.createElement("div");
  actions.className = "timer-comment-actions";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => closeAndForget());
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn btn-primary";
  saveBtn.textContent = "Save note";
  saveBtn.addEventListener("click", () => {
    sessions.setSolveComment(solve.id, textarea.value.trim());
    closeAndForget();
  });
  actions.append(cancelBtn, saveBtn);
  card.appendChild(actions);

  // Keyboard shortcuts inside the textarea
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      saveBtn.click();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeAndForget();
    }
  });

  // Backdrop click closes — but only if the click STARTED on the backdrop
  // too. Without this, a text-selection drag that begins in the textarea
  // and releases over the backdrop fires a click on the backdrop and the
  // user loses their unsaved typing.
  let downOnBackdrop = false;
  backdrop.addEventListener("mousedown", (e) => {
    downOnBackdrop = e.target === backdrop;
  });
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop && downOnBackdrop) closeAndForget();
    downOnBackdrop = false;
  });

  // Top-level Esc handler in case focus isn't in the textarea
  function onEscape(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeAndForget();
    }
  }
  document.addEventListener("keydown", onEscape, true);

  document.body.appendChild(backdrop);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onEscape, true);
    backdrop.remove();
  }
  const handle = { pop: card, backdrop, anchor, solveId: solve.id, close };
  activeCommentPopover = handle;

  function closeAndForget() {
    if (activeCommentPopover === handle) activeCommentPopover = null;
    handle.close();
  }

  setTimeout(() => {
    textarea.focus();
    // Place caret at end so user can keep typing on a saved note
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, 0);
}

function mkPenaltyBtn(label, value, s) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "timer-pill";
  b.textContent = label;
  // Only the MANUAL portion is editable via these pills — the inspection
  // penalty (if any) is locked in alongside.
  if (s.penalty === value) b.classList.add("active");
  b.addEventListener("click", () => sessions.setSolvePenalty(s.id, value));
  return b;
}

/* Build a human-readable summary of every penalty source on this solve.
 * Used in the row's title-attribute tooltip so the user understands why
 * the displayed time has a "+" or "++" suffix. */
function penaltySummary(s) {
  const ins = s.inspectionPenalty;
  const man = s.penalty;
  if (ins === "DNF") return "DNF (from inspection overrun)";
  if (man === "DNF") return "DNF (manual)";
  const parts = [];
  if (ins === "+2") parts.push("+2 from inspection");
  if (man === "+2") parts.push("+2 manual");
  if (parts.length === 0) return "none";
  if (parts.length === 2) return parts.join(" · ") + " → total +4";
  return parts[0];
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

/* Keep ticking through the entire pre-solve inspection cycle, including the
 * "arming" / "armed" hold-states. Updates BOTH the threshold checks
 * (+2 banking and the auto-DNF at limit+2s) AND the visible countdown
 * — holding space to re-arm during inspection should not freeze the
 * displayed seconds. Only the className is gated by state so the
 * green/yellow arm colors from the state-transition handlers aren't
 * overwritten during arming/armed. */
function inspectionTick() {
  if (!session) { cancelInspectionInterval(); return; }
  const inInspectCycle =
    session.state === "inspecting" ||
    session.state === "preInspectArm" ||
    session.state === "arming" ||
    session.state === "armed";
  if (!inInspectCycle) { cancelInspectionInterval(); return; }
  if (!session.inspectionStartMs) return; // not yet inspecting (preInspectArm before release)

  const totalMs = inspectionTotalMs();
  const dnfMs = inspectionDnfMs();
  const elapsed = performance.now() - session.inspectionStartMs;

  if (elapsed >= dnfMs) {
    // Past limit + 2s grace → automatic DNF, fires regardless of hold state
    cancelInspectionInterval();
    session.inspectionPenalty = "DNF";
    autoStartDnf();
    return;
  }
  if (elapsed >= totalMs) {
    // Within +2 grace window — bank the penalty so startRun sees it
    session.inspectionPenalty = "+2";
  }

  // Always update the visible countdown — including during arming/armed.
  // Without this the displayed seconds freeze the moment the user holds
  // space to re-arm, which misleads them about how much inspection time
  // they have left.
  if (elapsed >= totalMs) {
    session.ui.timeDisplay.textContent = "+2";
  } else {
    const remaining = Math.max(0, totalMs - elapsed);
    session.ui.timeDisplay.textContent = String(Math.ceil(remaining / 1000));
  }

  // className is owned by the state-transition handlers during arming/armed
  // so we don't clobber the green/yellow arm colors. While in pure
  // inspecting, drive the warn/bad bands here.
  if (session.state === "inspecting") {
    let cls = "timer-time timer-inspecting";
    if (elapsed >= totalMs) cls += " timer-bad";
    else if (elapsed >= totalMs * 0.80) cls += " timer-bad";
    else if (elapsed >= totalMs * 0.53) cls += " timer-warn";
    session.ui.timeDisplay.className = cls;
  }
}

function autoStartDnf() {
  // Record a DNF solve immediately for inspection overrun. The DNF lives in
  // inspectionPenalty (locked, not user-editable) — distinct from a user
  // clicking the DNF pill on a completed solve.
  if (!session) return;
  cancelRaf();
  const phases = sessions.getPhaseConfig().count;
  const dummy = new Array(phases).fill(0);
  recordAndReset({ timeMs: 0, phases: dummy, penalty: null, inspectionPenalty: "DNF" });
}

function startRun() {
  cancelInspectionInterval();
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
  // inspectionPenalty is the LOCKED inspection-overrun penalty; the manual
  // penalty (user clicking +2 / DNF after the fact) starts as null and is
  // edited via the OK/+2/DNF pills in the solves row. Without this split,
  // a +2 from blown inspection + a missed turn during the solve would only
  // record one +2 — but it's really +4 in WCA terms.
  recordAndReset({
    timeMs: totalMs,
    phases: session.phases.slice(),
    penalty: null,
    inspectionPenalty: session.inspectionPenalty || null,
  });
}

function recordAndReset({ timeMs, phases, penalty, inspectionPenalty }) {
  sessions.addSolve({
    timeMs,
    scramble: session.currentScramble || "",
    phases,
    penalty,
    inspectionPenalty,
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
  // Idempotent: drop any prior subscription before resubscribing so opening
  // the timer multiple times can't stack renderAll callbacks.
  if (unsubSessions) unsubSessions();
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

let activeSessionPop = null; // { close } | null

function openSessionManager() {
  // Toggle: re-clicking the label while open just closes.
  if (activeSessionPop) {
    activeSessionPop.close();
    activeSessionPop = null;
    return;
  }

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
      closeAndForget();
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

    const exp = document.createElement("button");
    exp.type = "button";
    exp.className = "timer-pill";
    exp.textContent = "export";
    exp.title = "Download this session as a JSON file";
    exp.addEventListener("click", () => {
      const json = sessions.exportSession(s.id);
      if (json) downloadJson(json, `${slugify(s.name)}-${dateStamp()}.json`);
    });
    row.appendChild(exp);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "timer-pill timer-pill-del";
    del.textContent = "delete";
    del.addEventListener("click", () => {
      if (confirm(`Delete "${s.name}" and all its solves?`)) {
        sessions.deleteSession(s.id);
        closeAndForget();
      }
    });
    row.appendChild(del);

    pop.appendChild(row);
  }

  const footer = document.createElement("div");
  footer.className = "timer-session-pop-footer";

  const newBtn = document.createElement("button");
  newBtn.type = "button";
  newBtn.className = "btn btn-small";
  newBtn.textContent = "+ New session";
  newBtn.addEventListener("click", () => {
    const name = prompt("Session name:", "New session");
    if (name != null && name.trim()) {
      sessions.createSession(name.trim());
      closeAndForget();
    }
  });
  footer.appendChild(newBtn);

  const exportAllBtn = document.createElement("button");
  exportAllBtn.type = "button";
  exportAllBtn.className = "btn btn-small";
  exportAllBtn.textContent = "Export all";
  exportAllBtn.title = "Download all sessions as one JSON file";
  exportAllBtn.addEventListener("click", () => {
    const json = sessions.exportAll();
    downloadJson(json, `rubiks-storage-sessions-${dateStamp()}.json`);
  });
  footer.appendChild(exportAllBtn);

  // Import: hidden file input + visible button that triggers it. Imports
  // are non-destructive — added as new sessions, never overwrite existing.
  const importInput = document.createElement("input");
  importInput.type = "file";
  importInput.accept = "application/json,.json";
  importInput.style.display = "none";
  importInput.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const result = sessions.importJson(text);
      if (!result.ok) {
        alert("Import failed: " + result.error);
      } else {
        alert(`Imported ${result.count} session${result.count === 1 ? "" : "s"}.`);
        closeAndForget();
      }
    } catch (e) {
      alert("Couldn't read the file: " + e.message);
    }
    importInput.value = ""; // allow re-selecting the same file later
  });
  footer.appendChild(importInput);

  const importBtn = document.createElement("button");
  importBtn.type = "button";
  importBtn.className = "btn btn-small";
  importBtn.textContent = "Import";
  importBtn.title = "Load sessions from a previously-exported JSON file";
  importBtn.addEventListener("click", () => importInput.click());
  footer.appendChild(importBtn);

  pop.appendChild(footer);

  session.ui.sessionLabel.insertAdjacentElement("afterend", pop);
  const dismiss = attachPopoverDismiss(pop, session.ui.sessionLabel);
  activeSessionPop = { close: dismiss.close };

  function closeAndForget() {
    if (activeSessionPop && activeSessionPop.close === dismiss.close) activeSessionPop = null;
    dismiss.close();
  }
}

/* ---------- settings panel ---------- */

let activeSettingsPop = null; // { close } | null

function openSettingsPanel() {
  // Toggle off on re-open
  if (activeSettingsPop) {
    activeSettingsPop.close();
    activeSettingsPop = null;
    return;
  }

  const cfg = sessions.getPhaseConfig();

  const pop = document.createElement("div");
  pop.className = "timer-settings-pop";

  const inspectLabel = document.createElement("label");
  inspectLabel.className = "timer-settings-row";
  const inspectCb = document.createElement("input");
  inspectCb.type = "checkbox";
  inspectCb.checked = sessions.getInspection();
  inspectCb.addEventListener("change", () => {
    sessions.setInspection(inspectCb.checked);
    durationRow.style.display = inspectCb.checked ? "" : "none";
  });
  inspectLabel.appendChild(inspectCb);
  inspectLabel.appendChild(document.createTextNode(" WCA inspection"));
  pop.appendChild(inspectLabel);

  // Inspection duration selector (only meaningful when inspection is on)
  const durationRow = document.createElement("div");
  durationRow.className = "timer-settings-row";
  durationRow.style.display = sessions.getInspection() ? "" : "none";
  const durationLabel = document.createElement("span");
  durationLabel.textContent = "Inspection duration";
  durationRow.appendChild(durationLabel);
  const durationGroup = document.createElement("div");
  durationGroup.className = "timer-settings-pill-group";
  const currentDuration = sessions.getInspectionDurationSec();
  for (const sec of [8, 15, 30, 60]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "timer-pill" + (sec === currentDuration ? " active" : "");
    b.textContent = sec + "s";
    b.addEventListener("click", () => {
      sessions.setInspectionDurationSec(sec);
      for (const pb of durationGroup.querySelectorAll(".timer-pill")) {
        pb.classList.toggle("active", parseInt(pb.textContent, 10) === sec);
      }
    });
    durationGroup.appendChild(b);
  }
  durationRow.appendChild(durationGroup);
  pop.appendChild(durationRow);

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
      closeAndForget();
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

  // Anchor: append to topbar (right side). Use the gear button as anchor for
  // outside-click detection so clicks on the gear (re-toggle) don't auto-close.
  const topbar = document.querySelector(".timer-topbar");
  if (topbar) topbar.appendChild(pop);
  const gearBtn = topbar?.querySelector(".timer-icon-btn");
  const dismiss = attachPopoverDismiss(pop, gearBtn || pop);
  activeSettingsPop = { close: dismiss.close };

  function closeAndForget() {
    if (activeSettingsPop && activeSettingsPop.close === dismiss.close) activeSettingsPop = null;
    dismiss.close();
  }
}

function defaultLabelsFor(n) {
  if (n === 1) return ["Solve"];
  if (n === 2) return ["F2L", "LL"];
  if (n === 3) return ["Cross+F2L", "OLL", "PLL"];
  if (n === 4) return ["Cross", "F2L", "OLL", "PLL"];
  return new Array(n).fill(0).map((_, i) => `Phase ${i + 1}`);
}

/* ---------- export helpers ---------- */

function downloadJson(jsonText, filename) {
  const blob = new Blob([jsonText], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Release the object URL after the click has had time to start the download
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slugify(s) {
  return String(s || "session")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "session";
}

function dateStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
