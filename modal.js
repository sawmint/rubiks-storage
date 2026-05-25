/* =========================================================
 * modal.js — minimal modal/overlay used by drill + recognition.
 *
 * Single-instance: open() replaces any existing content.
 * Handles: ESC to close, body scroll lock, focus return,
 *          click-outside to close (optional, opt-in).
 * ========================================================= */

const root = () => document.getElementById("modal-root");

let previousFocus = null;
let closeHandler = null;
let escListener = null;

export function open({ title, body, onClose, allowBackdropClose = true }) {
  close(); // ensure clean slate

  const r = root();
  if (!r) {
    console.error("modal-root element missing in DOM");
    return;
  }

  previousFocus = document.activeElement;

  // Build panel
  const panel = document.createElement("div");
  panel.className = "modal-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  if (title) panel.setAttribute("aria-label", title);

  const head = document.createElement("div");
  head.className = "modal-head";
  const h = document.createElement("h2");
  h.className = "modal-title";
  h.textContent = title || "";
  head.appendChild(h);

  const closeBtn = document.createElement("button");
  closeBtn.className = "modal-close";
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "\u2715"; // ✕
  closeBtn.addEventListener("click", () => close());
  head.appendChild(closeBtn);

  panel.appendChild(head);
  if (body instanceof Node) panel.appendChild(body);

  r.replaceChildren(panel);
  r.classList.remove("hidden");
  r.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";

  closeHandler = onClose || null;

  escListener = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };
  window.addEventListener("keydown", escListener);

  if (allowBackdropClose) {
    r.addEventListener("click", (e) => {
      if (e.target === r) close();
    });
  }

  // Focus first focusable inside the panel, else the close button
  const focusable = panel.querySelector(
    'input, button, [tabindex]:not([tabindex="-1"]), a[href]'
  );
  (focusable || closeBtn).focus();

  return panel;
}

export function close() {
  const r = root();
  if (!r) return;
  if (r.classList.contains("hidden")) return;
  r.classList.add("hidden");
  r.setAttribute("aria-hidden", "true");
  r.replaceChildren();
  document.body.style.overflow = "";
  if (escListener) {
    window.removeEventListener("keydown", escListener);
    escListener = null;
  }
  if (closeHandler) {
    const fn = closeHandler;
    closeHandler = null;
    try { fn(); } catch (e) { console.error("modal onClose error:", e); }
  }
  if (previousFocus && typeof previousFocus.focus === "function") {
    previousFocus.focus();
  }
  previousFocus = null;
}

export function isOpen() {
  const r = root();
  return r && !r.classList.contains("hidden");
}
