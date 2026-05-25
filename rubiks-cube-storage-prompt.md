# Rubik's Cube Algorithm Storage — Generation Prompt

> Paste the block below (everything between the two `===` rulers) into a fresh Claude session, in the same working directory where you want `rubiks-cube-algorithms.json` to be written. The prompt is self-contained.

---

```
=================================================================
<role>
You are a senior speedcuber and dataset author. You have memorized
the canonical CFOP algorithm corpus. You write WCA-notation
algorithms precisely. You never invent cases or guess silently —
if an algorithm is uncertain, you flag it with `confidence: "low"`
and add a `note`.
</role>

<task>
Produce ONE machine-readable JSON file named
`rubiks-cube-algorithms.json` in the current working directory.
It must contain, in full:
  • every PLL (21 cases)
  • every OLL (57 cases)
  • every standard advanced F2L case (41 cases)
  • a beginner F2L primitive set (~6–8 entries) used by the
    layer-by-layer / 2-look F2L method
The file is the deliverable. No UI, no extra files.
</task>

<conventions>
- Notation: WCA Singmaster.
  • Face turns: U D L R F B (with optional `'` or `2` suffix).
  • Wide moves: BOTH `Rw Lw Uw Dw Fw Bw` AND lowercase `r l u d f b`
    are acceptable — use whichever is most common for that algorithm.
  • Slice moves: M E S allowed.
  • Rotations: x y z allowed.
