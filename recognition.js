/* =========================================================
 * recognition.js — recognition trainer (PLL text + OLL thumbnails).
 *
 * For each round:
 *   - Pick a random selected case
 *   - Show its image (scrambled with random AUF + y so the case
 *     appears from a varying angle)
 *   - PLL: free-text input; OLL: 4-thumbnail multiple choice
 *   - Score correct/wrong, record reaction time
 *   - Advance to next on click or Enter
 * ========================================================= */

import * as modal from "./modal.js";
import * as selection from "./selection.js";
import * as stats from "./stats.js";
import { buildScramble } from "./cube-notation.js";
import { vcImage } from "./app.js";

const RECOG_CATEGORIES = new Set(["pll", "oll"]);
const SETTINGS_KEY = "rs-recog-settings-v1";

const DEFAULT_SETTINGS = {
  ollChoices: 4,        // 2, 4, or 6
  autoAdvance: true,    // after a correct answer, auto-load the next
  autoDelayMs: 1200,    // pause before auto-advance
  showAlgInFeedback: true,
  timeLimitSec: 0,      // 0 = no time limit; otherwise seconds per question
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}

let session = null;
let keyHandler = null;

/* Entry point — opens settings first, then proceeds to trainer on submit. */
export function start(data, keys) {
  const resolved = keys
    .map((k) => selection.resolve(k, data))
    .filter(Boolean)
    .filter(({ category, item }) =>
      RECOG_CATEGORIES.has(category) && typeof item.setup === "string"
    );

  if (resolved.length === 0) {
    modal.open({
      title: "Recognition trainer",
      body: messageBody("Select at least one PLL or OLL case to practice."),
    });
    return;
  }

  showSettings(data, resolved);
}

function showSettings(data, resolved) {
  const s = loadSettings();
  const body = buildSettingsBody(s, resolved, (finalSettings) => {
    saveSettings(finalSettings);
    startSession(data, resolved, finalSettings);
  });
  modal.open({
    title: "Recognition trainer settings",
    body,
  });
}

function buildSettingsBody(s, resolved, onStart) {
  const root = document.createElement("div");
  root.className = "recog-settings";

  const summary = document.createElement("div");
  summary.className = "recog-settings-summary";
  const pll = resolved.filter(r => r.category === "pll").length;
  const oll = resolved.filter(r => r.category === "oll").length;
  const parts = [];
  if (pll) parts.push(`${pll} PLL`);
  if (oll) parts.push(`${oll} OLL`);
  summary.textContent = `Practicing ${parts.join(" + ")} (${resolved.length} cases total)`;
  root.appendChild(summary);

  // OLL thumbnail count
  if (oll > 0) {
    root.appendChild(settingsRow("OLL thumbnail choices",
      "How many options to show for OLL cases. Fewer = easier, more = harder.",
      makeRadioGroup("ollChoices", [
        { value: "2", label: "2" },
        { value: "4", label: "4" },
        { value: "6", label: "6" },
      ], String(s.ollChoices), (v) => { s.ollChoices = parseInt(v, 10); })
    ));
  }

  // Auto-advance toggle
  root.appendChild(settingsRow("Auto-advance",
    "Automatically load the next case after a correct answer.",
    makeToggle("autoAdvance", s.autoAdvance, (v) => { s.autoAdvance = v; })
  ));

  // Auto-advance delay
  root.appendChild(settingsRow("Auto-advance delay",
    "How long to show the feedback before moving on.",
    makeRadioGroup("autoDelayMs", [
      { value: "600",  label: "Fast" },
      { value: "1200", label: "Normal" },
      { value: "2500", label: "Slow" },
    ], String(s.autoDelayMs), (v) => { s.autoDelayMs = parseInt(v, 10); })
  ));

  // Show algorithm in feedback
  root.appendChild(settingsRow("Show algorithm in feedback",
    "Display the case's algorithm after each answer.",
    makeToggle("showAlgInFeedback", s.showAlgInFeedback, (v) => { s.showAlgInFeedback = v; })
  ));

  // Time limit per question
  root.appendChild(settingsRow("Time limit per case",
    "Each question must be answered within this many seconds. Running out counts as wrong.",
    makeRadioGroup("timeLimitSec", [
      { value: "0",  label: "Off" },
      { value: "3",  label: "3s" },
      { value: "5",  label: "5s" },
      { value: "10", label: "10s" },
      { value: "20", label: "20s" },
    ], String(s.timeLimitSec), (v) => { s.timeLimitSec = parseInt(v, 10); })
  ));

  // Start button
  const startBtn = document.createElement("button");
  startBtn.type = "button";
  startBtn.className = "btn btn-primary recog-settings-start";
  startBtn.textContent = "Start training";
  startBtn.addEventListener("click", () => onStart(s));
  root.appendChild(startBtn);

  return root;
}

