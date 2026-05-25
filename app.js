/* =========================================================
 * Rubik's Storage — front-end
 *
 * Architecture:
 *   1. Load JSON dataset.
 *   2. Define a CATEGORIES table — each entry describes how to
 *      render and filter that category. Adding a new category
 *      later (e.g. ZBLL, COLL, OH algs) means appending one row.
 *   3. A single render() function dispatches off state.category.
 *   4. Cards are built from a small renderCard() helper that
 *      composes field components (badges, alg block, meta, etc.)
 *
 * Extension hooks:
 *   - CATEGORIES[].extraBadges(item)  → array of {label, className}
 *   - CATEGORIES[].metaRows(item)     → array of {label, value}
 *   - CATEGORIES[].filterFacets       → which fields drive chips
 *   - Future: add a per-card "actions" hook for buttons like
 *     "animate on cube", "practice timer", "add to favorites".
 * ========================================================= */

import * as selection from "./selection.js";
import * as stats from "./stats.js";
import { renderHtml as colorizeAlg } from "./alg-color.js";

const DATA_URL = "rubiks-cube-algorithms.json";
const VISUALCUBE_BASE = "https://visualcube.api.cubing.net/visualcube.php";

const state = {
  data: null,
  category: "pll",
  search: "",
  filters: {},        // { facetKey: Set<string> }
};

/* Build a VisualCube image URL.
 * Pass `setup` (preferred) for forward-application to a solved cube;
 * pass `caseAlg` to apply the inverse (legacy — used by F2L which has no
 * pre-computed setup). Setup-based URLs render correctly even for cases
 * whose solving algorithm contains rotations. */
export function vcImage({ setup, caseAlg, stage, view, size = 140, sch }) {
  const params = new URLSearchParams({
    fmt: "svg",
    size: String(size),
    bg: "t",
  });
  if (setup)   params.set("alg",  setup);
  if (caseAlg) params.set("case", caseAlg);
  if (stage)   params.set("stage", stage);
  if (view)    params.set("view", view);
  if (sch)     params.set("sch",  sch);
  return `${VISUALCUBE_BASE}?${params.toString()}`;
}

/* ---------- notation reference data ----------
 * Static dataset used by the Notation tab. Each entry is shaped like a
 * regular algorithm item (id/name/algorithm/setup) so the existing card
 * renderer works as-is — the only difference is `drillable: false` on
 * the category. The `algorithm` field flows through `algRow()` so the
 * letter renders with the same colorizer used everywhere else (R is
 * orange, x is red, etc.). The `setup` field drives the VisualCube
 * preview, which shows the cube state AFTER applying the move from
 * solved (WCA scheme so colors land in their conventional positions).
 */
