/* =========================================================
 * Rubik's Storage - front-end
 *
 * This file drives the WORKSPACE-TOP-BAR shell (Home / Browse /
 * Practice / Timer / Stats / Settings) defined in index.html.
 *
 * The existing module entry points (drill.start / recognition.start /
 * batch.start / weak-cases.start / timer.openTimer) are untouched -
 * we wire the new UI to them via hidden trigger buttons in index.html
 * so the drill/recognition/batch/timer modal flows keep working.
 *
 * Extension hooks:
 *   - CATEGORIES[].extraBadges(item)  → array of {label, className}
 *   - CATEGORIES[].metaRows(item)     → array of {label, value}
 *   - CATEGORIES[].filterFacets       → which fields drive chips
 *   - CATEGORIES[].drillable / recognitionMode  → feature gating
 * ========================================================= */

import * as selection from "./selection.js";
import * as stats from "./stats.js";
import * as sessions from "./sessions.js";
import * as auth from "./auth.js";
import * as cloudSync from "./cloud-sync.js";
import { renderHtml as colorizeAlg } from "./alg-color.js";

const DATA_URL = "rubiks-cube-algorithms.json";
const VISUALCUBE_BASE = "https://visualcube.api.cubing.net/visualcube.php";

/* ---------- VisualCube ---------- */

export function vcImage({ setup, caseAlg, stage, view, size = 140, sch }) {
  const params = new URLSearchParams({ fmt: "svg", size: String(size), bg: "t" });
  if (setup)   params.set("alg",  setup);
  if (caseAlg) params.set("case", caseAlg);
  if (stage)   params.set("stage", stage);
  if (view)    params.set("view", view);
  if (sch)     params.set("sch",  sch);
  return `${VISUALCUBE_BASE}?${params.toString()}`;
}

/* ---------- notation reference data ---------- */

const NOTATION_DATA = [
  { id: "R", name: "Right",  algorithm: "R",  setup: "R",  category: "Face turn", description: "Turn the right face 90° clockwise (looking at the right side)." },
  { id: "L", name: "Left",   algorithm: "L",  setup: "L",  category: "Face turn", description: "Turn the left face 90° clockwise (looking at the left side)." },
  { id: "U", name: "Up",     algorithm: "U",  setup: "U",  category: "Face turn", description: "Turn the top face 90° clockwise (looking down at it)." },
  { id: "D", name: "Down",   algorithm: "D",  setup: "D",  category: "Face turn", description: "Turn the bottom face 90° clockwise (looking up at it)." },
  { id: "F", name: "Front",  algorithm: "F",  setup: "F",  category: "Face turn", description: "Turn the front face 90° clockwise." },
  { id: "B", name: "Back",   algorithm: "B",  setup: "B",  category: "Face turn", description: "Turn the back face 90° clockwise (looking from behind)." },

  { id: "Rw", name: "Right wide (r)", algorithm: "Rw", setup: "Rw", category: "Wide", description: "Turn the right TWO layers in the R direction. Often written lowercase as r." },
  { id: "Lw", name: "Left wide (l)",  algorithm: "Lw", setup: "Lw", category: "Wide", description: "Turn the left TWO layers in the L direction. Often written as l." },
  { id: "Uw", name: "Up wide (u)",    algorithm: "Uw", setup: "Uw", category: "Wide", description: "Turn the top TWO layers in the U direction. Often written as u." },
  { id: "Dw", name: "Down wide (d)",  algorithm: "Dw", setup: "Dw", category: "Wide", description: "Turn the bottom TWO layers in the D direction. Often written as d." },
  { id: "Fw", name: "Front wide (f)", algorithm: "Fw", setup: "Fw", category: "Wide", description: "Turn the front TWO layers in the F direction. Often written as f." },
  { id: "Bw", name: "Back wide (b)",  algorithm: "Bw", setup: "Bw", category: "Wide", description: "Turn the back TWO layers in the B direction. Often written as b." },

  { id: "M", name: "Middle slice",     algorithm: "M", setup: "M", category: "Slice", description: "Turn the middle slice (between L and R) in the L direction." },
  { id: "E", name: "Equatorial slice", algorithm: "E", setup: "E", category: "Slice", description: "Turn the equator slice (between U and D) in the D direction." },
  { id: "S", name: "Standing slice",   algorithm: "S", setup: "S", category: "Slice", description: "Turn the standing slice (between F and B) in the F direction." },

  { id: "x", name: "x rotation", algorithm: "x", setup: "x", category: "Rotation", description: "Rotate the entire cube around the L-R axis, in the R direction." },
  { id: "y", name: "y rotation", algorithm: "y", setup: "y", category: "Rotation", description: "Rotate the entire cube around the U-D axis, in the U direction." },
  { id: "z", name: "z rotation", algorithm: "z", setup: "z", category: "Rotation", description: "Rotate the entire cube around the F-B axis, in the F direction." },

  { id: "prime",  name: "Apostrophe ( ' )", algorithm: "R'", setup: "R'", category: "Modifier", description: "Inverts the move (counter-clockwise / opposite direction). Example: R' is the inverse of R." },
  { id: "double", name: "Double ( 2 )",     algorithm: "R2", setup: "R2", category: "Modifier", description: "Half turn (180°). Same end result regardless of direction. Example: R2 = R + R." },
];

/* ---------- categories ---------- */

const CATEGORIES = [
  {
    key: "pll",
    label: "PLL",
    accent: "var(--cube-blue)",
    getItems: (d) => d.pll,
    titleOf: (it) => it.name,
    idOf: (it) => it.id,
    searchFields: ["id", "name", "group", "algorithm", "recognition"],
    filterFacets: [{ key: "group", label: "Group", from: (it) => it.group }],
    extraBadges: (it) => [
      it.group && { label: it.group, className: "badge" },
      it.auf && it.auf !== "none" && { label: "AUF " + it.auf, className: "badge" },
    ].filter(Boolean),
    metaRows: (it) => [
      it.recognition && { label: "Recognition", value: it.recognition },
    ].filter(Boolean),
    imageUrl: (it) => vcImage({ setup: it.setup, stage: "pll", view: "plan", size: 140 }),
    drillable: true,
    recognitionMode: "text",
  },
  {
    key: "oll",
    label: "OLL",
    accent: "var(--cube-orange)",
    getItems: (d) => d.oll,
    titleOf: (it) => it.name,
    idOf: (it) => "#" + it.id,
    searchFields: ["id", "name", "shape", "algorithm", "recognition"],
    filterFacets: [{ key: "shape", label: "Shape", from: (it) => it.shape }],
    extraBadges: (it) => [
      it.shape && { label: it.shape, className: "badge" },
    ].filter(Boolean),
    metaRows: (it) => [
      it.recognition && { label: "Recognition", value: it.recognition },
    ].filter(Boolean),
    imageUrl: (it) => vcImage({ setup: it.setup, stage: "oll", view: "plan", size: 140 }),
    drillable: true,
    recognitionMode: "thumbnails",
  },
  {
    key: "f2l_adv",
    label: "F2L (advanced)",
    shortLabel: "F2L+",
    accent: "var(--cube-green)",
    getItems: (d) => d.f2l.advanced,
    titleOf: (it) => "Case " + it.id + ": " + (it.trigger || "f2l"),
    idOf: (it) => "#" + it.id,
    searchFields: ["id", "slot", "corner_state", "edge_state", "algorithm", "trigger"],
    filterFacets: [{ key: "trigger", label: "Trigger", from: (it) => it.trigger }],
    extraBadges: (it) => [
      it.slot    && { label: "slot " + it.slot, className: "badge" },
      it.trigger && { label: it.trigger,        className: "badge" },
    ].filter(Boolean),
    metaRows: (it) => [
      it.corner_state && { label: "Corner", value: it.corner_state },
      it.edge_state   && { label: "Edge",   value: it.edge_state },
    ].filter(Boolean),
    imageUrl: (it) => vcImage({ caseAlg: it.algorithm, stage: "f2l", size: 140 }),
    drillable: false,
  },
  {
    key: "f2l_beg",
    label: "F2L (beginner)",
    shortLabel: "F2L−",
    accent: "var(--cube-red)",
    getItems: (d) => d.f2l.beginner,
    titleOf: (it) => it.name,
    idOf: (it) => it.id,
    searchFields: ["id", "name", "method", "algorithm", "notes"],
    filterFacets: [],
    extraBadges: () => [],
    metaRows: (it) => [
      it.method && { label: "Method", value: it.method },
      it.notes  && { label: "Notes",  value: it.notes },
    ].filter(Boolean),
    imageUrl: (it) => vcImage({ caseAlg: it.algorithm, stage: "f2l", size: 140 }),
    drillable: false,
  },
  {
    key: "notation",
    label: "Notation",
    accent: "var(--cube-green)",
    getItems: () => NOTATION_DATA,
    titleOf: (it) => it.name,
    idOf: (it) => it.algorithm,
    searchFields: ["id", "name", "category", "description", "algorithm"],
    filterFacets: [{ key: "category", label: "Category", from: (it) => it.category }],
    extraBadges: (it) => [{ label: it.category, className: "badge" }],
    metaRows: (it) => [{ label: "Description", value: it.description }],
    imageUrl: (it) => vcImage({ setup: it.setup, view: "trans", size: 140, sch: "wrgyob" }),
    drillable: false,
  },
];

