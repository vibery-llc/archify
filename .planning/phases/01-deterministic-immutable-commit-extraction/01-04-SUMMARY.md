---
phase: 01-deterministic-immutable-commit-extraction
plan: 04
subsystem: deterministic-station-projection
tags: [station-map, structural-groups, dependency-evidence, coarse-fallback, canonical-json, node-test]

requires:
  - phase: 01-03
    provides: Validated canonical station-evidence/v1 values, exact evidence bytes, complete workspace membership, and fallback reasons
provides:
  - Pure station-map/v1 projection bound to exact evidence SHA-256 and snapshot identity
  - Complete root or one-to-five first-path-segment rooms with disjoint exhaustive workspace membership
  - Exact aggregated directed cross-room declarations with sorted scopes and declaring-manifest evidence
  - One evidence-bound coarse room for every approved unsupported shape and out-of-range room count
  - Typed hard rejection for malformed, identity-inconsistent, unknown-reason, or byte-tampered evidence
affects: [01-05-independent-gate, 01-06-receipt-and-publication, 01-07-determinism-acceptance, 01-08-adversarial-closure]

tech-stack:
  added: []
  patterns: [pure evidence-to-map projection, structural-only topology, exact declaration aggregation, fail-closed coarse fallback, red-green TDD]

key-files:
  created:
    - integrations/vibery-station/lib/station-projector.mjs
    - integrations/vibery-station/test/station-projector.test.mjs
  modified: []

key-decisions:
  - "Treat the root package as the sole root-package room only for non-workspaces; for npm workspaces, detailed membership is exactly the declared workspace package-root set while the root manifest remains evidence rather than an invented extra path group."
  - "Aggregate a relation by ordered room endpoints, union exact declaration scopes and declaring manifest IDs, and suppress same-room declarations without converting them into topology."
  - "Collapse any approved evidence fallback or zero/more-than-five grouping to one project-root room containing all available selected-manifest evidence IDs and no detailed membership or relations."
  - "Use the valid root package name only when detail-eligible evidence is available for room-count fallback; otherwise use the canonical repository basename without changing room identity."

patterns-established:
  - "Detailed room labels expose only root-package or the exact first POSIX path segment; durable IDs derive from structural keys, never labels or package names."
  - "Evidence contract, canonical-byte equality, repository-derived project identity, and approved fallback codes are hard preconditions before projection."

requirements-completed: [MAP-02, MAP-03]

duration: 7 min
completed: 2026-09-16
---

# Phase 1 Plan 4: Complete structural projection and coarse fallback Summary

**Validated evidence now projects to canonical, evidence-bound Station maps containing either complete structural rooms with exact declaration-backed relations or one explicit relation-free coarse project room.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-09-16T15:39:51Z
- **Completed:** 2026-09-16T15:46:48Z
- **Tasks:** 2
- **Files modified:** 2 integration files plus 4 sequential planning documents

## Accomplishments

- Added a pure `projectStationMap(validatedEvidence, evidenceBytes)` boundary that validates the evidence contract, exact canonical bytes, repository-derived project identity, map contract, snapshot binding, and final canonical bytes.
- Projected a root package or every complete one-to-five first-path-segment workspace grouping with sorted, disjoint, exhaustive membership and structural-only labels.
- Aggregated exact cross-room declared package dependencies by ordered endpoint pair, preserving direction, the union of all four declaration scopes, and every declaring manifest evidence ID while suppressing same-room loops.
- Covered every approved evidence-builder fallback reason plus defensive zero/six-group room-count fallback as one coarse room with no package detail or relations.
- Kept malformed contracts, inconsistent repository/project identity, unknown fallback codes, and evidence-byte tampering as typed hard diagnostics rather than fallback.

## Detailed Fixture Matrix

| Fixture | Expected rooms | Membership/result |
|---|---:|---|
| Non-workspace root package | 1 | `root-package`, root `.` only, high confidence |
| One root-level workspace group | 1 | Exact `standalone` first segment; no requirement for a nested slash |
| Two workspace path groups | 2 | Every declared workspace root appears exactly once |
| Three workspace path groups | 3 | Complete, disjoint, ID-sorted rooms |
| Four workspace path groups | 4 | Complete, disjoint, ID-sorted rooms |
| Five workspace path groups | 5 | Complete, disjoint, ID-sorted rooms; no truncation |
| Permuted files/packages/roots/patterns | Same topology | Room/relation arrays remain ID-sorted; snapshot remains bound to the different exact evidence bytes |
| Package display-name changes at fixed roots | Same durable IDs | Room and relation IDs remain unchanged while the evidence-bound snapshot changes |

For every detailed workspace fixture, the sorted union of projected `package_roots` equals `workspace.package_roots`, every root occurs once, and each room contains only roots whose first POSIX path segment equals its structural label.

## Exact Relation Policy Evidence

The focused relation fixture contains `apps/api`, `apps/worker`, `packages/core`, and `packages/ui`:

- `apps → packages` is one relation aggregating exact declarations from both app manifests, with scopes `dependencies`, `devDependencies`, `optionalDependencies`, and `peerDependencies` and both declaring manifest evidence IDs.
- `packages → apps` is a distinct directed relation backed only by the `packages/ui` declaration and its exact manifest evidence ID.
- `apps/worker → apps/api` and `packages/core → packages/ui` remain declaration evidence but emit no same-room self-loop.
- An undeclared internal direction and an external package declaration emit no relation.
- Relation IDs derive only from the ordered room endpoint pair and remain unchanged after coordinated package display-name changes.

