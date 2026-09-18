---
phase: 01-deterministic-immutable-commit-extraction
plan: 07
subsystem: clone-independent-and-vibery-shaped-acceptance
tags: [exact-bytes, local-git-clones, checkout-invariance, stable-identities, twelve-workspaces, real-cli, node-test]

requires:
  - phase: 01-06
    provides: Real integration CLI, deterministic three-artifact receipt, and immutable CURRENT-selected generations
provides:
  - Exact-Buffer acceptance proof across equivalent remotes, clone paths, branches, dirty/index state, cwd, locale, timezone, environment ordering, and repeat runs
  - Repository non-mutation proof covering HEAD, branch, index bytes and checksum, refs, and porcelain status around every determinism run
  - Revision-aware identity proof for README-only, package-display-name-only, path-group, and relation-endpoint changes
  - Generic twelve-workspace acceptance proof yielding four exhaustive rooms and exactly three aggregated directions
  - Renamed-copy proof that first-segment grouping has no Vibery-specific production branch or LLM/provider participation
affects: [01-08-adversarial-closure]

tech-stack:
  added: []
  patterns: [real-cli acceptance, once-resolved bundle reads, exact Buffer comparison, local-only clone matrix, data-driven topology fixture, red-green TDD]

key-files:
  created:
    - integrations/vibery-station/test/helpers/station-fixtures.mjs
    - integrations/vibery-station/test/determinism-acceptance.test.mjs
    - integrations/vibery-station/test/vibery-shape.test.mjs
  modified: []

key-decisions:
  - "Compare all three files from a CURRENT pointer resolved exactly once, and surround every determinism CLI run with complete mutable-repository state captures."
  - "Use neutral synthetic package names and parameterized first-segment labels so the Vibery-shaped case remains acceptance data rather than production policy."
  - "Prove the durable-ID boundary both positively with README/name-only changes and negatively with an actual path-group/relation-endpoint change."

patterns-established:
  - "End-to-end determinism acceptance uses local Git clones only, synthetic supported-forge origins, and the real integration CLI; no pure-helper shortcut can satisfy it."
  - "Topology acceptance asserts exhaustive memberships, exact aggregated scopes and evidence IDs, no self-loop, and equivalent behavior after renaming all four path groups."

requirements-completed: [TEST-01, TEST-03]

duration: 10 min
completed: 2026-09-16
---

# Phase 1 Plan 7: Clone-independent Determinism and Vibery-shaped Acceptance Summary

**The real Station CLI now has provider-free acceptance evidence that one repository identity and commit produce exact immutable bytes independent of clone/checkout state, while the required twelve-workspace shape is projected mechanically into four rooms and three directions.**

## Performance

- **Duration:** 10 min
- **Completed:** 2026-09-16T16:29:25Z
- **Tasks:** 2
- **Files created:** 3 integration test/fixture files plus this summary

## Exact-byte Acceptance Evidence

- Created three local clones of one object graph at distinct absolute paths with equivalent canonical HTTPS, SSH URI, and SCP GitHub origin/authored spellings.
- Varied checked-out branch and HEAD commit, cwd, locale, timezone, irrelevant environment insertion order, and dirty state containing staged bytes, an unstaged tracked modification, a tracked deletion, and an untracked `package.json`.
- Invoked `integrations/vibery-station/bin/station-map.mjs` for the same full base commit in every clone, resolved each `CURRENT` file once, and compared `station-evidence.json`, `station-map.json`, and `station-receipt.json` as exact Buffers.
- Repeated extraction in a dirty clone and obtained the same three Buffers again.
- Fatal UTF-8 decoding, LF-only content, exactly one trailing LF, and the sole canonical repository URL `https://github.com/example/station-acceptance` were asserted for every successful artifact.
- Recursive artifact scans rejected repository paths, branch names, timestamp/runtime/host/PID markers, Node and Git versions, and raw-stderr markers.
- Every determinism run preserved exact HEAD, branch, index Buffer and SHA-256, complete fixture refs, and NUL-delimited porcelain status.

## Identity Delta Evidence