export const categoryByKey = (key) => CATEGORIES.find((c) => c.key === key);
export const state = { data: null, category: "pll", search: "", filters: {} };  // legacy export shape
export { CATEGORIES };

/* ============================================================ */
/* App state                                                      */
/* ============================================================ */

const appState = {
  data: null,
  activePage: "home",
};

const browseState = {
  category: "pll",
  search: "",
  filters: {},        // { facetKey: Set<string> }
};

const practiceState = {
  submode: "drill",   // drill | recognition | batch | weak
};

const statsPageState = {
  range: "all",       // 7 | 30 | "all"
};

/* Session-only set of case-keys the user has "Skip"ped from the Home
 * focus strip. Cleared on page reload - the SRS schedule (or actual
 * practice) determines next-day focus. */
const skippedFocusKeys = new Set();

/* ============================================================ */
/* Boot                                                            */
/* ============================================================ */

async function init() {
  try {
    const resp = await fetch(DATA_URL);
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    appState.data = await resp.json();
    state.data = appState.data;
  } catch (err) {
    document.getElementById("page-home").innerHTML = `
      <div class="page-body">
        <p class="page-eyebrow">Error</p>
        <h1 class="page-title">Could not load data</h1>
        <p class="page-subtitle">
          ${escapeHtml(err.message)}. Serve this folder over HTTP
          (e.g. <code>python3 -m http.server</code>). Opening index.html
          directly via file:// will not work.
        </p>
      </div>`;
    return;
  }

  bindWorkspaceBar();
  bindAccount();
  bindHiddenTriggers();

  selection.subscribe(() => {
    if (appState.activePage === "browse")   renderBrowse();
    if (appState.activePage === "practice") renderPractice();
  });
  stats.subscribe(() => {
    if (appState.activePage === "home")    renderHome();
    if (appState.activePage === "browse")  renderBrowse();
    if (appState.activePage === "stats")   renderStats();
  });
  sessions.subscribe(() => {
    if (appState.activePage === "home")     renderHome();
    if (appState.activePage === "timer")    renderTimer();
    if (appState.activePage === "stats")    renderStats();
    if (appState.activePage === "settings") renderSettings();
  });

  renderHome();
}

function bindWorkspaceBar() {
  for (const btn of document.querySelectorAll(".ws-mode")) {
    btn.addEventListener("click", () => setActivePage(btn.dataset.page));
  }
}

function setActivePage(page) {
  const prev = appState.activePage;
  appState.activePage = page;
  for (const btn of document.querySelectorAll(".ws-mode")) {
    btn.classList.toggle("active", btn.dataset.page === page);
  }
  for (const section of document.querySelectorAll(".page")) {
    section.classList.toggle("active", section.dataset.page === page);
  }
  // Tear down inline timer when switching AWAY from Timer page so key
  // handlers + rafs are released. Re-mounted on next visit by renderTimer.
  if (prev === "timer" && page !== "timer") {
    import("./timer.js").then((mod) => mod.unmountTimer());
  }
  const renderer = ({
    home: renderHome,
    browse: renderBrowse,
    practice: renderPractice,
    timer: renderTimer,
    stats: renderStats,
    settings: renderSettings,
  })[page];
  if (renderer) renderer();
  window.scrollTo({ top: 0, behavior: "instant" });
}

/* Account chip in the workspace bar. When cloud sync isn't configured
 * (supabase-config.js placeholders empty), the chip stays as a static
 * "Sign in" - clicking it just opens the modal which will offer no
 * providers. To keep the UI honest we hide it in that case. */
function bindAccount() {
  const btn = document.getElementById("ws-account");
  const label = document.getElementById("ws-account-label");
  const dot = document.getElementById("ws-account-dot");

  if (!auth.isCloudEnabled()) {
    btn.style.display = "none";
    return;
  }

  auth.boot();
  cloudSync.init();

  btn.addEventListener("click", async () => {
    const user = auth.currentUser();
    if (user) {
      setActivePage("settings");
    } else {
      const mod = await import("./auth-ui.js");
      mod.openSignIn();
    }
  });

  auth.onAuthChange((user) => {
    if (user) {
      const short = (user.email || "").split("@")[0] || "Account";
      label.textContent = short;
      dot.style.display = "inline-block";
      btn.title = user.email || "Account";
    } else {
      label.textContent = "Sign in";
      dot.style.display = "none";
      btn.title = "Sign in";
    }
    if (appState.activePage === "settings") renderSettings();
  });
}

function bindHiddenTriggers() {
  document.getElementById("open-timer").addEventListener("click", async () => {
    const mod = await import("./timer.js");
    mod.openTimer();
  });
  document.getElementById("open-weak-cases").addEventListener("click", async () => {
    const mod = await import("./weak-cases.js");
    mod.start(appState.data);
  });
  document.getElementById("drill-selected").addEventListener("click", async () => {
    if (selection.size() === 0) return showToast("Select cases in Browse first", "error");
    const mod = await import("./drill.js");
    mod.start(appState.data, selection.allKeys());
  });
  document.getElementById("batch-selected").addEventListener("click", async () => {
    const pllKeys = selection.allKeys().filter((k) => k.startsWith("pll/"));
    if (pllKeys.length === 0) return showToast("Batch needs PLL cases. Select some in Browse first.", "error");
    const mod = await import("./batch.js");
    mod.start(appState.data, pllKeys);
  });
  document.getElementById("recog-selected").addEventListener("click", async () => {
    if (selection.size() === 0) return showToast("Select cases in Browse first", "error");
    const mod = await import("./recognition.js");
    mod.start(appState.data, selection.allKeys());
  });
}

/* ============================================================ */
/* HOME                                                           */
/* ============================================================ */

