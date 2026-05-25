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
  // Capture a local handle so the onClose for THIS modal doesn't null out
  // a newer session if start() is invoked twice rapidly. modal.open()
  // internally calls modal.close() which fires the PRIOR onClose — without
  // this guard, that fire happens after `session = mySession` and would
  // null the new instance, crashing the renderList() below.
  const mySession = {
    data,
    settings: loadSettings(),
    currentTop: [],
    ui: {},
  };
  session = mySession;
  const body = buildBody();
  modal.open({
    title: "Today's drill — weak cases",
    body,
    onClose: () => { if (session === mySession) session = null; },
  });
  renderList();
}

/* ---------- weakness scoring ---------- */

function gatherCandidates(categories) {
  const all = stats.getAll();
  const nowSec = Math.floor(Date.now() / 1000);
  const out = [];
  for (const cat of categories) {
    const items = cat === "pll" ? session.data.pll : session.data.oll;
    if (!items) continue;
    for (const item of items) {
      // Skip cases without a setup — they're not drillable from this app
      if (typeof item.setup !== "string") continue;
      const slot = all[`${cat}/${item.id}`];
      const drill = slot?.drill;
      const srs = slot?.srs;
      const isUnpracticed = !drill || drill.n === 0;
      const isDue = !!srs && srs.dueAt > 0 && srs.dueAt <= nowSec;
      out.push({
        category: cat,
        item,
        key: selection.key(cat, item.id),
        drill,
        srs,
        isUnpracticed,
        isDue,
        // Negative if overdue (most overdue = most negative); used to sort
        // due cases by "most overdue first".
        dueDelta: srs?.dueAt ? srs.dueAt - nowSec : null,
        best: drill?.best ?? null,
        n: drill?.n ?? 0,
        lastAt: drill?.lastAt ?? 0,
      });
    }
  }
  return out;
}

/* Three-tier ranking, weakest first:
 *   1. Due-now cases (have an SRS schedule and dueAt has passed),
 *      sorted by most-overdue first.
 *   2. Never-drilled cases, sorted by id for deterministic order.
 *   3. Practiced but not yet due, sorted by slowest best descending
 *      (tiebreak oldest lastAt) — the original "weak cases" heuristic
 *      remains the baseline when nothing is explicitly due.
 */
function rankWeak(candidates) {
  const due = candidates
    .filter((c) => c.isDue)
    .sort((a, b) => (a.dueDelta ?? 0) - (b.dueDelta ?? 0));
  const unpracticed = candidates
    .filter((c) => c.isUnpracticed && !c.isDue)
    .sort((a, b) => String(a.item.id).localeCompare(String(b.item.id)));
  const future = candidates
    .filter((c) => !c.isUnpracticed && !c.isDue)
    .sort((a, b) => (b.best - a.best) || (a.lastAt - b.lastAt));
  return [...due, ...unpracticed, ...future];
}

/* ---------- UI ---------- */

function buildBody() {
  const root = document.createElement("div");
  root.className = "weak-body";

  const blurb = document.createElement("div");
  blurb.className = "weak-blurb";
  session.ui.blurb = blurb;
  // Updated dynamically by renderList so it shows live "X due, Y new" counts.
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

  // Blurb counts reflect the FULL candidate pool (not just the displayed top
  // N) so the user sees how much work is actually queued, not just what fits.
  const dueCount = candidates.filter((c) => c.isDue).length;
  const newCount = candidates.filter((c) => c.isUnpracticed && !c.isDue).length;
  const total = candidates.length;
  const parts = [];
  if (dueCount > 0) parts.push(`${dueCount} due now`);
  if (newCount > 0) parts.push(`${newCount} never drilled`);
  parts.push(`${total} total in selected categories`);
  session.ui.blurb.textContent =
    parts.join(" · ") +
    ". Ranking: SR-overdue first, then never-drilled, then slowest by best time.";

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
    if (e.isDue) row.classList.add("due");
    else if (e.isUnpracticed) row.classList.add("unpracticed");

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
    if (e.isDue) {
      const tag = document.createElement("span");
      tag.className = "weak-tag weak-tag-due";
      tag.textContent = dueLabel(e.dueDelta, e.srs?.box);
      meta.appendChild(tag);
    } else if (e.isUnpracticed) {
      const tag = document.createElement("span");
      tag.className = "weak-tag weak-tag-new";
      tag.textContent = "never drilled";
      meta.appendChild(tag);
    } else {
      // Practiced but not yet due: show best + SRS state if we have it
      let txt = `best ${stats.fmtTime(e.best)} · ${humanAgo(e.lastAt)} · n=${e.n}`;
      if (e.srs && e.dueDelta != null) {
        txt += ` · next ${humanIn(e.dueDelta)}`;
      }
      meta.textContent = txt;
    }
    row.appendChild(meta);

    host.appendChild(row);
  }
}

/* "due now" if delta is essentially 0; "due Xd ago" otherwise. Box info
 * is appended so the user sees how many reps they've stacked on the case. */
function dueLabel(deltaSec, box) {
  const overdueDays = Math.max(0, Math.floor((-(deltaSec || 0)) / 86400));
  const boxStr = box ? ` · box ${box}` : "";
  if (overdueDays === 0) return "due now" + boxStr;
  if (overdueDays === 1) return "due 1d ago" + boxStr;
  return `due ${overdueDays}d ago` + boxStr;
}

/* "next X" formatter — only used for practiced+future cases */
function humanIn(deltaSec) {
  if (!deltaSec || deltaSec <= 0) return "now";
  const days = Math.ceil(deltaSec / 86400);
  if (days >= 1) return `${days}d`;
  const hours = Math.ceil(deltaSec / 3600);
  return `${hours}h`;
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
