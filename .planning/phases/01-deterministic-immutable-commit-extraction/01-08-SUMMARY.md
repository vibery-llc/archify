---
phase: 01-deterministic-immutable-commit-extraction
plan: 08
subsystem: adversarial-closure-and-isolation-proof
tags: [hostile-git, fallback-budgets, gate-tamper, atomic-publication, no-network, isolation, node-test]

requires:
  - phase: 01-07
    provides: Clone-independent exact-byte acceptance and generic twelve-workspace topology proof
provides:
  - Explicit 45-row hostile Git/path/manifest/resource/fallback matrix with real-CLI and narrow in-process seam evidence
  - Explicit 64-row independent evidence/map tamper matrix with zero publication calls
  - Explicit 22-row immutable-generation/CURRENT failure, interruption, concurrency, and recovery matrix
  - Explicit 26-row no-network/import/Git-command/default-core isolation matrix
  - Final Phase 1 evidence: 129/129 provider-free Station tests, zero skips, unchanged default core tree and archive

affects: [phase-01-completion, future-station-host-integration]

tech-stack:
  added: []
  patterns: [enumerated executable matrices, hostile local Git fixtures, test-only primitive blocker, static import allowlist, command audit, retained immutable recovery]

key-files:
  created:
    - integrations/vibery-station/test/helpers/no-network.cjs
    - integrations/vibery-station/test/adversarial-extraction.test.mjs
    - integrations/vibery-station/test/gate-tamper.test.mjs
    - integrations/vibery-station/test/atomic-failure.test.mjs
    - integrations/vibery-station/test/isolation.test.mjs
  modified: []

key-decisions:
  - "Make every Plan 01-08 acceptance class a named executable matrix row and fail the suite if any declared row is not exercised."
  - "Use the real CLI for repository-constructible hostility and only inject the immutable reader/process or output-operation seam for malformed protocols and impossible-to-time filesystem failures."
  - "Block network clients, listeners, DNS, browser/process launch, and every non-Git child process in a preload while separately auditing the exact local Git command allowlist."
  - "Treat complete evidence retained beneath a more-than-five-group coarse map as truthful full ledger evidence, while requiring the map itself to contain one coarse room, no memberships, and no relations."

patterns-established:
  - "Closure suites export canonical row lists, mark rows only after assertions pass, and end with an exact no-omissions equality check."
  - "Hard-failure acceptance seeds a trusted generation first and compares CURRENT plus all three authoritative Buffers byte-for-byte after each hostile attempt."
  - "Isolation acceptance combines dynamic blockers, static import edges, child-command audit, baseline Git diff, default CLI smoke, and archive object/hash identity."

requirements-completed: [BOUND-01, TEST-02]

duration: 16 min
completed: 2026-09-16
---

# Phase 1 Plan 8: Adversarial Closure and Isolation Proof Summary

**Phase 1 closes with executable, provider-free proof that hostile evidence fails or falls back exactly by policy, tampering never reaches publication, CURRENT selects complete immutable generations, and the Station profile cannot invoke or alter default Archify surfaces.**

## Performance

- **Started:** 2026-09-16T16:34:26Z
- **Completed:** 2026-09-16T16:50:02Z
- **Duration:** 16 min
- **Tasks:** 3
- **Implementation files:** exactly five plan-listed test/helper files
- **Production behavior changes:** none

## Hostile Extraction Matrix — 45/45

All rows execute, and the final matrix assertion reports no omissions:

