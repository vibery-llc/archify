---
phase: 01-deterministic-immutable-commit-extraction
plan: 03
subsystem: bounded-node-workspace-evidence
tags: [npm-workspaces, git-blobs, canonical-json, fallback-policy, native-esm, node-test]

requires:
  - phase: 01-02
    provides: Complete immutable Git inventory, exact-OID size probes, bounded blob reads, and path-policy classifications
provides:
  - Canonical station-evidence/v1 values and exact bytes derived only from immutable reader sessions
  - Bounded root/npm workspace selection with exact and terminal-segment wildcard provenance
  - Exact manifest OID, SHA-256, byte-count, evidence-ID, package, private-state, and scoped declaration records
  - Whole-project fallback taxonomy that never converts reader/object integrity failures or emits partial package detail
affects: [01-04-structural-projection, 01-05-independent-gate, 01-07-determinism-acceptance, 01-08-adversarial-closure]

tech-stack:
  added: []
  patterns: [pure immutable-reader consumption, two-stage size policy, whole-project fallback, exact scoped declaration ledger, red-green TDD]

key-files:
  created:
    - integrations/vibery-station/lib/node-workspace-evidence.mjs
    - integrations/vibery-station/test/node-workspace-evidence.test.mjs
  modified: []

key-decisions:
  - "Represent the valid root manifest as package root '.' with the explicit root-package marker, while npm workspace package_roots contains only matched workspace members."
  - "Suppress every package record whenever any selected manifest or package declaration makes detail ineligible; retain only complete file evidence that was safely read and explicit sorted reasons."
  - "Treat duplicate package names and conflicting version strings for one dependency across scopes as station-fallback/package-name-ambiguous because the v1 declaration ledger intentionally omits version ranges."
  - "Read only the bounded root manifest needed to discover workspace selection, then probe every selected exact OID before any workspace content read and stop all detail reads when size policy is exceeded."

patterns-established:
  - "Supported workspace grammar is exactly a non-empty npm workspaces array or {packages: [...]} containing repository-relative exact roots or one terminal '*' segment."
  - "Dependency evidence preserves exact names and sorted scopes across dependencies, devDependencies, optionalDependencies, and peerDependencies without runtime-call semantics."
  - "Policy excess yields successful whole-project fallback; stat/read unavailability, malformed probes, and probe/read disagreement propagate as hard failures."

requirements-completed: [EVID-01]

duration: 8 min
completed: 2026-09-16
---

# Phase 1 Plan 3: Bounded Node workspace evidence ledger Summary

**A pure immutable-reader builder now emits canonical `station-evidence/v1` bytes with complete manifest/package/declaration linkage or one explicit whole-project fallback assessment.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-09-16T15:28:00Z
- **Completed:** 2026-09-16T15:35:48Z
- **Tasks:** 2
- **Files modified:** 2 integration files plus 4 sequential planning documents

## Accomplishments

- Selected root and npm workspace manifests only from the reader's complete Git inventory, supporting both workspace declaration forms, exact roots, and one terminal wildcard segment without filesystem globbing.
- Bound every safely read selected manifest to its exact path, Git blob OID, SHA-256, byte count, and evidence ID; package records resolve back to those exact files.
- Preserved exact package name/private facts and declarations across all four npm scopes, sorted by name and scope without claiming runtime behavior.
- Enforced 512 discovered manifests, 1 MiB per manifest, and 8 MiB aggregate selected-byte boundaries, with exact-boundary acceptance and whole-project fallback above each threshold.
- Guaranteed that any unsupported selected set has zero package records and zero represented manifests; reader/object inconsistency remains a thrown hard failure.

## Supported Workspace Grammar