function renderHome() {
  const root = document.getElementById("page-home");
  if (!appState.data) return;

  const weakAll = rankWeakCases(["pll", "oll"], 24);
  const weak = weakAll.filter((c) => !skippedFocusKeys.has(c.key));
  const focus = weak[0] || null;
  const upNext = weak.slice(1, 5);
  const week = computeWeekStats();
  const recents = computeRecentSessions();
  const milestones = computeMilestones();

  /* Focus strip */
  const focusEl = document.createElement("div");
  focusEl.className = "focus-strip";
  if (focus) {
    focusEl.innerHTML = `
      <div class="focus-face">
        <img src="${vcImageFor(focus)}" alt="${escapeHtml(focus.item.name)}" loading="lazy" />
      </div>
      <div class="focus-meta">
        <span class="focus-eyebrow">${focusEyebrow(focus)}</span>
        <h1 class="focus-name">${focus.category.toUpperCase()} · ${escapeHtml(focus.item.name)}</h1>
        <div class="focus-alg">${colorizeAlg(focus.item.algorithm)}</div>
      </div>
      <div class="focus-actions">
        <button class="btn" data-act="skip">Skip</button>
        <button class="btn btn-primary" data-act="start">Start drill →</button>
      </div>`;
    focusEl.querySelector('[data-act="skip"]').addEventListener("click", () => {
      // Mark this case as skipped for the rest of the session - the next
      // renderHome() will surface the next-weakest as the focus. Skipped
      // set is in-memory only (cleared on reload) since the underlying
      // SRS schedule + actual practice is what determines tomorrow's focus.
      skippedFocusKeys.add(focus.key);
      renderHome();
    });
    focusEl.querySelector('[data-act="start"]').addEventListener("click", () => {
      selection.clear();
      selection.toggle(focus.category, focus.item.id);
      document.getElementById("drill-selected").click();
    });
  } else {
    focusEl.style.gridTemplateColumns = "1fr auto";
    focusEl.innerHTML = `
      <div class="focus-meta">
        <span class="focus-eyebrow">Today's drill</span>
        <h1 class="focus-name">Pick a starting point.</h1>
        <div class="focus-alg" style="color: var(--text-soft);">
          Head to Browse and select a few PLL or OLL cases to start drilling.
          We'll surface the weakest ones here as you practice.
        </div>
      </div>
      <div class="focus-actions">
        <button class="btn btn-primary" data-act="browse">Browse algorithms →</button>
      </div>`;
    focusEl.querySelector('[data-act="browse"]').addEventListener("click", () => setActivePage("browse"));
  }

  /* Workshop grid */
  const grid = document.createElement("div");
  grid.className = "home-grid";

  // Milestones column
  const col1 = document.createElement("div");
  col1.innerHTML = `
    <h2 class="home-col-title">
      Your path
      <span class="home-col-title-meta">${milestones.filter(m=>m.done).length} of ${milestones.length}</span>
    </h2>
    <ul class="milestone-list">
      ${milestones.map((m, i) => `
        <li class="milestone ${m.done ? "done" : ""} ${m.current ? "current" : ""}">
          <span class="milestone-num">${String(i + 1).padStart(2, "0")}</span>
          <span class="milestone-name">${escapeHtml(m.name)}</span>
          <span class="milestone-meta">${escapeHtml(m.meta)}</span>
        </li>`).join("")}
    </ul>`;
  grid.appendChild(col1);

  // Recommended next
  const col2 = document.createElement("div");
  const upHtml = upNext.length
    ? upNext.map((c) => `
        <div class="upnext" data-key="${escapeHtml(c.key)}">
          <div class="upnext-face">
            <img src="${vcImageFor(c, 80)}" alt="${escapeHtml(c.item.name)}" loading="lazy" />
          </div>
          <div class="upnext-meta">
            <span class="upnext-cat">${c.category.toUpperCase()}${c.item.group ? " · " + escapeHtml(c.item.group) : ""}${c.item.shape ? " · " + escapeHtml(c.item.shape) : ""}</span>
            <span class="upnext-name">${escapeHtml(c.item.name)}</span>
            <span class="upnext-alg">${colorizeAlg(c.item.algorithm)}</span>
          </div>
          <button class="btn btn-small" data-act="drill">Drill →</button>
        </div>`).join("")
    : `<div class="upnext" style="grid-template-columns: 1fr; cursor:default;"><div class="upnext-meta"><span class="upnext-cat">No recommendations yet</span><span class="upnext-name" style="font-size:14px; font-weight:500;">Drill a few cases to start the spaced-repetition queue.</span></div></div>`;
  col2.innerHTML = `
    <h2 class="home-col-title">
      Recommended next
      <span class="home-col-title-meta">${upNext.length} cases</span>
    </h2>
    <div class="upnext-list">${upHtml}</div>`;
  for (const el of col2.querySelectorAll(".upnext[data-key]")) {
    const key = el.dataset.key;
    const startDrill = () => {
      const parts = key.split("/");
      selection.clear();
      selection.toggle(parts[0], parts.slice(1).join("/"));
      document.getElementById("drill-selected").click();
    };
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-act='drill']")) startDrill();
      else startDrill();
    });
  }
  grid.appendChild(col2);

  // This week stats
  const col3 = document.createElement("div");
  col3.innerHTML = `
    <h2 class="home-col-title">
      This week
      <span class="home-col-title-meta">Last 7 days</span>
    </h2>
    <div class="stat-tile">
      <p class="stat-label">Solves</p>
      <p class="stat-value">${week.solves}</p>
      <p class="stat-delta ${week.solvesDelta < 0 ? "negative" : week.solvesDelta === 0 ? "neutral" : ""}">${formatDelta(week.solvesDelta, "vs last week")}</p>
    </div>
    <div class="stat-tile">
      <p class="stat-label">ao12</p>
      <p class="stat-value">${week.ao12 != null ? sessions.fmtMs(week.ao12) : "-"}</p>
      <p class="stat-delta neutral">${week.solves >= 12 ? "session ao12" : "more solves needed"}</p>
    </div>
    <div class="stat-tile">
      <p class="stat-label">Drill reps</p>
      <p class="stat-value">${week.drillReps}</p>
      <p class="stat-delta ${week.drillRepsDelta < 0 ? "negative" : week.drillRepsDelta === 0 ? "neutral" : ""}">${formatDelta(week.drillRepsDelta, "vs last week")}</p>
    </div>`;
  grid.appendChild(col3);

  /* Recent sessions strip */
  const strip = document.createElement("div");
  strip.className = "recent-strip";
  if (recents.length === 0) {
    strip.innerHTML = `
      <div class="recent-head">
        <h2>Recent sessions</h2>
        <a data-act="open-timer">Open the timer →</a>
      </div>
      <div class="recent-grid"><div style="grid-column:1/-1; padding: var(--s-5); border: 1px dashed var(--border); border-radius: var(--r-md); color: var(--muted); text-align:center; font-family: var(--font-mono); font-size: 12px;">No timer sessions yet. Press "Open the timer" above to start a session.</div></div>`;
    strip.querySelector('[data-act="open-timer"]').addEventListener("click", () => setActivePage("timer"));
  } else {
    strip.innerHTML = `
      <div class="recent-head">
        <h2>Recent sessions</h2>
        <a data-act="see-all">See all →</a>
      </div>
      <div class="recent-grid">
        ${recents.map((r) => `
          <div class="recent-card" data-id="${escapeHtml(r.id)}">
            <div class="recent-card-head"><span>${escapeHtml(r.dateLabel)}</span><span>${r.count} solve${r.count===1?"":"s"}</span></div>
            <div class="recent-card-best">${r.last != null ? sessions.fmtMs(r.last) : "-"}</div>
            <div class="recent-card-meta">
              <span>ao5 <b>${r.ao5 != null ? sessions.fmtMs(r.ao5) : "-"}</b></span>
              <span>best <b>${r.best != null ? sessions.fmtMs(r.best) : "-"}</b></span>
            </div>
          </div>`).join("")}
      </div>`;
    strip.querySelector('[data-act="see-all"]').addEventListener("click", () => setActivePage("timer"));
    for (const card of strip.querySelectorAll(".recent-card")) {
      card.addEventListener("click", () => {
        const id = card.dataset.id;
        if (id) sessions.setActiveSession(id);
        setActivePage("timer");
      });
    }
  }

  root.replaceChildren(focusEl, grid, strip);
}

function computeMilestones() {
  const all = stats.getAll();
  const pllCount = appState.data.pll.length;       // 21
  const ollCount = appState.data.oll.length;       // 57

  const pllPracticed = appState.data.pll.filter((it) => all[`pll/${it.id}`]?.drill?.n > 0).length;
  const ollPracticed = appState.data.oll.filter((it) => all[`oll/${it.id}`]?.drill?.n > 0).length;

  // Best ao12 across all sessions for sub-X gates
  const allSolves = sessions.listSessions().flatMap((s) => s.solves);
  const bestAo12 = sessions.bestAverage(allSolves, 12);
  const bestSecs = bestAo12 != null && isFinite(bestAo12) ? bestAo12 / 1000 : null;

  const milestones = [
    { name: "Two-look CFOP", meta: pllPracticed >= 7 && ollPracticed >= 10 ? "Complete" : `${pllPracticed + ollPracticed}/17`, done: pllPracticed >= 7 && ollPracticed >= 10 },
    { name: "Full PLL", meta: pllPracticed === pllCount ? "Complete" : `${pllPracticed}/${pllCount}`, done: pllPracticed === pllCount },
    { name: "Full OLL", meta: ollPracticed === ollCount ? "Complete" : `${ollPracticed}/${ollCount}`, done: ollPracticed === ollCount },
    { name: "Sub-20",   meta: bestSecs != null ? (bestSecs <= 20 ? "Complete" : `ao12 ${bestSecs.toFixed(2)}s`) : "Locked", done: bestSecs != null && bestSecs <= 20 },
    { name: "Sub-15",   meta: bestSecs != null ? (bestSecs <= 15 ? "Complete" : `ao12 ${bestSecs.toFixed(2)}s`) : "Locked", done: bestSecs != null && bestSecs <= 15 },
  ];
  // Mark first not-done as "current"
  const nextIdx = milestones.findIndex((m) => !m.done);
  if (nextIdx >= 0) milestones[nextIdx].current = true;
  return milestones;
}

function computeWeekStats() {
  const allSessions = sessions.listSessions();
  const allSolves = allSessions.flatMap((s) => s.solves);
  const nowMs = Date.now();
  const weekMs = 7 * 86400 * 1000;
  const thisWeek = allSolves.filter((s) => nowMs - s.date < weekMs);
  const lastWeek = allSolves.filter((s) => {
    const age = nowMs - s.date;
    return age >= weekMs && age < 2 * weekMs;
  });
  const ao12 = sessions.trimmedAverage(thisWeek, 12);

  // Drill reps from stats.lastAt - count reps that happened in last 7 days
  const allStats = stats.getAll();
  const weekSec = nowMs / 1000 - 7 * 86400;
  let drillRepsThisWeek = 0;
  let drillRepsLastWeek = 0;
  for (const slot of Object.values(allStats)) {
    if (!slot?.drill) continue;
    // We don't store per-rep timestamps, only n + lastAt. Approximate: if
    // lastAt is within last 7 days, attribute the recent times count.
    if (slot.drill.lastAt && slot.drill.lastAt >= weekSec) {
      drillRepsThisWeek += Math.min(slot.drill.times?.length || 0, slot.drill.n || 0);
    }
  }
  return {
    solves: thisWeek.length,
    solvesDelta: thisWeek.length - lastWeek.length,
    ao12: ao12 != null && isFinite(ao12) ? ao12 : null,
    drillReps: drillRepsThisWeek,
    drillRepsDelta: drillRepsThisWeek - drillRepsLastWeek,
  };
}

