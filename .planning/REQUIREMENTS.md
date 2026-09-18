# Requirements: Archify Station Map

**Defined:** 2026-09-16
**Core Value:** Given the same repository identity and exact commit, Station receives byte-identical, independently verifiable topology artifacts—or no replacement at all.

## v1 Requirements

### Immutable Git Evidence

- [x] **GIT-01**: An operator can request extraction only with a canonical repository identity and one full 40-character commit that resolves locally to a commit object.
- [x] **GIT-02**: Extraction reads repository facts only from pinned Git tree/blob objects with replacement objects and lazy fetching disabled, as proven against a local promisor/partial clone, so checkout branch, dirty files, absolute clone path, and promised remote objects cannot change output.
- [x] **GIT-03**: Tree enumeration and manifest selection enforce explicit count/byte budgets and reject malformed, incomplete, aliased, non-UTF-8, control-character, symlink, gitlink, and non-regular-file evidence according to typed hard-failure or fallback policy.

### Evidence Ledger

- [x] **EVID-01**: A successful extraction emits a versioned `station-evidence/v1` ledger containing the canonical repository identity, exact commit/tree identity, extractor contract, selected manifest paths/OIDs/digests, workspace membership, package declarations, and scoped internal dependency evidence.
- [x] **EVID-02**: Evidence bytes are canonical UTF-8 JSON with recursively sorted keys, contract-defined array ordering, LF line endings, exactly one trailing newline, and no timestamps, absolute paths, or runtime-specific values.

### Station Projection

- [x] **MAP-01**: The projector derives project, room, relation, evidence, and snapshot IDs from versioned canonical structural inputs; durable topology IDs exclude revision, display labels, and layout.
- [x] **MAP-02**: Supported Node/npm workspaces produce a complete, disjoint, sorted one-to-five-room `station-map/v1` projection grouped by first workspace path segment, with exact aggregated cross-room dependency directions and no same-room self-loop topology.
- [x] **MAP-03**: Unsupported but integrity-valid repository shapes produce exactly one evidence-bound `coarse-project` room, zero relations, `confidence: coarse`, and one or more versioned fallback reason codes without partial detailed claims.

### Fail-Closed Gate

- [x] **GATE-01**: Before publication, the gate reparses the evidence and map and recomputes every ID, membership, relation, evidence reference, ordering rule, count, digest, and fallback invariant rather than trusting projector output.
- [x] **GATE-02**: Any integrity, identity, completeness, gate, output-path, or commit/rollback failure emits a typed diagnostic and publishes no replacement artifacts; no hard failure is downgraded to coarse fallback.

### Atomic Artifacts

- [x] **OUT-01**: A successful run emits `station-evidence/v1`, `station-map/v1`, and `station-extraction-receipt/v1` files whose receipt records exact file names, SHA-256 digests, byte counts, revision/tree identity, mode, counts, and deterministic contract versions without self-hashing or volatile data.
- [x] **OUT-02**: The three-artifact set is staged, fsynced/closed as required by the established Archify delivery pattern, preflighted against unsafe or aliased targets, and committed atomically so every failure preserves the complete last-known-good set.

### Isolation and Verification

- [x] **BOUND-01**: The implementation is isolated under `integrations/vibery-station/` and does not change default Archify CLI, core schemas/renderers, Viewer runtime, generated artifacts, or `archify.zip` behavior.
- [x] **TEST-01**: Provider-free tests prove byte-identical output across different clones, dirty worktrees, and checked-out branches, while README-only revisions change snapshot identity but preserve durable topology IDs.
- [x] **TEST-02**: Provider-free adversarial tests cover replacement refs, missing and promised-but-unhydrated local objects, symlink/gitlink/binary/invalid-UTF-8/path-collision inputs, resource budgets, all fallback reasons, every gate-tamper class, unsafe targets, interrupted commits, concurrent publishers, and rollback failure.
- [x] **TEST-03**: A Vibery-shaped fixture with twelve workspaces deterministically produces four structural rooms and exactly the expected aggregated cross-room relation directions without product-specific code or an LLM.

## v2 Requirements

### Richer Analysis

- **ANALYSIS-01**: Extract lockfile-resolved dependency versions and additional package-manager workspace formats.
- **ANALYSIS-02**: Derive import/module graphs or runtime-causality evidence with a separately versioned contract.
- **ANALYSIS-03**: Adapt validated Station maps into renderable Archify diagrams without inventing component semantics.
- **ANALYSIS-04**: Produce identity-aware visual deltas between validated Station snapshots.

### Host Integration

- **HOST-01**: Register the Station profile with an approved host API and explicit read/write permission boundary.
- **HOST-02**: Project validated maps into Unity/Station rooms and attach operational overlays.

## Out of Scope

| Feature | Reason |
|---------|--------|
| LLM synthesis or semantic naming | Breaks byte determinism and would turn interpretation into authority. |
| Checkout-file reads | Makes dirty state, current branch, and filesystem symlinks part of evidence. |
| Remote clone/fetch or partial-clone hydration | Phase 1 is local-object-only and network-independent. |
| Partial top-five package maps | Omits supported evidence and falsely presents an incomplete graph as detailed. |
| Default Archify CLI/schema/renderer/Viewer changes | Risks upstream behavior and packaged zero-install guarantees. |
| Production host registration or permissions | Requires separate host-side contracts and approval. |
| UI, rendering, Unity projection, and operational overlays | Phase 1 ends at validated JSON IR and receipts. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| GIT-01 | Phase 1 | Complete |
| GIT-02 | Phase 1 | Complete |
| GIT-03 | Phase 1 | Complete |
| EVID-01 | Phase 1 | Complete |
| EVID-02 | Phase 1 | Complete |
| MAP-01 | Phase 1 | Complete |
| MAP-02 | Phase 1 | Complete |
| MAP-03 | Phase 1 | Complete |
| GATE-01 | Phase 1 | Complete |
| GATE-02 | Phase 1 | Complete |
| OUT-01 | Phase 1 | Complete |
| OUT-02 | Phase 1 | Complete |
| BOUND-01 | Phase 1 | Complete |
| TEST-01 | Phase 1 | Complete |
| TEST-02 | Phase 1 | Complete |
| TEST-03 | Phase 1 | Complete |

**Coverage:**
- v1 requirements: 16 total
- Mapped to phases: 16
- Unmapped: 0 ✓

---
*Requirements defined: 2026-09-16*
*Last updated: 2026-09-16 after combined invalid-UTF8/raw-backslash remediation and 173/173 Phase 1 verification*