- Root `package.json` is mandatory and must be one regular Git blob with a non-empty string `name`; optional `private` must be boolean.
- No `workspaces` field means one root package represented by root `.` and marker `root-package`.
- Workspaces accept only a non-empty string array or an object containing exactly one `packages` string array.
- Patterns accept repository-relative POSIX exact roots or one final `*` path segment, including root `*`; empty, dot, parent, absolute, backslash, embedded glob, brace, bracket, question-mark, and recursive-glob forms are unsupported.
- Every matched root must have exactly one disjoint, unambiguous `package.json`; case/NFC aliases, duplicate matches, and ancestor/descendant workspace roots disable detail.

## Fallback Reason Taxonomy

| Reason | Trigger |
|---|---|
| `station-fallback/root-manifest-missing` | No exact root `package.json` exists. |
| `station-fallback/workspace-shape-unsupported` | The npm workspace declaration has an unsupported type, object shape, or empty list. |
| `station-fallback/workspace-pattern-unsupported` | A workspace pattern is outside the exact/terminal-segment grammar. |
| `station-fallback/workspace-match-empty` | A supported wildcard matches no workspace manifest. |
| `station-fallback/workspace-manifest-missing` | An exact workspace root has no manifest. |
| `station-fallback/workspace-manifest-non-regular` | A selected manifest is not a regular Git blob. |
| `station-fallback/workspace-manifest-oversized` | A selected exact-OID size is greater than 1 MiB. |
| `station-fallback/workspace-manifest-binary` | Selected bytes contain NUL. |
| `station-fallback/workspace-manifest-encoding-unsupported` | Selected bytes are not fatal-valid UTF-8. |
| `station-fallback/workspace-manifest-invalid` | JSON parsing or required package/dependency field typing fails. |
| `station-fallback/workspace-root-ambiguous` | Multiple patterns select one root or selected roots overlap. |
| `station-fallback/path-collision` | Selected roots collide by case or NFC spelling. |
| `station-fallback/manifest-count-exceeded` | More than 512 `package.json` paths were discovered. |
| `station-fallback/selected-manifest-bytes-exceeded` | Selected exact sizes total more than 8 MiB. |
| `station-fallback/package-name-ambiguous` | Selected package names duplicate or one dependency name has conflicting version strings across scopes. |

`station-fallback/room-count-out-of-range` remains projector-owned and is not emitted by this evidence builder.

## Integrity Failures That Never Become Fallback

- Exact-OID stat/read object unavailability.
- Malformed or unsafe size probes.
- Probe/read byte-count disagreement.
- Reader tree/protocol incompleteness or any earlier repository-integrity diagnostic.
- Malformed reader session or repository identity that cannot satisfy the strict evidence contract.

## Task Commits

Each task used an atomic RED then GREEN sequence:

1. **Task 1 RED: Specify bounded immutable manifest selection** — `b4b0a16434ba93ebe03392f6061a9c1357097ac5` (`test`)
2. **Task 1 GREEN: Select and parse immutable manifests** — `bac07b06a15fda0b3c4e648a7a4789807fad307c` (`feat`)
3. **Task 2 RED: Specify the complete canonical ledger** — `ba6724d598dae69329e00df8dc4580ff7fd30ef1` (`test`)
4. **Task 2 GREEN: Emit exact evidence and scoped declarations** — `3dc47991e273b7c5cc033f4fce999430f4e3999d` (`feat`)
5. **Regression RED: Cover a root terminal wildcard** — `3e931b96aee32f85ea95e1d213a9b8e9ca0d1edd` (`test`)
6. **Regression GREEN: Match root terminal wildcard** — `e6780e44ba1b9f5691311b798218a8cf42cff1c0` (`fix`)

**Plan metadata:** committed with this summary and the sequential GSD tracking updates.

## Files Created/Modified

