---
phase: 01-deterministic-immutable-commit-extraction
plan: 06
subsystem: receipt-cli-atomic-generation-publication
tags: [deterministic-receipt, integration-cli, immutable-generations, atomic-pointer, fsync, recovery, node-test]

requires:
  - phase: 01-05
    provides: Frozen independently gated evidence/map buffers and exact publication metadata
provides:
  - Integration-local station extract CLI with one machine-readable diagnostic boundary
  - Deterministic station-extraction-receipt/v1 bytes bound to the exact gated evidence and map
  - Immutable three-file generations selected by one atomically renamed regular-file CURRENT pointer
  - Once-resolved generation reader and deterministic retained-material recovery diagnostics
  - Direct interruption, concurrent-reader, path-swap, restoration, and rollback-failure evidence
affects: [01-07-determinism-acceptance, 01-08-adversarial-closure]

tech-stack:
  added: []
  patterns: [frozen-gate receipt derivation, same-parent immutable staging, one-pointer commit, fsync-aware restoration, once-resolved readers, red-green TDD]

key-files:
  created:
    - integrations/vibery-station/lib/extract.mjs
    - integrations/vibery-station/lib/station-output.mjs
    - integrations/vibery-station/bin/station-map.mjs
    - integrations/vibery-station/test/station-output.test.mjs
    - integrations/vibery-station/test/station-cli.test.mjs
  modified: []

key-decisions:
  - "Derive receipt bytes only from the frozen independent-gate result, and bind evidence/map logical basenames, exact hashes, byte counts, repository/tree identity, fixed extractor contract, topology result, fallback facts, and empty success diagnostics."
  - "Derive generation identity from the contract version and all three final artifact hashes, publish or byte-verify that immutable directory first, then use one regular-file CURRENT rename as the only successful visibility commit."
  - "Retain deterministic recovery and rollback-failure marker files when restoration cannot be completed, and make future readers/publishers fail closed until manual recovery is performed."
  - "Report directory-fsync as unsupported-on-platform when the filesystem rejects that operation rather than claiming portable crash durability beyond atomic rename."

patterns-established:
  - "CLI order is reader -> evidence builder -> projector -> independent gate -> receipt -> immutable publisher; every earlier typed failure makes zero publication calls."
  - "Readers consume CURRENT exactly once and keep all three opens inside that immutable generation; generations are never selected by directory scanning."
  - "Caught pre-pointer failures preserve old authority; caught post-pointer durability failures restore old authority or retain deterministic recovery material with station-output/commit-rollback-failed."

requirements-completed: [OUT-01, OUT-02]

duration: 12 min
completed: 2026-09-16
---

# Phase 1 Plan 6: Receipt, CLI orchestration, and atomic bundle publication Summary

**One integration-local command now turns the frozen independent-gate result into a deterministic receipt and commits all three exact artifacts through one immutable generation plus one atomic regular-file pointer.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-09-16T16:05:28Z
- **Completed:** 2026-09-16T16:17:36Z
- **Tasks:** 2
- **Files modified:** 5 integration files plus this summary and sequential planning tracking

## Command and Read Contract

```text
node integrations/vibery-station/bin/station-map.mjs extract <bundle-root> \
  --repo-root <path> \
  --repository-url <repository-url> \
  --revision <40-hex> \
  --json
```

- The parser rejects unknown/repeated options, `--option=value`, missing values/options, unknown commands, and extra positionals.
- `--json` reserves stdout for exactly one canonical success receipt or one parseable typed failure envelope; failures are nonzero and never emit a replacement failure receipt.
- The default Archify CLI is unchanged and has no Station route.
- A consumer validates and reads `CURRENT` once, obtains exactly one `generation-<64-hex>` identifier, and then reads all three regular files from `generations/<generation-id>/`. It never re-resolves CURRENT between artifact opens and never scans for a newest generation.

## Receipt Inventory

`station-receipt.json` is canonical UTF-8 JSON with one trailing LF and contains:

| Section | Deterministic fields |
|---|---|
| Contract | `schema: station-extraction-receipt/v1`, `ok: true`, `command: station extract` |
| Repository | identity-derived canonical URL, exact revision, tree OID, and `sha1` object format |
| Extractor | `node-workspaces/v1`, contract version 1, and all four fixed tree/manifest budgets |
| Evidence artifact | logical `station-evidence.json`, exact SHA-256, and exact byte count including LF |
| Map artifact | logical `station-map.json`, exact SHA-256, and exact byte count including LF |
| Result | project/snapshot IDs, structural/coarse mode, room/relation counts, fallback boolean, and exact reasons |
| Diagnostics | deterministic empty array on success |

The receipt deliberately has no receipt self-hash or generation ID, and no timestamp, duration, local path, branch, process, host, runtime, Git version, origin credential, or raw stderr.

## Immutable Publication State Machine

```text
GATED_IN_MEMORY
  -> PRIVATE_STAGING_WRITTEN_CLOSED_FILE_FSYNCED
  -> STAGING_REREAD_STRICT_VALIDATED_AND_INDEPENDENTLY_GATED
  -> STAGING_DIRECTORY_FSYNCED
  -> IMMUTABLE_GENERATION_RENAMED_OR_IDENTICAL_GENERATION_REUSED
  -> GENERATIONS_DIRECTORY_FSYNCED
  -> POINTER_AND_RECOVERY_FILES_WRITTEN_CLOSED_FILE_FSYNCED
  -> FINAL_PARENT_PATH_ALIAS_TYPE_IDENTITY_RECHECK
  -> CURRENT_ATOMIC_RENAME                 # sole successful visibility commit
  -> BUNDLE_DIRECTORY_FSYNCED
  -> NON_AUTHORITATIVE_RECOVERY_CLEANUP
```

The deterministic generation ID hashes the versioned generation contract plus evidence, map, and receipt hashes. Existing identical generations are byte-verified and reused; any conflicting inventory or byte is `station-output/generation-conflict`. Prior generations are never deleted.

## Failure and Recovery Results

| Failure point | Authority/result |
|---|---|
| Arguments, repository, extraction, projection, or gate | No publisher call and no bundle target touched |
| Staging write/validation/fsync or generation rename | Old CURRENT remains authoritative; only private staging is eligible for cleanup |
| After immutable generation publication but before CURRENT rename | Old CURRENT remains authoritative; complete candidate generation may remain immutable |
| Abrupt termination immediately before CURRENT rename | Once-read CURRENT selects the complete old generation |
| Abrupt termination immediately after CURRENT rename | Once-read CURRENT selects the complete new generation |
| Bundle-root fsync failure after CURRENT rename | Previous pointer is rewritten through a second atomic restore and fsynced; returns `station-output/commit-failed` |
| Pointer restoration failure | Returns only `station-output/commit-rollback-failed`; both generations, exact recovery pointer bytes, restore temp when present, and deterministic rollback-failure marker remain |
| Startup with rollback-failure marker | Reader and publisher return `station-output/recovery-required`; no directory scan or success claim |

Manual recovery is deterministic: verify both immutable generations, then atomically replace CURRENT with the previous generation ID plus LF (or remove CURRENT if no prior pointer existed), fsync the bundle directory where supported, and retain evidence until recovery is audited.

## Interruption and Concurrency Evidence

- Child processes were killed with SIGKILL at barriers immediately before and after the sole CURRENT rename; readers obtained a complete old or complete new set.
- A publisher paused before CURRENT rename while a concurrent reader resolved the old pointer once. After publication resumed, the old reader retained all old bytes while a new reader obtained all new bytes—no mixed generation was observable.
- Injected barriers covered caught failure after staging files, before generation rename, after generation publication, and before pointer rename.
- Final CURRENT symlink replacement, protected-path aliasing, symlinked bundle components, malformed/non-regular pointers, and conflicting generations were rejected with typed diagnostics.

