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
export function vcImage({ setup, caseAlg, stage, view, size = 140 }) {
  const params = new URLSearchParams({
    fmt: "svg",
    size: String(size),
    bg: "t",
  });
  if (setup)   params.set("alg",  setup);
  if (caseAlg) params.set("case", caseAlg);
  if (stage)   params.set("stage", stage);
  if (view)    params.set("view", view);
  return `${VISUALCUBE_BASE}?${params.toString()}`;
}

/* ---------- category configuration ---------- */

const CATEGORIES = [
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
  bindThemeToggle();
  bindLoadAll();
  bindSelectionToolbar();
  bindResetStats();
  selection.subscribe(updateSelectionUI);
  // Re-render cards when stats change so the badges stay fresh
  stats.subscribe(() => render());
  selectCategory(state.category);
}

function bindResetStats() {
  document.getElementById("reset-stats")?.addEventListener("click", () => {
    if (confirm("Reset all drill + recognition stats? This cannot be undone.")) {
      stats.resetAll();
    }
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
  // Enable/disable drill+recog buttons
  for (const id of ["drill-selected", "recog-selected", "clear-selection"]) {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = count === 0;
  }
  // Hide selection toolbar entirely if current category isn't drillable
  const wrap = document.getElementById("selection-toolbar");
  if (wrap) wrap.classList.toggle("hidden", !cat.drillable);
}

function bindLoadAll() {
  const btn = document.getElementById("load-all");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "Loading…";
    await loadAllImages();
    btn.textContent = original;
    btn.disabled = false;
  });
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
    btn.innerHTML = `${escapeHtml(cat.label)}<span class="tab-count">${count}</span>`;
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

  // alternates
  if (Array.isArray(it.alternates) && it.alternates.length) {
    const det = document.createElement("details");
    det.className = "alternates";
    const sum = document.createElement("summary");
    sum.textContent = `Show ${it.alternates.length} alternate${it.alternates.length === 1 ? "" : "s"}`;
    det.appendChild(sum);
    const ul = document.createElement("ul");
    ul.className = "alt-list";
    for (const alt of it.alternates) {
      const li = document.createElement("li");
      li.appendChild(algRow(alt));
      ul.appendChild(li);
    }
    det.appendChild(ul);
    card.appendChild(det);
  }

  // meta rows
  for (const m of cat.metaRows(it) || []) {
    const div = document.createElement("div");
    div.className = "card-meta";
    div.innerHTML = `<strong>${escapeHtml(m.label)}:</strong> ${escapeHtml(m.value)}`;
    card.appendChild(div);
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

function algRow(algStr) {
  const row = document.createElement("div");
  row.className = "alg-row";

  const code = document.createElement("code");
  code.className = "alg-block";
  code.textContent = algStr;
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

/* ---------- theme toggle ---------- */

function bindThemeToggle() {
  const btn = document.getElementById("theme-toggle");
  const stored = localStorage.getItem("rs-theme");
  if (stored) document.documentElement.setAttribute("data-theme", stored);
  btn.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("rs-theme", next);
  });
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
