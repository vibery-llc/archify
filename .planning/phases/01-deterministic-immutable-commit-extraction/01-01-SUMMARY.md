---
phase: 01-deterministic-immutable-commit-extraction
plan: 01
subsystem: deterministic-contract-foundation
tags: [native-esm, json-schema, canonical-json, sha256, stable-identities, node-test]

requires: []
provides:
  - Strict zero-dependency v1 contracts for Station evidence, map, and extraction receipt artifacts
  - Canonical UTF-8 JSON bytes and exact-byte SHA-256 helpers
  - Versioned project, evidence, room, relation, and snapshot identity formulas
  - Stable integration-owned diagnostic envelopes
  - Explicit deterministic comparators for every contract-sorted domain array
affects: [01-02-immutable-git-reader, 01-03-evidence-ledger, 01-04-station-projector, 01-05-station-gate, 01-06-receipt-output]

tech-stack:
  added: []
  patterns: [zero-runtime-dependency native ESM, closed JSON contracts, strict JSON-domain canonicalization, NUL-separated versioned identities, red-green TDD]

key-files:
  created:
    - integrations/vibery-station/lib/canonical-json.mjs
    - integrations/vibery-station/lib/contracts.mjs
    - integrations/vibery-station/lib/diagnostics.mjs
    - integrations/vibery-station/lib/identity.mjs
    - integrations/vibery-station/schemas/station-evidence.schema.json
    - integrations/vibery-station/schemas/station-map.schema.json
    - integrations/vibery-station/schemas/station-extraction-receipt.schema.json
    - integrations/vibery-station/test/contracts-and-identity.test.mjs
    - integrations/vibery-station/package.json
  modified: []

key-decisions:
  - "Keep Station validation integration-owned and dependency-free, with runtime closed-field sets mechanically checked against all three schema documents."
  - "Accept artifact repository URLs only in identity-derived canonical HTTPS form for supported GitHub and Gitee identities; alternate transport spellings never enter artifacts."
  - "Hash exact canonical bytes and derive durable topology identities only from versioned structural inputs separated by NUL bytes."

patterns-established:
  - "Contract boundary: every object rejects unknown properties and raises station-gate/schema-invalid through the six-field Station diagnostic envelope."
  - "Canonical bytes: recursively sort object keys by direct comparison, preserve producer-sorted arrays, emit compact UTF-8 JSON plus exactly one LF."
  - "Identity boundary: durable project/room/relation IDs exclude revision and presentation data; snapshot IDs bind revision and evidence bytes."

requirements-completed: [EVID-02, MAP-01]

duration: 10 min
completed: 2026-09-16
---

# Phase 1 Plan 1: Isolated contracts, canonical bytes, and stable identities Summary

**Strict Station v1 artifact contracts now share a deterministic zero-dependency foundation of canonical UTF-8 bytes, exact SHA-256 hashing, and five versioned structural identity formulas.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-09-16T14:55:49Z
- **Completed:** 2026-09-16T15:06:07Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- Added closed `station-evidence/v1`, `station-map/v1`, and `station-extraction-receipt/v1` schemas plus matching importable runtime validators with stable `station-gate/schema-invalid` diagnostics.
- Added strict canonical JSON that rejects non-JSON, sparse, cyclic, accessor-backed, and non-plain values while producing exact compact UTF-8 bytes with one trailing LF.
- Added fixed-vector project, evidence, room, relation, and snapshot identities using the researched NUL-separated formulas and lowercase SHA-256 hex.
- Added domain comparators for files, packages, declarations, rooms, relations, evidence IDs, scopes, and fallback codes without locale-sensitive ordering.
- Proved receipt exclusion of timestamps, durations, local paths, branches, hosts, process/runtime/Git versions, self-hashes, and unknown fields.

## Task Commits

Each task used an atomic RED then GREEN sequence:

1. **Task 1 RED: Specify strict Station artifact contracts** - `56cea0b` (test)
2. **Task 1 GREEN: Define closed Station artifact contracts** - `cae1d5f` (feat)
3. **Task 2 RED: Specify canonical bytes and stable identities** - `fdf8025` (test)
4. **Task 2 GREEN: Implement canonical bytes and identities** - `84983c8` (feat)

**Plan metadata:** committed with this summary and the sequential GSD tracking updates.

## Files Created/Modified

- `integrations/vibery-station/package.json` - Private native-ESM Node 18+ package with no dependencies, install hooks, binary, or host registration.
- `integrations/vibery-station/schemas/station-evidence.schema.json` - Closed evidence ledger contract with repository, fixed limits, selected files, workspace/package facts, declarations, and analysis reasons.
- `integrations/vibery-station/schemas/station-map.schema.json` - Closed structural/coarse map contract for snapshots, projects, rooms, relations, and fallback state.
- `integrations/vibery-station/schemas/station-extraction-receipt.schema.json` - Closed deterministic receipt contract binding logical evidence/map files without self-hashing or volatile fields.
- `integrations/vibery-station/lib/contracts.mjs` - Integration-owned constants and strict validators kept in field-level lockstep with schema documents.
- `integrations/vibery-station/lib/diagnostics.mjs` - Exact six-field diagnostic factory and typed Station diagnostic error.
- `integrations/vibery-station/lib/canonical-json.mjs` - Strict canonical serializer, exact-byte SHA-256 helpers, and explicit domain comparators.
- `integrations/vibery-station/lib/identity.mjs` - Versioned NUL-separated identity derivation with explicit structural input validation.
- `integrations/vibery-station/test/contracts-and-identity.test.mjs` - Sixteen contract, canonical-byte, comparator, invalid-domain, fixed-vector, and identity-stability tests.

## Decisions Made

- Runtime validation remains handwritten and integration-local so the package has no AJV or other production dependency; tests compare every runtime closed-field set to its schema object.
- Successful receipt diagnostics are deterministically empty, while failures use the separate Station diagnostic envelope and are not serialized as successful receipts.
- Canonical repository artifact URLs are HTTPS canonical forms for supported GitHub/Gitee identities; SSH, SCP, `.git`, credentialed, and case-noncanonical GitHub spellings are rejected.
- No passed-plan contract deviation was discovered.

## Commands Run

- `node --test integrations/vibery-station/test/contracts-and-identity.test.mjs` — PASS, 16/16 tests.
- `node -e "const p=require('./integrations/vibery-station/package.json'); if (p.dependencies || p.devDependencies || p.scripts?.install || p.scripts?.postinstall || p.scripts?.prepare) process.exit(1)"` — PASS.
- `git diff --name-only -- integrations/vibery-station` — PASS, empty after atomic task commits.
- `git diff --name-only d673e8300df60a5c8166abe78787fdc78f6b8000..HEAD -- integrations/vibery-station` — PASS, exactly the nine plan-listed integration files.
- `node --check` over all integration `.mjs` runtime/test files and JSON parsing over all three schemas — PASS.
- Guardrail search for locale-sensitive ordering, ambient runtime values, network/process APIs, host/default CLI imports, Viewer, and Unity references — PASS, no matches.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 01-02 can build the immutable local Git object reader on the committed contract constants, diagnostics, canonical bytes, and identity helpers.
- No blockers remain; no installs, network access, UI/Viewer/Unity work, host registration, branch changes, PRs, or pushes occurred.

## Self-Check: PASSED

- All nine plan-listed integration files exist.
- All four RED/GREEN task commits exist on `feat/station-fail-closed-extractor`.
- All task acceptance checks and plan-level verification commands pass.
- `requirements-completed` exactly matches the plan frontmatter: `EVID-02`, `MAP-01`.

---
*Phase: 01-deterministic-immutable-commit-extraction*
*Completed: 2026-09-16*
