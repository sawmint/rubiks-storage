/* =========================================================
 * batch.js — chained PLL batch with SHORT equivalent scramble.
 *
 * Pick 5 random PLL cases (OLLs ignored for now). The composition
 * of their 5 setups always lands in one of 288 reachable last-layer
 * states (each representable as a PLL × AUF × y-rotation variant).
 * We precompute that map in `pll-compose.json` and ship it; in the
 * client we walk a small composition table to find the equivalent
 * state and use its SHORT scramble (~10-20 moves) as the initial
 * scramble, instead of concatenating all 5 setups (~100 moves).
 *
 * The user applies that one short scramble, then executes the 5
 * algs in queue order; the cube ends solved.
 *
 * State machine:
 *   idle → armed (hold space) → running (release) → split×5 → done
 * ========================================================= */

import * as selection from "./selection.js";
import { vcImage, openSessionPage } from "./app.js";
import { renderHtml as colorizeAlg } from "./alg-color.js";

const BATCH_SIZE = 5;
const DRILLABLE = new Set(["pll"]); // OLLs not supported in chained batch (yet)

/* ---------- rotation-conjugation stripper ----------
 *
 * pll-compose.json scrambles contain matched x/x' (and similar) rotation
 * pairs from the underlying PLL setups, e.g. `x R2 D2 R U R' D2 R U' R x'`.
 * Those rotations are mathematically required by the setup conjugation but
 * visually they look like dead weight to a cuber applying the scramble.
 * This rewrites a scramble that's wrapped in `R0 ... R0_inv` to the
 * rotation-free equivalent by conjugating each inner face move through R0.
 * Slice/wide moves and unknown tokens cancel the rewrite (we keep the
 * original form rather than risk emitting bad notation).
 */
