# Content Guard Tests (temporary standalone runner)

This sandbox had no network access to the npm registry, so a proper test
runner (vitest/jest) could not be installed and these tests could not be
wired to import directly from `src/services/assistantOrchestrator.ts`.

`contentGuards.reference.mjs` is a byte-for-byte copy of the four
deterministic guard functions added to `assistantOrchestrator.ts`
(`sanitizeGeneratedContent`, `arabicNaturalnessGuard`,
`evaluateContentApproval`, `validateFinalPostContent`) — copied out so they
can run as plain Node ESM with zero dependencies.

`contentGuards.test.mjs` covers the two required test cases:
- **Content Quality Test** (spec item 14): rejects the known garbled-Arabic
  examples ("مقاييس حماك قنينة أمان؟", etc.), rejects `score=85` +
  `arabic_quality=55`, rejects a null/failed QC result, and approves clean
  natural content with strong sub-scores.
- **Metadata Leakage Test** (spec item 15): heavy multi-marker leakage
  triggers `regenerate`; a single isolated marker is `cleaned`; markdown
  fences are stripped; clean content passes through untouched;
  `validateFinalPostContent()` rejects leaked metadata and accepts clean
  content.

Run with: `node tests/contentGuards.test.mjs`

**Once `npm install` succeeds in a networked environment**, replace this
with a real `vitest`/`jest` suite that imports the functions directly from
`src/services/assistantOrchestrator.ts` (they're already exported) — the
duplication here is a stopgap, not the intended long-term test setup.