function computeRecentSessions() {
  const list = sessions.listSessions().slice().reverse(); // newest first by createdAt
  const out = [];
  for (const sess of list) {
    if (sess.solves.length === 0) continue;
    out.push({
      id: sess.id,
      dateLabel: sess.name || formatDateLabel(sess.createdAt),
      count: sess.solves.length,
      last: sessions.effectiveMs(sess.solves[sess.solves.length - 1]),
      ao5: sessions.trimmedAverage(sess.solves, 5),
      best: sessions.bestSingle(sess.solves),
    });
    if (out.length >= 4) break;
  }
  return out;
}

function formatDateLabel(ms) {
  const d = new Date(ms);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  if (isToday) return "Today";
  const yesterday = new Date(today.getTime() - 86400000);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function formatDelta(n, suffix) {
  if (n === 0) return `± 0 ${suffix}`;
  const arrow = n > 0 ? "↑" : "↓";
  return `${arrow} ${Math.abs(n)} ${suffix}`;
}

function focusEyebrow(c) {
  if (c.isDue) {
    const overdue = Math.max(0, Math.floor((-(c.dueDelta || 0)) / 86400));
    if (overdue === 0) return "Today's drill · Due now";
    return `Today's drill · Due ${overdue}d ago`;
  }
  if (c.isUnpracticed) return "Today's drill · Never drilled";
  return "Today's drill · Weakest recent";
}

function vcImageFor(c, size = 140) {
  const it = c.item;
  if (c.category === "pll") return vcImage({ setup: it.setup, stage: "pll", view: "plan", size });
  if (c.category === "oll") return vcImage({ setup: it.setup, stage: "oll", view: "plan", size });
  return vcImage({ caseAlg: it.algorithm, size });
}

function rankWeakCases(categories = ["pll", "oll"], limit = 10) {
  if (!appState.data) return [];
  const all = stats.getAll();
  const nowSec = Math.floor(Date.now() / 1000);
  const out = [];
  for (const cat of categories) {
    const items = cat === "pll" ? appState.data.pll : appState.data.oll;
    if (!items) continue;
    for (const item of items) {
      if (typeof item.setup !== "string") continue;
      const slot = all[`${cat}/${item.id}`];
      const drill = slot?.drill;
      const srs = slot?.srs;
      const isUnpracticed = !drill || drill.n === 0;
      const isDue = !!srs && srs.dueAt > 0 && srs.dueAt <= nowSec;
      out.push({
        category: cat, item,
        key: selection.key(cat, item.id),
        drill, srs, isUnpracticed, isDue,
        dueDelta: srs?.dueAt ? srs.dueAt - nowSec : null,
        best: drill?.best ?? null,
        lastAt: drill?.lastAt ?? 0,
      });
    }
  }
  const due = out.filter((c) => c.isDue).sort((a, b) => (a.dueDelta ?? 0) - (b.dueDelta ?? 0));
  const unpracticed = out.filter((c) => c.isUnpracticed && !c.isDue).sort((a, b) => String(a.item.id).localeCompare(String(b.item.id)));
  const future = out.filter((c) => !c.isUnpracticed && !c.isDue).sort((a, b) => (b.best - a.best) || (a.lastAt - b.lastAt));
  return [...due, ...unpracticed, ...future].slice(0, limit);
}

/* ============================================================ */
/* BROWSE                                                          */
/* ============================================================ */

function renderBrowse() {
  const root = document.getElementById("page-browse");
  if (!appState.data) return;

  const cat = categoryByKey(browseState.category);
  const allItems = cat.getItems(appState.data);
  const items = allItems.filter((it) => matchesFilters(it, cat));

  /* Header */
  const head = document.createElement("div");
  head.className = "page-head";
  head.innerHTML = `
    <div>
      <h1 class="page-title">Browse</h1>
      <p class="page-subtitle">${escapeHtml(catSubtitle(cat))}</p>
    </div>
    <div class="row" style="gap: var(--s-2);">
      <span class="meta-label" id="browse-count">${items.length === allItems.length ? `${allItems.length} ${cat.label.toLowerCase()}` : `${items.length} / ${allItems.length} ${cat.label.toLowerCase()}`}</span>
    </div>`;

  /* Category + search toolbar */
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";
  toolbar.innerHTML = `
    <input type="text" class="search" id="browse-search" placeholder="Search by name, id, algorithm, recognition…" value="${escapeHtml(browseState.search)}" />
    ${CATEGORIES.map((c) => `<button class="chip ${c.key === browseState.category ? "accent" : ""}" data-cat="${c.key}">${escapeHtml(c.shortLabel || c.label)}</button>`).join("")}
    <button class="chip planned" tabindex="-1" disabled>COLL</button>
    <button class="chip planned" tabindex="-1" disabled>ZBLL</button>
    <button class="chip planned" tabindex="-1" disabled>OH</button>
    <button class="chip planned" tabindex="-1" disabled>Roux</button>`;

  // Wire category chips
  for (const chip of toolbar.querySelectorAll("[data-cat]")) {
    chip.addEventListener("click", () => {
      browseState.category = chip.dataset.cat;
      browseState.filters = {};
      browseState.search = "";
      renderBrowse();
    });
  }
  // Wire search
  const searchInput = toolbar.querySelector("#browse-search");
  searchInput.addEventListener("input", () => {
    browseState.search = searchInput.value.trim().toLowerCase();
    updateBrowseGrid();
  });

  /* Facet filter row */
  const facetEl = renderFacetRow(cat, allItems);

  /* Selection action bar - only shown for drillable categories */
  const actions = document.createElement("div");
  if (cat.drillable) {
    actions.className = "toolbar";
    actions.style.borderTop = "none";
    actions.innerHTML = `
      <button class="btn btn-small" id="browse-select-all">Select all in view</button>
      <button class="btn btn-small" id="browse-clear" ${selection.size() === 0 ? "disabled" : ""}>Clear selection</button>
      <span class="meta-label" id="browse-selcount">${selection.size() === 0 ? "Nothing selected. Click a card or use the checkbox." : `${selection.size()} selected`}</span>
      <span style="margin-left:auto"></span>
      <button class="btn btn-primary btn-small" id="browse-drill" ${selection.size() === 0 ? "disabled" : ""}>Drill selected →</button>
      <button class="btn btn-small" id="browse-batch" ${selection.allKeys().filter(k=>k.startsWith("pll/")).length === 0 ? "disabled" : ""} title="Solve 5 PLLs under one continuous timer">Batch (5)</button>
      <button class="btn btn-small" id="browse-recog" ${selection.size() === 0 ? "disabled" : ""}>Train recognition</button>`;
    actions.querySelector("#browse-select-all").addEventListener("click", () => {
      selection.selectMany(cat.key, items);
    });
    actions.querySelector("#browse-clear").addEventListener("click", () => selection.clear());
    actions.querySelector("#browse-drill").addEventListener("click", () => {
      document.getElementById("drill-selected").click();
    });
    actions.querySelector("#browse-batch").addEventListener("click", () => {
      document.getElementById("batch-selected").click();
    });
    actions.querySelector("#browse-recog").addEventListener("click", () => {
      document.getElementById("recog-selected").click();
    });
  }

  /* Grid */
  const grid = document.createElement("div");
  grid.className = "browse-grid";
  grid.id = "browse-grid";
  if (items.length === 0) {
    grid.innerHTML = `<div class="empty-grid">No algorithms match the current filters.</div>`;
  } else {
    for (const it of items) grid.appendChild(renderBrowseCard(it, cat));
  }

  const parts = [head, toolbar];
  if (facetEl) parts.push(facetEl);
  if (cat.drillable) parts.push(actions);
  parts.push(grid);
  root.replaceChildren(...parts);

  // Concurrency-capped image loader (cards have <img> with src already; the
  // browser handles this natively. We rely on loading="lazy" + the SW cache).
}

function updateBrowseGrid() {
  // Lightweight re-render of just the cards + counter when search/filters change
  const cat = categoryByKey(browseState.category);
  const allItems = cat.getItems(appState.data);
  const items = allItems.filter((it) => matchesFilters(it, cat));
  const grid = document.getElementById("browse-grid");
  if (grid) {
    grid.innerHTML = "";
    if (items.length === 0) {
      grid.innerHTML = `<div class="empty-grid">No algorithms match the current filters.</div>`;
    } else {
      for (const it of items) grid.appendChild(renderBrowseCard(it, cat));
    }
  }
  const counter = document.getElementById("browse-count");
  if (counter) counter.textContent = items.length === allItems.length
    ? `${allItems.length} ${cat.label.toLowerCase()}`
    : `${items.length} / ${allItems.length} ${cat.label.toLowerCase()}`;
}

function renderFacetRow(cat, items) {
  if (!cat.filterFacets || cat.filterFacets.length === 0) return null;
  const wrap = document.createElement("div");
  wrap.className = "facet-row";
  let any = false;
  for (const facet of cat.filterFacets) {
    const values = uniqueSorted(items.map(facet.from).filter(Boolean));
    if (values.length === 0) continue;
    any = true;
    const label = document.createElement("span");
    label.className = "facet-label";
    label.textContent = facet.label;
    wrap.appendChild(label);
    for (const v of values) {
      const chip = document.createElement("button");
      chip.className = "chip facet" + ((browseState.filters[facet.key]?.has(v)) ? " active" : "");
      chip.textContent = v;
      chip.addEventListener("click", () => {
        const set = browseState.filters[facet.key] || new Set();
        if (set.has(v)) set.delete(v); else set.add(v);
        if (set.size === 0) delete browseState.filters[facet.key];
        else browseState.filters[facet.key] = set;
        renderBrowse();
      });
      wrap.appendChild(chip);
    }
  }
  return any ? wrap : null;
}

function catSubtitle(cat) {
  if (cat.key === "pll") return "21 last-layer permutations. Click cards to select; drill the selection from the bar below.";
  if (cat.key === "oll") return "57 last-layer orientations. Click cards to select; drill the selection from the bar below.";
  if (cat.key === "f2l_adv") return "25 advanced first-two-layers cases. Reference only, not drillable.";
  if (cat.key === "f2l_beg") return "16 beginner first-two-layers cases. Reference only, not drillable.";
  if (cat.key === "notation") return "Move notation reference. Click a card to see the cube state after applying that move from solved.";
  return "";
}

function renderBrowseCard(it, cat) {
  const card = document.createElement("article");
  card.className = "alg-card";
  card.style.setProperty("--card-accent", cat.accent);

  const key = selection.key(cat.key, it.id);
  if (cat.drillable && selection.isSelected(cat.key, it.id)) {
    card.classList.add("selected");
  }

  // Selection checkbox (drillable categories only)
  if (cat.drillable) {
    const check = document.createElement("div");
    check.className = "alg-card-check";
    check.setAttribute("role", "checkbox");
    check.setAttribute("aria-checked", String(selection.isSelected(cat.key, it.id)));
    check.title = "Toggle selection";
    card.appendChild(check);
  }

  // Image
  const img = document.createElement("div");
  img.className = "alg-img";
  if (cat.key === "notation") {
    // For notation, show the move letter big and bold instead of a tiny SVG
    img.classList.add("notation-letter");
    img.innerHTML = `<div>${colorizeAlg(it.algorithm)}</div>`;
  } else if (cat.imageUrl && it.algorithm) {
    const imgEl = document.createElement("img");
    imgEl.src = cat.imageUrl(it);
    imgEl.alt = `${cat.titleOf(it)} case state`;
    imgEl.loading = "lazy";
    imgEl.decoding = "async";
    img.appendChild(imgEl);
  }
  card.appendChild(img);

  // Title
  const title = document.createElement("h3");
  title.className = "alg-title";
  title.innerHTML = `${escapeHtml(cat.titleOf(it))} <span style="color:var(--muted); font-weight:500; font-family:var(--font-mono); font-size:12px; margin-left:6px;">${escapeHtml(cat.idOf(it))}</span>`;
  card.appendChild(title);

  // Notation
  if (it.algorithm && cat.key !== "notation") {
    const note = document.createElement("p");
    note.className = "alg-notation";
    note.innerHTML = colorizeAlg(it.algorithm);
    card.appendChild(note);
  } else if (cat.key === "notation") {
    const note = document.createElement("p");
    note.className = "alg-notation";
    note.innerHTML = colorizeAlg(it.algorithm);
    card.appendChild(note);
  }

  // Meta (description for notation, recognition for PLL/OLL, etc.)
  for (const m of cat.metaRows(it) || []) {
    const meta = document.createElement("p");
    meta.className = "alg-meta";
    meta.innerHTML = `<strong style="color: var(--text-soft); font-weight: 600;">${escapeHtml(m.label)}:</strong> ${escapeHtml(m.value)}`;
    card.appendChild(meta);
  }

  // Footer stats
  const footer = document.createElement("div");
  if (cat.drillable) {
    const drill = stats.getDrill(cat.key, it.id);
    const recog = stats.getRecog(cat.key, it.id);
    footer.className = "alg-stats";
    if (drill || recog) {
      const parts = [];
      if (drill) parts.push(`<span>best <strong>${escapeHtml(stats.fmtTime(drill.best))}</strong></span>`);
      if (drill) parts.push(`<span>reps <strong>${drill.n}</strong></span>`);
      if (recog) parts.push(`<span>recog <strong>${escapeHtml(stats.fmtAccuracy(recog))}</strong></span>`);
      footer.innerHTML = parts.join("");
    } else {
      footer.classList.add("empty");
      footer.innerHTML = `<span>untried</span><span></span>`;
    }
  } else {
    footer.className = "alg-stats empty";
    footer.innerHTML = `<span>${escapeHtml(cat.label.toLowerCase())}</span><span></span>`;
  }
  card.appendChild(footer);

  // Click anywhere on a drillable card toggles selection (except inside the
  // alg-notation block, which users will sometimes want to triple-click +
  // copy). Use a stopPropagation guard there.
  if (cat.drillable) {
    card.addEventListener("click", (e) => {
      // Allow selecting text in algorithm block without toggling
      if (e.target.closest(".alg-notation")) return;
      selection.toggle(cat.key, it.id);
    });
    const note = card.querySelector(".alg-notation");
    if (note) note.style.userSelect = "text";
  }
  return card;
}

function matchesFilters(it, cat) {
  for (const [facetKey, set] of Object.entries(browseState.filters)) {
    const facet = cat.filterFacets.find((f) => f.key === facetKey);
    if (!facet) continue;
    const v = facet.from(it);
    if (!set.has(v)) return false;
  }
  if (browseState.search) {
    const haystack = cat.searchFields
      .map((k) => (it[k] != null ? String(it[k]) : ""))
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(browseState.search)) return false;
  }
  return true;
}

