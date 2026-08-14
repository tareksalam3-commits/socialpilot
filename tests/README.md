# Content Guard Tests (temporary standalone runner)

This sandbox had no network access to the npm registry, so a proper test
runner (vitest/jest) could not be installed and these tests could not be
wired to import directly from `src/services/assistantOrchestrator.ts`.

`contentGuards.reference.mjs` is a byte-for-byte copy of the deterministic
guard functions in `src/engines/contentEngine/contentGuards.ts`
(`sanitizeGeneratedContent`, `arabicNaturalnessGuard`,
`evaluateContentApproval`, `validateFinalPostContent`, plus the
`makeQuality` calibration helper) — copied out so they can run as plain
Node ESM with zero dependencies.

`contentGuards.test.mjs` covers:
- **Content Quality Test** (spec item 14): rejects the known garbled-Arabic
  examples ("مقاييس حماك قنينة أمان؟", etc.), rejects `arabic_quality=55`
  even with every other dimension at 95, rejects a null/failed QC result,
  and approves clean natural content with strong sub-scores.
- **QC Hardening Pass — Critical Dimension Gate** (Aug 2026, brief item 3):
  proves a single weak CRITICAL dimension (e.g. `hook=60`) fails approval
  even when the overall mean would otherwise clear 90 ("95+95+95+60" can no
  longer average into a pass); proves a weak NON-critical dimension
  (`cta`/`originality`) does NOT by itself block approval as long as the
  mean holds; proves `score=89` fails and `score=90` (with every dimension
  also at 90) passes.
- **QC Hardening Pass — 10-case adversarial calibration set** (brief items
  8/9): the exact Bad Post 1-8 / Excellent Post 9 / Excellent-but-flawed
  Post 10 set from the brief, run through `evaluateContentApproval` with
  the dimension scores a correctly-calibrated QC pass should produce for
  each. Prints the `Test | Score | Pass/Fail | Reason` table the brief
  asks for and asserts every Bad case fails and Excellent Post 9 passes.
  **This is a test of the gating LOGIC, not of the live QC model** — it
  proves that IF the QC model scores each dimension roughly as described,
  the code correctly separates them. It cannot by itself prove the live
  model actually produces those scores; that requires running
  `reviewGeneratedContent()` against a real configured provider (see the
  calibration report handed back alongside this change for how to do that
  in this project's own environment, where network/API access exists).
- **Metadata Leakage Test** (spec item 15): heavy multi-marker leakage
  triggers `regenerate`; a single isolated marker is `cleaned`; markdown
  fences are stripped; clean content passes through untouched;
  `validateFinalPostContent()` rejects leaked metadata and accepts clean
  content.

Run with: `node tests/contentGuards.test.mjs` (also wired as `npm test`).

**Once `npm install` succeeds in a networked environment**, replace this
with a real `vitest`/`jest` suite that imports the functions directly from
`src/engines/contentEngine/contentGuards.ts` (they're already exported) —
the duplication here is a stopgap, not the intended long-term test setup.