const ROTATIONS = new Set(["x", "x'", "x2", "y", "y'", "y2", "z", "z'", "z2"]);
const ROT_INVERSE = {
  "x": "x'", "x'": "x", "x2": "x2",
  "y": "y'", "y'": "y", "y2": "y2",
  "z": "z'", "z'": "z", "z2": "z2",
};
// Face-rotation conjugation table: rot * F * rot' = which face in the
// original frame? Derived from "what face is at position F after applying
// `rot` to a solved cube." Verified against pycuber for all 9 rotations.
const FACE_MAP = {
  "x":  { U: "F", F: "D", D: "B", B: "U", R: "R", L: "L" },
  "x'": { U: "B", B: "D", D: "F", F: "U", R: "R", L: "L" },
  "x2": { U: "D", D: "U", F: "B", B: "F", R: "R", L: "L" },
  "y":  { F: "R", R: "B", B: "L", L: "F", U: "U", D: "D" },
  "y'": { F: "L", L: "B", B: "R", R: "F", U: "U", D: "D" },
  "y2": { F: "B", B: "F", R: "L", L: "R", U: "U", D: "D" },
  "z":  { U: "L", L: "D", D: "R", R: "U", F: "F", B: "B" },
  "z'": { U: "R", R: "D", D: "L", L: "U", F: "F", B: "B" },
  "z2": { U: "D", D: "U", R: "L", L: "R", F: "F", B: "B" },
};
function conjugateFaceMove(move, rot) {
  const m = move.match(/^([UDFBLR])(['2]?)$/);
  if (!m) return null;     // slice/wide/unknown → bail, keep original wrapper
  const newFace = FACE_MAP[rot]?.[m[1]];
  return newFace ? newFace + m[2] : null;
}
export function stripRotationConjugation(scr) {
  if (!scr || typeof scr !== "string") return scr;
  let tokens = scr.trim().split(/\s+/).filter(Boolean);
  // Scan left-to-right for any rotation token. When found, walk forward
  // looking for its inverse; if every token between them is conjugatable,
  // rewrite the slice and continue scanning from the same position (the
  // rewrite never introduces new rotations). Repeat until no more pairs
  // can be collapsed. This covers both fully-wrapped scrambles
  // (`x A x'`) and inner pairs (`U x A x' U`).
  let progress = true;
  while (progress) {
    progress = false;
    for (let i = 0; i < tokens.length; i++) {
      if (!ROTATIONS.has(tokens[i])) continue;
      const inv = ROT_INVERSE[tokens[i]];
      // Find the nearest matching inverse at index j > i with no other
      // rotation tokens in between — rewriting through a nested rotation
      // would require composing rotations and we keep this simple.
      let j = -1;
      for (let k = i + 1; k < tokens.length; k++) {
        if (tokens[k] === inv) { j = k; break; }
        if (ROTATIONS.has(tokens[k])) { j = -2; break; }
      }
      if (j < 0) continue;
      const inner = tokens.slice(i + 1, j);
      const conjugated = [];
      let ok = true;
      for (const t of inner) {
        const c = conjugateFaceMove(t, tokens[i]);
        if (c == null) { ok = false; break; }
        conjugated.push(c);
      }
      if (!ok) continue;
      tokens = [...tokens.slice(0, i), ...conjugated, ...tokens.slice(j + 1)];
      progress = true;
      break;     // restart scan since indices shifted
    }
  }
  return tokens.join(" ");
}

let session = null;
let rafId = null;
let composeData = null; // lazy-loaded pll-compose.json

async function loadCompose() {
  if (composeData) return composeData;
  const res = await fetch("./pll-compose.json");
  composeData = await res.json();
  // Build an id → index map for fast lookup
  composeData.pllIndex = Object.fromEntries(composeData.plls.map((p, i) => [p, i]));
  return composeData;
}

export async function start(data, keys) {
  // Filter to PLL-only with setups
  const resolved = keys
    .map((k) => selection.resolve(k, data))
    .filter(Boolean)
    .filter(({ category, item }) => DRILLABLE.has(category) && typeof item.setup === "string");

  if (resolved.length === 0) {
    openSessionPage({
      title: "Batch mode",
      body: messageBody("Select at least one PLL case. (OLL batch coming later.)"),
    });
    return;
  }

  const queue = pickQueue(resolved, BATCH_SIZE);

  // Load the composition table (lazily, cached after first load)
  const compose = await loadCompose();

  // Walk the table to find the equivalent state.
  // Chained scramble = setup_5 · setup_4 · ... · setup_1, so apply in REVERSE
  // queue order against the solved state.
  let stateId = compose.solved;
  for (const p of queue.slice().reverse()) {
    const idx = compose.pllIndex[p.item.id];
    if (idx == null) {
      // Shouldn't happen for PLLs in our dataset
      break;
    }
    stateId = compose.table[stateId][idx];
  }
  const initialScramble = stripRotationConjugation(compose.scrambles[stateId]);

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
  openSessionPage({
    title: `Batch mode — ${BATCH_SIZE} chained algs`,
    body,
    onLeave: endSession,
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

  const scrambleWrap = document.createElement("div");
  scrambleWrap.className = "batch-initial-wrap";
  const scrambleLabel = document.createElement("div");
  scrambleLabel.className = "batch-initial-label";
  scrambleLabel.textContent = "Apply this scramble to a solved cube:";
  scrambleWrap.appendChild(scrambleLabel);

  const scramble = document.createElement("div");
  scramble.className = "batch-initial-scramble";
  if (session.initialScramble) {
    scramble.innerHTML = colorizeAlg(session.initialScramble);
  } else {
    scramble.textContent = "(already solved — re-roll the batch)";
  }
  scrambleWrap.appendChild(scramble);

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
  session.ui.caseInfo.textContent = `PLL ${pick.item.id} — ${pick.item.name}`;
  if (pick.item.algorithm) {
    session.ui.alg.innerHTML = colorizeAlg(pick.item.algorithm);
  } else {
    session.ui.alg.textContent = "(no algorithm)";
  }
}

function renderQueue() {
  if (!session) return;
  session.ui.queue.innerHTML = "";
  for (let i = 0; i < BATCH_SIZE; i++) {
    const pip = document.createElement("span");
    pip.className = "batch-pip";
    if (i < session.currentIdx) pip.classList.add("done");
    else if (i === session.currentIdx) pip.classList.add("current");
    pip.textContent = session.queue[i].item.id;
    session.ui.queue.appendChild(pip);
  }
}

function renderSplits(total) {
  const wrap = session.ui.splits;
  wrap.classList.remove("hidden");
  wrap.innerHTML = "";

  const head = document.createElement("div");
  head.className = "batch-splits-head";
  head.textContent = `Total: ${(total / 1000).toFixed(2)}s, average ${(total / BATCH_SIZE / 1000).toFixed(2)}s`;
  wrap.appendChild(head);

  const list = document.createElement("div");
  list.className = "batch-splits-list";
  for (let i = 0; i < session.splits.length; i++) {
    const row = document.createElement("div");
    row.className = "batch-split-row";
    row.innerHTML = `<span>${i + 1}. ${escapeHtml(session.queue[i].item.name)}</span><span class="batch-split-time">${(session.splits[i] / 1000).toFixed(2)}s</span>`;
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
  session.ui.hint.textContent = "Execute the alg, then press space.";
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