function settingsRow(label, hint, control) {
  const row = document.createElement("div");
  row.className = "settings-row";
  const lbl = document.createElement("div");
  lbl.className = "settings-row-label";
  lbl.innerHTML = `<div class="settings-row-name">${label}</div><div class="settings-row-hint">${hint}</div>`;
  row.appendChild(lbl);
  row.appendChild(control);
  return row;
}

function makeToggle(name, initial, onChange) {
  const wrap = document.createElement("label");
  wrap.className = "toggle";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = initial;
  input.addEventListener("change", () => onChange(input.checked));
  wrap.appendChild(input);
  const slider = document.createElement("span");
  slider.className = "toggle-slider";
  wrap.appendChild(slider);
  return wrap;
}

function makeRadioGroup(name, options, initial, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "radio-group";
  for (const opt of options) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "radio-btn" + (opt.value === initial ? " active" : "");
    btn.textContent = opt.label;
    btn.addEventListener("click", () => {
      for (const b of wrap.querySelectorAll(".radio-btn")) b.classList.remove("active");
      btn.classList.add("active");
      onChange(opt.value);
    });
    wrap.appendChild(btn);
  }
  return wrap;
}

function startSession(data, resolved, settings) {
  session = {
    items: resolved,
    data,
    settings,
    current: null,
    askedAt: 0,
    ui: {},
    advanceTimer: null,
  };

  const body = buildBody();
  modal.open({
    title: `Recognition (${resolved.length} cases)`,
    body,
    onClose: () => endSession(),
  });

  attachKeyHandler();
  nextQuestion();
}

function endSession() {
  detachKeyHandler();
  if (session?.advanceTimer) clearTimeout(session.advanceTimer);
  stopCountdown();
  session = null;
}

function messageBody(text) {
  const div = document.createElement("div");
  div.style.padding = "16px 0";
  div.style.color = "var(--text-muted)";
  div.textContent = text;
  return div;
}

/* ---------- DOM ---------- */

function buildBody() {
  const root = document.createElement("div");
  root.className = "recog-body";

  const score = document.createElement("div");
  score.className = "recog-score";
  session.ui.score = score;
  root.appendChild(score);

  // Time-limit progress bar (only used if settings.timeLimitSec > 0)
  if (session.settings.timeLimitSec > 0) {
    const bar = document.createElement("div");
    bar.className = "recog-timer-bar";
    const fill = document.createElement("div");
    fill.className = "recog-timer-fill";
    bar.appendChild(fill);
    const label = document.createElement("div");
    label.className = "recog-timer-label";
    bar.appendChild(label);
    session.ui.timerBar = bar;
    session.ui.timerFill = fill;
    session.ui.timerLabel = label;
    root.appendChild(bar);
  }

  const image = document.createElement("div");
  image.className = "recog-image";
  session.ui.image = image;
  root.appendChild(image);

  const answer = document.createElement("div");
  answer.className = "recog-answer";
  session.ui.answer = answer;
  root.appendChild(answer);

  const feedback = document.createElement("div");
  feedback.className = "recog-feedback";
  session.ui.feedback = feedback;
  root.appendChild(feedback);

  const next = document.createElement("button");
  next.type = "button";
  next.className = "btn btn-primary";
  next.textContent = "Next case";
  next.addEventListener("click", () => nextQuestion());
  session.ui.nextBtn = next;
  root.appendChild(next);

  return root;
}

/* ---------- session state ---------- */

let stateCounts = { right: 0, wrong: 0 };

