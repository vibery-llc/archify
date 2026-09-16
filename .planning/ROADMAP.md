# Roadmap: Archify Station Map

_Last updated: 2026-09-16 after Plan 01-05 — Active milestone: **v1.0 Part 02 deterministic Station substrate**. Source of truth: `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`, and Phase 1 research at `.planning/phases/01-deterministic-immutable-commit-extraction/01-RESEARCH.md`._

## Milestone

**Goal:** Given a canonical repository identity and one exact locally available commit, produce byte-identical, independently verifiable Station evidence, topology, and receipt artifacts—or preserve the complete last-known-good artifact set.

**Boundary:** This is a brownfield, infrastructure-only milestone. It is limited to an isolated `integrations/vibery-station/` extraction profile for Node/npm workspace evidence. It does not add rendering, Viewer/UI, Unity projection, host registration, LLM synthesis, remote fetch, broad package-manager support, or changes to default Archify CLI/package behavior.

## Phases

- [ ] **Phase 1: Deterministic Immutable-Commit Extraction** — Extract bounded Git-object evidence, project it into validated stable Station primitives with explicit coarse fallback, and atomically publish the three deterministic artifacts.

## Phase Details

### Phase 1: Deterministic Immutable-Commit Extraction

**Directory:** `.planning/phases/01-deterministic-immutable-commit-extraction/`
**Goal:** A caller can extract one explicit immutable local commit into a gated `station-evidence/v1`, `station-map/v1`, and `station-extraction-receipt/v1` set without checkout influence, unsupported topology claims, or loss of the prior trusted set.
**Depends on:** Existing local Git plumbing; repository identity/redaction conventions; canonicalization, diagnostic, output-path, and rollback precedents documented by the brownfield map. No network, provider, browser, renderer, host, or package installation dependency.
**Requirements:** GIT-01, GIT-02, GIT-03, EVID-01, EVID-02, MAP-01, MAP-02, MAP-03, GATE-01, GATE-02, OUT-01, OUT-02, BOUND-01, TEST-01, TEST-02, TEST-03

**Implementation shape:**

1. Add an integration-owned immutable Git object reader with fixed plumbing commands, sanitized no-replacement/no-lazy-fetch environment, fatal UTF-8/path handling, and explicit tree/manifest resource budgets.
2. Add strict versioned evidence, map, and receipt contracts plus canonical UTF-8 serialization with recursively sorted keys, contract-sorted arrays, LF endings, and exactly one trailing newline.
3. Add pure project, room, relation, evidence, and snapshot identity derivation from canonical structural inputs; detailed projection is limited to complete one-to-five first-path-segment workspace groups.
4. Add one explicit evidence-bound `coarse-project` fallback for integrity-valid but structurally unsupported inputs; integrity failures remain hard failures and never become fallback.
5. Add an independent fail-closed gate that reconstructs the complete evidence ledger from the verified Git inventory/blobs, recomputes all identities and allowed claims, rederives canonical topology, and byte-compares the only valid evidence/map pair.
6. Add immutable generation staging, target/alias preflight, final safety recheck, and one atomic `CURRENT` pointer commit so caught failure, interruption, and concurrent readers observe a complete old or new three-artifact set; retain deterministic recovery material on restoration failure.
7. Add integration-owned provider-free `node:test` fixtures and adversarial tests; retain all default Archify runtime, rendering, Viewer, generated, package, and archive surfaces unchanged.

**Success Criteria** (all must be observable and mechanically verifiable):