/* ============================================================ */
/* PRACTICE                                                       */
/* ============================================================ */

function renderPractice() {
  const root = document.getElementById("page-practice");
  if (!appState.data) return;

  const selectedKeys = selection.allKeys();
  const pllCount = selectedKeys.filter((k) => k.startsWith("pll/")).length;
  const ollCount = selectedKeys.filter((k) => k.startsWith("oll/")).length;
  const totalSel = selectedKeys.length;

  /* Header */
  const head = document.createElement("div");
  head.className = "page-head";
  head.innerHTML = `
    <div>
      <h1 class="page-title">Practice</h1>
      <p class="page-subtitle">Drill, recognition, batch, or today's spaced-repetition pick.</p>
    </div>
    <div class="row" style="gap:var(--s-2);">
      <button class="btn btn-ghost" id="practice-clear" ${totalSel === 0 ? "disabled" : ""}>Clear selection</button>
    </div>`;
  head.querySelector("#practice-clear").addEventListener("click", () => selection.clear());

  /* Sub-mode row */
  const submodeRow = document.createElement("div");
  submodeRow.className = "submode-row";
  const submodes = [
    { key: "drill",     label: "Drill",            planned: false },
    { key: "weak",      label: "Today's drill",    planned: false },
    { key: "recognition", label: "Recognition",    planned: false },
    { key: "batch",     label: "Batch (5)",        planned: false },
    { key: "finger",    label: "Fingertricks",     planned: true  },
  ];
  for (const sm of submodes) {
    const btn = document.createElement("button");
    btn.className = "submode" + (sm.planned ? " planned" : "") + (practiceState.submode === sm.key ? " active" : "");
    btn.textContent = sm.label;
    if (!sm.planned) {
      btn.addEventListener("click", () => {
        practiceState.submode = sm.key;
        renderPractice();
      });
    } else {
      btn.addEventListener("click", () => showToast("Fingertricks", "info"));
    }
    submodeRow.appendChild(btn);
  }

  /* Stage - different content per submode */
  const shell = document.createElement("div");
  shell.className = "practice-shell";

  const stage = document.createElement("div");
  stage.className = "practice-stage";
  const stageContent = practiceStageContent(practiceState.submode, { selectedKeys, pllCount, ollCount, totalSel });
  stage.append(...stageContent);

  /* Side panel */
  const side = document.createElement("div");
  side.className = "practice-side";
  side.append(...practiceSidePanel());

  shell.append(stage, side);
  root.replaceChildren(head, submodeRow, shell);
}

