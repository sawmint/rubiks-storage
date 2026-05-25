/* =========================================================
 * weak-cases.js — "Today's drill"
 *
 * Surfaces the cases the user has practiced least or is slowest on,
 * using existing rs-stats-v2 drill data. Ranking:
 *   1. Unpracticed cases first (no drill record / n=0), by id.
 *   2. Then practiced cases sorted by slowest best descending.
 *   3. Tiebreak: oldest lastAt first (longer since drilled = weaker).
 *
 * From the modal, "Drill these" hands the surfaced keys to drill.start,
 * and "Batch (5)" hands the PLL subset to batch.start. No new drill/batch
 * code — this module is purely about case selection.
 * ========================================================= */

import * as modal from "./modal.js";
import * as stats from "./stats.js";
import * as selection from "./selection.js";

const SETTINGS_KEY = "rs-weak-settings-v1";
const DEFAULTS = {
  categories: ["pll", "oll"],
  count: 10,
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    const cats = Array.isArray(parsed.categories) && parsed.categories.length > 0
      ? parsed.categories.filter((c) => c === "pll" || c === "oll")
      : DEFAULTS.categories;
    const count = [5, 10, 20].includes(parsed.count) ? parsed.count : DEFAULTS.count;
    return { categories: cats.length ? cats : DEFAULTS.categories, count };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}

let session = null;

export function start(data) {
  session = {
    data,
    settings: loadSettings(),
    currentTop: [],
    ui: {},
  };
  const body = buildBody();
  modal.open({
    title: "Today's drill — weak cases",
    body,
    onClose: () => { session = null; },
  });
  renderList();
}

/* ---------- weakness scoring ---------- */

function gatherCandidates(categories) {
  const all = stats.getAll();
  const out = [];
  for (const cat of categories) {
    const items = cat === "pll" ? session.data.pll : session.data.oll;
    if (!items) continue;
    for (const item of items) {
      // Skip cases without a setup — they're not drillable from this app
      if (typeof item.setup !== "string") continue;
      const drill = all[`${cat}/${item.id}`]?.drill;
      out.push({
        category: cat,
        item,
        key: selection.key(cat, item.id),
        drill,
        isUnpracticed: !drill || drill.n === 0,
        best: drill?.best ?? null,
        n: drill?.n ?? 0,
        lastAt: drill?.lastAt ?? 0,
      });
    }
  }
  return out;
}

function rankWeak(candidates) {
  const unpracticed = candidates
    .filter((c) => c.isUnpracticed)
    .sort((a, b) => String(a.item.id).localeCompare(String(b.item.id)));
  const practiced = candidates
    .filter((c) => !c.isUnpracticed)
    .sort((a, b) => (b.best - a.best) || (a.lastAt - b.lastAt));
  return [...unpracticed, ...practiced];
}

/* ---------- UI ---------- */

function buildBody() {
  const root = document.createElement("div");
  root.className = "weak-body";

  const blurb = document.createElement("div");
  blurb.className = "weak-blurb";
  blurb.textContent = "Cases you've never drilled come first, then the slowest you have drilled. Use this as a focused warm-up.";
  root.appendChild(blurb);

  root.appendChild(makeToggleRow("Categories", [
    { value: "pll", label: "PLL" },
    { value: "oll", label: "OLL" },
  ], session.settings.categories, "weak-cat-grp", (value) => {
    const i = session.settings.categories.indexOf(value);
    if (i >= 0 && session.settings.categories.length > 1) {
      session.settings.categories.splice(i, 1);
    } else if (i < 0) {
      session.settings.categories.push(value);
    }
    saveSettings(session.settings);
    renderList();
    return session.settings.categories;
  }));

  root.appendChild(makeSingleRow("How many", [5, 10, 20], session.settings.count, (n) => {
    session.settings.count = n;
    saveSettings(session.settings);
    renderList();
  }));

  const listWrap = document.createElement("div");
  listWrap.className = "weak-list-wrap";
  const list = document.createElement("div");
  list.className = "weak-list";
  session.ui.list = list;
  listWrap.appendChild(list);
  root.appendChild(listWrap);

  const actions = document.createElement("div");
  actions.className = "weak-actions";

  const drillBtn = document.createElement("button");
  drillBtn.type = "button";
  drillBtn.className = "btn btn-primary";
  drillBtn.textContent = "Drill these";
  drillBtn.addEventListener("click", async () => {
    const keys = session.currentTop.map((e) => e.key);
    if (keys.length === 0) return;
    modal.close();
    const drill = await import("./drill.js");
    drill.start(session.data, keys);
  });
  actions.appendChild(drillBtn);

  const batchBtn = document.createElement("button");
  batchBtn.type = "button";
  batchBtn.className = "btn";
  batchBtn.textContent = "Batch (5)";
  batchBtn.title = "Pick 5 from the surfaced PLL cases and chain them under one continuous timer";
  batchBtn.addEventListener("click", async () => {
    const pllKeys = session.currentTop.filter((e) => e.category === "pll").map((e) => e.key);
    if (pllKeys.length === 0) {
      alert("Batch needs at least one PLL in the list. Toggle PLL on, or increase the count.");
      return;
    }
    modal.close();
    const batch = await import("./batch.js");
    batch.start(session.data, pllKeys);
  });
  actions.appendChild(batchBtn);

  session.ui.actions = actions;
  root.appendChild(actions);

  return root;
}