const NOTATION_DATA = [
  // ----- Face turns -----
  { id: "R", name: "Right", algorithm: "R", setup: "R", category: "Face turn",
    description: "Turn the right face 90° clockwise (looking at the right side)." },
  { id: "L", name: "Left", algorithm: "L", setup: "L", category: "Face turn",
    description: "Turn the left face 90° clockwise (looking at the left side)." },
  { id: "U", name: "Up", algorithm: "U", setup: "U", category: "Face turn",
    description: "Turn the top face 90° clockwise (looking down at it)." },
  { id: "D", name: "Down", algorithm: "D", setup: "D", category: "Face turn",
    description: "Turn the bottom face 90° clockwise (looking up at it)." },
  { id: "F", name: "Front", algorithm: "F", setup: "F", category: "Face turn",
    description: "Turn the front face 90° clockwise." },
  { id: "B", name: "Back", algorithm: "B", setup: "B", category: "Face turn",
    description: "Turn the back face 90° clockwise (looking from behind)." },

  // ----- Wide moves (two layers) -----
  { id: "Rw", name: "Right wide (r)", algorithm: "Rw", setup: "Rw", category: "Wide",
    description: "Turn the right TWO layers in the R direction. Often written lowercase as r." },
  { id: "Lw", name: "Left wide (l)", algorithm: "Lw", setup: "Lw", category: "Wide",
    description: "Turn the left TWO layers in the L direction. Often written as l." },
  { id: "Uw", name: "Up wide (u)", algorithm: "Uw", setup: "Uw", category: "Wide",
    description: "Turn the top TWO layers in the U direction. Often written as u." },
  { id: "Dw", name: "Down wide (d)", algorithm: "Dw", setup: "Dw", category: "Wide",
    description: "Turn the bottom TWO layers in the D direction. Often written as d." },
  { id: "Fw", name: "Front wide (f)", algorithm: "Fw", setup: "Fw", category: "Wide",
    description: "Turn the front TWO layers in the F direction. Often written as f." },
  { id: "Bw", name: "Back wide (b)", algorithm: "Bw", setup: "Bw", category: "Wide",
    description: "Turn the back TWO layers in the B direction. Often written as b." },

  // ----- Slice moves (middle layer only) -----
  { id: "M", name: "Middle slice", algorithm: "M", setup: "M", category: "Slice",
    description: "Turn the middle slice (between L and R) in the L direction." },
  { id: "E", name: "Equatorial slice", algorithm: "E", setup: "E", category: "Slice",
    description: "Turn the equator slice (between U and D) in the D direction." },
  { id: "S", name: "Standing slice", algorithm: "S", setup: "S", category: "Slice",
    description: "Turn the standing slice (between F and B) in the F direction." },

  // ----- Cube rotations (whole cube, no permutation change) -----
  { id: "x", name: "x rotation", algorithm: "x", setup: "x", category: "Rotation",
    description: "Rotate the entire cube around the L-R axis, in the R direction." },
  { id: "y", name: "y rotation", algorithm: "y", setup: "y", category: "Rotation",
    description: "Rotate the entire cube around the U-D axis, in the U direction." },
  { id: "z", name: "z rotation", algorithm: "z", setup: "z", category: "Rotation",
    description: "Rotate the entire cube around the F-B axis, in the F direction." },

  // ----- Modifiers (shown via example) -----
  { id: "prime", name: "Apostrophe ( ' )", algorithm: "R'", setup: "R'", category: "Modifier",
    description: "Inverts the move (counter-clockwise / opposite direction). Example: R' is the inverse of R." },
  { id: "double", name: "Double ( 2 )", algorithm: "R2", setup: "R2", category: "Modifier",
    description: "Half turn (180°). Same end result regardless of direction. Example: R2 = R + R." },
];

/* ---------- category configuration ---------- */

