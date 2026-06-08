/* =========================================================
 * drill.js — drill mode session.
 *
 * Flow:
 *   start(data, selectedKeys) → opens modal, picks random case,
 *   shows scramble + image, spacebar-style timer, records stat,
 *   auto-advances (toggleable) or "Next" button.
 *
 * Timer state machine: idle → armed → running → stopped → idle (next)
 * ========================================================= */

import * as modal from "./modal.js";
import * as selection from "./selection.js";
import * as stats from "./stats.js";
import { buildScramble } from "./cube-notation.js";
import { vcImage } from "./app.js";
import { renderHtml as colorizeAlg } from "./alg-color.js";

let session = null;

const DRILLABLE_CATEGORIES = new Set(["pll", "oll"]);
const AUTO_ADVANCE_MS = 500;
const STUCK_WATCHDOG_MS = 2000;

/* Start a drill session. `keys` is an array of "category/id" strings. */
export function start(data, keys) {
  // Resolve, then filter to drillable + having a setup field
  const resolved = keys
    .map((k) => selection.resolve(k, data))
    .filter(Boolean)
    .filter(({ category, item }) =>
      DRILLABLE_CATEGORIES.has(category) && typeof item.setup === "string"
    );

  if (resolved.length === 0) {
    modal.open({
      title: "Drill",
      body: messageBody("Select at least one PLL or OLL case to drill."),
    });
    return;
  }

  session = {
    items: resolved,
    bag: [],
    lastIdx: -1,
    autoAdvance: true,
    current: null,
    timer: { state: "idle", startMs: 0, elapsedMs: 0, last: null },
    ui: {},
    keyHandlers: null,
  };

  const body = buildBody();
  modal.open({
    title: `Drill (${resolved.length} cases)`,
    body,
    onClose: () => endSession(),
  });

  attachKeyHandlers();
  next();
}

function endSession() {
  detachKeyHandlers();
  session = null;
}

/* ---------- DOM ---------- */

function buildBody() {
  const root = document.createElement("div");
  root.className = "drill-body";

  const caseInfo = document.createElement("div");
  caseInfo.className = "drill-case-info";
  session.ui.caseInfo = caseInfo;
  root.appendChild(caseInfo);

  const img = document.createElement("div");
  img.className = "drill-image";
  session.ui.image = img;
  root.appendChild(img);

  const scramble = document.createElement("div");
  scramble.className = "drill-scramble";
  session.ui.scramble = scramble;
  root.appendChild(scramble);

  // Touch-tap surface: wraps the timer so tapping anywhere inside controls it
  const tapArea = document.createElement("div");
  tapArea.className = "drill-tap-area";
  tapArea.setAttribute("role", "button");
  tapArea.setAttribute("aria-label", "Tap to start or stop timer");

  const timer = document.createElement("div");
  timer.className = "drill-timer";
  timer.textContent = "0.00";
  session.ui.timer = timer;
  tapArea.appendChild(timer);

  const hint = document.createElement("div");
  hint.className = "drill-hint";
  hint.textContent = "Hold space (or tap below) to start. Press any key (or tap again) to stop.";
  session.ui.hint = hint;
  tapArea.appendChild(hint);

  // Touch: simple tap-to-start / tap-to-stop (no hold-release; bad UX on touch).
  tapArea.addEventListener("touchstart", (e) => {
    e.preventDefault();
    if (!session) return;
    if (session.timer.state === "idle" || session.timer.state === "stopped") {
      armTimer();
      // Auto-transition armed → running on tap (touch can't model "release")
      startTimer();
    } else if (session.timer.state === "running") {
      stopTimer();
    }
  }, { passive: false });

  root.appendChild(tapArea);

  const controls = document.createElement("div");
  controls.className = "drill-controls";

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "btn btn-primary";
  nextBtn.textContent = "Next case";
  nextBtn.addEventListener("click", () => next());
  session.ui.nextBtn = nextBtn;
  controls.appendChild(nextBtn);

  const autoLabel = document.createElement("label");
  autoLabel.className = "drill-auto";
  const autoCb = document.createElement("input");
  autoCb.type = "checkbox";
  autoCb.checked = session.autoAdvance;
  autoCb.addEventListener("change", () => { session.autoAdvance = autoCb.checked; });
  autoLabel.appendChild(autoCb);
  autoLabel.appendChild(document.createTextNode(" Auto-advance after solve"));
  controls.appendChild(autoLabel);

  root.appendChild(controls);

  const lastTime = document.createElement("div");
  lastTime.className = "drill-last";
  session.ui.lastTime = lastTime;
  root.appendChild(lastTime);

  return root;
}

