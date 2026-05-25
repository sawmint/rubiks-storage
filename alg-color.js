/* =========================================================
 * alg-color.js — tokenize + colorize cube algorithm strings.
 *
 * Each move (face, slice, rotation, wide) gets a CSS class
 * derived from its leading face letter (uppercase-normalized
 * so lowercase wide moves share their uppercase color):
 *   R U R'  →  <span class="move move-R">R</span> ...
 * Whitespace and parens are preserved; the parens get their
 * own muted class so grouping markers stay visually quiet.
 *
 * Pair with the CSS in styles.css (`.move-D`, `.move-R`, ...).
 * Colors are theme-aware (defined for both light + dark).
 * ========================================================= */

/* Single-pass tokenizer. The regex tries, in order:
 *   1. whitespace          → kind: "space"
 *   2. parenthesis         → kind: "paren"
 *   3. wide notation (Rw)  → kind: "move", head=Rw
 *   4. single-char move    → kind: "move", head=R|r|M|x|...
 *      ...followed by optional modifier: '', "'", "2", or "2'"
 *      ...then a negative lookahead so adjoining letters don't get
 *         partially colored (e.g. "fix" should NOT color "f", and
 *         "Right" should NOT color "R"). Algorithm strings in the
 *         dataset are whitespace-separated, so this just makes the
 *         tokenizer ignore prose if it ever sneaks in.
 *
 * Anything not matched (commas, brackets, unknown letters) falls
 * through as raw text so callers can pass arbitrary notation without
 * crashing the renderer.
 */
const TOKEN_RE =
  /(\s+)|([()])|(?<![A-Za-z])(Rw|Lw|Uw|Dw|Fw|Bw|[RLUDFBrludfbMESxyz])((?:'|2'?)?)(?![A-Za-z])/g;

export function tokenize(s) {
  const tokens = [];
  if (s == null) return tokens;
  const str = String(s);
  let last = 0;
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(str)) !== null) {
    if (m.index > last) {
      tokens.push({ kind: "raw", text: str.slice(last, m.index) });
    }
    if (m[1] != null) {
      tokens.push({ kind: "space", text: m[1] });
    } else if (m[2] != null) {
      tokens.push({ kind: "paren", text: m[2] });
    } else {
      tokens.push({ kind: "move", head: m[3], mod: m[4] || "" });
    }
    last = TOKEN_RE.lastIndex;
  }
  if (last < str.length) tokens.push({ kind: "raw", text: str.slice(last) });
  return tokens;
}

/* Map a move's head string to a CSS class suffix. Lowercase wide
 * moves (r, l, u, d, f, b) share the color of their uppercase face. */
function moveClass(head) {
  const c = head[0];
  if (c >= "a" && c <= "z" && "rludfb".includes(c)) return c.toUpperCase();
  return c; // R L U D F B M E S x y z
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

/* Render an algorithm string as colored HTML. The full move (head
 * plus modifier) is wrapped so the apostrophe / 2 inherits the face
 * color — easier to scan than half-colored tokens. */
export function renderHtml(s) {
  const tokens = tokenize(s);
  const parts = [];
  for (const t of tokens) {
    if (t.kind === "space") {
      parts.push(t.text);
    } else if (t.kind === "raw") {
      parts.push(escapeHtml(t.text));
    } else if (t.kind === "paren") {
      parts.push(`<span class="move-paren">${escapeHtml(t.text)}</span>`);
    } else {
      const cls = moveClass(t.head);
      parts.push(
        `<span class="move move-${cls}">${escapeHtml(t.head + t.mod)}</span>`
      );
    }
  }
  return parts.join("");
}