function makeToggleRow(labelText, options, initialSet, groupClass, onToggle) {
  const row = document.createElement("div");
  row.className = "weak-row";
  const label = document.createElement("div");
  label.className = "weak-row-label";
  label.textContent = labelText;
  row.appendChild(label);
  const group = document.createElement("div");
  group.className = "weak-btn-group " + groupClass;
  for (const opt of options) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "weak-toggle" + (initialSet.includes(opt.value) ? " active" : "");
    b.textContent = opt.label;
    b.dataset.value = opt.value;
    b.addEventListener("click", () => {
      const next = onToggle(opt.value);
      for (const tb of group.querySelectorAll(".weak-toggle")) {
        tb.classList.toggle("active", next.includes(tb.dataset.value));
      }
    });
    group.appendChild(b);
  }
  row.appendChild(group);
  return row;
}

function makeSingleRow(labelText, values, initial, onPick) {
  const row = document.createElement("div");
  row.className = "weak-row";
  const label = document.createElement("div");
  label.className = "weak-row-label";
  label.textContent = labelText;
  row.appendChild(label);
  const group = document.createElement("div");
  group.className = "weak-btn-group";
  for (const v of values) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "weak-toggle" + (v === initial ? " active" : "");
    b.textContent = String(v);
    b.dataset.value = String(v);
    b.addEventListener("click", () => {
      for (const tb of group.querySelectorAll(".weak-toggle")) {
        tb.classList.toggle("active", tb.dataset.value === String(v));
      }
      onPick(v);
    });
    group.appendChild(b);
  }
  row.appendChild(group);
  return row;
}

function renderList() {
  const candidates = gatherCandidates(session.settings.categories);
  const ranked = rankWeak(candidates);
  const top = ranked.slice(0, session.settings.count);
  session.currentTop = top;

  const host = session.ui.list;
  host.innerHTML = "";

  if (top.length === 0) {
    const empty = document.createElement("div");
    empty.className = "weak-empty";
    empty.textContent = "No cases match — pick at least one category.";
    host.appendChild(empty);
    return;
  }

  for (let i = 0; i < top.length; i++) {
    const e = top[i];
    const row = document.createElement("div");
    row.className = "weak-list-row";
    if (e.isUnpracticed) row.classList.add("unpracticed");

    const rank = document.createElement("div");
    rank.className = "weak-rank";
    rank.textContent = String(i + 1);
    row.appendChild(rank);

    const nameWrap = document.createElement("div");
    nameWrap.className = "weak-name";
    const strong = document.createElement("strong");
    strong.textContent = e.item.name || String(e.item.id);
    nameWrap.appendChild(strong);
    const catTag = document.createElement("span");
    catTag.className = "weak-cat-tag";
    catTag.textContent = e.category.toUpperCase();
    nameWrap.appendChild(catTag);
    row.appendChild(nameWrap);

    const meta = document.createElement("div");
    meta.className = "weak-meta";
    if (e.isUnpracticed) {
      const tag = document.createElement("span");
      tag.className = "weak-tag weak-tag-new";
      tag.textContent = "never drilled";
      meta.appendChild(tag);
    } else {
      meta.textContent = `best ${stats.fmtTime(e.best)} · ${humanAgo(e.lastAt)} · n=${e.n}`;
    }
    row.appendChild(meta);

    host.appendChild(row);
  }
}

function humanAgo(lastAtSec) {
  if (!lastAtSec) return "never";
  const seconds = Math.floor(Date.now() / 1000) - lastAtSec;
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
