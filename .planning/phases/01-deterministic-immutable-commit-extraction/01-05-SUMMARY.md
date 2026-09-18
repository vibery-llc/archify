---
phase: 01-deterministic-immutable-commit-extraction
plan: 05
subsystem: independent-fail-closed-station-gate
tags: [independent-recomputation, canonical-bytes, mutation-testing, typed-diagnostics, publication-safety, node-test]

requires:
  - phase: 01-04
    provides: Canonical station-evidence/v1 and station-map/v1 producer outputs with structural and coarse policies
provides:
  - Independent exact-byte evidence reconstruction from the verified immutable reader session
  - Independent structural/coarse topology reconstruction without evidence-builder or projector imports
  - Stable schema, canonical, order, reference, evidence-identity, topology-identity, and unsupported-claim diagnostics
  - Frozen publication-safe success metadata with mutation-isolated exact buffers, hashes, identities, mode, and counts
affects: [01-06-receipt-and-publication, 01-07-determinism-acceptance, 01-08-adversarial-closure]

tech-stack:
  added: []
  patterns: [independent policy duplication, exact-byte admission, fail-closed typed diagnostics, defensive buffer getters, red-green TDD]

key-files:
  created:
    - integrations/vibery-station/lib/station-gate.mjs
    - integrations/vibery-station/test/station-gate.test.mjs
  modified: []

key-decisions:
  - "Reconstruct unsupported-path accounting, manifest-candidate inventory, count policy, selected manifests, packages, declarations, rooms, and relations directly from the reader session rather than trusting either producer artifact."
  - "Classify noncanonical bytes separately from semantic ordering, evidence/reference identity, topology identity, and unsupported claims while exposing only bounded logical paths in diagnostics."
  - "Expose accepted artifact buffers through defensive-copy getters because Node Buffers cannot be deeply frozen, while freezing all publication metadata and fallback reasons."

patterns-established:
  - "Gate success exists only after strict parse, canonical byte equality, complete independent evidence equality, and complete independent map equality all pass."
  - "Trustworthy policy excess can independently yield coarse success; object stat/read/probe disagreement always remains a typed hard failure."

requirements-completed: [GATE-01, GATE-02]

duration: 9 min
completed: 2026-09-16
---

# Phase 1 Plan 5: Independent fail-closed Station gate Summary

**Exact evidence and map bytes now reach publication metadata only after a separate authority reconstructs every ledger and topology fact from the immutable reader session.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-09-16T15:50:45Z
- **Completed:** 2026-09-16T15:59:42Z
- **Tasks:** 2
- **Files modified:** 2 integration files plus 4 sequential planning documents

## Accomplishments

- Added `gateStationArtifacts(evidenceBytes, mapBytes, readerSession)`, which fatal-decodes, strict-validates, canonical-reserializes, and exact-byte-compares both artifacts before admitting any claim.
- Independently revalidated the reader repository identity, fixed budgets, complete ordered tree inventory, manifest candidates, manifest-count policy, path decoding, and unsupported-path accounting.
- Duplicated the bounded npm workspace grammar and fallback policy intentionally, including exact-OID stat/reread, digest and evidence identity, selected-file accounting, pattern provenance, package fields, scoped declarations, ambiguity, and all counts.
- Independently rebuilt complete root/first-segment rooms and aggregated cross-room declarations, or the single approved coarse room, then byte-compared the one valid map.
- Added a table-driven mutation suite spanning detailed and coarse artifacts, stable diagnostics, false fallback, hard object inconsistency, diagnostic secrecy, and publication-result immutability.

## Independent Recomputation Matrix

| Authority area | Independently recomputed before success |
|---|---|
| Exact bytes | Buffer type, fatal UTF-8, JSON parse, closed v1 schema/profile, canonical key representation, exactly one canonical trailing LF, exact byte equality |
| Reader session | Canonical repository URL, revision, tree OID, SHA-1 format, fixed limits, inventory mode/type/OID/path bytes/order/uniqueness, manifest candidates/count policy, unsupported path facts |
| Manifest selection | Root manifest, both npm workspace forms, exact roots, terminal `*`, wildcard matches, provenance, duplicate/overlapping/colliding roots, selected count and aggregate sizes |
| Blob evidence | Exact OID size probes, per-file policy, reread agreement, UTF-8/JSON/package validity, SHA-256, byte count, evidence ID, selected-file completeness |
| Package ledger | Root/name/private fields, workspace pattern, package roots, duplicate names, four declaration scopes, conflicting versions, deterministic package/declaration order |
| Evidence analysis | Detail eligibility, discovered/selected/represented counts, complete approved reason set, no partial packages during fallback |
| Structural map | Project/snapshot identities, root or first-segment grouping, 1–5 complete disjoint rooms, labels/keys/IDs/confidence/membership/evidence/order |
| Relations | Exact internal-name resolution, endpoint direction, cross-room-only aggregation, scopes, declaring-manifest evidence, IDs, completeness, and order |
| Coarse map | Independently proven reasons, one `project-root` coarse room, repository/root-package label, all available evidence, no membership, zero relations |
| Publication facts | Exact evidence/map hashes and defensive Buffer copies, repository facts, project/snapshot IDs, mode, room/relation counts, fallback flag/reasons |

## Mutation-to-Diagnostic Matrix

