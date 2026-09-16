---
phase: 01-deterministic-immutable-commit-extraction
plan: 08
subsystem: adversarial-closure-and-isolation-proof
tags: [hostile-git, fallback-budgets, gate-tamper, atomic-publication, no-network, isolation, node-test]

requires:
  - phase: 01-07
    provides: Clone-independent exact-byte acceptance and generic twelve-workspace topology proof
provides:
  - Explicit 48-row hostile Git/path/manifest/resource/fallback matrix with real-CLI, local-promisor, and narrow in-process seam evidence
  - Explicit 64-row independent evidence/map tamper matrix with zero publication calls
  - Explicit 26-row immutable-generation/CURRENT failure, interruption, concurrency, and recovery matrix
  - Explicit 26-row no-network/import/Git-command/default-core isolation matrix
  - Final Phase 1 evidence: 139/139 provider-free Station tests, zero skips, unchanged default core tree and archive

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
  modified:
    - integrations/vibery-station/lib/contracts.mjs
    - integrations/vibery-station/lib/node-workspace-evidence.mjs
    - integrations/vibery-station/lib/station-gate.mjs
    - integrations/vibery-station/lib/station-output.mjs
    - integrations/vibery-station/lib/station-projector.mjs
    - integrations/vibery-station/schemas/station-evidence.schema.json
    - integrations/vibery-station/schemas/station-extraction-receipt.schema.json
    - integrations/vibery-station/test/helpers/git-fixture.mjs
    - integrations/vibery-station/test/station-cli.test.mjs
    - integrations/vibery-station/test/station-output.test.mjs
    - integrations/vibery-station/test/station-projector.test.mjs

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
verification_status: passed
remediation_started: 2026-09-16T18:42:53Z
remediation_completed: 2026-09-16T19:05:55Z

duration: 16 min
completed: 2026-09-16
---

# Phase 1 Plan 8: Adversarial Closure and Isolation Proof Summary

> **Verification status: PASSED — remediation complete.** Generation authentication, concurrent-publisher authority, selected control-path diagnostics, generic canonical repository support, and partial-clone discrimination are implemented and covered by the final gates.

**Plan 01-08 now provides executable, provider-free evidence for hostile extraction, tamper rejection, atomic publication, integration isolation, and fail-closed local-promisor behavior.**

## Final Remediation Closure

The reopened review blockers are closed:

1. Resolved generations are authenticated against the content-derived generation ID and exact receipt/evidence/map identity bindings, including coherent tampering attempts.
2. Concurrent publishers cannot let an older failing publisher overwrite newer `CURRENT` authority; retained recovery diagnostics name only material that exists.
3. Selected control-character paths produce the typed whole-project `station-fallback/path-unsupported` result without partial topology.
4. Canonical arbitrary-host HTTPS, SSH URI, and SCP repository identities pass reader, runtime contract, independent gate, projector, receipt, publication, and reread consistently; standard GitHub/Gitee normalization and credential rejection remain intact.
5. A provider-free local `file://` promisor fixture omits the manifest blob, proves extraction fails with `station-extract/object-unavailable` while `GIT_NO_LAZY_FETCH=1` leaves it unhydrated, then proves an explicit control read without that guard hydrates the same promised object.

## Performance

- **Original plan run:** 2026-09-16T16:34:26Z–16:50:02Z (16 min, 3 tasks, five test/helper files, no production behavior change)
- **Final remediation:** 2026-09-16T18:42:53Z–19:05:55Z
- **Remediation shape:** four strict RED/GREEN pairs plus planning closure; production contract/gate/projector/output changes remained integration-owned

## Hostile Extraction Matrix — 48/48

All rows execute, and the final matrix assertion reports no omissions:

1. Replacement isolation: `replacement-commit`, `replacement-tree`, `replacement-blob` — active refs are present, but the real CLI succeeds from the named original objects because replacement objects are disabled.
2. Revision typing: `branch-revision`, `tag-revision`, `abbreviated-revision`, `blob-revision`, `tree-revision` — mutable/abbreviated names are invalid and direct non-commit OIDs are unavailable as commits.
3. Local object availability: `missing-commit`, `missing-tree`, `missing-blob`, `partial-clone-lazy-fetch-disabled` — each is nonzero, never coarse, and preserves prior authority; the real local promisor row additionally proves disabled lazy fetch does not hydrate a promised blob while its explicit control read does.
4. Repository identity/root/format: `wrong-origin`, `missing-origin`, `credentialed-origin-redaction`, `non-top-level-root`, `unsupported-object-format` — diagnostics are stable and credentials are absent from output.
5. Tree protocol: `malformed-tree-protocol`, `incomplete-tree-protocol`, `tree-output-over-budget` — injected only through the real orchestrator's reader seam; publication is never called.
6. Manifest and path classes: `manifest-symlink`, `manifest-gitlink`, `manifest-binary-nul`, `manifest-invalid-utf8`, `control-character-path`, `selected-control-exact`, `selected-control-wildcard`, `invalid-path-shape`, `case-collision`, `unicode-nfc-collision`.
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

## Immutable Generation and CURRENT Matrix — 26/26

All rows execute with no skips:

- Generation creation: `generation-file-write`, `generation-file-close`, `generation-file-fsync`, `generation-directory-rename`, `generation-directory-fsync`.
- Final commit checks: `final-path-recheck`, `final-path-swap-before-rename`, `temporary-pointer-write`, `temporary-pointer-fsync`, `pointer-rename`, `bundle-root-fsync`.
- Recovery: `pointer-restoration`, `recovery-material-handling`, `cleanup-recovery-fsync-failure`, `rollback-failure-retention`.
- Interruption/concurrency: `interrupt-before-pointer-rename`, `interrupt-after-pointer-rename`, `concurrent-once-resolved-reader`, `publisher-publisher-interleaving`, `post-rename-fsync-newer-authority`.
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

### Final remediation commits

1. `208da0d52d645337d9287f41b22de88ae09b0211` — `docs(01-08): reopen final verification`
2. `e03ce41dfa54c02b0d25c52000f64ada463643d7` — `test(station): expose unauthenticated generation reads`
3. `20e4dd298cd898a3526bbaf62037b6318bcd6416` — `fix(station): authenticate resolved generations`
4. `4a372b411aa3e40fd8f767465184a54a744adbc7` — `test(station): expose concurrent publication races`
5. `393b04398e1dfd9088539568e9f78fded0fb944f` — `fix(station): preserve concurrent publisher authority`
6. `8ab9de77f9d5b07844e388c89e47ba8b08cb7442` — `test(station): expose selected control path failures`
7. `fc3a49957b4520661ce17bc27f6c2b315e7ffe18` — `fix(station): type selected control path fallback`
8. `0d4543815699690a914c780c8dfe529fbe1708f4` — `test(station): expose arbitrary-host identities`
9. `5724e46a807418cba380848193267f12bd39649d` — `fix(station): admit canonical arbitrary hosts`
10. `26498b994964fcefd5505b712ebdec3d0b2c0ebf` — `test(station): require promisor isolation proof`
11. `3e4dedf076235b68f661082ea3f9d7704619bf72` — `test(station): prove promisor fetch stays disabled`

## Verification Evidence

- `node --test integrations/vibery-station/test/adversarial-extraction.test.mjs` — PASS, 15/15; zero skips.
- `node --test integrations/vibery-station/test/station-output.test.mjs integrations/vibery-station/test/atomic-failure.test.mjs` — PASS, 28/28; zero skips.
- Focused contracts/identity, reader, gate, projector, CLI, generation, concurrency, control-path, and promisor suites — PASS.
- `node --test integrations/vibery-station/test/isolation.test.mjs` — PASS, 8/8; zero skips.
- `node --test integrations/vibery-station/test/*.test.mjs` — PASS, 139/139; zero skips.
- `node --check` for every integration `.mjs` file and JSON parsing for all three schemas — PASS.
- `git diff --check bf4ed1910848eb7d887121ab2ad970551db71d97..HEAD` and worktree check — PASS.
- `git diff --exit-code d673e8300df60a5c8166abe78787fdc78f6b8000 -- archify viewer scripts examples generated archify.zip` — PASS.
- Default `archify --help` — PASS with only the preexisting command surface and no Station route.
- Default no-install `inspect architecture` smoke — PASS.
- `archify/bin/archify.mjs` object — unchanged from baseline.
- `archify.zip` Git object — unchanged at `f7fdf0f866c0d15385a81503e92e8bbbc4d81582`.
- `archify.zip` SHA-256 — unchanged at `2657acf353d3fadfde472b2c799eb9a1fa3a3b344129066980b9b1c5935f0883`.
- Scope guard — PASS: all remediation code remains under `integrations/vibery-station/`; only planning records changed outside it.
- Forbidden-route scan — PASS: no production, core, generated, archive, provider, network, browser, renderer, Viewer, package-manager, push, or PR path.

## Deviations and Omissions

- **Deviations:** remediation changed only the isolated Station integration and its planning evidence; default Archify behavior and artifacts remain unchanged.
- **Omitted matrix cases:** none. All 48 hostile extraction, 64 gate tamper, 26 atomic failure, and 26 isolation rows executed; the four matrix closure assertions passed.
- **Skipped tests:** none.

## Residual Filesystem Limitations

- SIGKILL interruption evidence is inherently POSIX-specific and executed successfully on this Linux host; the suite intentionally fails rather than skips on a host without that evidence.
- Directory fsync is not portable across all operating systems/filesystems. The publisher reports `unsupported-on-platform` and limits its durability claim when the filesystem rejects directory fsync; this run's Linux filesystem supported the exercised directory-fsync boundaries.
- Atomic rename guarantees apply within the same filesystem and parent-directory strategy used by the publisher; cross-filesystem rename is outside the contract.

## User Setup and External Actions

None. No authorized workspace/worktree/branch operation, install, network request, provider, browser, renderer, Viewer, schema generation, archive regeneration, push, or PR occurred. Tests created only disposable local Git fixtures, including the provider-free bare remote and partial clone used to discriminate lazy hydration.

## Phase 1 Completion

All eight plan summaries exist and Phase 1 is complete. All 16 requirements, including `BOUND-01` and `TEST-02`, passed the reopened focused, cumulative, static, schema, isolation, scope, core, default-CLI, and archive gates.

## Self-Check: PASSED

The authorized branch and workspace stayed in place, remediation continued from exact HEAD `fc3a49957b4520661ce17bc27f6c2b315e7ffe18` without reset/clean, every final gate passed with zero skips, and no acceptance claim relies on an inferred row. Default Archify/core/archive surfaces remain at their approved objects and hashes.

---
*Phase: 01-deterministic-immutable-commit-extraction*
*Completed: 2026-09-16*
