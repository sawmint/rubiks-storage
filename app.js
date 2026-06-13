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

export function vcImage({ setup, caseAlg, stage, view, size = 140, sch, bg }) {
  const params = new URLSearchParams({ fmt: "svg", size: String(size), bg: bg || "t" });
  if (setup)   params.set("alg",  setup);
  if (caseAlg) params.set("case", caseAlg);
  if (stage)   params.set("stage", stage);
  if (view)    params.set("view", view);
  if (sch)     params.set("sch",  sch);
  // VisualCube's default cubie outline ("co") is a light grey that reads
  // as a transparent gap between stickers on dark surfaces. Force opaque
  // black so the cube reads cleanly against the warm-dark UI.
  params.set("co", "000000");
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

/* ---------- 2-look subset ----------
 * 2-look PLL = 6 cases (Ua / Ub / Z / H / T / Y).
 * 2-look OLL = 7 OCLL cases (#21-27) + 3 GENERIC edge-orient cases
 *              (Line, L, Dot) that represent the universal 2-look algs
 *              applicable regardless of corner orientation.
 *
 * The 3 generic OLL cases are SYNTHETIC items — they don't come from
 * the JSON dataset. They get injected into data.oll at init time so
 * selection / drill / recognition handle them as regular OLLs.
 *
 * Selection-routing note: 2-look browse tabs route selection through
 * the underlying "pll"/"oll" key via `selectionCategory`, so drill,
 * recognition, batch, and stats remain unaware of the 2-look split.
 */
const TWO_LOOK_PLL_IDS = new Set(["Ua", "Ub", "Z", "H", "T", "Y"]);
const TWO_LOOK_OLL_IDS = new Set([
  "21", "22", "23", "24", "25", "26", "27",   // 7 OCLL (corners-only, cross already)
  "2L-line", "2L-L", "2L-dot",                // 3 generic edge-orient algs
]);
const isTwoLookPll = (it) => TWO_LOOK_PLL_IDS.has(String(it.id));
const isTwoLookOll = (it) => TWO_LOOK_OLL_IDS.has(String(it.id));

/* Generic 2-look OLL items. Each has:
 *   - algorithm: the universal alg used regardless of corner state
 *   - setup: inverse of algorithm so applying alg from setup state returns to solved
 *   - recognition: makes clear that side stickers (corner orientation) don't matter
 * The shape field drives the existing OLL filter facet.
 */
const SYNTHETIC_2L_OLL = [
  {
    id: "2L-line",
    name: "Line",
    shape: "line",
    algorithm: "F R U R' U' F'",
    setup: "F U R U' R' F'",
    recognition: "Two yellow edges form a straight line across the top face. Side yellow stickers don't matter in 2-look OLL — only the U-face edge pattern defines the case. Hold the line vertically (front to back) and apply the alg.",
    twoLookSynthetic: true,
    twoLookKind: "edge",
  },
  {
    id: "2L-L",
    name: "L-shape",
    shape: "L",
    algorithm: "f R U R' U' f'",
    setup: "f U R U' R' f'",
    recognition: "Two yellow edges form an L (one front, one right) on the top face. Side yellow stickers don't matter. Position the L in the front-left position and apply the wide-F alg.",
    twoLookSynthetic: true,
    twoLookKind: "edge",
  },
  {
    id: "2L-dot",
    name: "Dot",
    shape: "dot",
    algorithm: "F R U R' U' F' f R U R' U' f'",
    setup: "f U R U' R' f' F U R U' R' F'",
    recognition: "Zero yellow edges on top — center yellow only. Side yellow stickers don't matter. Apply F R U R' U' F' to get a Line or L, then apply the matching alg (this combined sequence covers the common case).",
    twoLookSynthetic: true,
    twoLookKind: "edge",
  },
];

/* ---------- categories ---------- */

const CATEGORIES = [
  {
    key: "pll_2look",
    label: "2-look PLL",
    shortLabel: "2L PLL",
    accent: "var(--cube-yellow)",
    selectionCategory: "pll",
    getItems: (d) => d.pll.filter(isTwoLookPll),
    titleOf: (it) => it.name,
    idOf: (it) => it.id,
    searchFields: ["id", "name", "group", "algorithm", "recognition"],
    // 2L PLL is taught with two corner-recognition cues only — Headlights
    // (T-perm) and Diagonal (Y-perm). The other 4 cases (Ua, Ub, H, Z)
    // have all corners already solved so they don't need a chip — they
    // just show whenever neither filter is active.
    filterFacets: [{
      key: "tag",
      label: "Category",
      multi: true,
      values: [
        { v: "headlights", label: "Headlights" },
        { v: "diagonal",   label: "Diagonal" },
      ],
      from: (it) => it.tags || [],
    }],
    extraBadges: (it) => [
      { label: "2-look", className: "badge" },
    ],
    metaRows: (it) => [
      it.recognition && { label: "Recognition", value: it.recognition },
    ].filter(Boolean),
    imageUrl: (it) => vcImage({ setup: it.setup, stage: "pll", view: "plan", size: 140 }),
    drillable: true,
    recognitionMode: "text",
  },
  {
    key: "pll",
    label: "PLL",
    accent: "var(--cube-blue)",
    getItems: (d) => d.pll,
    titleOf: (it) => it.name,
    idOf: (it) => it.id,
    searchFields: ["id", "name", "group", "algorithm", "recognition"],
    filterFacets: [{
      key: "tag",
      label: "Category",
      multi: true,
      // Declarative tag list — drives the chip row even before any case is
      // selected. The PLL tagging audit lives in CLAUDE.md (Plan Old-app
      // removal + PLL recat); tags themselves are in rubiks-cube-algorithms.json.
      values: [
        { v: "edges-only",   label: "Edges only" },
        { v: "corners-only", label: "Corners only" },
        { v: "both",         label: "Both corners and edges" },
        { v: "headlights",   label: "Headlights" },
        { v: "diagonal",     label: "Diagonal" },
        { v: "a-perms",      label: "A perms" },
        { v: "u-perms",      label: "U perms" },
        { v: "j-perms",      label: "J perms" },
        { v: "r-perms",      label: "R perms" },
        { v: "g-perms",      label: "G perms" },
        { v: "n-perms",      label: "N perms" },
      ],
      from: (it) => it.tags || [],
    }],
    extraBadges: (it) => [
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
    key: "oll_2look",
    label: "2-look OLL",
    shortLabel: "2L OLL",
    accent: "var(--cube-yellow)",
    selectionCategory: "oll",
    // Sort so the 3 generic edge-orient cases (Line, L, Dot) come first,
    // then the 7 OCLL corner-orient cases. Mirrors the order they're
    // taught: orient edges first, then orient corners.
    getItems: (d) => d.oll.filter(isTwoLookOll).sort((a, b) => {
      const aSyn = a.twoLookSynthetic ? 0 : 1;
      const bSyn = b.twoLookSynthetic ? 0 : 1;
      return aSyn - bSyn;
    }),
    titleOf: (it) => it.name,
    idOf: (it) => it.twoLookSynthetic ? "generic" : "#" + it.id,
    searchFields: ["id", "name", "shape", "algorithm", "recognition"],
    filterFacets: [{ key: "shape", label: "Shape", from: (it) => it.shape }],
    extraBadges: (it) => [
      it.shape && { label: it.shape, className: "badge" },
      it.twoLookSynthetic
        ? { label: "generic 2-look", className: "badge" }
        : { label: "OCLL", className: "badge" },
    ].filter(Boolean),
    metaRows: (it) => [
      it.recognition && { label: "Recognition", value: it.recognition },
    ].filter(Boolean),
    imageUrl: (it) => vcImage({ setup: it.setup, stage: "oll", view: "plan", size: 140 }),
    drillable: true,
    recognitionMode: "thumbnails",
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
    getItems: (d) => [...d.f2l.advanced, ...d.f2l.beginner],
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

/* ---------- Timer display preferences ----------
 * Lightweight localStorage-backed prefs for visual toggles on the Timer
 * page. Applied to <html data-...> attributes so CSS rules in index.html
 * can react without timer.js having to read prefs itself. */
const TIMER_PREVIEW_KEY = "rs-timer-show-preview";
export function getShowCubePreview() {
  try { return localStorage.getItem(TIMER_PREVIEW_KEY) !== "false"; }
  catch { return true; }
}
export function setShowCubePreview(on) {
  try { localStorage.setItem(TIMER_PREVIEW_KEY, on ? "true" : "false"); }
  catch { /* localStorage disabled — pref reverts to default on next load */ }
  applyShowCubePreview();
}
function applyShowCubePreview() {
  document.documentElement.dataset.timerPreview = getShowCubePreview() ? "on" : "off";
}

const browseState = {
  category: "pll_2look",     // start beginners on the 2-look set
  search: "",
  filters: {},        // { facetKey: Set<string> }
};

const practiceState = {
  submode: "drill",   // drill | recognition | batch | weak
};

/* Picker (inline on the Practice page) state. The Practice picker
 * replaces the old Browse selection toolbar — Browse is now
 * reference-only and case selection happens here. */
const practicePickerState = {
  category: "pll",     // pll_2look | pll | oll_2look | oll
  filters: {},         // { facetKey: Set<string> }
};
/* Categories the picker can show. Mirrors a subset of CATEGORIES — only
 * the drillable PLL / OLL views. F2L isn't drillable so it's excluded. */
const PICKER_CATEGORY_KEYS = ["pll_2look", "pll", "oll_2look", "oll"];

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
    // Inject the synthetic 2-look OLL items (Line/L/Dot) into the OLL
    // pool so selection.resolve, drill.js, recognition.js, batch.js
    // and stats.js handle them as regular OLL cases without needing
    // to know about the 2-look split.
    appState.data.oll = [...appState.data.oll, ...SYNTHETIC_2L_OLL];
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

  applyShowCubePreview();
  bindWorkspaceBar();
  bindSidebarCollapse();
  bindAccount();

  selection.subscribe(() => {
    // Browse is reference-only now (selection happens on Practice), so
    // only Practice needs to react to selection changes.
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

/* Collapsible sidebar. The collapsed/expanded state is a `.nav-collapsed`
 * class on `.app`; CSS handles the width + label hiding. Persisted across
 * sessions in localStorage so the user's preference sticks. */
const NAV_COLLAPSE_KEY = "rs-nav-collapsed-v1";
function bindSidebarCollapse() {
  const app = document.querySelector(".app");
  const collapseBtn = document.getElementById("ws-collapse");  // inside the sidebar
  const expandBtn = document.getElementById("ws-expand");      // floating, shown when collapsed
  if (!app) return;

  let collapsed = false;
  try { collapsed = localStorage.getItem(NAV_COLLAPSE_KEY) === "1"; } catch (e) { /* private mode */ }

  const apply = () => {
    app.classList.toggle("nav-collapsed", collapsed);
    if (collapseBtn) collapseBtn.setAttribute("aria-expanded", String(!collapsed));
  };
  apply();
  // Enable transitions only after the initial state has painted, so a
  // sidebar restored to "collapsed" from localStorage doesn't visibly
  // animate closed on every page load.
  requestAnimationFrame(() => app.classList.add("nav-anim"));

  const setCollapsed = (v) => {
    collapsed = v;
    try { localStorage.setItem(NAV_COLLAPSE_KEY, collapsed ? "1" : "0"); } catch (e) { /* private mode */ }
    apply();
  };
  if (collapseBtn) collapseBtn.addEventListener("click", () => setCollapsed(true));
  if (expandBtn) expandBtn.addEventListener("click", () => setCollapsed(false));
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
  // Tear down whatever module mounted the session page when leaving it,
  // so drill/batch/recognition can release their key handlers + sessions.
  if (prev === "session" && page !== "session" && sessionPageCleanup) {
    const fn = sessionPageCleanup;
    sessionPageCleanup = null;
    try { fn(); } catch (e) { console.error("session page leave hook failed:", e); }
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

/* Mount a module's body inline into the dedicated #page-session host, with
 * a "← Back" header. Replaces the old modal flow for drill / batch /
 * recognition — those are long-lived sessions that read better as their
 * own page than a popup the user can accidentally backdrop-close. The
 * onLeave hook fires when the user navigates anywhere else (Back button,
 * top-bar nav, Esc). Calling openSessionPage again replaces the prior
 * mount's content + fires the previous onLeave first. */
let sessionPageCleanup = null;
let sessionPageReturn = "practice";  // page to return to from Back
export function openSessionPage({ title, body, onLeave, returnTo }) {
  // Fire prior cleanup before clobbering the host (prevents two drill
  // sessions stacking key handlers).
  if (sessionPageCleanup) {
    const fn = sessionPageCleanup;
    sessionPageCleanup = null;
    try { fn(); } catch (e) { console.error("prior session leave hook failed:", e); }
  }
  sessionPageCleanup = onLeave || null;
  sessionPageReturn = returnTo || "practice";

  const host = document.getElementById("page-session");
  if (!host) return;
  host.innerHTML = "";

  const head = document.createElement("div");
  head.className = "page-head session-page-head";
  const titleSpan = title ? `<h1 class="page-title">${escapeHtml(title)}</h1>` : "";
  head.innerHTML = `
    <button class="btn btn-ghost session-back" id="session-back" type="button">← Back</button>
    <div>${titleSpan}</div>`;
  head.querySelector("#session-back").addEventListener("click", () => setActivePage(sessionPageReturn));
  host.appendChild(head);

  const wrap = document.createElement("div");
  wrap.className = "session-page-body";
  if (body) wrap.appendChild(body);
  host.appendChild(wrap);

  setActivePage("session");
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
      label.textContent = displayNameFor(user);
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

export async function openTimer() {
  const mod = await import("./timer.js");
  mod.openTimer();
}
export async function openWeakCases() {
  const mod = await import("./weak-cases.js");
  mod.start(appState.data);
}
export async function openDrill(keys) {
  const useKeys = keys ?? selection.allKeys();
  if (useKeys.length === 0) return showToast("Select cases in Browse first", "error");
  const mod = await import("./drill.js");
  mod.start(appState.data, useKeys);
}
export async function openBatch(keys) {
  const useKeys = keys ?? selection.allKeys();
  const pllKeys = useKeys.filter((k) => k.startsWith("pll/"));
  if (pllKeys.length === 0) return showToast("Batch needs PLL cases. Select some in Browse first.", "error");
  const mod = await import("./batch.js");
  mod.start(appState.data, pllKeys);
}
export async function openRecognition(keys) {
  const useKeys = keys ?? selection.allKeys();
  if (useKeys.length === 0) return showToast("Select cases in Browse first", "error");
  const mod = await import("./recognition.js");
  mod.start(appState.data, useKeys);
}

/* ============================================================ */
/* HOME                                                           */
/* ============================================================ */

function renderHome() {
  const root = document.getElementById("page-home");
  if (!appState.data) return;

  // Milestone-aware so the recommendation aligns with the sidebar:
  // a user on the Two-look CFOP milestone gets a 2-look case, not a
  // random 1-look advanced case from the full pool.
  const weakAll = rankWeakCases(["pll", "oll"], 24, { milestoneAware: true });
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
        <h1 class="focus-name">${focus.category.toUpperCase()} ${escapeHtml(focus.item.name)}</h1>
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
      openDrill();
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
  grid.className = "home-grid home-grid-2col";

  // (The "Your path" milestones column was removed — the focus strip + SRS
  // queue already convey the same progression in a less goal-y way.)

  // Recommended next
  const col2 = document.createElement("div");
  const upHtml = upNext.length
    ? upNext.map((c) => `
        <div class="upnext" data-key="${escapeHtml(c.key)}">
          <div class="upnext-face">
            <img src="${vcImageFor(c, 80)}" alt="${escapeHtml(c.item.name)}" loading="lazy" />
          </div>
          <div class="upnext-meta">
            <span class="upnext-cat">${c.category.toUpperCase()}${c.item.group ? " " + escapeHtml(c.item.group) : ""}${c.item.shape ? " " + escapeHtml(c.item.shape) : ""}</span>
            <span class="upnext-name">${escapeHtml(c.item.name)}</span>
            <span class="upnext-alg">${colorizeAlg(c.item.algorithm)}</span>
            <span class="upnext-best">best <strong>${escapeHtml(stats.fmtTime(c.best))}</strong></span>
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
      openDrill();
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
      <p class="stat-delta neutral">${week.drillReps === 0 ? "no reps yet" : "this week"}</p>
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
  const pllAll = appState.data.pll;       // 21 total
  const ollAll = appState.data.oll;       // 57 total
  const pll2look = pllAll.filter(isTwoLookPll);   // 6
  const oll2look = ollAll.filter(isTwoLookOll);   // 10
  const twoLookTotal = pll2look.length + oll2look.length;   // 16

  const drilled = (cat, id) => (all[`${cat}/${id}`]?.drill?.n || 0) > 0;
  const pll2lookDone = pll2look.filter((it) => drilled("pll", it.id)).length;
  const oll2lookDone = oll2look.filter((it) => drilled("oll", it.id)).length;
  const pllDone = pllAll.filter((it) => drilled("pll", it.id)).length;
  const ollDone = ollAll.filter((it) => drilled("oll", it.id)).length;
  const twoLookDone = pll2lookDone + oll2lookDone;

  const twoLookComplete = pll2lookDone === pll2look.length && oll2lookDone === oll2look.length;
  const pllComplete = pllDone === pllAll.length;
  const ollComplete = ollDone === ollAll.length;

  // Best ao12 across all sessions for sub-X gates
  const allSolves = sessions.listSessions().flatMap((s) => s.solves);
  const bestAo12 = sessions.bestAverage(allSolves, 12);
  const bestSecs = bestAo12 != null && isFinite(bestAo12) ? bestAo12 / 1000 : null;

  const milestones = [
    { name: "Two-look CFOP", meta: twoLookComplete ? "Complete" : `${twoLookDone}/${twoLookTotal}`, done: twoLookComplete },
    { name: "Full PLL", meta: pllComplete ? "Complete" : `${pllDone}/${pllAll.length}`, done: pllComplete },
    { name: "Full OLL", meta: ollComplete ? "Complete" : `${ollDone}/${ollAll.length}`, done: ollComplete },
    { name: "Sub-20",   meta: bestSecs != null ? (bestSecs <= 20 ? "Complete" : `ao12 ${bestSecs.toFixed(2)}s`) : "Locked", done: bestSecs != null && bestSecs <= 20 },
    { name: "Sub-15",   meta: bestSecs != null ? (bestSecs <= 15 ? "Complete" : `ao12 ${bestSecs.toFixed(2)}s`) : "Locked", done: bestSecs != null && bestSecs <= 15 },
  ];
  // Mark first not-done as "current"
  const nextIdx = milestones.findIndex((m) => !m.done);
  if (nextIdx >= 0) milestones[nextIdx].current = true;
  return milestones;
}

/* Which stage of the CFOP progression the user is on. The home focus
 * strip uses this to scope its recommendation to the right pool —
 * otherwise a beginner on Two-look gets pushed full-OLL cases they
 * haven't been taught yet. */
function currentMilestoneStage() {
  const ms = computeMilestones();
  if (!ms[0].done) return "twoLook";   // 2-look CFOP not done yet
  if (!ms[1].done) return "fullPLL";   // 2-look done, working on full PLL
  if (!ms[2].done) return "fullOLL";   // working on full OLL
  return "speed";                       // chasing sub-20 / sub-15
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
  if (n === 0) return `0 ${suffix}`;
  const arrow = n > 0 ? "↑" : "↓";
  return `${arrow} ${Math.abs(n)} ${suffix}`;
}

function focusEyebrow(c) {
  if (c.isDue) {
    const overdue = Math.max(0, Math.floor((-(c.dueDelta || 0)) / 86400));
    if (overdue === 0) return "Today's drill — Due now";
    return `Today's drill — Due ${overdue}d ago`;
  }
  if (c.isUnpracticed) return "Today's drill — Never drilled";
  return "Today's drill — Weakest recent";
}

function vcImageFor(c, size = 140) {
  const it = c.item;
  if (c.category === "pll") return vcImage({ setup: it.setup, stage: "pll", view: "plan", size });
  if (c.category === "oll") return vcImage({ setup: it.setup, stage: "oll", view: "plan", size });
  return vcImage({ caseAlg: it.algorithm, size });
}

function rankWeakCases(categories = ["pll", "oll"], limit = 10, opts = {}) {
  if (!appState.data) return [];
  const all = stats.getAll();
  const nowSec = Math.floor(Date.now() / 1000);

  // When milestone-aware, scope the candidate pool to whatever stage the
  // user is currently on so beginners don't get pushed full-OLL cases
  // and intermediates don't get spammed with 2-look they already finished.
  let pllPass = () => true;
  let ollPass = () => true;
  if (opts.milestoneAware) {
    const stage = currentMilestoneStage();
    if (stage === "twoLook") {
      pllPass = isTwoLookPll;
      ollPass = isTwoLookOll;
    } else if (stage === "fullPLL") {
      // 2-look done. Focus on the 15 advanced PLLs; OLL 2-look already
      // drilled so OLL recommendations come from the full set.
      pllPass = (it) => !isTwoLookPll(it);
    } else if (stage === "fullOLL") {
      pllPass = (it) => !isTwoLookPll(it);
      ollPass = (it) => !isTwoLookOll(it);
    }
    // "speed" stage: no filter — everything is fair game for SR review.
  }

  const out = [];
  for (const cat of categories) {
    const items = cat === "pll" ? appState.data.pll : appState.data.oll;
    if (!items) continue;
    const passFn = cat === "pll" ? pllPass : ollPass;
    for (const item of items) {
      if (typeof item.setup !== "string") continue;
      if (!passFn(item)) continue;
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
    <input type="text" class="search" id="browse-search" placeholder="Search algorithms…" value="${escapeHtml(browseState.search)}" />
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
    // Two ways to source the chip values:
    //   1. Declarative `values: [{v,label}]` on the facet — used for
    //      array-valued tag facets where the chip list should be stable
    //      regardless of which items happen to be in view.
    //   2. Derived from observed item values — original behavior.
    let chipDefs;
    if (Array.isArray(facet.values)) {
      chipDefs = facet.values.map((x) => ({ value: x.v, label: x.label || x.v }));
    } else {
      const observed = uniqueSorted(items.flatMap((it) => {
        const v = facet.from(it);
        return Array.isArray(v) ? v : [v];
      }).filter(Boolean));
      chipDefs = observed.map((v) => ({ value: v, label: v }));
    }
    if (chipDefs.length === 0) continue;
    any = true;
    const label = document.createElement("span");
    label.className = "facet-label";
    label.textContent = facet.label;
    wrap.appendChild(label);
    for (const def of chipDefs) {
      const v = def.value;
      const chip = document.createElement("button");
      chip.className = "chip facet" + ((browseState.filters[facet.key]?.has(v)) ? " active" : "");
      chip.textContent = def.label;
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
  if (cat.key === "pll_2look") return "6 beginner permutations: Ua, Ub, Z, H for edges, plus T-perm and Y-perm for combined corner-and-edge cases. Master these to solve any state via the two-look method.";
  if (cat.key === "pll") return "All 21 last-layer permutations. Filter by tag — a single case can match multiple (T-perm is Both corners and edges AND Headlights).";
  if (cat.key === "oll_2look") return "10 beginner orientations: 3 generic edge-orient algs (Line, L, Dot) where side stickers don't matter, plus 7 OCLL corner cases. Pair with 2-look PLL for full two-look CFOP.";
  if (cat.key === "oll") return "All 60 last-layer orientations (57 cases + 3 generic 2-look entries). The 7 OCLL cases also live in 2-look OLL.";
  if (cat.key === "f2l_adv") return "41 first-two-layers cases (25 advanced + 16 beginner). Reference only, not drillable — F2L algs are short enough to learn through actual solving.";
  if (cat.key === "f2l_beg") return "16 beginner first-two-layers cases. Reference only, not drillable.";
  if (cat.key === "notation") return "Move notation reference. Each card shows the cube state after applying that move from solved.";
  return "";
}

function renderBrowseCard(it, cat) {
  const card = document.createElement("article");
  card.className = "alg-card";
  card.style.setProperty("--card-accent", cat.accent);

  // selCat = the underlying data category used for stats lookup so the
  // 2-look browse views share drill/recog records with the full view.
  const selCat = cat.selectionCategory || cat.key;

  // Image
  const img = document.createElement("div");
  img.className = "alg-img";
  if (cat.key === "notation") {
    // Real cube preview of the move applied to a solved cube, viewed in
    // WCA orientation so the user can visually see what changes.
    // Rotations (x/y/z) use the trans view so the cube's rotated body is
    // visible; everything else uses the default plan view.
    const isRotation = /^[xyz]/i.test(it.setup || "");
    const imgEl = document.createElement("img");
    imgEl.src = vcImage({
      setup: it.setup,
      view: isRotation ? "trans" : "plan",
      size: 140,
      sch: "wrgyob",
    });
    imgEl.alt = `${it.name} state`;
    imgEl.loading = "lazy";
    imgEl.decoding = "async";
    img.appendChild(imgEl);
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

  // Footer stats — drillable categories always render the same three
  // columns (best / reps / recog) so card layouts line up vertically
  // whether or not a case has been practiced. Missing values render as
  // em-dashes via stats.fmtTime / a "—" literal for recog.
  const footer = document.createElement("div");
  if (cat.drillable) {
    footer.className = "alg-stats";
    const drillStats = stats.getDrill(selCat, it.id);
    const recogStats = stats.getRecog(selCat, it.id);
    if (!drillStats && !recogStats) footer.classList.add("empty");
    const bestText = drillStats?.best != null ? stats.fmtTime(drillStats.best) : "—";
    const repsText = drillStats?.n ?? 0;
    const recogText = recogStats ? stats.fmtAccuracy(recogStats) : "—";
    footer.innerHTML =
      `<span>best <strong>${escapeHtml(bestText)}</strong></span>` +
      `<span>reps <strong>${escapeHtml(String(repsText))}</strong></span>` +
      `<span>recog <strong>${escapeHtml(recogText)}</strong></span>`;
  } else {
    footer.className = "alg-stats empty";
    footer.innerHTML = `<span>${escapeHtml(cat.label.toLowerCase())}</span>`;
  }
  card.appendChild(footer);

  // Browse cards are reference-only — selection happens on the Practice
  // page. Algorithm notation is freely text-selectable for copying.
  const note = card.querySelector(".alg-notation");
  if (note) note.style.userSelect = "text";
  return card;
}

function matchesFilters(it, cat) {
  for (const [facetKey, set] of Object.entries(browseState.filters)) {
    const facet = cat.filterFacets.find((f) => f.key === facetKey);
    if (!facet) continue;
    const v = facet.from(it);
    if (Array.isArray(v)) {
      // Multi-tag facet: case matches if ANY of its tags is in the selected set.
      let any = false;
      for (const t of v) { if (set.has(t)) { any = true; break; } }
      if (!any) return false;
    } else {
      if (!set.has(v)) return false;
    }
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

  /* Header (Clear selection moved into the stage CTAs next to Start) */
  const head = document.createElement("div");
  head.className = "page-head";
  head.innerHTML = `
    <div>
      <h1 class="page-title">Practice</h1>
    </div>`;

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
      btn.addEventListener("click", () => showToast("Fingertricks: coming soon"));
    }
    submodeRow.appendChild(btn);
  }

  /* Single full-width stage. Top row: compact summary + CTA. Body: the
   * dominant content for this submode (Quick Start grid, weak preview,
   * selected cases preview, etc.) filling the remaining height. */
  const stage = document.createElement("div");
  stage.className = "practice-stage-v2";
  stage.append(...practiceStageContent(practiceState.submode, { selectedKeys, pllCount, ollCount, totalSel }));

  root.replaceChildren(head, submodeRow, stage);
}

function practiceStageContent(submode, ctx) {
  const out = [];

  // Top bar: label + count + CTAs, single horizontal row.
  const topBar = document.createElement("div");
  topBar.className = "stage-top";

  const meta = document.createElement("div");
  meta.className = "stage-meta";

  const ctas = document.createElement("div");
  ctas.className = "stage-ctas";

  // Builder for the inline Clear-selection chip — sits in the stage-top
  // CTAs next to Start, not buried in the picker action row. Disabled when
  // selection is empty.
  const buildClear = () => {
    const c = btn("btn", "Clear selection");
    c.disabled = selection.size() === 0;
    c.addEventListener("click", () => selection.clear());
    return c;
  };

  if (submode === "drill") {
    meta.innerHTML = `
      <span class="stage-label">Drill</span>
      <span class="stage-count"><b>${ctx.totalSel}</b> case${ctx.totalSel === 1 ? "" : "s"} selected${ctx.totalSel ? ` (${ctx.pllCount} PLL, ${ctx.ollCount} OLL)` : ""}</span>`;
    const start = btn("btn btn-primary btn-lg", "Start drill →");
    start.disabled = ctx.totalSel === 0;
    start.addEventListener("click", () => openDrill());
    ctas.append(buildClear(), start);
  } else if (submode === "weak") {
    const weak = rankWeakCases(["pll", "oll"], 20);
    const dueCount = weak.filter((c) => c.isDue).length;
    const newCount = weak.filter((c) => c.isUnpracticed && !c.isDue).length;
    meta.innerHTML = `
      <span class="stage-label">Today's drill</span>
      <span class="stage-count"><b>${dueCount}</b> due, <b>${newCount}</b> never drilled</span>`;
    const start = btn("btn btn-primary btn-lg", "Open today's drill →");
    start.addEventListener("click", () => openWeakCases());
    ctas.append(start);
  } else if (submode === "recognition") {
    meta.innerHTML = `
      <span class="stage-label">Recognition</span>
      <span class="stage-count"><b>${ctx.totalSel}</b> case${ctx.totalSel === 1 ? "" : "s"} selected</span>`;
    const start = btn("btn btn-primary btn-lg", "Start recognition →");
    start.disabled = ctx.totalSel === 0;
    start.addEventListener("click", () => openRecognition());
    ctas.append(buildClear(), start);
  } else if (submode === "batch") {
    meta.innerHTML = `
      <span class="stage-label">Batch (5)</span>
      <span class="stage-count"><b>${ctx.pllCount}</b> PLL selected${ctx.pllCount && ctx.pllCount < 5 ? " — pick 5+ for variety" : ""}</span>`;
    const start = btn("btn btn-primary btn-lg", "Start batch →");
    start.disabled = ctx.pllCount === 0;
    start.addEventListener("click", () => openBatch());
    ctas.append(buildClear(), start);
  }
  topBar.append(meta, ctas);
  out.push(topBar);

  // Body: either a picker (drill / recognition / batch) or the weak
  // preview (today's drill). The picker REPLACES the old Browse
  // selection toolbar — case selection happens inline here.
  if (submode === "weak") {
    const body = document.createElement("div");
    body.className = "stage-body";
    body.appendChild(renderWeakPreviewGrid());
    out.push(body);
  } else {
    out.push(...renderPracticePicker(submode));
  }

  return out;
}

/* Inline case picker on the Practice page. Replaces the old Browse
 * selection toolbar. Renders: category chips, facet chips, action row
 * (Select all in view / Clear / count), and a clickable case grid. */
function renderPracticePicker(submode) {
  // Batch only supports PLL — restrict the category chips accordingly so
  // the user doesn't waste effort selecting OLLs that batch would ignore.
  const allowedKeys = submode === "batch"
    ? PICKER_CATEGORY_KEYS.filter((k) => k.startsWith("pll"))
    : PICKER_CATEGORY_KEYS;
  if (!allowedKeys.includes(practicePickerState.category)) {
    practicePickerState.category = allowedKeys[0];
    practicePickerState.filters = {};
  }
  const cat = categoryByKey(practicePickerState.category);
  const allItems = cat.getItems(appState.data);
  const visible = allItems.filter((it) => matchesPickerFilters(it, cat));
  const selCat = cat.selectionCategory || cat.key;

  // -- Category chip row --
  const catRow = document.createElement("div");
  catRow.className = "picker-cat-row";
  for (const k of allowedKeys) {
    const c = categoryByKey(k);
    const chip = document.createElement("button");
    chip.className = "chip" + (k === practicePickerState.category ? " accent" : "");
    chip.textContent = c.shortLabel || c.label;
    chip.addEventListener("click", () => {
      practicePickerState.category = k;
      practicePickerState.filters = {};
      renderPractice();
    });
    catRow.appendChild(chip);
  }

  // -- Facet chip row --
  const facetRow = renderPickerFacetRow(cat, allItems);

  // -- Action row: select-all / clear / count --
  const actionsRow = document.createElement("div");
  actionsRow.className = "picker-actions-row";
  const selectedHere = visible.filter((it) => selection.isSelected(selCat, it.id)).length;
  const allHere = visible.length;
  const allSelectedHere = allHere > 0 && selectedHere === allHere;

  const selAll = btn("btn btn-small", allSelectedHere ? "Deselect all in view" : "Select all in view");
  selAll.disabled = allHere === 0;
  selAll.addEventListener("click", () => {
    if (allSelectedHere) selection.deselectMany(selCat, visible);
    else selection.selectMany(selCat, visible);
  });

  // Clear selection lives in stage-top next to Start now; this row stays
  // focused on per-view bulk select + the running count.
  const counter = document.createElement("span");
  counter.className = "picker-counter";
  counter.textContent = `${selectedHere}/${allHere} in view, ${selection.size()} total`;

  actionsRow.append(selAll, counter);

  // -- Picker grid --
  const grid = document.createElement("div");
  grid.className = "picker-grid";
  if (visible.length === 0) {
    grid.classList.add("empty");
    grid.innerHTML = `<div class="stage-empty">No cases match the current filter.</div>`;
  } else {
    for (const it of visible) {
      grid.appendChild(renderPickerCard(it, cat, selCat));
    }
  }

  return [catRow, facetRow, actionsRow, grid].filter(Boolean);
}

function renderPickerCard(it, cat, selCat) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "picker-card";
  if (selection.isSelected(selCat, it.id)) card.classList.add("selected");
  const drill = stats.getDrill(selCat, it.id);
  const best = drill?.best != null ? stats.fmtTime(drill.best) : "—";
  card.innerHTML = `
    <div class="picker-face">
      <img src="${escapeHtml(cat.imageUrl(it))}" alt="${escapeHtml(cat.titleOf(it))}" loading="lazy" />
    </div>
    <div class="picker-meta">
      <div class="picker-cat">${cat.label.replace("(advanced)","").replace("(beginner)","").trim().toUpperCase()}</div>
      <div class="picker-name">${escapeHtml(cat.titleOf(it))}</div>
      <div class="picker-best">best <strong>${escapeHtml(best)}</strong></div>
    </div>`;
  card.addEventListener("click", () => selection.toggle(selCat, it.id));
  return card;
}

/* Picker uses its own filter map (practicePickerState.filters) so it
 * doesn't fight with the Browse page state. Same OR-within-facet
 * semantics as the Browse filter. */
function matchesPickerFilters(it, cat) {
  for (const [facetKey, set] of Object.entries(practicePickerState.filters)) {
    const facet = cat.filterFacets.find((f) => f.key === facetKey);
    if (!facet) continue;
    const v = facet.from(it);
    if (Array.isArray(v)) {
      let any = false;
      for (const t of v) { if (set.has(t)) { any = true; break; } }
      if (!any) return false;
    } else {
      if (!set.has(v)) return false;
    }
  }
  return true;
}

function renderPickerFacetRow(cat, items) {
  if (!cat.filterFacets || cat.filterFacets.length === 0) return null;
  const wrap = document.createElement("div");
  wrap.className = "picker-facet-row";
  let any = false;
  for (const facet of cat.filterFacets) {
    let chipDefs;
    if (Array.isArray(facet.values)) {
      chipDefs = facet.values.map((x) => ({ value: x.v, label: x.label || x.v }));
    } else {
      const observed = uniqueSorted(items.flatMap((it) => {
        const v = facet.from(it);
        return Array.isArray(v) ? v : [v];
      }).filter(Boolean));
      chipDefs = observed.map((v) => ({ value: v, label: v }));
    }
    if (chipDefs.length === 0) continue;
    any = true;
    const label = document.createElement("span");
    label.className = "facet-label";
    label.textContent = facet.label;
    wrap.appendChild(label);
    for (const def of chipDefs) {
      const v = def.value;
      const chip = document.createElement("button");
      chip.className = "chip facet" + ((practicePickerState.filters[facet.key]?.has(v)) ? " active" : "");
      chip.textContent = def.label;
      chip.addEventListener("click", () => {
        const set = practicePickerState.filters[facet.key] || new Set();
        if (set.has(v)) set.delete(v); else set.add(v);
        if (set.size === 0) delete practicePickerState.filters[facet.key];
        else practicePickerState.filters[facet.key] = set;
        renderPractice();
      });
      wrap.appendChild(chip);
    }
  }
  return any ? wrap : null;
}

/* Weak-cases preview for the Today's drill submode. */
function renderWeakPreviewGrid() {
  const weak = rankWeakCases(["pll", "oll"], 12, { milestoneAware: true });
  if (!weak.length) {
    const empty = document.createElement("div");
    empty.className = "stage-empty";
    empty.textContent = "No drill history yet — practice a few cases and we'll surface the weakest ones here.";
    return empty;
  }
  const wrap = document.createElement("div");
  wrap.className = "picker-grid";
  for (const c of weak) {
    const card = document.createElement("div");
    card.className = "picker-card";
    const tag = c.isDue ? "due" : c.isUnpracticed ? "new" : (c.best != null ? stats.fmtTime(c.best) : "—");
    card.innerHTML = `
      <div class="picker-face">
        <img src="${escapeHtml(vcImageFor(c, 64))}" alt="${escapeHtml(c.item.name)}" loading="lazy" />
      </div>
      <div class="picker-meta">
        <div class="picker-cat">${c.category.toUpperCase()}</div>
        <div class="picker-name">${escapeHtml(c.item.name)}</div>
        <div class="picker-best">${escapeHtml(tag)}</div>
      </div>`;
    wrap.appendChild(card);
  }
  return wrap;
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
    sm.addEventListener("click", () => showToast(`${sm.textContent.trim()}: coming soon`));
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

    ${total === 0 ? `
      <div class="stats-empty" style="margin-top: var(--s-6);">
        <strong>Stats fill in as you practice</strong>
        Open the <a id="stats-go-timer">Timer</a> to start logging solves, or head to
        <a id="stats-go-browse2">Browse</a> to drill a few cases.
        Spaced-repetition kicks in after your first drill.
      </div>` : ""}`;

  // Draw the chart (best-of-rolling-ao5 over time)
  const chartHost = body.querySelector("#stats-chart");
  drawTrendChart(chartHost, filtered);

  // Heatmap of solves per (week, day-of-week) for last 14 weeks
  const heatmapHost = body.querySelector("#stats-heatmap");
  drawHeatmap(heatmapHost, allSolves);

  // Mastery grid + WCA ribbon were removed from the stats page — the
  // orientation hint now lives as a small badge on individual cube
  // previews where it's actually useful (see .cube-orient-badge).
  const goTimer = body.querySelector("#stats-go-timer");
  if (goTimer) goTimer.addEventListener("click", () => setActivePage("timer"));
  const goBrowse2 = body.querySelector("#stats-go-browse2");
  if (goBrowse2) goBrowse2.addEventListener("click", () => setActivePage("browse"));

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
      cells.push(`<div class="heatmap-cell ${cls}" title="${d.toDateString()} — ${c} solve${c === 1 ? "" : "s"}"></div>`);
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
    <div class="mastery-cell" title="${escapeHtml(c.item.name)} — ${c.n} reps">
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
            <div class="settings-label">${user ? `Hi, ${escapeHtml(displayNameFor(user))}` : "Sign in / create account"}</div>
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
  const showPreview = getShowCubePreview();
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
      <div class="settings-row">
        <div>
          <div class="settings-label">Show cube preview on Timer</div>
          <div class="settings-desc">Renders a small cube of the scrambled state in the timer's top-right corner. Hides automatically during a solve.</div>
        </div>
        <div class="toggle ${showPreview ? "on" : ""}" id="set-show-preview"></div>
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
  prefCol.querySelector("#set-show-preview").addEventListener("click", () => {
    setShowCubePreview(!getShowCubePreview());
    renderSettings();
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
          <div class="settings-desc">${allSolves} timer solve${allSolves === 1 ? "" : "s"}, ${allDrills} drilled case${allDrills === 1 ? "" : "s"}</div>
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

  /* About footer — trimmed to the two cells that actually carry useful
   * info (account status + GitHub link). The previous "App / Tip" cells
   * were noise; without them the columns also get to breathe wider so the
   * about row fills the page width instead of leaving a fat right margin. */
  const about = document.createElement("div");
  about.className = "settings-about settings-about-slim";
  about.innerHTML = `
    <div class="settings-about-cell">
      <span class="settings-about-label">Account</span>
      <span class="settings-about-value">${user ? "Signed in & synced" : cloudConfigured ? "Local only" : "No cloud configured"}</span>
    </div>
    <div class="settings-about-cell">
      <span class="settings-about-label">Links</span>
      <div class="settings-about-links">
        <a href="https://github.com/sawmint/rubiks-storage" target="_blank" rel="noopener">GitHub</a>
      </div>
    </div>`;

  body.append(shell, about);
  root.replaceChildren(head, body);
}

/* ============================================================ */
/* Helpers                                                        */
/* ============================================================ */

/* Turn a Supabase user object into a friendly short display name.
 * Tries (in order): user_metadata.full_name → user_metadata.name → first
 * name parsed out of the email local-part → "Account" fallback. Names get
 * title-cased so "arjun.singhal" reads as "Arjun" and "nitin_s" as "Nitin". */
export function displayNameFor(user) {
  if (!user) return "Account";
  const meta = user.user_metadata || {};
  const named = meta.full_name || meta.name || meta.given_name;
  if (typeof named === "string" && named.trim()) {
    return titleCase(named.trim().split(/\s+/)[0]);
  }
  const email = user.email || "";
  const local = email.split("@")[0] || "";
  if (!local) return "Account";
  // Split on the common separators in email local-parts and take the first
  // chunk — "arjun.singhal" → "Arjun", "nitin_s" → "Nitin".
  const first = local.split(/[.\-_+]/)[0] || local;
  return titleCase(first);
}

function titleCase(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export function showToast(label, kind = "info") {
  const existing = document.querySelector(".soon-toast");
  if (existing) existing.remove();
  const t = document.createElement("div");
  t.className = "soon-toast" + (kind === "error" ? " error" : "");
  t.textContent = label;
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