1. Replacement isolation: `replacement-commit`, `replacement-tree`, `replacement-blob` — active refs are present, but the real CLI succeeds from the named original objects because replacement objects are disabled.
2. Revision typing: `branch-revision`, `tag-revision`, `abbreviated-revision`, `blob-revision`, `tree-revision` — mutable/abbreviated names are invalid and direct non-commit OIDs are unavailable as commits.
3. Local object availability: `missing-commit`, `missing-tree`, `missing-blob` — each is nonzero, never coarse, and preserves prior authority with lazy fetch disabled.
4. Repository identity/root/format: `wrong-origin`, `missing-origin`, `credentialed-origin-redaction`, `non-top-level-root`, `unsupported-object-format` — diagnostics are stable and credentials are absent from output.
5. Tree protocol: `malformed-tree-protocol`, `incomplete-tree-protocol`, `tree-output-over-budget` — injected only through the real orchestrator's reader seam; publication is never called.
6. Manifest and path classes: `manifest-symlink`, `manifest-gitlink`, `manifest-binary-nul`, `manifest-invalid-utf8`, `control-character-path`, `invalid-path-shape`, `case-collision`, `unicode-nfc-collision`.
7. Structural fallback: `unsupported-glob`, `missing-root-manifest`, `malformed-manifest`, `oversized-manifest`, `zero-workspace-matches`, `duplicate-package-identity`, `more-than-five-groups`.
8. Policy boundaries: `manifest-count-512`, `manifest-count-513`, `manifest-bytes-1mib`, `manifest-bytes-1mib-plus-one`, `selected-bytes-8mib`, `selected-bytes-8mib-plus-one`.
9. Integrity failures: `object-unavailable`, `malformed-size-probe`, `probe-read-disagreement`, `process-output-overflow` — all remain hard failures and retain the complete prior three-file authority.
10. NUL framing: `nul-safe-space-tab-newline-paths` — spaces, tabs, and newlines remain distinct complete records.

Every fallback row asserts the exact approved reason set, one `coarse-project` room, coarse confidence, no room memberships, zero relations, and no partial topology. Control/invalid raw-path rows additionally assert their reader classification; with no root manifest, their exact approved coarse cause is `station-fallback/root-manifest-missing`. The more-than-five-group case retains the complete detailed evidence ledger but exposes no partial map claim.

## Evidence and Map Tamper Matrix — 64/64

Every row invokes the real independent gate through the orchestrator, asserts one stable `station-gate/*` code, and proves zero publication calls:

- Contract/schema: `evidence-schema`, `map-schema`, `profile`, `contract-version`, `evidence-unknown-property`, `map-unknown-property`.
- Repository: `repository-url`, `repository-revision`, `repository-tree`, `repository-object-format`.
- Selected files/manifests: `selected-file-omission`, `selected-file-invention`, `manifest-oid`, `manifest-sha256`, `manifest-bytes`, `manifest-path`, `manifest-root`, `manifest-reference`.
- Workspace/package/dependency: `workspace-kind`, `workspace-patterns`, `workspace-membership`, `package-name`, `package-private`, `package-root`, `dependency-name`, `dependency-scope`.
- IDs: `project-id`, `evidence-id`, `room-id`, `relation-id`, `snapshot-id`.
- Ordering/duplication/count: `file-order`, `package-order`, `workspace-pattern-order`, `dependency-scope-order`, `room-order`, `relation-order`, `package-duplication`, `analysis-count`.
- Room claims: `room-structural-key`, `room-label`, `room-confidence`, `room-membership`, `room-evidence-set`.
- Relation claims: `relation-endpoint`, `relation-direction`, `relation-scope`, `relation-evidence-set`, `relation-omission`, `relation-invention`, `relation-self-loop`.
- Snapshot/fallback/count completeness: `evidence-hash`, `fallback-false-cause`, `fallback-omitted-cause`, `fallback-unknown-cause`, `sixth-room`, `duplicate-room`, `omitted-room`.
- Exact bytes: `invalid-utf8`, `invalid-json`, `noncanonical-json`, `noncanonical-newline`.
- Coherent attacks: `coherent-evidence-map-pair`, `false-detailed-to-coarse-downgrade`.

## Immutable Generation and CURRENT Matrix — 22/22

All rows execute with no skips:

- Generation creation: `generation-file-write`, `generation-file-close`, `generation-file-fsync`, `generation-directory-rename`, `generation-directory-fsync`.
- Final commit checks: `final-path-recheck`, `temporary-pointer-write`, `temporary-pointer-fsync`, `pointer-rename`, `bundle-root-fsync`.
- Recovery: `pointer-restoration`, `recovery-material-handling`, `rollback-failure-retention`.
- Interruption/concurrency: `interrupt-before-pointer-rename`, `interrupt-after-pointer-rename`, `concurrent-once-resolved-reader`.
- Initial/path/conflict safety: `no-prior-pointer-failure`, `malformed-path`, `aliased-path`, `symlinked-path`, `conflicting-path`.
- Retention: `prior-generations-retained`.

Caught pre-pointer failures preserve `CURRENT` and all three old artifact Buffers. A first publication failing before pointer rename has no `CURRENT`; any retained generation is complete. SIGKILL immediately before/after pointer rename selects a complete old/new generation. A once-resolved concurrent reader keeps all old bytes while a later reader gets all new bytes. Post-pointer fsync failure restores prior authority. Forced restoration failure returns only `station-output/commit-rollback-failed`, retains both immutable generations plus deterministic recovery and failure-marker files, and blocks readers/publishers with `station-output/recovery-required`.

### Retained Recovery Procedure

1. Preserve both immutable generations and all `CURRENT.recovery-*`, `.CURRENT.restore-*`, and `CURRENT.rollback-failed-*` material.
2. Verify the three files and receipt binding in both generations.
3. Read the marker's `previous_generation_id` and atomically replace `CURRENT` with that ID plus one LF, or atomically remove `CURRENT` when the prior ID is null.
4. Fsync the bundle directory where supported.
5. Remove recovery material only after authority is independently verified and the incident is recorded.

## Isolation Matrix — 26/26

- Dynamic preload: `successful-extraction-under-no-network-preload`, `failing-extraction-under-no-network-preload`, `no-fetch-http-https-net-dns`.
- Static/runtime command boundaries: `runtime-import-allowlist`, `git-command-allowlist`, `no-shell-command`, `no-package-manager`, `no-remote-git`.
- Forbidden routes: `no-update-check`, `no-brand-capture`, `no-preview`, `no-visual-check`, `no-renderer`, `no-viewer`, `no-provider-sdk`, `no-telemetry`.
- Package/host isolation: `dependency-free-package`, `no-install-hooks`, `no-host-registration`, `no-default-root-mutation`.
- Default behavior: `default-help-has-no-station-route`, `default-cli-smoke`, `default-cli-object-unchanged`.
- Core/archive identity: `baseline-core-tree-unchanged`, `archive-object-unchanged`, `archive-sha256-unchanged`.

The preload throws synchronously on `fetch`, HTTP/HTTPS/HTTP2 clients and listeners, net/TLS/UDP, DNS, shell, browser opener, and every non-Git child process. Successful and failing real extractions pass beneath it. The audit observes only `git` with `shell: false`, fixed local plumbing commands, `remote get-url origin`, and no clone/fetch/pull/push/ls-remote/submodule or package-manager command.

The static graph permits Node built-ins, integration-local modules, and exactly `repository-location.mjs` plus `output-path.mjs` outside the integration. No update, brand-capture, preview, visual-check, renderer (beyond the two approved shared helpers), Viewer, provider/LLM SDK, telemetry, or network builtin edge exists.

## TDD and Task Commits

