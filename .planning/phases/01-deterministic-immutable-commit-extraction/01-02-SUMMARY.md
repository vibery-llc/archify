---
phase: 01-deterministic-immutable-commit-extraction
plan: 02
subsystem: immutable-git-object-reader
tags: [git-plumbing, sha1, nul-protocol, bounded-io, native-esm, node-test]

requires:
  - phase: 01-01
    provides: Station diagnostics, contract constants, canonical repository URL rules, and stable identity foundation
provides:
  - Exact top-level SHA-1 commit acceptance with direct object typing and canonical repository identity matching
  - Sanitized local-only Git process boundary with replacement objects and lazy fetching disabled
  - Complete bounded raw tree inventory with path-policy classifications and exact object modes
  - Exact-OID blob size probes and integrity-ceiling reads with typed fail-closed diagnostics
affects: [01-03-evidence-ledger, 01-05-station-gate, 01-07-determinism-acceptance, 01-08-adversarial-closure]

tech-stack:
  added: []
  patterns: [synchronous shell-free Git plumbing, raw NUL-delimited Buffer parsing, fatal UTF-8 decoding, explicit policy-versus-integrity boundaries, red-green TDD]

key-files:
  created:
    - integrations/vibery-station/lib/git-object-reader.mjs
    - integrations/vibery-station/test/helpers/git-fixture.mjs
    - integrations/vibery-station/test/git-object-reader.test.mjs
  modified: []

key-decisions:
  - "Require the supplied 40-hex object itself to have Git type commit before verifying its peeled commit, so a full annotated-tag object ID cannot cross the immutable revision boundary."
  - "Treat malformed, incomplete, duplicate, or over-budget tree protocol as a hard failure while preserving every trustworthy entry and explicitly classifying unsupported path spellings and aliases for later coarse fallback."
  - "Return all discovered package.json entries with explicit count-policy status; exact per-blob sizes remain evidence-layer policy inputs, while attempted reads beyond an integrity ceiling fail closed."
  - "Give blob subprocesses bounded diagnostic headroom, then enforce the caller's stdout integrity ceiling and exact prior size independently so missing objects remain distinguishable from output overflow."

patterns-established:
  - "Git allowlist: rev-parse top-level/object-format/tree, remote get-url origin, cat-file type/existence/size/blob, and one recursive raw ls-tree enumeration."
  - "Every Git call uses Buffer output, shell false, a fixed cwd, bounded maxBuffer, minimal inherited executable lookup, C locale, no pager/prompt/optional locks, and forced no-replace/no-lazy-fetch settings."
  - "Object inventory retains mode, type, OID, decoded path when valid, and authoritative raw path bytes; unsupported paths are classified without silent omission."

requirements-completed: [GIT-01, GIT-02, GIT-03]

duration: 9 min
completed: 2026-09-16
---

# Phase 1 Plan 2: Immutable local Git object reader Summary

**A shell-free local Git trust boundary now accepts only one directly typed SHA-1 commit and returns a complete bounded raw tree inventory plus exact-OID blob evidence, or a stable typed failure.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-09-16T15:12:07Z
- **Completed:** 2026-09-16T15:21:28Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added exact physical top-level, authored URL, origin identity, object-format, direct commit-type, peeled commit, and tree-OID validation without exposing absolute roots or raw Git stderr.
- Normalized equivalent standard GitHub/Gitee HTTPS, SSH URI, and SCP identities to one Station HTTPS URL while retaining semantically distinct internal transport/port/path identities.
- Added one 16 MiB `git ls-tree -rz --full-tree` read with raw header/path separation, strict mode/type/OID checks, fatal UTF-8 handling, duplicate rejection, deterministic raw-byte sorting, and explicit control/shape/case/NFC classifications.
- Added exact `git cat-file -s <oid>` probes and `git cat-file blob <oid>` reads that reject malformed sizes, missing objects, policy-over-ceiling attempts, process overflow, and probe/read disagreement.
- Proved replacement refs, current branch, dirty/deleted/untracked files, symlink/gitlink modes, malformed protocol, path collisions, absent objects, and an annotated tag cannot change or fabricate accepted evidence.

## Accepted Git Command Allowlist

1. `git rev-parse --show-toplevel`
2. `git remote get-url origin`
3. `git rev-parse --show-object-format`
4. `git cat-file -t <revision>`
5. `git cat-file -e <revision>^{commit}`
6. `git rev-parse <revision>^{tree}`
7. `git ls-tree -rz --full-tree <revision>`
8. `git cat-file -s <oid>`
9. `git cat-file blob <oid>`

No implementation path invokes a shell, repository-content filesystem read, remote operation, worktree mutation, external conversion, or content filter.

## Diagnostic Codes