const CATEGORIES = [
  {
    key: "notation",
    label: "Notation",
    accent: "var(--cat-notation)",
    getItems: () => NOTATION_DATA,
    titleOf: (it) => it.name,
    idOf: (it) => it.algorithm,
    searchFields: ["id", "name", "category", "description", "algorithm"],
    filterFacets: [
      { key: "category", label: "Category", from: (it) => it.category },
    ],
    extraBadges: (it) => [{ label: it.category, className: "badge" }],
    metaRows: (it) => [{ label: "Description", value: it.description }],
    imageUrl: (it) => vcImage({ setup: it.setup, view: "trans", size: 140, sch: "wrgyob" }),
    drillable: false,
  },
  {
    key: "pll",
    label: "PLL",
    accent: "var(--cat-pll)",
    getItems: (d) => d.pll,
    titleOf: (it) => it.name,
    idOf: (it) => it.id,
    searchFields: ["id", "name", "group", "algorithm", "recognition"],
    filterFacets: [
      { key: "group", label: "Group", from: (it) => it.group },
    ],
    extraBadges: (it) => [
      it.group   && { label: it.group,            className: "badge" },
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
    accent: "var(--cat-oll)",
    getItems: (d) => d.oll,
    titleOf: (it) => it.name,
    idOf: (it) => "#" + it.id,
    searchFields: ["id", "name", "shape", "algorithm", "recognition"],
    filterFacets: [
      { key: "shape", label: "Shape", from: (it) => it.shape },
    ],
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
    accent: "var(--cat-f2l-adv)",
    getItems: (d) => d.f2l.advanced,
    titleOf: (it) => "Case " + it.id + ": " + (it.trigger || "f2l"),
    idOf: (it) => "#" + it.id,
    searchFields: ["id", "slot", "corner_state", "edge_state", "algorithm", "trigger"],
    filterFacets: [
      { key: "trigger", label: "Trigger", from: (it) => it.trigger },
    ],
    extraBadges: (it) => [
      it.slot    && { label: "slot " + it.slot, className: "badge" },
      it.trigger && { label: it.trigger,        className: "badge" },
    ].filter(Boolean),
    metaRows: (it) => [
      it.corner_state && { label: "Corner", value: it.corner_state },
      it.edge_state   && { label: "Edge",   value: it.edge_state },
    ].filter(Boolean),
    imageUrl: (it) => vcImage({ caseAlg: it.algorithm, stage: "f2l", size: 160 }),
    drillable: false,
  },
  {
    key: "f2l_beg",
    label: "F2L (beginner)",
    shortLabel: "F2L−",
    accent: "var(--cat-f2l-beg)",
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
    imageUrl: (it) => vcImage({ caseAlg: it.algorithm, stage: "f2l", size: 160 }),
    drillable: false,
  },
];

export const categoryByKey = (key) => CATEGORIES.find((c) => c.key === key);
export { CATEGORIES, state };

/* ---------- bootstrap ---------- */

async function init() {
  try {
    const resp = await fetch(DATA_URL);
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    state.data = await resp.json();
  } catch (err) {
    document.getElementById("grid").innerHTML =
      `<div class="empty">Could not load <code>${DATA_URL}</code>: ${escapeHtml(err.message)}.<br>` +
      `Serve this folder over HTTP (e.g. <code>python3 -m http.server</code>). Opening index.html directly via file:// will not work.</div>`;
    return;
  }

  renderTabs();
  bindSearch();
  applyStoredTheme();
  bindSelectionToolbar();
  bindSettings();
  bindOpenTimer();
  selection.subscribe(updateSelectionUI);
  // Re-render cards when stats change so the badges stay fresh
  stats.subscribe(() => render());
  selectCategory(state.category);
}

function bindSettings() {
  const btn = document.getElementById("open-settings");
  if (!btn) return;
  btn.addEventListener("click", () => toggleSettingsPopover(btn));
}

function toggleSettingsPopover(anchor) {
  const existing = document.querySelector(".header-settings-pop");
  if (existing) { existing.remove(); return; }

  const pop = document.createElement("div");
  pop.className = "header-settings-pop";

  // Dark mode toggle
  const themeRow = document.createElement("label");
  themeRow.className = "header-settings-row";
  const themeCb = document.createElement("input");
  themeCb.type = "checkbox";
  themeCb.checked = document.documentElement.getAttribute("data-theme") === "dark";
  themeCb.addEventListener("change", () => {
    const next = themeCb.checked ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("rs-theme", next);
  });
  themeRow.append(themeCb, document.createTextNode(" Dark mode"));
  pop.appendChild(themeRow);

  // Divider
  const hr = document.createElement("hr");
  hr.className = "header-settings-divider";
  pop.appendChild(hr);

  // Reset stats action
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "header-settings-action header-settings-danger";
  resetBtn.textContent = "Reset drill + recognition stats";
  resetBtn.addEventListener("click", () => {
    if (confirm("Reset all drill + recognition stats? This cannot be undone.")) {
      stats.resetAll();
      pop.remove();
    }
  });
  pop.appendChild(resetBtn);

  // Click outside to close
  const onDocClick = (e) => {
    if (!pop.contains(e.target) && e.target !== anchor) {
      pop.remove();
      document.removeEventListener("click", onDocClick);
    }
  };
  setTimeout(() => document.addEventListener("click", onDocClick), 0);

  anchor.insertAdjacentElement("afterend", pop);
}

function applyStoredTheme() {
  const stored = localStorage.getItem("rs-theme");
  if (stored) document.documentElement.setAttribute("data-theme", stored);
}

function bindOpenTimer() {
  document.getElementById("open-timer")?.addEventListener("click", async () => {
    const mod = await import("./timer.js");
    mod.openTimer();
  });
  document.getElementById("open-weak-cases")?.addEventListener("click", async () => {
    const mod = await import("./weak-cases.js");
    mod.start(state.data);
  });
}

/* ---------- selection toolbar ---------- */

function bindSelectionToolbar() {
  document.getElementById("select-all")?.addEventListener("click", () => {
    const cat = categoryByKey(state.category);
    const items = cat.getItems(state.data).filter((it) => matchesFilters(it, cat));
    selection.selectMany(cat.key, items);
  });
  document.getElementById("clear-selection")?.addEventListener("click", () => {
    selection.clear();
  });
  document.getElementById("drill-selected")?.addEventListener("click", async () => {
    const mod = await import("./drill.js");
    mod.start(state.data, selection.allKeys());
  });
  document.getElementById("batch-selected")?.addEventListener("click", async () => {
    const mod = await import("./batch.js");
    mod.start(state.data, selection.allKeys());
  });
  document.getElementById("recog-selected")?.addEventListener("click", async () => {
    const mod = await import("./recognition.js");
    mod.start(state.data, selection.allKeys());
  });
}

function updateSelectionUI() {
  const cat = categoryByKey(state.category);
  const count = selection.size();
  const counter = document.getElementById("selection-count");
  if (counter) counter.textContent = count === 0 ? "" : `${count} selected`;
  // Update card checkboxes that are currently rendered
  for (const cb of document.querySelectorAll(".card-checkbox")) {
    const k = cb.dataset.key;
    if (k) cb.checked = selection.allKeys().includes(k);
  }
  // Enable/disable selection-driven action buttons
  for (const id of ["drill-selected", "batch-selected", "recog-selected", "clear-selection"]) {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = count === 0;
  }
  // Selection toolbar always shows Timer; hide the selection-specific
  // controls (drill, recognition, select-all, etc.) when category isn't drillable.
  for (const el of document.querySelectorAll(".selection-only")) {
    el.classList.toggle("hidden", !cat.drillable);
  }
  const divider = document.getElementById("selection-divider");
  if (divider) divider.classList.toggle("hidden", !cat.drillable);
}


/* ---------- tabs ---------- */

function renderTabs() {
  const host = document.getElementById("tabs");
  host.innerHTML = "";
  for (const cat of CATEGORIES) {
    const btn = document.createElement("button");
    btn.className = "tab";
    btn.type = "button";
    btn.setAttribute("role", "tab");
    btn.dataset.cat = cat.key;
    btn.style.setProperty("--tab-accent", cat.accent);
    const count = cat.getItems(state.data).length;
    const shortLabel = cat.shortLabel || cat.label;
    btn.innerHTML = `<span class="tab-label-full">${escapeHtml(cat.label)}</span><span class="tab-label-short">${escapeHtml(shortLabel)}</span><span class="tab-count">${count}</span>`;
    btn.addEventListener("click", () => selectCategory(cat.key));
    host.appendChild(btn);
  }
}

function selectCategory(key) {
  state.category = key;
  state.filters = {};
  for (const tab of document.querySelectorAll(".tab")) {
    tab.classList.toggle("active", tab.dataset.cat === key);
  }
  renderFilters();
  render();
  updateSelectionUI();
}

/* ---------- search ---------- */

function bindSearch() {
  const input = document.getElementById("search");
  input.addEventListener("input", () => {
    state.search = input.value.trim().toLowerCase();
    render();
  });
}

/* ---------- filters ---------- */

function renderFilters() {
  const cat = categoryByKey(state.category);
  const host = document.getElementById("filters");
  host.innerHTML = "";

  const items = cat.getItems(state.data);
  for (const facet of cat.filterFacets) {
    const values = uniqueSorted(items.map(facet.from).filter(Boolean));
    if (values.length === 0) continue;

    const group = document.createElement("div");
    group.className = "filter-group";
    group.style.display = "flex";
    group.style.gap = "4px";
    group.style.flexWrap = "wrap";

    for (const value of values) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = value;
      chip.dataset.facet = facet.key;
      chip.dataset.value = value;
      chip.addEventListener("click", () => toggleFilter(facet.key, value));
      group.appendChild(chip);
    }
    host.appendChild(group);
  }
}