- `integrations/vibery-station/lib/node-workspace-evidence.mjs` — bounded selection, decoding, policy classification, exact file/package/declaration records, validation, and canonical bytes.
- `integrations/vibery-station/test/node-workspace-evidence.test.mjs` — fifteen focused grammar, boundary, integrity, linkage, ordering, ambiguity, and real-reader integration tests.
- `.planning/phases/01-deterministic-immutable-commit-extraction/01-03-SUMMARY.md` — execution evidence and fallback taxonomy.
- `.planning/STATE.md` — current plan, metrics, decisions, and session continuity.
- `.planning/ROADMAP.md` — Plan 01-03 and phase progress.
- `.planning/REQUIREMENTS.md` — EVID-01 completion and traceability.

## Decisions Made

- Root package evidence remains explicit even for workspace repositories, but workspace membership lists only matched workspace roots so later projection can distinguish the structural root marker.
- Any fallback reason suppresses the complete package array rather than preserving whichever manifests happened to parse; safely read file evidence may remain because its OID/digest/size facts are complete and independently verifiable.
- Dependency version strings are validated but omitted by the v1 contract. Conflicting strings for one dependency across scopes therefore become an ambiguity fallback instead of being silently collapsed.
- Size policy is distinct from integrity: trustworthy excess is fallback, while any object/probe/read inconsistency throws unchanged.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Supported a terminal wildcard directly at repository root**
- **Found during:** Task 2 acceptance review
- **Issue:** The initial segment matcher handled `packages/*` but constructed `/` as the prefix for the valid root pattern `*`, causing a false empty-match fallback.
- **Fix:** Added a failing one-segment regression test and treated an empty wildcard prefix as repository root without allowing nested matches.
- **Files modified:** `integrations/vibery-station/lib/node-workspace-evidence.mjs`, `integrations/vibery-station/test/node-workspace-evidence.test.mjs`
- **Verification:** Focused suite passes 15/15, including root `*` and nested exclusion.
- **Committed in:** `3e931b96aee32f85ea95e1d213a9b8e9ca0d1edd` and `e6780e44ba1b9f5691311b798218a8cf42cff1c0`

---

**Total deviations:** 1 auto-fixed bug. **Impact:** Required grammar coverage was completed without expanding scope or weakening any boundary.

## Issues Encountered

- No unresolved issues. The terminal-root wildcard defect was caught by an added RED regression before final verification and fixed atomically.

## Verification Evidence

- `node --test integrations/vibery-station/test/node-workspace-evidence.test.mjs` — PASS, 15/15 tests.
- `node --test integrations/vibery-station/test/*.test.mjs` — PASS, 48/48 cumulative Station tests.
- `node --check` for both plan-listed files — PASS.
- Evidence-reference walk — PASS: every package manifest ID resolves to one file at `<root>/package.json`, with recomputed evidence ID, SHA-256, and byte count.
- Four-scope/unsupported-field assertions — PASS: all allowed scopes are preserved; scripts/imports do not create declarations or appear in output.
- Integrity-vs-policy assertions — PASS: count/per-file/aggregate excess is fallback; stat/read/probe mismatch remains hard failure.
- Implementation guardrail search — PASS: no filesystem, subprocess, network, package-manager, checkout, or worktree access in the builder.
- Scope diff from required base `8513246f0038413a04d7d21e3814b2f607d7029c` — PASS, exactly the two plan-listed integration files before tracking docs.
- `archify.zip` diff from the required base — PASS, unchanged.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 01-04 can project only validated evidence values and exact evidence bytes, using `workspace.kind`, root/workspace provenance, complete package roots, exact declarations, and sorted fallback reasons.
- No blockers remain; no installs, network access, package-manager execution, workspace/branch changes, PRs, pushes, or unrelated file changes occurred.

## Self-Check: PASSED

- Both plan-listed integration files exist and all six RED/GREEN/regression commits are present in order.
- Every task acceptance criterion and plan-level verification passes.
- The summary records the complete supported grammar, fallback taxonomy, hard-failure boundary, exact tests, and one auto-fixed deviation.
- `requirements-completed` exactly matches plan frontmatter: `EVID-01`.

---
*Phase: 01-deterministic-immutable-commit-extraction*
*Completed: 2026-09-16*