## Platform Durability Boundary

Regular files are closed and fsynced where the platform supports file fsync. Staging, generations, and bundle directories are fsynced around their rename boundaries where directory fsync is supported. Some platforms/filesystems reject directory fsync (`EINVAL`, `ENOTSUP`, or `ENOSYS`; selected Windows directory errors also qualify); the publisher then reports `directory_fsync: unsupported-on-platform` and the narrower `atomic-rename-without-portable-directory-fsync-guarantee` claim. Atomic rename semantics remain tested, but portable crash durability is not overclaimed.

## TDD and Task Commits

1. **Task 1 RED: Specify extraction orchestration and receipt** — `6a2d8c59b0c4ce5cef4757364ec093863c545cb2`
2. **Task 1 GREEN: Orchestrate gated extraction receipt** — `54ac6773bdef0b33c7f21ca5554a70381bcc6ea4`
3. **Task 2 RED: Specify atomic generation publication** — `283cc0c527daa140177717e7e5a4cf0bf646c109`
4. **Task 2 GREEN: Publish atomic immutable generations** — `5123a22e25b3d668b7973b53a3b3f7b4f886a477`

## Files Created

- `integrations/vibery-station/lib/extract.mjs` — exact pipeline orchestration and frozen-gate receipt construction.
- `integrations/vibery-station/lib/station-output.mjs` — path preflight, immutable staging/publication, CURRENT reader/commit, fsync handling, restoration, and retained recovery.
- `integrations/vibery-station/bin/station-map.mjs` — executable integration-only parser and JSON diagnostic boundary.
- `integrations/vibery-station/test/station-cli.test.mjs` — parser, stage ordering, receipt, failure-boundary, and end-to-end CLI coverage.
- `integrations/vibery-station/test/station-output.test.mjs` — exact bytes, interruption, concurrency, alias/swap, reuse/conflict, fsync, restoration, and recovery coverage.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None unresolved.

## Verification Evidence

- `node --test integrations/vibery-station/test/station-output.test.mjs integrations/vibery-station/test/station-cli.test.mjs` — PASS, 18/18 focused tests.
- `node --test integrations/vibery-station/test/*.test.mjs` — PASS, 90/90 cumulative Station tests.
- `node --check` for all five plan-listed files — PASS.
- `git diff --check 9a48996f75fa5aca3451ab9126800b9ca3e8512c..HEAD` — PASS.
- Plan scope guard before tracking — PASS, exactly the five plan-listed integration files.
- Forbidden runtime import/network scan — PASS; only the explicitly permitted shared output-path helper crosses the integration boundary.
- Default `archify/bin/archify.mjs` object identity — PASS, unchanged at `07ad91ba3204c3a2ec5b52b5997d7cb5f7879702`.
- `archify.zip` object identity — PASS, unchanged at `f7fdf0f866c0d15385a81503e92e8bbbc4d81582`.
- TDD order — PASS: Task 1 RED -> GREEN, then Task 2 RED -> GREEN.

## User Setup Required

None - no service, provider, browser, install, or network configuration is required.

## Next Phase Readiness

- Plan 01-07 can compare complete evidence/map/receipt generations across clones, branches, dirty worktrees, and Vibery-shaped fixtures through the integration CLI and once-resolved reader.
- No blockers remain; no workspace/branch changes, installs, network access, rendering, browser/provider calls, PRs, pushes, or unrelated code changes occurred.

## Self-Check: PASSED

- All five plan-listed files and this summary exist, and all four RED/GREEN commits are present in serial order.
- Both requirements are implemented and tested: `OUT-01`, `OUT-02`.
- The focused/cumulative suites, syntax, exact-byte binding, interruption/concurrency, diff/scope, forbidden-import, default-CLI, and archive guards pass.

---
*Phase: 01-deterministic-immutable-commit-extraction*
*Completed: 2026-09-16*