## Fallback Fixture Matrix

| Unsupported evidence class | Covered reason codes | Result |
|---|---|---|
| Missing root or selected workspace manifest | `root-manifest-missing`, `workspace-manifest-missing` | One coarse room, zero relations |
| Unsupported workspace declaration or pattern | `workspace-shape-unsupported`, `workspace-pattern-unsupported` | One coarse room, zero relations |
| Empty wildcard match or ambiguous roots | `workspace-match-empty`, `workspace-root-ambiguous` | One coarse room, zero relations |
| Non-regular, oversized, binary, invalid-encoding, or invalid manifest | `workspace-manifest-non-regular`, `workspace-manifest-oversized`, `workspace-manifest-binary`, `workspace-manifest-encoding-unsupported`, `workspace-manifest-invalid` | One coarse room, zero relations |
| Path collision | `path-collision` | One coarse room, zero relations |
| Count or aggregate-byte budget | `manifest-count-exceeded`, `selected-manifest-bytes-exceeded` | One coarse room, zero relations |
| Ambiguous package name/declaration | `package-name-ambiguous` | One coarse room, zero relations |
| Zero or six structural groups | `room-count-out-of-range` | One coarse room, zero relations; all available manifest evidence retained |
| Multiple approved reasons in unsorted input order | Unique code-point-sorted approved reasons | One coarse room, zero relations |

Every coarse room uses structural key `project-root`, `kind: coarse-project`, `confidence: coarse`, an empty `package_roots` array, all available selected-manifest evidence IDs sorted uniquely, and an identity derived from project ID plus the fixed structural key. No detailed room subset survives fallback.

## Task Commits

Each task used an atomic RED then GREEN sequence:

1. **Task 1 RED: Specify complete detailed structural projection** — `50a9c3e` (`test`)
2. **Task 1 GREEN: Project complete structural topology** — `1083f5b` (`feat`)
3. **Task 2 RED: Specify fail-closed coarse fallback** — `60c8596` (`test`)
4. **Task 2 GREEN: Collapse unsupported evidence to coarse truth** — `71b0d89` (`feat`)

**Plan metadata:** committed with this summary and the sequential GSD tracking updates.

## Files Created/Modified

- `integrations/vibery-station/lib/station-projector.mjs` — exact-byte validation, repository/project identity check, structural room projection, relation aggregation, room-count policy, coarse fallback, map validation, and canonical serialization.
- `integrations/vibery-station/test/station-projector.test.mjs` — eight focused tests spanning root and one-to-five groups, completeness, relation aggregation, ordering, durable IDs, all fallback reasons, room-count collapse, and hard diagnostics.
- `.planning/phases/01-deterministic-immutable-commit-extraction/01-04-SUMMARY.md` — fixture matrices, exact relation evidence, TDD commits, and verification record.
- `.planning/STATE.md` — current plan, metrics, decisions, and session continuity.
- `.planning/ROADMAP.md` — Plan 01-04 and phase progress.
- `.planning/REQUIREMENTS.md` — MAP-02 and MAP-03 completion and traceability.

## Decisions Made

- The npm workspace root manifest remains selected evidence but does not become an invented workspace group; detailed membership is exactly the complete `workspace.package_roots` set.
- Internal dependency resolution uses exact selected workspace package names only. Declarations aggregate by directed room pair and retain declaration scopes rather than claiming execution or causality.
- Fallback is a successful projection only for approved unsupported evidence or room-count policy; evidence contract, canonical-byte, and identity defects remain typed hard failures.
- Presentation labels never participate in project, room, relation, or snapshot topology identity.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None unresolved. A numeric assertion typo in the Task 2 RED fixture was corrected before the GREEN commit and final acceptance run.

## Verification Evidence

- `node --test integrations/vibery-station/test/station-projector.test.mjs` — PASS, 8/8 tests.
- `node --test integrations/vibery-station/test/*.test.mjs` — PASS, 56/56 cumulative Station tests.
- Relation completeness/property run (`--test-name-pattern='projects every complete|aggregates only exact'`) — PASS, 2/2 selected tests.
- `node --check` for both plan-listed files — PASS.
- `git diff --check 470b3c2...HEAD` — PASS.
- Required-base scope guard — PASS: only `station-projector.mjs` and its focused test changed before tracking documents.
- `archify.zip` guard against required base — PASS, unchanged.
- Projected label/kind semantic scan — PASS: no frontend, backend, service, database, owner, calls, causal, or runtime terminology.
- Implementation side-effect/truncation scan — PASS: no top-five slicing, filesystem, process, network, rendering, or layout call.
- TDD gate order — PASS: Task 1 RED → GREEN, then Task 2 RED → GREEN.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 01-05 can independently reconstruct the complete ledger and the only valid structural/coarse map, then byte-compare against these deterministic projector outputs.
- The projector exposes exact evidence binding, stable structural IDs, complete memberships, declaration provenance, and explicit fallback causes needed by the independent gate.
- No blockers remain; no installs, network access, LLMs, UI/rendering paths, workspace/branch changes, PRs, pushes, or unrelated source changes occurred.

## Self-Check: PASSED

- Both plan-listed integration files exist and all four RED/GREEN commits are present in order.
- Every task acceptance criterion, plan-level verification, relation-completeness property, semantic prohibition, syntax check, scope guard, and cumulative Station test passes.
- `requirements-completed` exactly matches plan frontmatter: `MAP-02`, `MAP-03`.

---
*Phase: 01-deterministic-immutable-commit-extraction*
*Completed: 2026-09-16*