function practiceStageContent(submode, ctx) {
  const out = [];
  const headline = document.createElement("h2");
  headline.className = "practice-headline";
  const sub = document.createElement("p");
  sub.className = "practice-sub";
  const countPill = document.createElement("div");
  countPill.className = "practice-count-pill";
  const ctaRow = document.createElement("div");
  ctaRow.className = "practice-cta-row";

  if (submode === "drill") {
    headline.textContent = "Drill selected cases";
    sub.textContent = "Hold space to arm, release to start, press any key to stop. Each case is scrambled and you solve it under the clock. Drill times update spaced-repetition automatically.";
    countPill.innerHTML = `<b>${ctx.totalSel}</b> case${ctx.totalSel === 1 ? "" : "s"} selected${ctx.totalSel ? ` · ${ctx.pllCount} PLL · ${ctx.ollCount} OLL` : ""}`;
    const start = btn("btn btn-primary btn-lg", "Start drill →");
    start.disabled = ctx.totalSel === 0;
    start.addEventListener("click", () => document.getElementById("drill-selected").click());
    const browse = btn("btn", "Pick cases in Browse");
    browse.addEventListener("click", () => setActivePage("browse"));
    ctaRow.append(start, browse);
  } else if (submode === "weak") {
    headline.textContent = "Today's drill";
    sub.textContent = "Surface the cases you've practiced least, are slowest on, or are overdue for spaced-repetition review. Opens a picker so you can confirm the lineup before starting.";
    const weak = rankWeakCases(["pll", "oll"], 20);
    const dueCount = weak.filter((c) => c.isDue).length;
    const newCount = weak.filter((c) => c.isUnpracticed && !c.isDue).length;
    countPill.innerHTML = `<b>${dueCount}</b> due now · <b>${newCount}</b> never drilled`;
    const start = btn("btn btn-primary btn-lg", "Open today's drill →");
    start.addEventListener("click", () => document.getElementById("open-weak-cases").click());
    ctaRow.append(start);
  } else if (submode === "recognition") {
    headline.textContent = "Train recognition";
    sub.textContent = "Show the case, name it before time runs out. Opens a settings screen first so you can tune options like time limit and OLL choice count.";
    countPill.innerHTML = `<b>${ctx.totalSel}</b> case${ctx.totalSel === 1 ? "" : "s"} selected`;
    const start = btn("btn btn-primary btn-lg", "Start recognition →");
    start.disabled = ctx.totalSel === 0;
    start.addEventListener("click", () => document.getElementById("recog-selected").click());
    const browse = btn("btn", "Pick cases in Browse");
    browse.addEventListener("click", () => setActivePage("browse"));
    ctaRow.append(start, browse);
  } else if (submode === "batch") {
    headline.textContent = "Batch: 5 PLLs, one continuous timer";
    sub.textContent = "Pulls 5 random PLLs from your selection, then issues a single short scramble that's equivalent to the composed setup. You execute all 5 algorithms under one timer; the cube ends solved.";
    countPill.innerHTML = `<b>${ctx.pllCount}</b> PLL case${ctx.pllCount === 1 ? "" : "s"} selected${ctx.pllCount < 5 ? " · need 5+ for variety" : ""}`;
    const start = btn("btn btn-primary btn-lg", "Start batch →");
    start.disabled = ctx.pllCount === 0;
    start.addEventListener("click", () => document.getElementById("batch-selected").click());
    const browse = btn("btn", "Pick PLLs in Browse");
    browse.addEventListener("click", () => {
      browseState.category = "pll";
      setActivePage("browse");
    });
    ctaRow.append(start, browse);
  }

  out.push(headline, sub, countPill, ctaRow);
  return out;
}

function practiceSidePanel() {
  const out = [];

  // Selection summary
  const selBlock = document.createElement("div");
  selBlock.className = "side-block";
  const selKeys = selection.allKeys();
  const pllKeys = selKeys.filter((k) => k.startsWith("pll/"));
  const ollKeys = selKeys.filter((k) => k.startsWith("oll/"));
  selBlock.innerHTML = `
    <h3 class="side-block-title">Selection</h3>
    <div class="side-stats-row"><span class="side-stat-label">Total</span><span class="side-stat-value">${selKeys.length}</span></div>
    <div class="side-stats-row"><span class="side-stat-label">PLL</span><span class="side-stat-value">${pllKeys.length}</span></div>
    <div class="side-stats-row"><span class="side-stat-label">OLL</span><span class="side-stat-value">${ollKeys.length}</span></div>`;
  out.push(selBlock);

  // Last 7 days drill stats
  const allStats = stats.getAll();
  const nowSec = Math.floor(Date.now() / 1000);
  const weekStart = nowSec - 7 * 86400;
  let weekReps = 0;
  let bestThisWeek = null;
  for (const slot of Object.values(allStats)) {
    if (!slot?.drill) continue;
    if (slot.drill.lastAt >= weekStart) {
      weekReps += slot.drill.n || 0;
      if (slot.drill.best != null && (bestThisWeek == null || slot.drill.best < bestThisWeek)) {
        bestThisWeek = slot.drill.best;
      }
    }
  }

  const weekBlock = document.createElement("div");
  weekBlock.className = "side-block";
  weekBlock.innerHTML = `
    <h3 class="side-block-title">Last 7 days</h3>
    <div class="side-stats-row"><span class="side-stat-label">Drill reps</span><span class="side-stat-value">${weekReps}</span></div>
    <div class="side-stats-row"><span class="side-stat-label">Best single</span><span class="side-stat-value">${bestThisWeek != null ? stats.fmtTime(bestThisWeek) : "-"}</span></div>`;
  out.push(weekBlock);

  // Weak cases preview
  const weak = rankWeakCases(["pll", "oll"], 6);
  const weakBlock = document.createElement("div");
  weakBlock.className = "side-block";
  const itemsHtml = weak.length
    ? weak.map((c, i) => `
        <div class="session-item ${i === 0 ? "best" : ""}">
          <span>${escapeHtml(c.item.name)}</span>
          <span class="session-meta">${c.isDue ? "due" : c.isUnpracticed ? "new" : (c.best != null ? stats.fmtTime(c.best) : "-")}</span>
        </div>`).join("")
    : `<div class="session-meta" style="padding: var(--s-2) 0;">No drill data yet</div>`;
  weakBlock.innerHTML = `
    <h3 class="side-block-title">Weakest cases</h3>
    <div class="session-list">${itemsHtml}</div>`;
  out.push(weakBlock);

  return out;
}

function btn(className, text) {
  const b = document.createElement("button");
  b.className = className;
  b.textContent = text;
  b.type = "button";
  return b;
}

/* ============================================================ */
/* TIMER                                                          */
/* The timer mounts INLINE into the page (no modal). This is the   */
/* full speedcubing timer with WCA inspection, sessions, comments  */
/* and stats footer, hosted directly under the workspace bar.      */
/* ============================================================ */

function renderTimer() {
  const root = document.getElementById("page-timer");
  if (!appState.data) return;
  // Single inline host fills the page; timer.js builds its UI inside.
  let host = root.querySelector(".timer-inline-host");
  if (!host) {
    host = document.createElement("div");
    host.className = "timer-inline-host";
    root.replaceChildren(host);
  }
  // mountTimer is idempotent: if already mounted into this host, it no-ops
  // so the live timer state survives the page-render call.
  import("./timer.js").then((mod) => mod.mountTimer(host));
}

/* ============================================================ */
/* STATS                                                          */
/* ============================================================ */