function toggleFilter(facetKey, value) {
  const set = state.filters[facetKey] || new Set();
  if (set.has(value)) set.delete(value); else set.add(value);
  if (set.size === 0) delete state.filters[facetKey];
  else state.filters[facetKey] = set;

  for (const chip of document.querySelectorAll(".chip")) {
    if (chip.dataset.facet === facetKey && chip.dataset.value === value) {
      chip.classList.toggle("active", set.has(value));
    }
  }
  render();
}

/* ---------- main render ---------- */

function render() {
  const cat = categoryByKey(state.category);
  const grid = document.getElementById("grid");
  const empty = document.getElementById("empty");
  const stats = document.getElementById("stats");

  const items = cat.getItems(state.data).filter((it) => matchesFilters(it, cat));

  grid.innerHTML = "";
  for (const it of items) grid.appendChild(renderCard(it, cat));

  empty.classList.toggle("hidden", items.length > 0);
  const total = cat.getItems(state.data).length;
  stats.textContent = items.length === total
    ? `${total} ${cat.label.toLowerCase()}`
    : `${items.length} / ${total} ${cat.label.toLowerCase()}`;

  // Auto-load all visible case images. Concurrency-capped inside loadAllImages
  // so VisualCube isn't flooded; the SW caches each response so subsequent
  // renders (e.g. filter changes) hit the cache.
  loadAllImages();
}

