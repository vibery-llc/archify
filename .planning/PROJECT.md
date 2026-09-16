# Archify Station Map

## What This Is

Archify Station Map is an isolated integration profile that turns one explicit immutable Git commit into a deterministic, evidence-bound project-and-room topology for Vibery Station. It extends the brownfield Archify repository without changing Archify's default CLI, schemas, renderers, Viewer, generated artifacts, or packaged `archify.zip` behavior.

## Core Value

Given the same repository identity and exact commit, Station receives byte-identical, independently verifiable topology artifacts—or no replacement at all.

## Requirements

### Validated

- ✓ Archify validates typed JSON IR and atomically delivers deterministic standalone artifacts — existing.
- ✓ Repository evidence can verify authored source paths against pinned Git revisions — existing.
- ✓ Architecture Delta provides sorted canonicalization, stable-ID comparison, revision-pinned proof, and multi-file rollback patterns — existing.
- ✓ The DeepSeek Harness demonstrates how a profile-specific integration can remain isolated from the packaged default runtime — existing.

### Active

- [ ] Read only an explicit full commit from a local Git object database, independent of checkout state and without network access.
- [ ] Emit deterministic `station-evidence/v1`, `station-map/v1`, and `station-extraction-receipt/v1` JSON artifacts.
- [ ] Derive stable project, room, relation, evidence, and snapshot identities from canonical repository and structural facts.
- [ ] Produce a complete one-to-five-room structural map when evidence supports it, otherwise one explicit coarse room.
- [ ] Recompute and validate every derived field and reference at a fail-closed gate before publication.
- [ ] Atomically publish all artifacts while preserving the last-known-good set on every failure.
- [ ] Prove determinism, tamper rejection, fallback truthfulness, and hostile Git/path handling with provider-free tests.

### Out of Scope

- AST, import-graph, runtime-call, ownership, or semantic service inference — unsupported evidence would create false architecture claims.
- LLM synthesis or naming — Phase 1 must be mechanical and byte-deterministic.
- Lockfile, `pnpm-workspace.yaml`, Nx/Turbo, TypeScript-reference, package-script, or broad package-manager analysis — defer until the Node workspace contract is proven.
- Architecture rendering, Viewer changes, Unity projection, or interactive Station UI — this phase ends at validated Station IR and receipts.
- Remote clone/fetch or partial-clone hydration — extraction is local-object-only and fail-closed.
- Changes to the default Archify CLI, core schemas/renderers, generated assets, or `archify.zip` — preserve upstream behavior.
- Host registration, permission APIs, and production integration — external planning dependencies for a later phase.

## Context

The brownfield repository is a Node 18+ native-ESM, zero-install compiler pipeline from typed JSON IR to validated standalone HTML. Existing repository evidence proves user-authored claims but does not extract repository structure. The closest reusable seams are `archify/delta/architecture-delta.mjs` for canonicalization and identity-aware comparison, `archify/bin/archify.mjs` for staged atomic delivery and receipts, and `integrations/deepseek-harness/` for profile isolation.

Phase research at `.planning/phases/01-deterministic-immutable-commit-extraction/01-RESEARCH.md` establishes a bounded Node/npm workspace profile. The current Vibery repository shape deterministically collapses twelve declared workspaces into four first-segment rooms with three cross-room dependency directions, but this is a fixture expectation rather than product-specific implementation logic.

## Constraints

- **Evidence boundary**: Read commit tree/blob objects, never checkout files — dirty worktrees, current branches, and symlinks must not affect claims.
- **Immutability**: Require one full 40-character commit and disable replacement objects and lazy network fetch — a pinned name alone is insufficient.
- **Determinism**: Canonical UTF-8 JSON, LF endings, one trailing newline, sorted arrays/keys, and no timestamps or absolute paths — exact bytes are the contract.
- **Resource bounds**: Bound tree output, manifest count, per-manifest bytes, and total selected bytes — never emit partial detailed topology.
- **Truthfulness**: Structural workspace grouping only; unsupported shapes become an explicit coarse room, while integrity failures publish nothing.
- **Compatibility**: Keep the extension under `integrations/vibery-station/` and avoid default Archify behavior changes.
- **Delivery**: Commit the evidence, map, and receipt as one atomic set or preserve the complete last-known-good set.
- **Validation**: Provider-free tests must cover alternate clones, dirty checkouts, replacement refs, symlinks, gitlinks, binaries, invalid UTF-8, path collisions, tampering, and rollback failure.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Use a pure evidence → projector → gate pipeline | Prevents synthesis from becoming authority and keeps every claim mechanically reproducible | — Pending |
| Stop Phase 1 at `station-map/v1` rather than Architecture v1 renderer IR | Existing renderer component types would invent semantics and source limits do not fit grouped evidence | — Pending |
| Group npm workspaces by first path segment only when that yields one-to-five complete groups | Structural, deterministic, explainable, and bounded without product-specific labels | — Pending |
| Emit one `coarse-project` room for supported-but-underdetermined shapes | Completeness is more truthful than selecting a partial detailed graph | — Pending |
| Derive durable IDs without revision, labels, or layout | Topology identity must survive equivalent rescans and display-name changes | — Pending |
| Keep the profile isolated under `integrations/vibery-station/` | Protects the zero-install packaged Skill and default CLI behavior | — Pending |
| Treat this infrastructure milestone as horizontal/standard planning rather than a UI MVP | The deliverable is a verified substrate with no user interface | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition:**
1. Move verified requirements from Active to Validated with the phase reference.
2. Move invalidated requirements to Out of Scope with the reason.
3. Add newly discovered requirements before expanding implementation scope.
4. Record decisions and their observed outcomes.
5. Recheck that the Core Value still governs tradeoffs.

**After each milestone:**
1. Review all boundaries and deferred work.
2. Confirm byte determinism and fail-closed behavior remain the priority.
3. Revisit host-integration dependencies only with a separate approved phase.

---
*Last updated: 2026-09-16 after brownfield mapping and Phase 1 research*
