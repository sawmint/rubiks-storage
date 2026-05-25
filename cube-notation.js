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
