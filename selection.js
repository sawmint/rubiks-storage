/* =========================================================
 * selection.js — multi-select state for drill/recognition.
 *
 * In-memory only; cleared on page reload by design (the user's
 * working "what I want to drill today" set is ephemeral).
 *
 * Keys are "<category>/<id>" e.g. "pll/Aa", "oll/27".
 * Cross-tab: switching tabs preserves selection.
 * ========================================================= */

const selected = new Set();
const listeners = new Set();

export function key(category, itemId) {
  return `${category}/${itemId}`;
}

export function parseKey(k) {
  const idx = k.indexOf("/");
  return idx < 0 ? null : { category: k.slice(0, idx), id: k.slice(idx + 1) };
}

export function isSelected(category, itemId) {
  return selected.has(key(category, itemId));
}

export function toggle(category, itemId) {
  const k = key(category, itemId);
  if (selected.has(k)) selected.delete(k);
  else selected.add(k);
  notify();
}

export function selectMany(category, items) {
  for (const it of items) selected.add(key(category, it.id));
  notify();
}

export function deselectMany(category, items) {
  for (const it of items) selected.delete(key(category, it.id));
  notify();
}

export function clear() {
  selected.clear();
  notify();
}

export function size() {
  return selected.size;
}

export function countInCategory(category) {
  let n = 0;
  const prefix = category + "/";
  for (const k of selected) if (k.startsWith(prefix)) n++;
  return n;
}

export function allKeys() {
  return Array.from(selected);
}

/* Resolve a key to the full item object given the loaded dataset.
   Returns { category, item } or null. */
export function resolve(k, data) {
  const parsed = parseKey(k);
  if (!parsed) return null;
  const { category, id } = parsed;
  let arr;
  switch (category) {
    case "pll":     arr = data.pll; break;
    case "oll":     arr = data.oll; break;
    case "f2l_adv": arr = data.f2l.advanced; break;
    case "f2l_beg": arr = data.f2l.beginner; break;
    default: return null;
  }
  // ids may be strings ("Aa", "B1") or numbers (27); compare loosely.
  const item = arr.find((it) => String(it.id) === id);
  return item ? { category, item } : null;
}

/* Resolve all selected items, optionally filtered by category. */
export function resolveAll(data, category = null) {
  const out = [];
  for (const k of selected) {
    const r = resolve(k, data);
    if (!r) continue;
    if (category && r.category !== category) continue;
    out.push(r);
  }
  return out;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) {
    try { fn(); } catch (e) { console.error("selection listener error:", e); }
  }
}
