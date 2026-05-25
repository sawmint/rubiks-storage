/* =========================================================
 * cube-notation.js — pure helpers for scramble generation.
 * ========================================================= */

const AUFS = ["", "U", "U2", "U'"];
const YS   = ["", "y", "y2", "y'"];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/* Build a drill scramble for a case. The `setup` is the precomputed
   string (in JSON) that produces the case state in canonical orientation
   when applied to a solved cube. We randomise:
     - leading y rotation: makes the case appear from any of 4 angles
     - leading AUF: rotates the U-layer permutation arbitrarily
*/
export function buildScramble(setup) {
  const y = pick(YS);
  const auf = pick(AUFS);
  return [y, auf, setup].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

export function randomY()   { return pick(YS); }
export function randomAUF() { return pick(AUFS); }

/* Simplify a move sequence by collapsing consecutive same-face moves.
   R R → R2, R R' → (cancelled), R R2 → R', x x' → (cancelled), etc.
   Only collapses immediate neighbors; doesn't reorder commuting moves.
   Unknown tokens pass through unchanged. */
export function simplifyMoves(scramble) {
  const tokens = String(scramble).split(/\s+/).filter(Boolean);
  const out = []; // {face, turns} where turns ∈ {1,2,3} (1=normal, 2=double, 3=prime)
  for (const tok of tokens) {
    const m = /^([RUFLDBMESrufldbxyz]w?)(['2])?$/.exec(tok);
    if (!m) {
      // Unknown — flush and pass through as a literal
      out.push({ literal: tok });
      continue;
    }
    const face = m[1];
    const mod = m[2];
    let turns = mod === "'" ? 3 : mod === "2" ? 2 : 1;
    const last = out[out.length - 1];
    if (last && !last.literal && last.face === face) {
      const merged = (last.turns + turns) % 4;
      if (merged === 0) out.pop();
      else last.turns = merged;
    } else {
      out.push({ face, turns });
    }
  }
  return out
    .map((m) => {
      if (m.literal) return m.literal;
      if (m.turns === 1) return m.face;
      if (m.turns === 2) return m.face + "2";
      if (m.turns === 3) return m.face + "'";
      return m.face;
    })
    .join(" ");
}