function matchesFilters(it, cat) {
  // facet filters
  for (const [facetKey, set] of Object.entries(state.filters)) {
    const facet = cat.filterFacets.find((f) => f.key === facetKey);
    if (!facet) continue;
    const v = facet.from(it);
    if (!set.has(v)) return false;
  }
  // search
  if (state.search) {
    const haystack = cat.searchFields
      .map((k) => (it[k] != null ? String(it[k]) : ""))
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(state.search)) return false;
  }
  return true;
}

/* ---------- card rendering ---------- */

function renderCard(it, cat) {
  const card = document.createElement("article");
  card.className = "card";
  card.setAttribute("role", "listitem");
  card.style.setProperty("--card-accent", cat.accent);

  // head
  const head = document.createElement("div");
  head.className = "card-head";

  // Selection checkbox (only for drillable categories) — first in the head row
  if (cat.drillable) {
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "card-checkbox";
    cb.dataset.key = selection.key(cat.key, it.id);
    cb.checked = selection.isSelected(cat.key, it.id);
    cb.setAttribute("aria-label", `Select ${cat.titleOf(it)}`);
    cb.addEventListener("change", () => selection.toggle(cat.key, it.id));
    cb.addEventListener("click", (e) => e.stopPropagation());
    head.appendChild(cb);
  }

  const title = document.createElement("h2");
  title.className = "card-title";
  title.textContent = cat.titleOf(it);
  head.appendChild(title);
  const idBadge = document.createElement("span");
  idBadge.className = "card-id";
  idBadge.textContent = cat.idOf(it);
  head.appendChild(idBadge);
  card.appendChild(head);

  // badges row
  const badges = document.createElement("div");
  badges.className = "badges";
  for (const b of cat.extraBadges(it) || []) {
    badges.appendChild(badge(b.label, b.className));
  }
  if (badges.children.length) card.appendChild(badges);

  // case image (VisualCube) — click-to-load to avoid flooding the API
  if (cat.imageUrl && it.algorithm) {
    card.appendChild(imageSlot(cat.imageUrl(it), cat.titleOf(it)));
  }

  // primary algorithm
  if (it.algorithm) {
    card.appendChild(algRow(it.algorithm));
  }

  // meta rows. On portrait mobile the meta text gets line-clamped to 2
  // lines (CSS), but we'd rather not silently truncate — so each meta gets
  // a "more"/"collapse" toggle that only renders when overflow is real
  // (detected post-layout via scrollHeight > clientHeight). The full text
  // also lives in the title attribute as a backup for tap-and-hold.
  for (const m of cat.metaRows(it) || []) {
    card.appendChild(metaRowWithToggle(m));
  }

  // stats badge (drillable categories only)
  if (cat.drillable) {
    const drill = stats.getDrill(cat.key, it.id);
    const recog = stats.getRecog(cat.key, it.id);
    if (drill || recog) {
      const row = document.createElement("div");
      row.className = "card-stats";
      const parts = [];
      if (drill) parts.push(`<span title="Best drill time of ${drill.n} attempts">⏱ ${stats.fmtTime(drill.best)}</span>`);
      if (recog) parts.push(`<span title="Recognition accuracy over ${recog.n} attempts">🎯 ${stats.fmtAccuracy(recog)}</span>`);
      const resetBtn = `<button class="card-stats-reset" type="button" title="Reset stats for this case" data-key="${selection.key(cat.key, it.id)}">↺</button>`;
      row.innerHTML = parts.join(" · ") + " " + resetBtn;
      const resetEl = row.querySelector(".card-stats-reset");
      resetEl.addEventListener("click", (e) => {
        e.stopPropagation();
        stats.resetCase(cat.key, it.id);
      });
      card.appendChild(row);
    }
  }

  /* extension hook: future per-card actions could be appended here,
     e.g. a row of buttons for "animate", "drill", "favorite". */

  return card;
}

/* Build an image slot that loads on user click (or programmatically).
   Avoids flooding VisualCube with 50+ parallel requests on tab open. */
function imageSlot(src, label) {
  const wrap = document.createElement("div");
  wrap.className = "card-img-wrap empty";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "load-img-btn";
  btn.textContent = "Show case image";
  btn.dataset.src = src;
  btn.dataset.label = label;

  btn.addEventListener("click", () => loadImage(wrap, btn));
  wrap.appendChild(btn);
  return wrap;
}