function renderStats() {
  const root = document.getElementById("page-stats");
  if (!appState.data) return;

  const allSessions = sessions.listSessions();
  const allSolves = allSessions.flatMap((s) => s.solves);
  const filtered = filterByRange(allSolves, statsPageState.range);

  const total = filtered.length;
  const best = sessions.bestSingle(filtered);
  const ao5 = sessions.trimmedAverage(filtered, 5);
  const ao12 = sessions.trimmedAverage(filtered, 12);

  const head = document.createElement("div");
  head.className = "page-head";
  head.innerHTML = `
    <div>
      <h1 class="page-title">Stats &amp; <em>trends</em></h1>
      <p class="page-subtitle">Real WCA averages from your timer sessions, plus per-case drill mastery.</p>
    </div>
    <div class="row" style="gap:var(--s-2);">
      <button class="chip ${statsPageState.range === 7 ? "accent" : ""}" data-range="7">7 days</button>
      <button class="chip ${statsPageState.range === 30 ? "accent" : ""}" data-range="30">30 days</button>
      <button class="chip ${statsPageState.range === "all" ? "accent" : ""}" data-range="all">All time</button>
    </div>`;
  for (const chip of head.querySelectorAll("[data-range]")) {
    chip.addEventListener("click", () => {
      const r = chip.dataset.range;
      statsPageState.range = r === "all" ? "all" : Number(r);
      renderStats();
    });
  }

  const submodeRow = document.createElement("div");
  submodeRow.className = "submode-row";
  submodeRow.innerHTML = `
    <button class="submode active">Overview</button>
    <button class="submode planned">Solve analysis</button>
    <button class="submode planned">Achievements</button>
    <button class="submode planned">Sharing</button>`;
  for (const sm of submodeRow.querySelectorAll(".submode.planned")) {
    sm.addEventListener("click", () => showToast(sm.textContent.trim(), "info"));
  }

  const body = document.createElement("div");
  body.className = "page-body";
  body.innerHTML = `
    <div class="stats-grid">
      <div class="stats-cell">
        <p class="stat-label">Solves</p>
        <p class="stat-value">${total}</p>
        <p class="stat-delta neutral">${rangeLabel(statsPageState.range)}</p>
      </div>
      <div class="stats-cell">
        <p class="stat-label">Best single</p>
        <p class="stat-value">${best != null ? sessions.fmtMs(best) : "-"}</p>
        <p class="stat-delta ${best != null ? "" : "neutral"}">${best != null ? "personal record" : "no solves yet"}</p>
      </div>
      <div class="stats-cell">
        <p class="stat-label">ao5</p>
        <p class="stat-value">${ao5 != null ? sessions.fmtMs(ao5) : "-"}</p>
        <p class="stat-delta neutral">last 5 in range</p>
      </div>
      <div class="stats-cell">
        <p class="stat-label">ao12</p>
        <p class="stat-value">${ao12 != null ? sessions.fmtMs(ao12) : "-"}</p>
        <p class="stat-delta neutral">last 12 in range</p>
      </div>
    </div>

    <div class="chart-row">
      <div class="chart-cell">
        <p class="meta-label">Trend</p>
        <h3 class="section-title" style="margin: var(--s-2) 0 0;">Average over time</h3>
        <div class="chart-area" id="stats-chart"></div>
      </div>
      <div class="chart-cell">
        <p class="meta-label">Activity</p>
        <h3 class="section-title" style="margin: var(--s-2) 0 0;">14-week heatmap</h3>
        <div class="heatmap" id="stats-heatmap"></div>
      </div>
    </div>

    <div class="recent-head" style="margin-top: var(--s-6); margin-bottom: 0;">
      <h2>Algorithm mastery</h2>
      <a id="stats-go-browse">Browse all cases →</a>
    </div>
    <div class="mastery-grid" id="stats-mastery"></div>`;

  // Draw the chart (best-of-rolling-ao5 over time)
  const chartHost = body.querySelector("#stats-chart");
  drawTrendChart(chartHost, filtered);

  // Heatmap of solves per (week, day-of-week) for last 14 weeks
  const heatmapHost = body.querySelector("#stats-heatmap");
  drawHeatmap(heatmapHost, allSolves);

  // Mastery grid - top 6 drilled cases by best time (ascending)
  const masteryHost = body.querySelector("#stats-mastery");
  drawMastery(masteryHost);

  body.querySelector("#stats-go-browse").addEventListener("click", () => setActivePage("browse"));

  root.replaceChildren(head, submodeRow, body);
}

function rangeLabel(r) {
  if (r === 7) return "last 7 days";
  if (r === 30) return "last 30 days";
  return "all time";
}

function filterByRange(solves, range) {
  if (range === "all") return solves;
  const cutoff = Date.now() - range * 86400 * 1000;
  return solves.filter((s) => s.date >= cutoff);
}

function drawTrendChart(host, solves) {
  if (!solves || solves.length < 2) {
    host.innerHTML = `<div style="display:flex; align-items:center; justify-content:center; height:100%; color:var(--muted); font-family:var(--font-mono); font-size:12px;">Need at least 2 solves to plot a trend.</div>`;
    return;
  }
  const points = solves
    .map((s, i) => ({ x: i, y: sessions.effectiveMs(s) }))
    .filter((p) => isFinite(p.y));
  if (points.length < 2) {
    host.innerHTML = `<div style="display:flex; align-items:center; justify-content:center; height:100%; color:var(--muted); font-family:var(--font-mono); font-size:12px;">All solves in range are DNF.</div>`;
    return;
  }
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));
  const range = Math.max(maxY - minY, 1);
  const w = 600, h = 200;
  const pad = 10;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const xs = (x) => pad + (x / Math.max(points.length - 1, 1)) * innerW;
  const ys = (y) => pad + innerH - ((y - minY) / range) * innerH;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xs(p.x).toFixed(1)} ${ys(p.y).toFixed(1)}`).join(" ");
  host.innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="1.5" />
      ${points.slice(-1).map((p) => `<circle cx="${xs(p.x).toFixed(1)}" cy="${ys(p.y).toFixed(1)}" r="3" fill="var(--accent)" />`).join("")}
    </svg>`;
}

function drawHeatmap(host, solves) {
  const cells = [];
  const now = new Date();
  // Build 14 columns × 7 rows. Each cell = one day. Columns ordered oldest→newest left→right.
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const oldest = new Date(today);
  oldest.setDate(today.getDate() - (14 * 7 - 1));
  // Count solves per day
  const counts = new Map();
  for (const s of solves) {
    const d = new Date(s.date);
    const key = d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  // We render row-by-day, with 14 columns. We need cells in row-major order
  // for CSS grid (which the .heatmap uses 14 columns).
  // Build a 14*7 array, going week-by-week, day-by-day.
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 14; col++) {
      const dayOffset = col * 7 + row;
      const d = new Date(oldest);
      d.setDate(oldest.getDate() + dayOffset);
      const key = d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
      const c = counts.get(key) || 0;
      let cls = "";
      if (c >= 30) cls = "l4";
      else if (c >= 15) cls = "l3";
      else if (c >= 5) cls = "l2";
      else if (c >= 1) cls = "l1";
      cells.push(`<div class="heatmap-cell ${cls}" title="${d.toDateString()} · ${c} solve${c === 1 ? "" : "s"}"></div>`);
    }
  }
  host.innerHTML = cells.join("");
}

function drawMastery(host) {
  const all = stats.getAll();
  const candidates = [];
  for (const [key, slot] of Object.entries(all)) {
    if (!slot?.drill || slot.drill.n === 0) continue;
    const [cat, ...rest] = key.split("/");
    const id = rest.join("/");
    if (cat !== "pll" && cat !== "oll") continue;
    const items = cat === "pll" ? appState.data.pll : appState.data.oll;
    const item = items.find((it) => String(it.id) === id);
    if (!item) continue;
    candidates.push({ cat, item, best: slot.drill.best, n: slot.drill.n });
  }
  candidates.sort((a, b) => a.best - b.best);
  const top = candidates.slice(0, 12);
  if (top.length === 0) {
    host.innerHTML = `<div style="grid-column:1/-1; padding: var(--s-5); border: 1px dashed var(--border); border-radius: var(--r-md); color: var(--muted); text-align:center; font-family: var(--font-mono); font-size: 12px;">No drill data yet. Drill a few PLL or OLL cases to see your mastery here.</div>`;
    return;
  }
  host.innerHTML = top.map((c) => `
    <div class="mastery-cell" title="${escapeHtml(c.item.name)} · ${c.n} reps">
      <div class="mastery-face">
        <img src="${vcImage({ setup: c.item.setup, stage: c.cat, view: "plan", size: 80 })}" alt="${escapeHtml(c.item.name)}" loading="lazy" />
      </div>
      <div class="mastery-name">${escapeHtml(c.item.name)}</div>
      <div class="mastery-best">${escapeHtml(stats.fmtTime(c.best))}</div>
    </div>`).join("");
}

/* ============================================================ */
/* SETTINGS                                                       */
/* ============================================================ */