| Mutation class | Stable result |
|---|---|
| Invalid UTF-8/JSON, unknown fields, unsupported schemas/profiles/limits, impossible structural/coarse shape | `station-gate/schema-invalid` |
| Parseable but noncanonical whitespace/LF/object representation | `station-gate/canonical-mismatch` |
| File/package/declaration/scope/room/relation array permutation | `station-gate/order-mismatch` |
| Missing or invented manifest evidence reference | `station-gate/evidence-reference-missing` |
| Repository/revision/tree/project evidence identity, selected-file set, OID/digest/bytes/evidence ID, reader inventory/probe/read mismatch | `station-gate/evidence-identity-mismatch` |
| Project/snapshot/evidence-hash/revision/room/relation identity mutation in the map | `station-gate/topology-identity-mismatch` |
| Workspace provenance/membership/package/declaration/count claim, room membership/evidence/label/key, relation endpoint/scope/evidence/completeness, or false/replaced fallback | `station-gate/unsupported-claim` |
| Exact per-manifest policy excess independently proven from size probe | Frozen coarse success with the exact approved reason |
| Blob unavailable, malformed probe, or probe/read disagreement | Typed hard failure only; no result and no fallback synthesis |

All diagnostics retain the exact Station envelope and bounded logical subjects only. The focused guard proves no absolute temporary path, credential-bearing URL, raw bytes, stack, warning, or partial result is serialized.

## TDD and Task Commits

1. **Task 1 RED: Specify independent evidence and topology gate** — `069a43d6053284e2112d3fff8025165e9af366ac`
2. **Task 1 GREEN: Independently rederive evidence and topology** — `dd7812afff9d21264b66f83dc328af28ddb99f23`
3. **Task 2 RED: Specify publication-safe gate result** — `517630be5b8c4fa9d61b85935d9eea28950410f2`
4. **Task 2 GREEN: Expose publication-safe gate success** — `aca14594efb3a291985dbbe9a4c6f29ab252b0d9`
5. **Coverage closure: Complete coarse mutation matrix** — `46ac4bf1bb77197a0a333dc1156b8149476d0ef4`

**Plan metadata:** committed with this summary and sequential GSD tracking updates.

## Files Created/Modified

- `integrations/vibery-station/lib/station-gate.mjs` — independent reader/session verification, evidence reconstruction, topology reconstruction, typed mismatch classification, and frozen publication result.
- `integrations/vibery-station/test/station-gate.test.mjs` — sixteen focused acceptance, mutation, policy-boundary, diagnostic, and immutability tests.
- `.planning/phases/01-deterministic-immutable-commit-extraction/01-05-SUMMARY.md` — recomputation and diagnostic matrices plus execution evidence.
- `.planning/STATE.md` — Plan 01-05 completion, decisions, metrics, and continuity.
- `.planning/ROADMAP.md` — Plan 01-05 and phase progress.
- `.planning/REQUIREMENTS.md` — GATE-01 and GATE-02 completion and traceability.

## Decisions Made

- Independence is enforced as an import boundary and a policy boundary: the gate imports only Node UTF-8 support plus Station contracts, canonical primitives, and identity primitives; it never imports either producer.
- Reader-session internals are not blindly trusted. Inventory ordering/path bytes, candidate membership, count policy, unsupported-path facts, repository identity, and budgets are checked again before object rereads.
- Canonical representation defects receive a dedicated diagnostic before semantic recomputation; canonical array permutations receive a distinct ordering diagnostic.
- Buffer immutability is provided by defensive-copy getters because freezing a Node Buffer does not provide a valid deep-immutable publication payload.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None unresolved.

## Verification Evidence

- `node --test integrations/vibery-station/test/station-gate.test.mjs` — PASS, 16/16 tests.
- Focused mutation name-pattern suite — PASS, 15/15 selected mutation/guard tests.
- `node --test integrations/vibery-station/test/*.test.mjs` — PASS, 72/72 cumulative Station tests.
- Exact forbidden-import scan for both producer module/function names — PASS, zero matches.
- `node --check` for both plan-listed files — PASS.
- `git diff --check a45f3aa9fdcf28fb94d5242106ff502eccd5ee7a...HEAD` — PASS.
- Side-effect scan for filesystem, child process, HTTP/fetch, publication, rendering, browser, and preview paths — PASS, zero matches.
- Diagnostic secret/path guard — PASS; no credential, absolute fixture path, stack, warning, or result leaked.
- Required-base scope guard before tracking docs — PASS, exactly `station-gate.mjs` and `station-gate.test.mjs`.
- `archify.zip` object identity against required base — PASS, unchanged at `f7fdf0f866c0d15385a81503e92e8bbbc4d81582`.
- TDD order — PASS: Task 1 RED → GREEN, Task 2 RED → GREEN, then coarse mutation coverage closure.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 01-06 can build the receipt exclusively from the frozen gate result and can obtain mutation-isolated exact artifact Buffers for immutable-generation publication.
- No blockers remain; no installs, network access, publication, UI/rendering, workspace/branch changes, PRs, pushes, or unrelated changes occurred.

## Self-Check: PASSED

- Both plan-listed integration files and this summary exist; all five implementation/test commits are present in serial order.
- Every task criterion, mutation matrix, plan-level verification, forbidden-import boundary, syntax/diff/scope guard, and cumulative Station suite passes.
- `requirements-completed` exactly matches plan frontmatter: `GATE-01`, `GATE-02`.

---
*Phase: 01-deterministic-immutable-commit-extraction*
*Completed: 2026-09-16*