1. CLI contract tests reject credentialed/malformed repository inputs, normalize every equivalent supported-forge HTTPS/SSH/SCP spelling to one Station canonical URL, require one full locally available 40-hex SHA-1 commit, and prove every repository fact is read from commit tree/blob OIDs with replacement objects and lazy fetching disabled—never from checkout files.
2. Two clones of the same commit at different absolute paths, branches, and dirty-worktree states emit byte-for-byte identical evidence, map, and receipt files; each file is valid UTF-8 canonical JSON with LF endings, exactly one trailing newline, and no timestamp, absolute path, branch, process, host, or runtime value.
3. Schema and recomputation assertions prove the evidence ledger records the exact commit/tree, selected manifest paths/OIDs/SHA-256/byte counts, workspace membership, package declarations, dependency scopes, and extractor contract, with every evidence reference resolvable to one selected blob.
4. Fixture assertions prove a root package or complete one-to-five-group Node/npm workspace produces sorted, disjoint, exhaustive rooms and exact aggregated directed cross-room declarations with no same-room self-loop; the twelve-workspace Vibery-shaped fixture produces four rooms and exactly three expected relation directions without product-specific labels or an LLM.
5. Every supported-but-underdetermined fixture produces exactly one evidence-bound `coarse-project` room, zero relations, `confidence: coarse`, and sorted versioned reason codes; malformed/incomplete Git evidence instead returns a typed hard diagnostic and writes no replacement.
6. Identity tests prove project/room/relation IDs exclude revision, labels, and layout; a README-only commit changes snapshot identity while preserving durable topology IDs, and every ID is reproducible from documented versioned canonical inputs.
7. A table-driven tamper suite independently mutates each schema version, selected-file set, workspace/package/declaration fact, derived ID, digest, ordering rule, membership, evidence reference, relation, count, completeness rule, and true/false fallback cause; every isolated or coherent evidence/map mutation is rejected by a stable `station-gate/*` diagnostic before publication.
8. Failure and child-termination injection around generation writes and the sole pointer rename proves `CURRENT` always selects a complete old or new immutable set; unsafe/aliased/symlinked/conflicting paths and pointer-restoration failures produce distinct typed diagnostics, preserve deterministic recovery material, and never report success.
9. Provider-free adversarial fixtures cover replacement refs, unavailable local objects, symlink/gitlink/binary/invalid-UTF-8/control-character/path-collision inputs, manifest/tree budgets, every fallback reason, and deterministic repeated execution using only temporary local Git repositories.
10. Isolation checks prove all new runtime and test behavior is owned by `integrations/vibery-station/`, extraction opens no network/browser/preview/update/brand-capture path, and default Archify help, schemas, renderers, Viewer assets, generated artifacts, examples, and `archify.zip` bytes are unchanged.

**Plans:** 8 executable plans in 8 ordered waves

- [x] **01-01 — Isolated contracts, canonical bytes, and stable identities** (Wave 1; EVID-02, MAP-01)
- [x] **01-02 — Immutable local Git object reader** (Wave 2; depends on 01-01; GIT-01, GIT-02, GIT-03)
- [x] **01-03 — Bounded Node workspace evidence ledger** (Wave 3; depends on 01-02; EVID-01)
- [x] **01-04 — Complete structural projection and coarse fallback** (Wave 4; depends on 01-03; MAP-02, MAP-03)
- [x] **01-05 — Independent fail-closed Station gate** (Wave 5; depends on 01-04; GATE-01, GATE-02)
- [ ] **01-06 — Receipt, CLI orchestration, and atomic bundle publication** (Wave 6; depends on 01-05; OUT-01, OUT-02)
- [ ] **01-07 — Clone-independent determinism and Vibery-shaped acceptance** (Wave 7; depends on 01-06; TEST-01, TEST-03)
- [ ] **01-08 — Adversarial closure and isolation proof** (Wave 8; depends on 01-07; BOUND-01, TEST-02)

Each v1 requirement is owned by exactly one plan. Plan-level unit tests establish each layer as it is built; Plans 07–08 provide the end-to-end provider-free acceptance and failure-injection closure.

## Progress

| Phase | Requirements | Plans Complete | Status |
|-------|--------------|----------------|--------|
| 1. Deterministic Immutable-Commit Extraction | 16 | 5/8 | In Progress |

## Deferred Beyond v1

- Architecture rendering or a `station-map/v1` visual adapter
- Viewer, Station UI, Unity rooms, overlays, and interactive topology
- Host registration, permissions, persistence, and production lifecycle integration
- LLM summaries, semantic naming, ownership, runtime-call, import-graph, or causality inference
- Remote clone/fetch and partial-clone hydration
- Lockfile resolution, pnpm workspace files, Nx/Turbo/Bazel, TypeScript references, package scripts, polyglot extraction, and broad package-manager support
- Default Archify CLI, schema, renderer, generated asset, package, or archive behavior changes
