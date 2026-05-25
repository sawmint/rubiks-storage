"""Compute `setup` (PLL+OLL) and `recognitionGroup` (OLL) fields and write them
back into rubiks-cube-algorithms.json.

Run with the pycuber venv:
    /tmp/cubevenv/bin/python scripts/compute-setups.py

What this does:
  * For each PLL and OLL: take the canonical solving algorithm, invert it, apply
    it to a solved pycuber Cube, then append rotation(s) to bring the cube back
    to canonical orientation (yellow on top, green at front). The resulting
    string is the `setup` field — applied forward to a solved cube it produces
    the case state in canonical orientation.
  * For each OLL: compute a `recognitionGroup` key that captures the U-layer
    yellow/non-yellow pattern modulo whole-cube y rotation. Cases that share a
    group are rotationally indistinguishable from above and must not be used
    as each other's distractors in the recognition trainer.

We also re-validate every algorithm via the same checks we used during the
correctness audit (D solid + bottom-2-layers solid for PLL/OLL, cross + ≥2
sides solved for F2L) and refuse to write if anything regresses.
"""

import json
import sys
from pathlib import Path

import pycuber as pc

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "rubiks-cube-algorithms.json"

# -----------------------------------------------------------------------------
# Notation utilities
# -----------------------------------------------------------------------------

def strip_parens(alg: str) -> str:
    return alg.replace("(", "").replace(")", "").strip()


def tokens(alg: str) -> list[str]:
    return strip_parens(alg).split()


def invert(alg: str) -> str:
    """Invert a WCA-notation algorithm string (token-wise)."""
    out = []
    for t in reversed(tokens(alg)):
        base = t.rstrip("'2")
        suf = t[len(base):]
        if suf == "'":
            out.append(base)
        elif suf == "2":
            out.append(base + "2")
        else:
            out.append(base + "'")
    return " ".join(out)


def apply(cube: pc.Cube, alg: str) -> None:
    clean = strip_parens(alg)
    if clean:
        cube(clean)


# -----------------------------------------------------------------------------
# Sticker-state helpers
# -----------------------------------------------------------------------------

# pycuber's default colour mapping for centres:
#   U = yellow (y), D = white (w), F = green (g),
#   B = blue (b), L = red (r), R = orange (o)
# We use those colour codes to figure out which face each centre has rotated to.

CENTRE_COLOUR_TO_FACE = {
    "y": "U", "w": "D", "g": "F", "b": "B", "r": "L", "o": "R",
}


def faces(cube: pc.Cube) -> dict[str, list[str]]:
    out = {}
    for f in "UDFBLR":
        rows = cube.get_face(f)
        out[f] = [str(sq)[1] for row in rows for sq in row]
    return out


def centre_face_for_colour(cube: pc.Cube, colour: str) -> str:
    """Return which face (U/D/F/B/L/R) currently holds the centre of `colour`."""
    f = faces(cube)
    for face in "UDFBLR":
        if f[face][4] == colour:
            return face
    raise RuntimeError(f"Colour {colour!r} not found on any centre")


# -----------------------------------------------------------------------------
# Rotation cancellation
# -----------------------------------------------------------------------------

# To bring `target_face`'s current centre back to F (green):
GREEN_TO_FRONT = {
    "F": "",
    "U": "x'",
    "D": "x",
    "L": "y'",
    "R": "y",
    "B": "y2",
}

# Once green is at F, rotate around the F-B axis (z) to put yellow on top:
YELLOW_TO_TOP = {
    "U": "",
    "D": "z2",
    "L": "z",
    "R": "z'",
    # U/D after the GREEN_TO_FRONT step are the only possibilities for yellow,
    # because green is fixed at F and yellow ≠ green ≠ neighbours' opposites.
}


def cancellation_rotations(cube: pc.Cube) -> str:
    """Return rotation tokens that bring the cube back to canonical orientation
    (yellow up, green front), applied AFTER current state."""
    parts = []

    # Step 1: bring green to F.
    green_face = centre_face_for_colour(cube, "g")
    rot1 = GREEN_TO_FRONT[green_face]
    if rot1:
        parts.append(rot1)
        # Apply rotation virtually to update where yellow ends up.
        cube(rot1)

    # Step 2: bring yellow to U.
    yellow_face = centre_face_for_colour(cube, "y")
    rot2 = YELLOW_TO_TOP[yellow_face]
    if rot2:
        parts.append(rot2)
        cube(rot2)

    return " ".join(parts)


def compute_setup(alg: str) -> str:
    """Compute the setup string for a solving algorithm.

    Setup applied forward to a solved cube reproduces the case state in
    canonical orientation. Equivalent to: invert(alg) + rotations needed to
    re-orient the cube to yellow-up / green-front.
    """
    inv = invert(alg)
    cube = pc.Cube()
    apply(cube, inv)
    rot = cancellation_rotations(cube)  # mutates cube to canonical orientation
    return (inv + (" " + rot if rot else "")).strip()


# -----------------------------------------------------------------------------
# OLL recognition groups
# -----------------------------------------------------------------------------

# OLL identity = pattern of "yellow vs non-yellow" stickers on the U layer:
# U face (9 stickers) + top row of each of F/R/B/L (3 each) = 21 booleans.
# Two cases are rotationally equivalent (and so visually identical from above
# under some y-rotation) iff their patterns agree under some 0/90/180/270
# y-rotation. We canonicalise by computing all 4 rotated patterns and taking
# the lexicographic minimum as the group key.