function nextQuestion() {
  if (!session) return;
  if (session.advanceTimer) { clearTimeout(session.advanceTimer); session.advanceTimer = null; }
  stopCountdown();
  const pick = session.items[Math.floor(Math.random() * session.items.length)];
  session.current = pick;
  session.askedAt = performance.now();

  // Image: render the case with random AUF + y so the angle varies
  const stage = pick.category === "pll" ? "pll" : "oll";
  const scrambledSetup = buildScramble(pick.item.setup);
  const img = new Image();
  img.alt = `${pick.category.toUpperCase()} case`;
  img.className = "recog-cube";
  img.src = vcImage({ setup: scrambledSetup, stage, view: "plan", size: 200 });
  session.ui.image.replaceChildren(img);

  // Clear feedback
  session.ui.feedback.textContent = "";
  session.ui.feedback.className = "recog-feedback";
  session.ui.nextBtn.style.visibility = "hidden";

  // Render answer UI based on category
  if (pick.category === "pll") {
    renderPllInput();
  } else {
    renderOllChoices();
  }
  updateScore();

  // Start countdown if enabled
  if (session.settings.timeLimitSec > 0) startCountdown();
}

/* ---------- per-question countdown ---------- */

function startCountdown() {
  const limitMs = session.settings.timeLimitSec * 1000;
  const startedAt = performance.now();
  session.countdownStart = startedAt;
  session.countdownLimit = limitMs;

  const tick = () => {
    if (!session || session.countdownStart !== startedAt) return; // cancelled
    const elapsed = performance.now() - startedAt;
    const remaining = Math.max(0, limitMs - elapsed);
    const pct = (remaining / limitMs) * 100;
    if (session.ui.timerFill) session.ui.timerFill.style.width = pct + "%";
    if (session.ui.timerLabel) session.ui.timerLabel.textContent = (remaining / 1000).toFixed(1) + "s";
    // Color shifts as time runs out
    if (session.ui.timerBar) {
      session.ui.timerBar.classList.toggle("recog-timer-warn", remaining < limitMs * 0.33);
      session.ui.timerBar.classList.toggle("recog-timer-crit", remaining < limitMs * 0.15);
    }
    if (remaining <= 0) {
      timeExpired();
    } else {
      session.countdownRaf = requestAnimationFrame(tick);
    }
  };
  session.countdownRaf = requestAnimationFrame(tick);
}

function stopCountdown() {
  if (!session) return;
  if (session.countdownRaf) {
    cancelAnimationFrame(session.countdownRaf);
    session.countdownRaf = null;
  }
  session.countdownStart = null;
}

function timeExpired() {
  if (!session || !session.current) return;
  stopCountdown();
  // Count as wrong; show correct answer
  finalize(false);
  // Override feedback prefix to say "time's up"
  const f = session.ui.feedback;
  if (f) f.textContent = "⏱ Time's up. " + f.textContent.replace(/^✗\s*/, "");
}

function updateScore() {
  const total = stateCounts.right + stateCounts.wrong;
  session.ui.score.textContent = total === 0
    ? "Identify the case below:"
    : `Score: ${stateCounts.right}/${total} (${Math.round(100*stateCounts.right/Math.max(1,total))}%)`;
}

function renderPllInput() {
  const wrap = session.ui.answer;
  wrap.innerHTML = "";

  const form = document.createElement("form");
  form.className = "recog-pll-form";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "recog-pll-input";
  input.placeholder = "Type case name: Aa, T, Ub, Z, etc.";
  input.autocomplete = "off";
  input.autocapitalize = "off";
  input.spellcheck = false;
  form.appendChild(input);

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "btn btn-primary";
  submit.textContent = "Submit";
  form.appendChild(submit);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!input.value.trim()) return;
    judgePll(input.value);
  });

  wrap.appendChild(form);
  setTimeout(() => input.focus(), 50);
}

function normalizePllAnswer(raw) {
  // lowercase, strip non-alphanumeric, then strip trailing "perm"
  let s = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (s.endsWith("perm")) s = s.slice(0, -4);
  return s;
}

function judgePll(raw) {
  const expected = session.current.item.id.toLowerCase();
  const guess = normalizePllAnswer(raw);
  const correct = guess === expected;
  finalize(correct);
}