function messageBody(text) {
  const div = document.createElement("div");
  div.style.padding = "16px 0";
  div.style.color = "var(--text-muted)";
  div.textContent = text;
  return div;
}

/* ---------- session control ---------- */

function next() {
  if (!session) return;
  resetTimerState();
  const idx = drawFromBag();
  const { category, item } = session.items[idx];
  session.lastIdx = idx;
  session.current = { category, item };

  // Case info
  const ci = session.ui.caseInfo;
  ci.innerHTML = "";
  const label = document.createElement("span");
  label.className = "drill-label";
  label.textContent = (category === "pll" ? "PLL" : "OLL") + " · " + item.name;
  ci.appendChild(label);

  // Image (rendered from setup, not the case's own algorithm string)
  const stage = category === "pll" ? "pll" : "oll";
  const imgUrl = vcImage({ setup: item.setup, stage, view: "plan", size: 180 });
  const img = new Image();
  img.alt = item.name;
  img.className = "drill-cube";
  img.src = imgUrl;
  session.ui.image.replaceChildren(img);

  // Scramble = random AUF + random y + setup
  const scr = buildScramble(item.setup);
  session.ui.scramble.innerHTML = colorizeAlg(scr);

  // Preload the *next* draw's image so the cache is warm by the time the
  // user finishes this rep. Cheap and reduces perceived swap time.
  if (session.items.length > 1) {
    const peekIdx = session.bag[0] ?? null;
    if (peekIdx != null && session.items[peekIdx]) {
      const nextItem = session.items[peekIdx].item;
      const nextCat = session.items[peekIdx].category;
      const nextStage = nextCat === "pll" ? "pll" : "oll";
      const pre = new Image();
      pre.src = vcImage({ setup: nextItem.setup, stage: nextStage, view: "plan", size: 180 });
    }
  }
}

/* Shuffled-bag draw: refills with a Fisher-Yates shuffle on exhaustion so
   every case appears once before repeats, and avoids back-to-back repeats. */
function drawFromBag() {
  if (!session) return 0;
  if (session.bag.length === 0) {
    const n = session.items.length;
    const idxs = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
    }
    if (n > 1 && idxs[0] === session.lastIdx) {
      const swap = 1 + Math.floor(Math.random() * (n - 1));
      [idxs[0], idxs[swap]] = [idxs[swap], idxs[0]];
    }
    session.bag = idxs;
  }
  return session.bag.shift();
}

/* ---------- timer ---------- */

let rafId = null;

function resetTimerState() {
  cancelRaf();
  session.timer.state = "idle";
  session.timer.elapsedMs = 0;
  session.ui.timer.textContent = "0.00";
  session.ui.timer.classList.remove("armed", "running", "stopped");
  session.ui.hint.textContent = "Hold space to arm, release to start, press any key to stop.";
}

function armTimer() {
  if (session.timer.state !== "idle" && session.timer.state !== "stopped") return;
  session.timer.state = "armed";
  session.ui.timer.classList.remove("running", "stopped");
  session.ui.timer.classList.add("armed");
  session.ui.timer.textContent = "0.00";
  session.ui.hint.textContent = "Release space to start.";
}

function startTimer() {
  if (session.timer.state !== "armed") return;
  session.timer.state = "running";
  session.timer.startMs = performance.now();
  session.ui.timer.classList.remove("armed", "stopped");
  session.ui.timer.classList.add("running");
  session.ui.hint.textContent = "Press any key to stop.";
  tick();
}

function tick() {
  if (!session || session.timer.state !== "running") return;
  const elapsed = (performance.now() - session.timer.startMs) / 1000;
  session.ui.timer.textContent = stats.fmtSecs(elapsed);
  rafId = requestAnimationFrame(tick);
}