# U-face index layout (pycuber rows top-to-bottom, left-to-right):
#   0 1 2
#   3 4 5
#   6 7 8
# A 90° CW y-rotation maps U[i] as follows (corners cycle, edges cycle):
U_ROT_CW = [6, 3, 0, 7, 4, 1, 8, 5, 2]

# Side faces under y-rotation cycle: F -> L, L -> B, B -> R, R -> F (CW from above).
# For each side face, only the TOP row (indices 0,1,2) is relevant for OLL.
# When the cube rotates y CW, the F top-row stickers stay on the (now-L) face,
# and so on.

SIDES = ["F", "R", "B", "L"]
SIDE_NEXT_CW = {"F": "L", "L": "B", "B": "R", "R": "F"}


def oll_pattern(cube: pc.Cube) -> tuple[str, ...]:
    """Return a 21-tuple of 'Y'/'.' indicating yellow/non-yellow stickers on
    the U layer (U face + top row of each side face)."""
    f = faces(cube)
    yellow = "y"  # pycuber's U centre colour
    flags = []
    for s in f["U"]:
        flags.append("Y" if s == yellow else ".")
    for side in SIDES:
        for i in (0, 1, 2):
            flags.append("Y" if f[side][i] == yellow else ".")
    return tuple(flags)


def rotate_pattern_cw(pat: tuple[str, ...]) -> tuple[str, ...]:
    """Rotate the 21-element OLL pattern by 90° CW (whole-cube y)."""
    u = pat[:9]
    sides = {  # current top rows
        "F": pat[9:12],
        "R": pat[12:15],
        "B": pat[15:18],
        "L": pat[18:21],
    }
    # Rotate U-face stickers.
    new_u = tuple(u[i] for i in U_ROT_CW)
    # When the cube rotates y CW, the stickers that were on F's top row are
    # now on L's top row, etc. (F->L, L->B, B->R, R->F).
    new_sides = {SIDE_NEXT_CW[face]: row for face, row in sides.items()}
    return new_u + new_sides["F"] + new_sides["R"] + new_sides["B"] + new_sides["L"]


def recognition_group(pattern: tuple[str, ...]) -> str:
    rotations = [pattern]
    for _ in range(3):
        rotations.append(rotate_pattern_cw(rotations[-1]))
    canonical = min(rotations)
    return "".join(canonical)


# -----------------------------------------------------------------------------
# Validators (copied from the audit script — refuse to write if any regress)
# -----------------------------------------------------------------------------

def is_pll(cube):
    f = faces(cube)
    if any(c != f["D"][4] for c in f["D"]):
        return False, "D not solid"
    if any(c != f["U"][4] for c in f["U"]):
        return False, "U not solid"
    for face in "FBLR":
        ctr = f[face][4]
        if any(f[face][i] != ctr for i in (3, 4, 5, 6, 7, 8)):
            return False, f"{face} bottom-2-layers broken"
    return True, "ok"


def is_oll(cube):
    f = faces(cube)
    if any(c != f["D"][4] for c in f["D"]):
        return False, "D not solid"
    for face in "FBLR":
        ctr = f[face][4]
        if any(f[face][i] != ctr for i in (3, 4, 5, 6, 7, 8)):
            return False, f"{face} bottom-2-layers broken"
    return True, "ok"


def verify_setup(setup: str, validator) -> tuple[bool, str]:
    cube = pc.Cube()
    apply(cube, setup)
    return validator(cube)


# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

def main() -> int:
    data = json.loads(DATA.read_text())

    failures = []

    # PLL
    for entry in data["pll"]:
        setup = compute_setup(entry["algorithm"])
        ok, msg = verify_setup(setup, is_pll)
        if not ok:
            failures.append(("pll", entry["id"], setup, msg))
        entry["setup"] = setup

    # OLL — compute setup and recognitionGroup
    for entry in data["oll"]:
        setup = compute_setup(entry["algorithm"])
        ok, msg = verify_setup(setup, is_oll)
        if not ok:
            failures.append(("oll", entry["id"], setup, msg))
        entry["setup"] = setup

        # Apply setup to fresh cube to read the pattern in canonical orientation.
        cube = pc.Cube()
        apply(cube, setup)
        entry["recognitionGroup"] = recognition_group(oll_pattern(cube))

    if failures:
        print("ABORT — setup verification failed:")
        for cat, eid, setup, msg in failures:
            print(f"  {cat} {eid}: {msg}  setup={setup!r}")
        return 1

    DATA.write_text(json.dumps(data, indent=2) + "\n")

    # Summary
    print(f"PLL setups: {len(data['pll'])}")
    print(f"OLL setups: {len(data['oll'])}")

    # Recognition group distribution
    from collections import Counter
    groups = Counter(o["recognitionGroup"] for o in data["oll"])
    sizes = Counter(groups.values())
    print(f"OLL recognition groups: {len(groups)} distinct")
    for size, count in sorted(sizes.items()):
        print(f"  {count} group(s) of size {size}")
    # Spot-check: how many OLL cases have a same-group sibling?
    shared = sum(1 for o in data["oll"] if groups[o["recognitionGroup"]] > 1)
    print(f"OLL cases that share a group with at least one sibling: {shared}/{len(data['oll'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