function loadImage(wrap, btn) {
  const src = btn.dataset.src;
  const label = btn.dataset.label;
  btn.disabled = true;
  btn.textContent = "Loading…";

  const img = new Image();
  img.className = "card-img";
  img.alt = `${label} case state`;
  img.decoding = "async";
  img.addEventListener("load", () => {
    wrap.classList.remove("empty", "img-failed");
    wrap.classList.add("loaded");
    wrap.replaceChildren(img);
  });
  img.addEventListener("error", () => {
    wrap.classList.add("img-failed");
    btn.disabled = false;
    btn.textContent = "Retry";
  });
  img.src = src;
}

/* Load all currently-rendered image slots, with a small concurrency cap
   so VisualCube isn't flooded. Called from the "Load all" toolbar button. */
async function loadAllImages() {
  const buttons = Array.from(document.querySelectorAll(".load-img-btn:not(:disabled)"));
  const CONCURRENCY = 4;
  let i = 0;
  async function worker() {
    while (i < buttons.length) {
      const btn = buttons[i++];
      const wrap = btn.closest(".card-img-wrap");
      if (!wrap || !btn.dataset.src) continue;
      await new Promise((resolve) => {
        const img = new Image();
        img.className = "card-img";
        img.alt = `${btn.dataset.label} case state`;
        img.decoding = "async";
        img.addEventListener("load", () => {
          wrap.classList.remove("empty", "img-failed");
          wrap.classList.add("loaded");
          wrap.replaceChildren(img);
          resolve();
        });
        img.addEventListener("error", () => {
          wrap.classList.add("img-failed");
          btn.disabled = false;
          btn.textContent = "Retry";
          resolve();
        });
        img.src = btn.dataset.src;
      });
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

/* Build a meta row (e.g. "Recognition: ..." / "Description: ...") with a
 * "more"/"collapse" toggle that appears ONLY when the text is actually
 * truncated by a CSS line-clamp. Detection runs post-layout via
 * requestAnimationFrame, so it picks up whichever font-size + clamp the
 * current breakpoint resolved to (no JS-side hardcoded thresholds). */
function metaRowWithToggle(m) {
  const wrap = document.createElement("div");
  wrap.className = "card-meta-wrap";

  const text = document.createElement("div");
  text.className = "card-meta";
  text.title = `${m.label}: ${m.value}`;
  text.innerHTML = `<strong>${escapeHtml(m.label)}:</strong> ${escapeHtml(m.value)}`;
  wrap.appendChild(text);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "card-meta-toggle hidden";
  toggle.textContent = "more";
  toggle.addEventListener("click", () => {
    const expanded = text.classList.toggle("expanded");
    toggle.textContent = expanded ? "collapse" : "more";
  });
  wrap.appendChild(toggle);

  // Reveal the toggle only if the CSS clamp actually truncated something.
  // Use setTimeout(0) rather than requestAnimationFrame — RAF doesn't fire
  // in headless rendering contexts (preview/screenshot tools), and a 0ms
  // timeout still runs after the current synchronous render so the
  // browser has applied layout. Double-schedule via setTimeout-in-setTimeout
  // for the same "fonts have settled" buffer we'd get from double RAF.
  setTimeout(() => setTimeout(() => {
    if (text.scrollHeight > text.clientHeight + 1) {
      toggle.classList.remove("hidden");
    }
  }, 0), 0);

  return wrap;
}

function algRow(algStr) {
  const row = document.createElement("div");
  row.className = "alg-row";

  const code = document.createElement("code");
  code.className = "alg-block";
  code.innerHTML = colorizeAlg(algStr);
  row.appendChild(code);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "copy-btn";
  btn.textContent = "Copy";
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(algStr);
      btn.textContent = "Copied!";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.textContent = "Copy";
        btn.classList.remove("copied");
      }, 1200);
    } catch {
      btn.textContent = "Press Ctrl+C";
    }
  });
  row.appendChild(btn);
  return row;
}

function badge(text, className) {
  const el = document.createElement("span");
  el.className = `badge ${className || ""}`.trim();
  el.textContent = text;
  return el;
}

/* ---------- utils ---------- */

function uniqueSorted(arr) {
  return Array.from(new Set(arr)).sort((a, b) => String(a).localeCompare(String(b)));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

init();