function renderSettings() {
  const root = document.getElementById("page-settings");

  const head = document.createElement("div");
  head.className = "page-head";
  head.innerHTML = `
    <div>
      <h1 class="page-title">Settings</h1>
      <p class="page-subtitle">Account, timer preferences, and data management.</p>
    </div>`;

  const body = document.createElement("div");
  body.className = "page-body";

  const shell = document.createElement("div");
  shell.className = "settings-shell";

  /* Account */
  const accountCol = document.createElement("div");
  accountCol.className = "settings-col";
  const user = auth.isCloudEnabled() ? auth.currentUser() : null;
  const cloudConfigured = auth.isCloudEnabled();
  accountCol.innerHTML = `
    <p class="settings-section-title">Account</p>
    <div class="settings-section">
      ${cloudConfigured ? `
        <div class="settings-row">
          <div>
            <div class="settings-label">${user ? "Email" : "Sign in / create account"}</div>
            <div class="settings-desc">${user ? escapeHtml(user.email || "(unknown)") : "Email magic-link or Google sign-in"}</div>
          </div>
          ${user ? `<button class="btn" id="set-signout">Sign out</button>` : `<button class="btn btn-primary" id="set-signin">Sign in</button>`}
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-label">Cloud sync</div>
            <div class="settings-desc">${user ? "Active. Drill + sessions sync across devices." : "Sign in to enable cloud sync"}</div>
          </div>
          <span class="chip ${user ? "accent" : ""}">${user ? "Connected" : "Off"}</span>
        </div>` : `
        <div class="settings-row">
          <div>
            <div class="settings-label">Cloud sync</div>
            <div class="settings-desc">Not configured. Fill <code>supabase-config.js</code> to enable accounts + cloud sync.</div>
          </div>
          <span class="chip">Local only</span>
        </div>`}
    </div>`;
  if (cloudConfigured) {
    const signinBtn = accountCol.querySelector("#set-signin");
    if (signinBtn) signinBtn.addEventListener("click", async () => {
      const mod = await import("./auth-ui.js");
      mod.openSignIn();
    });
    const signoutBtn = accountCol.querySelector("#set-signout");
    if (signoutBtn) signoutBtn.addEventListener("click", async () => {
      if (confirm("Sign out? Your local data stays on this device.")) {
        await auth.signOut();
      }
    });
  }

  /* Preferences */
  const prefCol = document.createElement("div");
  prefCol.className = "settings-col";
  const inspection = sessions.getInspection();
  const inspectionDur = sessions.getInspectionDurationSec();
  prefCol.innerHTML = `
    <p class="settings-section-title">Timer preferences</p>
    <div class="settings-section">
      <div class="settings-row">
        <div>
          <div class="settings-label">WCA inspection</div>
          <div class="settings-desc">Countdown before each solve. Overrun adds +2 / DNF.</div>
        </div>
        <div class="toggle ${inspection ? "on" : ""}" id="set-inspection"></div>
      </div>
      <div class="settings-row" style="flex-direction: column; align-items: stretch; gap: var(--s-3);">
        <div>
          <div class="settings-label">Inspection duration</div>
          <div class="settings-desc">Standard is 15 seconds. Pick a preset or type your own.</div>
        </div>
        <div style="display:flex; gap: var(--s-2); flex-wrap: wrap; align-items: center;">
          <div class="settings-pill-row" id="set-inspection-pills">
            ${[8,15,30,60].map((n) => `<button class="settings-pill ${inspectionDur === n ? "active" : ""}" data-dur="${n}">${n}s</button>`).join("")}
          </div>
          <input class="settings-num" id="set-inspection-num" type="number" min="1" max="999" value="${inspectionDur}" title="Custom duration in seconds" />
        </div>
      </div>
    </div>`;
  prefCol.querySelector("#set-inspection").addEventListener("click", () => {
    sessions.setInspection(!sessions.getInspection());
  });
  for (const pill of prefCol.querySelectorAll("[data-dur]")) {
    pill.addEventListener("click", () => {
      sessions.setInspectionDurationSec(Number(pill.dataset.dur));
    });
  }
  const numInput = prefCol.querySelector("#set-inspection-num");
  const commitNum = () => {
    const n = Number(numInput.value);
    if (n > 0 && n < 1000) sessions.setInspectionDurationSec(n);
  };
  numInput.addEventListener("change", commitNum);
  numInput.addEventListener("keydown", (e) => { if (e.key === "Enter") commitNum(); });

  /* Data */
  const dataCol = document.createElement("div");
  dataCol.className = "settings-col";
  const allSolves = sessions.listSessions().reduce((n, s) => n + s.solves.length, 0);
  const allDrills = Object.keys(stats.getAll()).length;
  dataCol.innerHTML = `
    <p class="settings-section-title">Data</p>
    <div class="settings-section">
      <div class="settings-row">
        <div>
          <div class="settings-label">Export sessions</div>
          <div class="settings-desc">Download all timer sessions + solves as JSON.</div>
        </div>
        <button class="btn" id="set-export" ${allSolves === 0 ? "disabled" : ""}>Export</button>
      </div>
      <div class="settings-row">
        <div>
          <div class="settings-label">Import sessions</div>
          <div class="settings-desc">Load a previously-exported JSON file (non-destructive).</div>
        </div>
        <button class="btn" id="set-import">Import</button>
      </div>
      <div class="settings-row">
        <div>
          <div class="settings-label">Storage summary</div>
          <div class="settings-desc">${allSolves} timer solve${allSolves === 1 ? "" : "s"} · ${allDrills} drilled case${allDrills === 1 ? "" : "s"}</div>
        </div>
        <span class="chip">local</span>
      </div>
      <div class="settings-row">
        <div>
          <div class="settings-label">Reset drill + SRS stats</div>
          <div class="settings-desc">Clears per-case best times, rep counts, and spaced-repetition state.</div>
        </div>
        <button class="btn" id="set-reset-stats">Reset</button>
      </div>
      <div class="settings-row">
        <div>
          <div class="settings-label">Clear timer session</div>
          <div class="settings-desc">Wipe solves in the active session (keeps the session itself).</div>
        </div>
        <button class="btn" id="set-clear-session">Clear</button>
      </div>
    </div>`;

  dataCol.querySelector("#set-export").addEventListener("click", () => {
    const json = sessions.exportAll();
    downloadText(json, "rubiks-storage-sessions-" + dateStamp() + ".json");
  });
  dataCol.querySelector("#set-import").addEventListener("click", () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "application/json,.json";
    inp.addEventListener("change", () => {
      const file = inp.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const result = sessions.importJson(String(reader.result));
        if (result.ok) {
          showToast(`Imported ${result.count} session${result.count === 1 ? "" : "s"}`);
        } else {
          showToast("Import failed: " + result.error, "error");
        }
      };
      reader.readAsText(file);
    });
    inp.click();
  });
  dataCol.querySelector("#set-reset-stats").addEventListener("click", () => {
    if (confirm("Reset ALL drill + SRS stats? This cannot be undone.")) {
      stats.resetAll();
      showToast("Drill stats reset");
    }
  });
  dataCol.querySelector("#set-clear-session").addEventListener("click", () => {
    if (confirm("Clear all solves in the active session? This cannot be undone.")) {
      sessions.clearActiveSession();
      showToast("Active session cleared");
    }
  });

  shell.append(accountCol, prefCol, dataCol);

  /* About footer */
  const about = document.createElement("div");
  about.className = "settings-about";
  about.innerHTML = `
    <div class="settings-about-cell">
      <span class="settings-about-label">App</span>
      <span class="settings-about-value">Rubik's Storage</span>
    </div>
    <div class="settings-about-cell">
      <span class="settings-about-label">Account</span>
      <span class="settings-about-value">${user ? "Signed in · synced" : cloudConfigured ? "Local only" : "No cloud configured"}</span>
    </div>
    <div class="settings-about-cell">
      <span class="settings-about-label">Links</span>
      <div class="settings-about-links">
        <a href="https://github.com/sawmint/rubiks-storage" target="_blank" rel="noopener">GitHub</a>
        <a href="SETUP.md" target="_blank" rel="noopener">Setup guide</a>
      </div>
    </div>
    <div class="settings-about-cell">
      <span class="settings-about-label">Tip</span>
      <span class="settings-about-value" style="font-size: 12px; font-weight: 400; color: var(--text-soft);">Hold space on the Timer page to arm, release to start, press a key to stop.</span>
    </div>`;

  body.append(shell, about);
  root.replaceChildren(head, body);
}

/* ============================================================ */
/* Helpers                                                        */
/* ============================================================ */

function showToast(label, kind = "info") {
  const existing = document.querySelector(".soon-toast");
  if (existing) existing.remove();
  const t = document.createElement("div");
  t.className = "soon-toast" + (kind === "error" ? " error" : "");
  t.textContent = kind === "info" ? `${label}: coming soon` : label;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 240);
  }, kind === "error" ? 2800 : 1800);
}

function downloadText(text, filename) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function dateStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function uniqueSorted(arr) {
  return Array.from(new Set(arr)).sort((a, b) => String(a).localeCompare(String(b)));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

init();