1. **Task 1 RED** — `fed58aa9fd800315a9bd6c2793ed4c1fb1f210a2` — `test(01-08): specify adversarial extraction matrix`
2. **Task 1 GREEN** — `a1ed3a618d7c222d2b1281383f592b299108f4c7` — `test(01-08): prove hostile extraction closure`
3. **Task 2 RED** — `24590a4fcf1ff407c34d02bb3f8cc106b823c156` — `test(01-08): specify tamper and atomic failure matrices`
4. **Task 2 GREEN** — `2fa4cd889e85033534014aceb81729f7e88bfd0c` — `test(01-08): prove gate and publication fail closed`
5. **Task 3 RED** — `b697e7294f68318fe21e784875dc6c477f66ba61` — `test(01-08): specify integration isolation matrix`
6. **Task 3 GREEN** — `f3be03f03c6330013cdc71e3220f67d3a72ee174` — `test(01-08): prove Station integration isolation`

## Verification Evidence

- `node --test integrations/vibery-station/test/adversarial-extraction.test.mjs` — PASS, 13/13; zero skips.
- `node --test integrations/vibery-station/test/gate-tamper.test.mjs integrations/vibery-station/test/atomic-failure.test.mjs` — PASS, 14/14; zero skips.
- `node --test integrations/vibery-station/test/isolation.test.mjs` — PASS, 8/8; zero skips.
- `node --test integrations/vibery-station/test/*.test.mjs` — PASS, 129/129; zero skips.
- `node --check` for all five plan-listed files — PASS.
- `git diff --check bf4ed1910848eb7d887121ab2ad970551db71d97..HEAD` and worktree check — PASS.
- `git diff --exit-code d673e8300df60a5c8166abe78787fdc78f6b8000 -- archify viewer scripts examples generated archify.zip` — PASS.
- Default `archify --help` — PASS with only the preexisting command surface and no Station route.
- Default no-install `inspect architecture` smoke — PASS.
- `archify/bin/archify.mjs` object — unchanged from baseline.
- `archify.zip` Git object — unchanged at `f7fdf0f866c0d15385a81503e92e8bbbc4d81582`.
- `archify.zip` SHA-256 — unchanged at `2657acf353d3fadfde472b2c799eb9a1fa3a3b344129066980b9b1c5935f0883`.
- Scope guard — PASS: exactly the five plan-listed test/helper files before planning tracking.
- Forbidden-route scan — PASS: no production, core, generated, archive, provider, network, browser, renderer, Viewer, package-manager, push, or PR path.

## Deviations and Omissions

- **Deviations:** none requiring product or production behavior changes. No test-only shim beyond the authorized no-network preload was needed.
- **Omitted matrix cases:** none. All 45 hostile extraction, 64 gate tamper, 22 atomic failure, and 26 isolation rows executed; the four matrix closure assertions passed.
- **Skipped tests:** none.

## Residual Filesystem Limitations

- SIGKILL interruption evidence is inherently POSIX-specific and executed successfully on this Linux host; the suite intentionally fails rather than skips on a host without that evidence.
- Directory fsync is not portable across all operating systems/filesystems. The publisher reports `unsupported-on-platform` and limits its durability claim when the filesystem rejects directory fsync; this run's Linux filesystem supported the exercised directory-fsync boundaries.
- Atomic rename guarantees apply within the same filesystem and parent-directory strategy used by the publisher; cross-filesystem rename is outside the contract.

## User Setup and External Actions

None. No workspace/worktree/clone/branch operation, install, network request, provider, browser, renderer, Viewer, schema generation, archive regeneration, push, or PR occurred. Temporary local Git fixture repositories were the only repositories created.

## Phase 1 Completion

All eight plan summaries now exist and all 16 Phase 1 requirements have executable evidence. `BOUND-01` and `TEST-02` are complete, so Phase 1 and milestone v1.0 are eligible to be marked complete.

## Self-Check: PASSED

The authorized branch stayed in place, the run began from exact clean HEAD `bf4ed1910848eb7d887121ab2ad970551db71d97`, implementation scope stayed within the five listed test files, every final gate passed, and no acceptance claim relies on an inferred or skipped row.

---
*Phase: 01-deterministic-immutable-commit-extraction*
*Completed: 2026-09-16*
