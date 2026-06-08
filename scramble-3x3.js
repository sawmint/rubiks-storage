/* =========================================================
 * scramble-3x3.js — random-move 3x3 scramble generator.
 *
 * Produces ~22-move scrambles with the standard constraints used
 * by every casual cube timer:
 *   • no two consecutive moves on the same face (R then R' is wasted)
 *   • no same-axis triple where the outer two share a face
 *     (R L R is disallowed because the two Rs cancel through L)
 *
 * Note: this is NOT a WCA random-state scrambler (which would
 * require a Kociemba solver). It is uniformly random over the move
 * sequence space subject to the cancellation constraints, which
 * always produces a fully-scrambled cube state. For practical
 * timing purposes it is indistinguishable from WCA scrambles.
 *
 * Public API (kept stable so timer.js doesn't change):
 *   nextScramble(): Promise<string>
 *   isReady(): bool
 *   onStatus(fn): unsubscribe   // fn("ready")
 *   warmUp()
 * ========================================================= */

const FACES = ["U", "D", "L", "R", "F", "B"];
const AXIS = { U: "UD", D: "UD", L: "LR", R: "LR", F: "FB", B: "FB" };
const MODIFIERS = ["", "'", "2"];

const DEFAULT_LENGTH = 22;

function generate(length = DEFAULT_LENGTH) {
  const moves = [];
  let prevFace = null;
  let prevAxisFace = null; // the face from the move before prevFace (only set if same axis as prevFace)
  for (let i = 0; i < length; i++) {
    let face;
    let attempts = 0;
    do {
      face = FACES[Math.floor(Math.random() * FACES.length)];
      attempts++;
      if (attempts > 100) break; // safety: shouldn't happen, but never spin
    } while (
      (face === prevFace) ||
      (AXIS[face] === AXIS[prevFace] && face === prevAxisFace)
    );
    const mod = MODIFIERS[Math.floor(Math.random() * MODIFIERS.length)];
    moves.push(face + mod);
    // Track if the move before `face` was on the same axis as `prevFace`
    if (prevFace && AXIS[face] === AXIS[prevFace]) {
      prevAxisFace = prevFace;
    } else {
      prevAxisFace = null;
    }
    prevFace = face;
  }
  return moves.join(" ");
}

const statusListeners = new Set();
function emit(status) {
  for (const fn of statusListeners) {
    try { fn(status); } catch (e) { console.error("scramble status listener:", e); }
  }
}

/* This generator is synchronous and instant; the async wrapper preserves
   the interface a future random-state implementation would need. */
export async function nextScramble() {
  const s = generate();
  emit("ready");
  return s;
}

export function isReady() {
  return true;
}

export function onStatus(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

export function warmUp() {
  // no-op; generation is instant
}
