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

## Extraction bounds

The v1 contract admits at most 512 manifest candidates and at most 512 workspace patterns. A 513th workspace pattern produces the existing `station-fallback/workspace-pattern-unsupported` whole-project fallback before selection. Workspace matching examines only the bounded manifest-candidate list, while complete inventory validation remains independent. Root `package.json` participates in case and NFC alias classification.

## CLI recovery states

Normal JSON success remains the canonical extraction receipt. A known committed replacement requiring recovery or carrying owner-release durability uncertainty returns exit 0 with a JSON success envelope containing `publication` and `receipt`. Indeterminate authority returns exit 1 with a typed publication envelope. Human-readable output distinguishes retained recovery cleanup from unknown owner-release durability.