function cancelRaf() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
}

function stopTimer() {
  if (session.timer.state !== "running") return;
  cancelRaf();
  const seconds = (performance.now() - session.timer.startMs) / 1000;
  session.timer.state = "stopped";
  session.timer.elapsedMs = seconds * 1000;
  session.ui.timer.classList.remove("armed", "running");
  session.ui.timer.classList.add("stopped");
  session.ui.timer.textContent = stats.fmtSecs(seconds);

  // PB detection — read prior best BEFORE recording so the new time doesn't
  // count as "beating" itself. A new PB triggers a brief CSS pulse on the
  // timer (defined in styles.css; class is auto-removed on animationend).
  const { category, item } = session.current;
  const prior = stats.getDrill(category, item.id);
  const isPB = prior?.best != null && seconds < prior.best;

  // Record stat — wrap in try/catch so a thrown stats write (cloud-sync
  // hiccup, localStorage quota) doesn't block auto-advance.
  try {
    stats.recordDrill(category, item.id, seconds);
  } catch (err) {
    console.error("drill: stats.recordDrill failed", err);
  }
  session.ui.lastTime.textContent = `Last: ${stats.fmtTime(seconds)}` + (isPB ? "  (PB)" : "");

  if (isPB) {
    const t = session.ui.timer;
    t.classList.remove("pb-pulse");
    void t.offsetWidth;     // restart animation
    t.classList.add("pb-pulse");
    t.addEventListener("animationend", () => t.classList.remove("pb-pulse"), { once: true });
  }

  // Single-case sessions can't actually "advance" — drawing again returns
  // the same case, which looks like a stuck state to the user. Surface
  // that explicitly instead of pretending to load.
  const singleCase = session.items.length === 1;
  if (singleCase || !session.autoAdvance) {
    session.ui.hint.textContent = "Saved. Hit space to drill again.";
    return;
  }

  session.ui.hint.textContent = "Saved. Loading next case…";

  // Primary auto-advance.
  setTimeout(() => { if (session) next(); }, AUTO_ADVANCE_MS);

  // Watchdog: if next() didn't run for any reason (a thrown render error,
  // a focus-stolen timeout, etc.), the hint stays on "Loading next case…".
  // Detect that and force-fire next() so the user is never left staring at
  // a stuck loading message.
  setTimeout(() => {
    if (!session) return;
    if (session.ui.hint.textContent.startsWith("Saved. Loading")) {
      try { next(); } catch (err) { console.error("drill watchdog next() failed", err); }
    }
  }, STUCK_WATCHDOG_MS);
}

function cancelArmedOrRunning() {
  cancelRaf();
  if (session && (session.timer.state === "armed" || session.timer.state === "running")) {
    session.timer.state = "idle";
    session.ui.timer.classList.remove("armed", "running");
    session.ui.timer.textContent = "0.00";
    session.ui.hint.textContent = "Cancelled. Hold space to arm again.";
  }
}

/* ---------- key bindings ---------- */

function attachKeyHandlers() {
  const onKeyDown = (e) => {
    if (!session) return;
    if (e.isComposing) return;
    if (e.repeat) return;
    // Don't fire if typing in an input/textarea
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;

    if (e.code === "Space") {
      e.preventDefault();
      if (session.timer.state === "idle" || session.timer.state === "stopped") {
        armTimer();
      } else if (session.timer.state === "running") {
        stopTimer();
      }
      return;
    }
    // Any other key stops the timer when running
    if (session.timer.state === "running") {
      e.preventDefault();
      stopTimer();
    }
  };

  const onKeyUp = (e) => {
    if (!session) return;
    if (e.isComposing) return;
    if (e.code === "Space") {
      e.preventDefault();
      if (session.timer.state === "armed") startTimer();
    }
  };

  const onBlur = () => cancelArmedOrRunning();

  session.keyHandlers = { onKeyDown, onKeyUp, onBlur };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
}

function detachKeyHandlers() {
  cancelRaf();
  if (!session || !session.keyHandlers) return;
  const { onKeyDown, onKeyUp, onBlur } = session.keyHandlers;
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
  window.removeEventListener("blur", onBlur);
}
