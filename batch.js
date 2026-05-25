/* =========================================================
 * batch.js — chained-scramble batch drill.
 *
 * Pick N random PLL/OLL cases (locked to 5 for now). Build a
 * single initial scramble by concatenating the cases' setups in
 * REVERSE order:
 *
 *     scramble = setup_N · setup_{N-1} · ... · setup_1
 *
 * Applied to a solved cube, this leaves the cube in a chaotic
 * LL state. Executing the cases' algorithms in FORWARD order
 * (alg_1, alg_2, ..., alg_N) cancels each setup in turn, so
 * after the N-th alg the cube is back to solved.
 *
 * The user reads the alg from the screen, executes it, presses
 * space to split, then sees the next alg. Single continuous
 * timer for the whole sequence; per-alg splits shown at the end.
 *
 * (Intermediate states don't look like canonical case_2, case_3,
 * etc. — they're the case state with additional residual setup
 * permutations on top. That's fine: the user follows the on-
 * screen alg rather than recognizing.)
 *
 * State machine:
 *   idle → armed (hold space) → running (release) → split×N → done
 * ========================================================= */

import * as modal from "./modal.js";
import * as selection from "./selection.js";
import { vcImage } from "./app.js";

const BATCH_SIZE = 5;
const DRILLABLE = new Set(["pll", "oll"]);

let session = null;
let rafId = null;

export function start(data, keys) {
  const resolved = keys
    .map((k) => selection.resolve(k, data))
    .filter(Boolean)
    .filter(({ category, item }) => DRILLABLE.has(category) && typeof item.setup === "string");

  if (resolved.length === 0) {
    modal.open({
      title: "Batch mode",
      body: messageBody("Select at least one PLL or OLL case to batch-drill."),
    });
    return;
  }

  const queue = pickQueue(resolved, BATCH_SIZE);
  // Chained initial scramble: setups in REVERSE order so the user's algs in
  // FORWARD order cancel them one by one.
  const initialScramble = queue
    .slice()
    .reverse()
    .map((p) => p.item.setup)
    .join(" ");

  session = {
    queue,
    initialScramble,
    currentIdx: 0,
    splits: [],
    timer: { state: "idle", startMs: 0, lastSplitMs: 0, elapsedMs: 0 },
    ui: {},
    keyHandlers: null,
  };

  const body = buildBody();
  modal.open({
    title: `Batch mode — ${BATCH_SIZE} chained cases`,
    body,
    onClose: endSession,
  });

  attachKeyHandlers();
  renderCurrent();
  renderQueue();
}

function endSession() {
  detachKeyHandlers();
  cancelRaf();
  session = null;
}

function pickQueue(items, n) {
  const bag = items.slice();
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  const out = [];
  while (out.length < n) {
    if (bag.length === 0) {
      out.push(items[Math.floor(Math.random() * items.length)]);
    } else {
      out.push(bag.shift());
    }
  }
  return out;
}

/* ---------- DOM ---------- */

function buildBody() {
  const root = document.createElement("div");
  root.className = "batch-body";

  // Initial scramble — visible the entire run; user applies once at the start.
  const scrambleWrap = document.createElement("div");
  scrambleWrap.className = "batch-initial-wrap";
  const scrambleLabel = document.createElement("div");
  scrambleLabel.className = "batch-initial-label";
  scrambleLabel.textContent = "Apply this scramble to a solved cube:";
  scrambleWrap.appendChild(scrambleLabel);

  const scramble = document.createElement("div");
  scramble.className = "batch-initial-scramble";
  scramble.textContent = session.initialScramble;
  scrambleWrap.appendChild(scramble);

  // Initial-state preview — what the cube should look like after applying the
  // scramble. Reuses VisualCube with the WCA white-up scheme.
  const preview = document.createElement("img");
  preview.className = "batch-initial-preview";
  preview.alt = "Scrambled state preview";
  preview.src = vcImage({
    setup: session.initialScramble,
    view: "trans",
    size: 110,
    sch: "wrgyob",
  });
  scrambleWrap.appendChild(preview);

  root.appendChild(scrambleWrap);

  const status = document.createElement("div");
  status.className = "batch-status";
  session.ui.status = status;
  root.appendChild(status);

  const caseInfo = document.createElement("div");
  caseInfo.className = "batch-case-info";
  session.ui.caseInfo = caseInfo;
  root.appendChild(caseInfo);

  const algBox = document.createElement("div");
  algBox.className = "batch-alg";
  session.ui.alg = algBox;
  root.appendChild(algBox);

  const timer = document.createElement("div");
  timer.className = "batch-timer";
  timer.textContent = "0.00";
  session.ui.timer = timer;
  root.appendChild(timer);

  const hint = document.createElement("div");
  hint.className = "batch-hint";
  hint.textContent = "Apply the scramble above, then hold space to arm. Press space after each alg.";
  session.ui.hint = hint;
  root.appendChild(hint);

  const queueRow = document.createElement("div");
  queueRow.className = "batch-queue";
  session.ui.queue = queueRow;
  root.appendChild(queueRow);

  const splits = document.createElement("div");
  splits.className = "batch-splits hidden";
  session.ui.splits = splits;
  root.appendChild(splits);

  return root;
}

function messageBody(text) {
  const div = document.createElement("div");
  div.style.padding = "16px 0";
  div.style.color = "var(--text-muted)";
  div.textContent = text;
  return div;
}