- Cube orientation reference: white bottom, yellow top, green front.
- Prefer the algorithm most widely taught by the modern speedcubing
  community (algdb.net "best" / J Perm's sheets / Cubeskills).
- If multiple algorithms are roughly equally popular, list the
  primary in `algorithm` and up to 3 others in `alternates`.
- Group parentheses for readability (`(R U R' U')`) are allowed but
  not required.
</conventions>

<sources_to_recall_from>
- algdb.net (PLL, OLL, F2L pages)
- J Perm's printable algorithm sheets
- Cubeskills.com F2L/OLL/PLL pages
- speedsolving.com wiki
Do not fabricate. If unsure of a specific entry, set
`confidence: "low"` and add a `note` field explaining the uncertainty.
</sources_to_recall_from>

<schema>
The output must be a single JSON object with exactly this shape:

{
  "pll": [
    {
      "id": "Aa",
      "name": "A-perm (a)",
      "group": "corners-only" | "edges-only" | "corners+edges" | "diagonal",
      "algorithm": "x R' U R' D2 R U' R' D2 R2 x'",
      "alternates": ["...", "..."],
      "recognition": "Headlights on left, 3-corner cycle clockwise",
      "auf": "U" | "U2" | "U'" | "none",
      "confidence": "high" | "medium" | "low",
      "note": "optional, only if confidence < high"
    }
    // ... 21 PLL entries total
  ],

  "oll": [
    {
      "id": 27,
      "name": "Sune",
      "shape": "cross" | "dot" | "line" | "L" | "T" | "C" | "P" | "W" | "Z" | "I" | "small-lightning" | "big-lightning" | "fish" | "square" | "knight" | "awkward" | "other",
      "algorithm": "R U R' U R U2 R'",
      "alternates": ["..."],
      "recognition": "Yellow corner on UFR, two adjacent corners showing yellow on F/R",
      "confidence": "high" | "medium" | "low",
      "note": "optional"
    }
    // ... 57 OLL entries total, ids 1..57
  ],

  "f2l": {
    "advanced": [
      {
        "id": 1,
        "slot": "FR",
        "corner_state": "white sticker on top (U)",
        "edge_state": "edge in top layer, oriented",
        "algorithm": "U (R U' R')",
        "trigger": "insert" | "sledgehammer" | "hedgeslammer" | "split-pair" | "rejoin" | "other",
        "confidence": "high" | "medium" | "low",
        "note": "optional"
      }
      // ... 41 advanced F2L entries total, ids 1..41 (algdb.net numbering)
    ],

    "beginner": [
      {
        "id": "B1",
        "name": "Pair on top — corner white-up, insert from above",
        "method": "2-look / LBL: pair the corner+edge in the top layer, then insert",
        "algorithm": "U R U' R'",
        "notes": "All cases reducible to this by AUF/setup",
        "confidence": "high"
      }
      // ... 6–8 beginner primitives covering the LBL approach
    ]
  },

  "meta": {
    "notation": "WCA Singmaster (uppercase + lowercase wide both used)",
    "assumed_orientation": "white bottom, yellow top, green front",
    "generated_by": "<model name + ISO date>",
    "counts": {
      "pll": 21,
      "oll": 57,
      "f2l_advanced": 41,
      "f2l_beginner": "6-8"
    }
  }
}
</schema>

<examples>
One concrete example per category to anchor field shape and tone.

<pll_example>
{
  "id": "Ua",
  "name": "U-perm (a)",
  "group": "edges-only",
  "algorithm": "R U' R U R U R U' R' U' R2",
  "alternates": ["M2 U M U2 M' U M2"],
  "recognition": "Three-edge cycle counter-clockwise, headlights on front",
  "auf": "none",
  "confidence": "high"
}
</pll_example>

<oll_example>
{
  "id": 27,
  "name": "Sune",
  "shape": "small-lightning",
  "algorithm": "R U R' U R U2 R'",
  "alternates": ["L' U' L U' L' U2 L"],
  "recognition": "Yellow on UFR corner only; two adjacent yellows show on F and R sides",
  "confidence": "high"
}
</oll_example>

<f2l_adv_example>
{
  "id": 3,
  "slot": "FR",
  "corner_state": "white sticker facing F, corner in UFR",
  "edge_state": "edge in top layer, oriented",
  "algorithm": "(U' R U R') (U' R U' R')",
  "trigger": "split-pair-rejoin",
  "confidence": "high"
}
</f2l_adv_example>

<f2l_beg_example>
{
  "id": "B1",
  "name": "Right-hand insert: corner white-up over slot, edge paired above",
  "method": "2-look F2L: AUF so the pair lines up, then insert",
  "algorithm": "U R U' R'",
  "notes": "The fundamental right-hand insert used as a building block",
  "confidence": "high"
}
</f2l_beg_example>
</examples>

<output_rules>
1. Output ONLY the JSON object as a file write — no prose, no
   markdown fences in the file content.
2. Write the file at `./rubiks-cube-algorithms.json` (current
   working directory).
3. After the write, print exactly one summary line to chat in this
   format:
     "Wrote <P> PLLs / <O> OLLs / <Aadv> F2L-advanced / <Abeg> F2L-beginner"
4. Do not write any other files. Do not modify any other files.
</output_rules>

<self_check>
Before finalizing, run these checks and re-emit if any fail:

1. COUNTS
   - `pll` length == 21
   - `oll` length == 57
   - `f2l.advanced` length == 41
   - `f2l.beginner` length between 6 and 8 inclusive

2. PLL IDS (exact set, no duplicates)
   { Aa, Ab, E, F, Ga, Gb, Gc, Gd, H, Ja, Jb, Na, Nb, Ra, Rb, T, Ua, Ub, V, Y, Z }

3. OLL IDS — integers 1..57, each present exactly once.

4. F2L ADVANCED IDS — integers 1..41, each present exactly once.

5. NOTATION — every `algorithm` and `alternates[]` string contains
   only tokens drawn from:
     { U, D, L, R, F, B,
       Rw, Lw, Uw, Dw, Fw, Bw,
       r, l, u, d, f, b,
       M, E, S,
       x, y, z }
   each optionally suffixed with `'` or `2`, and separated by spaces
   (parentheses are allowed and should be ignored for token check).

6. CONFIDENCE — every entry has a `confidence` field. Every entry
   with `confidence != "high"` also has a `note`.

7. NO DUPLICATES — within each category, all `id` values are unique.

If any check fails, fix the JSON and re-write the file before
emitting the summary line.
</self_check>

<final_reminder>
- Output a single JSON file at ./rubiks-cube-algorithms.json.
- Hit the counts: 21 PLL, 57 OLL, 41 advanced F2L, 6–8 beginner F2L.
- Never invent algorithms. Mark uncertainty honestly with
  confidence:"low" + note.
- After writing, print the one-line summary and stop.
</final_reminder>
=================================================================
```

---

## How to verify the output (after running the prompt above)

From the same directory:

```bash
jq '.pll | length' rubiks-cube-algorithms.json            # 21
jq '.oll | length' rubiks-cube-algorithms.json            # 57
jq '.f2l.advanced | length' rubiks-cube-algorithms.json   # 41
jq '.f2l.beginner | length' rubiks-cube-algorithms.json   # 6–8

jq '[.pll[].id]         | sort | unique | length' rubiks-cube-algorithms.json  # 21
jq '[.oll[].id]         | sort | unique | length' rubiks-cube-algorithms.json  # 57
jq '[.f2l.advanced[].id]| sort | unique | length' rubiks-cube-algorithms.json  # 41

jq '[.. | objects | select(has("confidence") and .confidence != "high") | select(has("note") | not)]' \
   rubiks-cube-algorithms.json   # should be []
```

Spot-check well-known cases:

- **Sune** (OLL 27): `R U R' U R U2 R'`
- **T-perm** (PLL T): `R U R' U' R' F R2 U' R' U' R U R' F'`
- **J-perm (b)** (PLL Jb): `R U R' F' R U R' U' R' F R2 U' R' U'`