- Input and identity: `station-extract/root-unreadable`, `station-extract/root-not-top-level`, `station-extract/url-invalid`, `station-extract/origin-mismatch`, `station-extract/revision-invalid`, `station-extract/revision-unavailable`, `station-extract/object-format-unsupported`, `station-extract/git-unavailable`.
- Tree integrity: `station-extract/tree-unreadable`, `station-extract/tree-protocol-invalid`, `station-extract/tree-budget-exceeded`.
- Unsupported path classifications: `station-extract/path-encoding-unsupported`, `station-extract/path-control-unsupported`, `station-extract/path-shape-unsupported`, `station-extract/path-case-collision`, `station-extract/path-nfc-collision`.
- Blob integrity: `station-extract/object-unavailable`, `station-extract/object-size-invalid`, `station-extract/object-size-mismatch`, `station-extract/object-budget-exceeded`.

## Fixed Budgets and Policy Decisions

- Complete tree output: **16 MiB**; truncation or overflow is a hard failure because completeness cannot be proven.
- Discovered `package.json` paths: **512**; all candidates remain accounted for and `manifestPolicy.exceeded` explicitly delegates whole-project coarse fallback to the evidence layer.
- Selected manifest bytes: **1 MiB per manifest** and **8 MiB total**; exported as immutable contract constants for evidence-layer policy accounting.
- A sound exact size above policy is not partially read. Calling `readBlob` beyond its supplied integrity ceiling fails explicitly; unavailable bytes or size disagreement remain hard integrity failures.

## Task Commits

Each task used an atomic RED then GREEN sequence:

1. **Task 1 RED: Specify immutable repository trust boundary** - `269933149949d2960cff344994c5bfa47fbe0ac0` (test)
2. **Task 1 GREEN: Validate immutable repository inputs** - `af812158d9e787b2c422ad3a1d72fbcd2cf2032d` (feat)
3. **Task 2 RED: Specify bounded tree and blob reads** - `7ca5cb4bc33b8e0ff43d672d6bd3a1c0aa975a0e` (test)
4. **Task 2 GREEN: Read bounded tree and blob objects** - `3ebfb715c46c635a38d374031f808bd549a5bb1a` (feat)

**Plan metadata:** committed with this summary and the sequential GSD tracking updates.

## Files Created/Modified

- `integrations/vibery-station/lib/git-object-reader.mjs` - Immutable repository validation, sanitized Git runner, raw tree parser, fixed budgets, path classifications, and exact blob operations.
- `integrations/vibery-station/test/helpers/git-fixture.mjs` - Provider-free temporary repositories, synthetic raw trees, missing objects, committed revisions, process recording, and mutation snapshots.
- `integrations/vibery-station/test/git-object-reader.test.mjs` - Seventeen focused trust-boundary, protocol, budget, path, replacement, object, and worktree-independence tests.

## Decisions Made

- Direct `cat-file -t` object typing is mandatory before `^{commit}` verification; peeling alone would incorrectly accept an annotated-tag object ID.
- Raw path bytes remain authoritative and inventory entries are never silently dropped; path encoding and portability hazards are later fallback evidence, not tree-integrity escape hatches.
- Manifest count excess is represented explicitly without truncation. Per-manifest and aggregate byte policy remain evidence-layer decisions based on exact probes.
- Blob process limits include small bounded stderr headroom so a missing object is typed as unavailable rather than mistaken for stdout overflow; the output bytes still face an independent exact ceiling.

## Verification Evidence

- `node --test integrations/vibery-station/test/git-object-reader.test.mjs` — PASS, 17/17 tests.
- `node --test integrations/vibery-station/test/*.test.mjs` — PASS, 33/33 Station tests.
- `node --check` for the reader, fixture, and focused test — PASS.
- Guardrail search for repository-content reads, worktree mutation commands, remote operations, shell execution, archive/conversion/filter paths — PASS, no implementation hits.
- Scope diff from base `5114b3105b539af1188c703a6e01c5746b30f822` — PASS, exactly the three plan-listed integration files before tracking docs.
- `archify.zip` diff from the required base — PASS, unchanged.
- Fixture state snapshots — PASS: `HEAD`, raw index bytes, and `git status --porcelain=v1 -z` are identical before/after reads.
- Direct annotated-tag coverage — PASS: a full tag-object OID is observed as `tag` and rejected with `station-extract/revision-unavailable`.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The first GREEN run exposed a test-order assumption for invalid UTF-8 paths after required raw-byte sorting; the assertion was corrected to check complete accounting independent of position.
- A one-byte integrity ceiling also bounded Git's missing-object stderr and initially looked like output overflow. The runner now allows bounded diagnostic headroom while independently enforcing exact stdout bytes and the caller's ceiling.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 01-03 can consume the complete inventory, unsupported-path classifications, manifest candidate accounting, exact size probes, and exact blob bytes without consulting checkout files.
- No blockers remain; no installs, network access, workspace/branch changes, PRs, pushes, or default Archify surface changes occurred.

## Self-Check: PASSED

- All three plan-listed integration files exist and are committed.
- All four RED/GREEN task commits exist on `feat/station-fail-closed-extractor` in the required order.
- Every task acceptance check and plan-level verification passes, including direct annotated-tag object typing.
- `requirements-completed` exactly matches the plan frontmatter: `GIT-01`, `GIT-02`, `GIT-03`.

---
*Phase: 01-deterministic-immutable-commit-extraction*
*Completed: 2026-09-16*