| Change | Evidence/map/receipt bytes | Snapshot ID | Project ID | Room IDs | Relation IDs |
|---|---|---|---|---|---|
| README bytes only | Changed | Changed | Preserved | Preserved | Preserved |
| Package/root display names and matching dependency names only | Changed | Changed | Preserved | Preserved | Preserved |
| Workspace first-segment and relation endpoint room | Changed | Changed | Preserved | Changed | Changed |

The README commit changes only `README.md`; selected manifests and their durable evidence links remain unchanged. Package renaming preserves structural paths and room endpoints, while the final control commit moves the target group from `packages/*` to `shared/*` and proves identities change only at the structural boundary.

## Four-room / Three-direction Result

The twelve declared workspaces use three neutral packages in each of these first-segment groups:

1. `vibery-backend-new`
2. `vibery-ui-web`
3. `vibery-games`
4. `packages`

The real CLI emitted four exhaustive, sorted rooms and exactly:

- `vibery-backend-new -> packages` with exact `dependencies` and `optionalDependencies` scopes and two declaring-manifest evidence IDs.
- `vibery-ui-web -> packages` with exact `devDependencies` and `peerDependencies` scopes and two declaring-manifest evidence IDs.
- `vibery-games -> packages` with exact `dependencies` and `peerDependencies` scopes and one declaring-manifest evidence ID.

A `packages -> packages` declaration was present in evidence and correctly suppressed as a same-room self-loop. A second repository replaced all four labels with `services`, `clients`, `experiences`, and `libraries`; it retained the same four-room membership cardinalities and three-direction scope behavior under the renamed segments.

Production-source assertions found no fixture URL, Vibery package name, twelve-package special case, branch keyed to any fixture label, or imported LLM/provider module. Artifact keys also contain no model, prompt, completion, or provider-result surface.

## TDD and Task Commits

1. **Task 1 RED: Specify clone-independent acceptance** — `f654df3c9726ccf18b5fed931e71f6f3e263d49a`
2. **Task 1 GREEN: Prove clone-independent determinism** — `f862e5411d6f9bac00d5d7f46cf7b5f9a7904608`
3. **Task 2 RED: Specify generic twelve-workspace shape** — `73c091d4826370cffd555584652fee8504e882b1`
4. **Task 2 GREEN: Prove generic four-room projection** — `8303614a06d37cfd0051c9eabdf0a90d5df0b2f8`

## Verification Evidence

- `node --test integrations/vibery-station/test/determinism-acceptance.test.mjs` — PASS, 2/2.
- `node --test integrations/vibery-station/test/vibery-shape.test.mjs` — PASS, 2/2.
- Combined Plan 01-07 focused suite — PASS, 4/4; no skips.
- `node --test integrations/vibery-station/test/*.test.mjs` — PASS, 94/94 cumulative Station tests; no skips.
- `node --check` for all three plan-listed files — PASS.
- `git diff --check` — PASS.
- Scope guard — PASS: implementation commits contain only the three plan-listed integration test/helper files.
- Default `archify/bin/archify.mjs` object identity — unchanged at `07ad91ba3204c3a2ec5b52b5997d7cb5f7879702`.
- `archify.zip` object identity — unchanged at `f7fdf0f866c0d15385a81503e92e8bbbc4d81582`.

## Deviations from Plan

None. No production implementation change was required; the existing generic extractor satisfied both acceptance contracts.

## User Setup Required

None. All fixtures use temporary local Git repositories and the checked-in integration CLI without installs, network, providers, browsers, renderers, listeners, pushes, or PRs.

## Next Phase Readiness

Plan 01-08 can add the adversarial object/tamper/failure-injection matrix and final isolation proof. TEST-01 and TEST-03 are complete; BOUND-01 and TEST-02 remain pending.

## Self-Check: PASSED

All three plan artifacts exist, all four RED/GREEN commits are serial, both owned requirements are complete, and integration/default-package boundaries remain unchanged.

---
*Phase: 01-deterministic-immutable-commit-extraction*
*Completed: 2026-09-16*
