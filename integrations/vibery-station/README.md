# Vibery Station map integration

This private integration extracts deterministic Station evidence from one trusted local Git commit. It has no default Archify route and performs no network access, installation, rendering, or host registration.

## Publication authority

`publishStationGeneration(candidate)` returns one of these publication results:

- `state: "committed"`, `committed: true` — `CURRENT` names the candidate and transaction cleanup completed.
- `state: "committed-recovery-required"`, `committed: true` — the candidate is known to be authoritative and exact token-addressable owner material remains for explicit recovery. This is a committed replacement, not a failed replacement.
- `state: "committed-durability-unknown"`, `committed: true` — the candidate is authoritative and no owner material remains in the observed filesystem, but the final owner-removal directory fsync failed. No nonexistent recovery token is claimed.
- `state: "authority-indeterminate"`, `committed: null` — a rename error and subsequent inspection could not establish authority. No success claim is made.

Every result also carries `generation_id`, `reused`, `recovery_required`, `recovery_reasons`, `directory_fsync`, and `durability_claim`. Unsupported directory fsync downgrades the durability claim; a failed final owner-removal fsync reports `directory_fsync: "unknown"`; regular-file fsync is mandatory.

Publication uses a regular fixed lock acquired by hard-linking a fully written and fsynced unique owner file. Owner metadata binds a random recovery token, PID, and OS process-start identity. Exclusive-create collisions are foreign: the colliding bytes and inode are never cleaned by the losing invocation. There is no age timeout. Live owners are busy, dead or PID-reused owners are stale, and unreadable ownership is recovery-required. Every cleanup rechecks exact file identity and bytes before unlink. Before replacing `CURRENT`, the publisher durably records a prepared forward-only transaction journal. It never rolls back after a known commit.

`inspectStationPublication(bundleRoot)` is read-only. `recoverStationPublication(bundleRoot, { recoveryToken })` is the only supported cleanup seam; it reattests the exact stale owner and token before changing transaction material. Preserve all immutable generations during recovery.

## Trusted reads

`readStationGeneration(bundleRoot, { expectedGenerationId })` requires a generation ID obtained from an external trusted control plane. Missing or malformed anchors are rejected before `CURRENT` or any artifact is read. `CURRENT` must exactly equal that anchor before the reader performs canonical-byte, generation-hash, evidence-to-map, and receipt binding checks. Never derive the expected anchor from the bundle being verified.

## Profile ladder

Extraction tries two profiles in order and records which one produced the artifacts in `evidence.extractor.profile`, `map.snapshot.profile`, and `receipt.extractor.profile`.

1. `node-workspaces/v1`. npm/yarn/pnpm workspace member packages become rooms with confidence `high` and declared-dependency relations. Its result is final when it finds workspace members or reports any fallback other than a missing root `package.json`.
2. `directory-layout/v1`. Tried when `node-workspaces/v1` finds only a single root package or no root `package.json`. It reads committed tree paths only (no file contents):
   - Candidates are the top-level directories. Under the conventional roots `src/`, `lib/`, `app/`, `apps/`, `packages/`, `cmd/`, and `internal/`, the child directories are the candidates instead; a conventional root with no child candidate is a candidate itself.
   - Unity: top-level `Assets/` is never a candidate. Each direct child `Assets/<X>/` is treated as a conventional root, so `Assets/Scripts/Player` and `Assets/Scripts/UI` become candidates. `Assets/Plugins`, `Assets/Resources`, `Assets/StreamingAssets`, and `Assets/Editor Default Resources` are skipped because they hold third-party code or engine-loaded data.
   - A candidate is kept only if its subtree has at least one regular file whose extension is in `DIRECTORY_CODE_EXTENSIONS` (`lib/contracts.mjs`).
   - Files under `node_modules`, `dist`, `build`, `out`, `.next`, `target`, `vendor`, `__pycache__`, `.venv`, `venv`, `Library`, `Temp`, `Obj`, `obj`, `Logs`, `Packages`, `ProjectSettings`, `UserSettings`, `coverage`, or any dot-directory (including `.github`) are ignored at every depth.
   - If more than 64 candidates remain, the unexpanded top-level directories are used instead. If those also exceed 64, the profile falls back with `station-fallback/directory-candidates-exceeded`.
   - The profile wins with two or more rooms. Each room has label and `package_roots` equal to its directory path, confidence `layout`, and no relations. Evidence carries one `directories[]` record per room (`id`, `root`, `code_file_count`); the `evidence-<sha256>` ID binds the root to the exact path and blob OID of every code file it counts.
   - Any unsupported or colliding path in the tree makes the profile fall back with `station-fallback/path-unsupported` or `station-fallback/path-collision`.

When `directory-layout/v1` does not win, the `node-workspaces/v1` result stands. For a single root package that result is byte-identical to extraction before the ladder existed. For a repository without a root `package.json` the coarse result is kept, and `analysis.profile_attempts` records both attempts with their outcome and reason code; `station-fallback/directory-candidates-exceeded` is also added to the fallback reasons in that case. `station-fallback/directory-rooms-insufficient` appears only in `profile_attempts`.

`profile_attempts` is present when `directory-layout/v1` won or ran for a repository without a root manifest. Each entry is `{ profile, outcome, reason_code }` with `outcome` one of `selected`, `single-package`, or `fallback`; `reason_code` is set only for `fallback`.

The gate recomputes the directory selection from the verified reader inventory with its own implementation and rejects any evidence or map it cannot reproduce byte for byte.

### Mapping changed paths to rooms

Consumers that overlay activity onto rooms (for example, files changed by a commit) assign each repository path to the room whose `package_roots` entry is the longest path-segment prefix of that path (`src/lib` matches `src/lib/api.ts` but not `src/library/x.ts`). Paths that match no room belong to the project wing, not to any room. A root-package room (`package_roots: ["."]`) matches every path.

## Extraction bounds

The v1 contract admits at most 512 manifest candidates and at most 512 workspace patterns. A 513th workspace pattern produces the existing `station-fallback/workspace-pattern-unsupported` whole-project fallback before selection. Workspace matching examines only the bounded manifest-candidate list, while complete inventory validation remains independent. Root `package.json` participates in case and NFC alias classification.

## CLI recovery states

Normal JSON success remains the canonical extraction receipt. A known committed replacement requiring recovery or carrying owner-release durability uncertainty returns exit 0 with a JSON success envelope containing `publication` and `receipt`. Indeterminate authority returns exit 1 with a typed publication envelope. Human-readable output distinguishes retained recovery cleanup from unknown owner-release durability.