function renderOllChoices() {
  const wrap = session.ui.answer;
  wrap.innerHTML = "";

  const correct = session.current.item;
  const allOll = session.data.oll;
  const totalChoices = session.settings.ollChoices;

  // Pick (totalChoices - 1) distractors with different recognitionGroup so
  // the user isn't asked to disambiguate two visually-identical cases.
  const distractors = pickDistractors(correct, allOll, totalChoices - 1);
  const options = shuffle([correct, ...distractors]);

  const grid = document.createElement("div");
  grid.className = "recog-name-grid";
  for (const opt of options) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "recog-name-btn";
    btn.dataset.id = String(opt.id);
    btn.setAttribute("aria-label", opt.name);

    const num = document.createElement("span");
    num.className = "recog-name-num";
    num.textContent = "#" + opt.id;
    btn.appendChild(num);

    const name = document.createElement("span");
    name.className = "recog-name-text";
    name.textContent = opt.name;
    btn.appendChild(name);

    btn.addEventListener("click", () => judgeOll(opt));
    grid.appendChild(btn);
  }
  wrap.appendChild(grid);
}

function pickDistractors(correct, pool, n) {
  // Prefer ones from a different recognitionGroup
  const candidates = pool.filter((o) =>
    o.id !== correct.id && o.recognitionGroup !== correct.recognitionGroup
  );
  shuffle(candidates);
  if (candidates.length >= n) return candidates.slice(0, n);
  // Fallback: include any other OLL if needed
  const others = pool.filter((o) =>
    o.id !== correct.id && !candidates.includes(o)
  );
  shuffle(others);
  return [...candidates, ...others].slice(0, n);
}

function judgeOll(picked) {
  const correct = picked.id === session.current.item.id;
  finalize(correct);
  // Mark chosen button and the actual correct one
  for (const btn of session.ui.answer.querySelectorAll(".recog-name-btn")) {
    btn.disabled = true;
    const id = btn.dataset.id;
    if (id === String(picked.id)) btn.classList.add(correct ? "correct" : "wrong");
    if (id === String(session.current.item.id)) btn.classList.add("answer");
  }
}

function finalize(correct) {
  stopCountdown();
  const reaction = performance.now() - session.askedAt;
  const { category, item } = session.current;
  stats.recordRecognition(category, item.id, correct, reaction);

  if (correct) stateCounts.right++;
  else         stateCounts.wrong++;

  // Feedback
  const f = session.ui.feedback;
  const showAlg = session.settings.showAlgInFeedback;
  const algPart = showAlg ? ` · ${item.algorithm}` : "";
  if (correct) {
    f.textContent = `✓ Correct: ${item.name}${algPart}`;
    f.className = "recog-feedback ok";
  } else {
    f.textContent = `✗ ${item.name}${algPart}`;
    f.className = "recog-feedback bad";
  }
  // Disable PLL input if still there
  for (const input of session.ui.answer.querySelectorAll("input")) input.disabled = true;
  for (const btn of session.ui.answer.querySelectorAll("button[type=submit]")) btn.disabled = true;

  session.ui.nextBtn.style.visibility = "visible";
  session.ui.nextBtn.focus();
  updateScore();

  // Auto-advance on correct, if enabled
  if (correct && session.settings.autoAdvance) {
    if (session.advanceTimer) clearTimeout(session.advanceTimer);
    session.advanceTimer = setTimeout(() => {
      if (session) nextQuestion();
    }, session.settings.autoDelayMs);
  }
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ---------- keys ---------- */

function attachKeyHandler() {
  keyHandler = (e) => {
    if (!session) return;
    if (e.key === "Enter") {
      // Already handled by form submit if input focused
      // For OLL or post-answer: advance
      const inInput = e.target.tagName === "INPUT";
      if (!inInput && session.ui.nextBtn?.style.visibility === "visible") {
        e.preventDefault();
        nextQuestion();
      }
    }
  };
  window.addEventListener("keydown", keyHandler);
}

function detachKeyHandler() {
  if (keyHandler) {
    window.removeEventListener("keydown", keyHandler);
    keyHandler = null;
  }
  stateCounts = { right: 0, wrong: 0 };
}