/* ---------- rendering ---------- */

function renderCurrent() {
  if (!session) return;
  const { queue, currentIdx } = session;
  if (currentIdx >= queue.length) return;
  const pick = queue[currentIdx];

  session.ui.status.textContent = `Alg ${currentIdx + 1} of ${BATCH_SIZE}`;
  const catLabel = pick.category === "pll" ? "PLL" : "OLL";
  const idStr = pick.category === "pll" ? pick.item.id : `#${pick.item.id}`;
  session.ui.caseInfo.textContent = `${catLabel} ${idStr} · ${pick.item.name}`;
  session.ui.alg.textContent = pick.item.algorithm || "(no algorithm in data)";
}

function renderQueue() {
  if (!session) return;
  session.ui.queue.innerHTML = "";
  for (let i = 0; i < BATCH_SIZE; i++) {
    const pip = document.createElement("span");
    pip.className = "batch-pip";
    if (i < session.currentIdx) pip.classList.add("done");
    else if (i === session.currentIdx) pip.classList.add("current");
    const pick = session.queue[i];
    const label = pick.category === "pll" ? pick.item.id : `#${pick.item.id}`;
    pip.textContent = label;
    session.ui.queue.appendChild(pip);
  }
}

function renderSplits(total) {
  const wrap = session.ui.splits;
  wrap.classList.remove("hidden");
  wrap.innerHTML = "";

  const head = document.createElement("div");
  head.className = "batch-splits-head";
  head.textContent = `Total: ${(total / 1000).toFixed(2)}s · average ${(total / BATCH_SIZE / 1000).toFixed(2)}s`;
  wrap.appendChild(head);

  const list = document.createElement("div");
  list.className = "batch-splits-list";
  for (let i = 0; i < session.splits.length; i++) {
    const row = document.createElement("div");
    row.className = "batch-split-row";
    const pick = session.queue[i];
    const label = pick.category === "pll" ? pick.item.name : `OLL #${pick.item.id}`;
    row.innerHTML = `<span>${i + 1}. ${escapeHtml(label)}</span><span class="batch-split-time">${(session.splits[i] / 1000).toFixed(2)}s</span>`;
    list.appendChild(row);
  }
  wrap.appendChild(list);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- timer ---------- */

function armTimer() {
  if (session.timer.state !== "idle") return;
  session.timer.state = "armed";
  session.ui.timer.classList.add("armed");
  session.ui.hint.textContent = "Release space to start.";
}

function startTimer() {
  if (session.timer.state !== "armed") return;
  session.timer.state = "running";
  session.timer.startMs = performance.now();
  session.timer.lastSplitMs = session.timer.startMs;
  session.ui.timer.classList.remove("armed");
  session.ui.timer.classList.add("running");
  session.ui.hint.textContent = "Execute the alg, then press space to split.";
  tick();
}

function tick() {
  if (!session || session.timer.state !== "running") return;
  const elapsed = (performance.now() - session.timer.startMs) / 1000;
  session.ui.timer.textContent = elapsed.toFixed(2);
  rafId = requestAnimationFrame(tick);
}

function cancelRaf() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
}

function splitOrFinish() {
  if (!session || session.timer.state !== "running") return;
  const now = performance.now();
  const splitMs = now - session.timer.lastSplitMs;
  session.splits.push(splitMs);
  session.timer.lastSplitMs = now;
  session.currentIdx += 1;

  if (session.currentIdx >= BATCH_SIZE) {
    finish(now);
  } else {
    renderCurrent();
    renderQueue();
  }
}

function finish(stopMs) {
  cancelRaf();
  session.timer.state = "done";
  const total = stopMs - session.timer.startMs;
  session.timer.elapsedMs = total;
  session.ui.timer.classList.remove("running");
  session.ui.timer.classList.add("stopped");
  session.ui.timer.textContent = (total / 1000).toFixed(2);
  session.ui.caseInfo.textContent = "Cube should be solved!";
  session.ui.alg.textContent = "";
  session.ui.status.textContent = "Done";
  session.ui.hint.textContent = "Close the modal or run another batch.";
  renderQueue();
  renderSplits(total);
}

/* ---------- input ---------- */

function attachKeyHandlers() {
  const onKeyDown = (e) => {
    if (!session) return;
    if (e.isComposing || e.repeat) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;

    if (e.code === "Space") {
      e.preventDefault();
      if (session.timer.state === "idle") armTimer();
      else if (session.timer.state === "running") splitOrFinish();
      return;
    }
    if (session.timer.state === "running") {
      e.preventDefault();
      splitOrFinish();
    }
  };
  const onKeyUp = (e) => {
    if (!session) return;
    if (e.code === "Space") {
      e.preventDefault();
      if (session.timer.state === "armed") startTimer();
    }
  };
  const onBlur = () => {
    if (!session) return;
    if (session.timer.state === "armed") {
      session.timer.state = "idle";
      session.ui.timer.classList.remove("armed");
      session.ui.hint.textContent = "Hold space to arm.";
    }
  };
  session.keyHandlers = { onKeyDown, onKeyUp, onBlur };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
}

function detachKeyHandlers() {
  if (!session || !session.keyHandlers) return;
  window.removeEventListener("keydown", session.keyHandlers.onKeyDown);
  window.removeEventListener("keyup", session.keyHandlers.onKeyUp);
  window.removeEventListener("blur", session.keyHandlers.onBlur);
}
