# Phase 1: Deterministic Immutable-Commit Extraction — Research

**Researched:** 2026-09-16
**Domain:** Node/TypeScript workspace evidence, immutable Git object reads, deterministic JSON, fail-closed Station projection
**Confidence:** HIGH for repository seams and deterministic mechanics; MEDIUM for the proposed path-group room policy pending product acceptance

## Constraints and phase boundary

This is the smallest implementation phase for Part 02. It must:

- read one explicit full commit from a local Git object database without checking it out or reading source facts from the working tree;
- mechanically extract bounded Node/TypeScript workspace evidence;
- serialize a versioned evidence ledger to deterministic bytes;
- derive and validate a minimal `station-map/v1` project/room graph from that ledger;
- preserve stable project, room, and relation IDs across equivalent rescans;
- emit one truthful coarse room when the supported evidence cannot justify a one-to-five-room decomposition;
- fail without publishing a replacement when repository integrity, evidence integrity, gate validation, or output commit fails;
- return typed diagnostics using Archify's existing diagnostic shape.

It must not add AST/import analysis, an LLM synthesis step, semantic component naming, rendering/geometry work, Unity projection, operational overlays, architecture migration, remote fetching, dependency installation, or broad package-manager support.

The repository's complete `archify/SKILL.md` was read before this research. Its relevant invariants are consistent with this phase: real-code claims require commit-pinned evidence, runtime causality must not be inferred from proximity/naming, validation failures must be reported truthfully, and repository verification is local.

## Recommendation

Implement a pure, mechanical pipeline:

```text
local repo + canonical URL + full 40-char commit
  -> immutable Git tree/blob reader
  -> station-evidence/v1 ledger
  -> deterministic Node workspace projector
  -> fail-closed Station gate
  -> station-map/v1
  -> atomic ledger + map + receipt commit
```

Do not put an agent between evidence and Station IR in Phase 1. The projector should be a pure function of the validated ledger. The gate should recompute IDs and allowed claims rather than accepting authored IDs or topology. This is the smallest way to satisfy “may summarize supported facts but may not invent unsupported topology”: Phase 1 does no summarization at all.

### Supported repository profile

Call the profile `node-workspaces/v1` and support only:

1. a root `package.json` parsed with Node's JSON semantics;
2. `workspaces` as either an array or `{ "packages": [...] }`;
3. exact workspace directories and segment wildcards such as `packages/*`;
4. regular Git blobs named `package.json` at matched workspace roots;
5. internal package relations where a declared dependency name exactly equals another selected workspace package's `name`;
6. dependency scopes preserved as evidence (`dependencies`, `optionalDependencies`, `peerDependencies`, `devDependencies`) rather than collapsed into a runtime claim.

Do not parse lockfiles, `pnpm-workspace.yaml`, Nx/Turbo configuration, TypeScript imports, `tsconfig` references, package scripts, or framework conventions in this phase. Their presence may be recorded as files later, but they must not create rooms or relations now.

### Truthful one-to-five-room policy

Use workspace boundaries, not inferred product semantics:

1. A non-workspace root package becomes one room keyed `root-package`.
2. Workspace packages are grouped by their first path segment. Examples: `packages/core-ui` and `packages/core-ai` belong to the structural `packages` room; `vibery-games/voidfarer` and `vibery-games/card-studio` belong to `vibery-games`.
3. A detailed map is allowed only when this produces 1–5 non-empty groups and every selected manifest needed for the decomposition is readable and unambiguous.
4. Cross-room relations aggregate exact internal package declarations. Same-room declarations stay in the ledger but do not create self-loop topology.
5. If those rules cannot produce a complete supported decomposition, emit exactly one `coarse-project` room with explicit fallback reasons. Do not select five packages, omit the rest, guess categories, or ask the developer to design the map.

This policy is structural rather than semantic, but every room remains truthful: it names a declared workspace path boundary and lists all package roots it contains. It also fits the current Vibery checkout without special cases. A read-only shape check found 12 declared npm workspaces that collapse deterministically into four first-segment groups: `vibery-backend-new`, `vibery-ui-web`, `vibery-games`, and `packages`. Exact internal package declarations produce three cross-group directions (backend → packages, UI → packages, games → packages); declarations within `packages` remain ledger evidence rather than a false room self-loop.

## Current repository seams

### Reuse directly

| Seam | Current behavior | Phase 1 use |
|---|---|---|
| `archify/renderers/shared/repository-location.mjs` | Canonicalizes supported HTTP(S)/SSH remotes, compares repository identities, and redacts credentials without network access. | Reuse `parseRepositoryRemote` and `redactRepositoryRemote`; do not invent another remote parser. |
| `archify/renderers/shared/diagnostics.mjs` | Normalizes diagnostics to `{code,severity,message,subject,evidence,supportedFixes}` and provides a fail-closed renderer boundary. | Reuse the diagnostic shape and naming discipline. The Station CLI can have its own boundary but should produce the same fields. |
| `archify/renderers/shared/repository-evidence.mjs` | Requires a full 40-character SHA, verifies top-level root/origin/commit/blob/line evidence, and uses `git cat-file`/`git show` rather than working-tree file reads. | Treat as precedent. Reuse remote identity helpers, but do not refactor this stable renderer path during Phase 1. |
| `archify/delta/architecture-delta.mjs` | Uses code-point ordering and recursive sorted-key JSON for semantic canonicalization; compares exact stable IDs. | Extract or reproduce the small canonical-JSON primitive in a Station-owned module. Do not make Station depend on the large delta renderer. |
| `archify/bin/archify.mjs` | Freezes input bytes, stages beside targets, hashes exact bytes, reports typed receipts, and preserves last-known-good output. `commitComparePair` already demonstrates rollback for a multi-file commit. | Generalize the pair-commit idea to three Station JSON targets, without changing existing delivery/compare behavior. |
| `archify/schemas/*.schema.json` + generated standalone validators | JSON Schema is authoritative; generated validators keep runtime zero-install. | Add dedicated evidence/map schemas and generated validators, not ad hoc shape checks alone. |
| `scripts/run-tests.mjs` | Discovers every top-level `archify/test/*.test.mjs` in sorted order. | New Station tests are automatically included if they follow the existing naming/location convention. |

### Important limitations in current seams

- `verifyRepositoryEvidence` verifies authored source references; it does not enumerate or classify repository structure.
- Its Git helper requests UTF-8 strings and uses `git show <revision>:<path>`. The extractor needs Buffer-based NUL-delimited tree parsing and blob-OID reads because Git paths may contain tabs/newlines and the working tree must remain irrelevant.
- Current Architecture schema requires renderer component types such as `backend` and caps component sources at three. Mapping structural rooms to one of those semantic types would invent meaning, while grouped rooms may have more than three manifest records. Therefore Phase 1 should stop at validated `station-map/v1`; an Archify rendering adapter is a later phase.
- Existing canonical JSON is private to `architecture-delta.mjs`. Copying its 10-line behavior is lower risk than importing the delta subsystem, but a tiny shared `canonical-json.mjs` is preferable if extraction can be proven not to perturb delta bytes.
- The current package has no runtime parsing dependency beyond generated code. A parser/indexer dependency is unnecessary for this phase.

## Immutable Git object-read contract

### Inputs

Require all of:

- `--repo-root <absolute-or-relative-local-path>`;
- `--repository-url <credential-free canonical clone URL>`;
- `--revision <40 lowercase-or-uppercase hex SHA-1>`;
- an output prefix.

Continue the repository's current SHA-1-only contract for Phase 1. Query `git rev-parse --show-object-format`; if it is not `sha1`, return `station-extract/object-format-unsupported`. Supporting SHA-256 repositories can be a later schema revision because IDs, validation patterns, and existing Architecture evidence all currently assume 40 characters.

### Git invocation rules

Use `spawnSync('git', args, { encoding: null, shell: false, ... })` with bounded buffers and an environment that includes:

```text
GIT_NO_REPLACE_OBJECTS=1
GIT_NO_LAZY_FETCH=1
GIT_OPTIONAL_LOCKS=0
GIT_TERMINAL_PROMPT=0
LC_ALL=C
```

The first two flags are essential: replacement refs can make a pinned object name resolve to substituted content, and partial-clone object reads can otherwise fetch missing blobs. Phase 1 promises local, immutable, no-network evidence.

Recommended read sequence:

1. Resolve and realpath `repoRoot`; require it to equal `git rev-parse --show-toplevel`.
2. Parse and compare `origin` with the authored repository URL using the existing repository-location helper; never copy raw credentialed origins into diagnostics.
3. Validate the revision with the fixed hex regex before passing it to Git.
4. Require `git cat-file -e <revision>^{commit}`.
5. Resolve `treeOid = git rev-parse <revision>^{tree}`.
6. Enumerate once with `git ls-tree -rz --full-tree <revision>` and parse NUL-delimited Buffer records. Parse the fixed header (`mode type oid<TAB>`) separately from raw path bytes.
7. Decode paths with `new TextDecoder('utf-8', { fatal: true })`. Unsupported/non-UTF-8/control-character manifest paths force coarse fallback; malformed tree protocol is a hard failure.
8. Read only selected regular blobs by exact object ID using `git cat-file blob <blobOid>`. Do not use `fs.readFile` under the repository and do not use `git checkout`, `worktree`, `archive`, `show <sha>:<path>`, or filters.

Use conservative budgets, all represented in the receipt contract: 16 MiB tree output, at most 512 discovered `package.json` paths, at most 1 MiB per manifest, and at most 8 MiB total selected manifest bytes. Probe selected blob sizes first with exact-OID `git cat-file -s`; a trustworthy size beyond manifest policy yields whole-project coarse fallback before content reading. Unavailable objects, malformed size output, probe/read disagreement, or process-output overflow are hard integrity failures. A budget violation must never yield a partial detailed graph; if tree enumeration itself is incomplete, fail entirely because even a coarse claim cannot be proven complete.

Symlink `package.json` entries and submodule entries are not regular package manifests. Record the unsupported shape and use coarse fallback; never follow a checkout symlink.

## Deterministic-byte contract

Create one small canonical JSON serializer with these rules:

- JSON-domain values only; reject `undefined`, functions, symbols, non-finite numbers, and cycles;
- recursively sort object keys by direct Unicode code-point comparison (`left < right`), never `localeCompare`;
- preserve array order only after each domain producer has sorted the array by a documented stable key;
- UTF-8 encoding, LF line endings, and exactly one trailing newline;
- no timestamps, durations, absolute local paths, current branch, `HEAD`, Git version, process ID, host data, or raw stderr in successful artifacts;
- SHA-256 hashes cover the exact emitted bytes including the trailing newline.

Domain array keys:

- files: `path`, then Git OID;
- packages: `root`, then package name;
- dependency declarations: dependency name, then scope;
- rooms: room ID;
- relations: relation ID;
- evidence references and reason codes: unique code-point order.

The same repository identity, revision, object database, and extractor contract version must produce byte-identical ledger/map/receipt artifacts in different clones, on dirty working trees, and with a different checked-out branch. Station normalizes standard GitHub/Gitee HTTPS, SSH URI, and SCP spellings to one identity-derived canonical HTTPS URL before hashing or serialization; caller/origin transport spelling is never artifact data.

## Exact artifact contracts

The three logical artifact names below live together inside one immutable generation selected by a once-read atomic `CURRENT` pointer.

### 1. `station-evidence.json`

Recommended minimal shape:

```json
{
  "schema": "station-evidence/v1",
  "extractor": {
    "profile": "node-workspaces/v1",
    "contract_version": 1
  },
  "repository": {
    "id": "project-<64 hex>",
    "url": "https://example.test/owner/repo",
    "revision": "<40 hex>",
    "tree_oid": "<40 hex>",
    "object_format": "sha1"
  },
  "files": [
    {
      "id": "evidence-<64 hex>",
      "kind": "git-blob",
      "path": "packages/api/package.json",
      "git_oid": "<40 hex>",
      "sha256": "<64 hex>",
      "bytes": 1234
    }
  ],
  "packages": [
    {
      "root": "packages/api",
      "name": "@example/api",
      "private": true,
      "manifest_evidence_id": "evidence-<64 hex>",
      "workspace_pattern": "packages/*",
      "declared_dependencies": [
        {
          "name": "@example/core",
          "scopes": ["dependencies"]
        }
      ]
    }
  ]
}
```

The root Git tree is implicit in `tree_oid`; every parsed package fact points to the exact manifest blob from which it came. Raw manifest contents do not need to be duplicated in the ledger because their exact Git OID, SHA-256, byte length, and repository path are retained and can be independently reread from the pinned commit.

Project ID formula:

```text
project- + sha256("station-project/v1\0" + canonicalRepositoryIdentity)
```

Evidence ID formula:

```text
evidence- + sha256("station-evidence/v1\0git-blob\0" + path + "\0" + gitOid)
```

Do not include the revision in project or room IDs. Revision belongs to snapshot identity, not durable topology identity.

### 2. `station-map.json`

Recommended minimal shape:

```json
{
  "schema": "station-map/v1",
  "snapshot": {
    "id": "snapshot-<64 hex>",
    "project_id": "project-<64 hex>",
    "revision": "<40 hex>",
    "evidence_sha256": "<64 hex>",
    "profile": "node-workspaces/v1",
    "mode": "structural"
  },
  "project": {
    "id": "project-<64 hex>",
    "label": "example-repo"
  },
  "rooms": [
    {
      "id": "room-<64 hex>",
      "project_id": "project-<64 hex>",
      "kind": "component",
      "structural_key": "workspace-path-group:packages",
      "label": "packages",
      "package_roots": ["packages/api", "packages/core"],
      "confidence": "high",
      "evidence_ids": ["evidence-<64 hex>"]
    }
  ],
  "relations": [
    {
      "id": "relation-<64 hex>",
      "kind": "declared-package-dependency",
      "from_room_id": "room-<64 hex>",
      "to_room_id": "room-<64 hex>",
      "scopes": ["dependencies"],
      "evidence_ids": ["evidence-<64 hex>"]
    }
  ],
  "fallback": {
    "used": false,
    "reason_codes": []
  }
}
```

Room ID formula:

```text
room- + sha256("station-room/v1\0" + projectId + "\0" + structuralKey)
```

Relation ID formula:

```text
relation- + sha256("station-relation/v1\0declared-package-dependency\0" + fromRoomId + "\0" + toRoomId)
```

Snapshot ID formula:

```text
snapshot- + sha256("station-snapshot/v1\0" + projectId + "\0" + revision + "\0" + evidenceSha256 + "\0node-workspaces/v1")
```

A fallback map uses exactly one room with:

```json
{
  "kind": "coarse-project",
  "structural_key": "project-root",
  "label": "<root package name or repository basename>",
  "package_roots": [],
  "confidence": "coarse"
}
```

Its `fallback.used` is `true`, and `reason_codes` contains one or more typed causes such as `station-fallback/root-manifest-missing`, `station-fallback/workspace-shape-unsupported`, `station-fallback/workspace-manifest-invalid`, `station-fallback/room-count-out-of-range`, or `station-fallback/package-name-ambiguous`.

### 3. `station-receipt.json`

The successful sidecar should contain only deterministic logical names and exact hashes/byte counts:

```json
{
  "schema": "station-extraction-receipt/v1",
  "ok": true,
  "command": "station extract",
  "repository": {
    "url": "https://example.test/owner/repo",
    "revision": "<40 hex>"
  },
  "artifacts": {
    "evidence": { "file": "station-evidence.json", "sha256": "<64 hex>", "bytes": 1234 },
    "map": { "file": "station-map.json", "sha256": "<64 hex>", "bytes": 567 }
  },
  "result": {
    "project_id": "project-<64 hex>",
    "snapshot_id": "snapshot-<64 hex>",
    "rooms": 4,
    "relations": 3,
    "fallback": false
  },
  "diagnostics": []
}
```

Do not make the receipt self-hash. Its own bytes are deterministic because it excludes absolute target paths and volatile execution data.

## Fail-closed evidence-to-Station gate

Implement `projectStationMap(validatedLedger)` as the production map constructor. Before output commit, an independent gate must reconstruct the complete expected evidence ledger from verified Git inventory/blobs and separately reconstruct the only valid map without importing either builder.

The gate must begin from the verified complete Git inventory and independently assert:

1. exact supported schema/profile versions and the identity-derived Station canonical repository URL;
2. full revision/tree/object identity and fixed resource-budget contract;
3. root/workspace manifest selection, exact OID size probes, policy-size fallback, blob decoding/parsing, workspace patterns/membership, package fields, dependency declarations/scopes, and every true fallback cause;
4. every selected file path/OID/digest/byte count/evidence ID and complete selected-file accounting;
5. canonical evidence bytes exactly equal the independently reconstructed `station-evidence/v1` ledger—no invented/omitted file, package, declaration, membership, or fallback claim;
6. every detailed room's structural key, package membership, ID, confidence, and evidence set exactly match the deterministic grouping policy;
7. rooms are complete, disjoint, sorted, and total 1–5;
8. every relation corresponds to at least one exact internal package declaration crossing those rooms; its direction, scopes, evidence set, and ID are recomputed, with no omitted/invented/self-loop relation;
9. fallback has exactly one coarse room, zero relations, `confidence: coarse`, and only independently proven fallback reasons; a valid detailed repository cannot be falsely downgraded;
10. snapshot evidence hash and snapshot ID match exact independently reconstructed ledger bytes;
11. no unknown properties or noncanonical bytes survive validation.

The gate must not import or call the evidence builder or projector. It intentionally duplicates the small workspace/fallback and grouping/relation policies so a coherent builder/projector defect cannot become authority. Any mismatch returns a gate diagnostic and commits nothing.

### Hard failure versus fallback

Use fallback only when the commit and complete tree are trustworthy but supported structure is insufficient.

**Hard failure; publish nothing:** Git unavailable, unreadable/non-top-level repository, origin mismatch, invalid/unavailable/non-commit revision, unsupported Git object format, incomplete/malformed tree enumeration, local object unavailable with lazy fetching disabled, malformed ledger, gate mismatch, unsafe/aliased output path, or atomic commit/rollback failure.

**Successful coarse fallback:** no root package manifest, malformed/oversized selected manifest, unsupported workspace shape/pattern, symlink manifest, zero matched workspaces, more than five first-segment groups, duplicate/ambiguous selected package names, or another explicitly versioned unsupported Node workspace shape. These conditions do not justify detail, but a verified commit/tree still justifies one project room.

## Typed diagnostics

Use the existing diagnostic fields exactly. Suggested stable codes:

```text
station-extract/git-unavailable
station-extract/root-unreadable
station-extract/root-not-top-level
station-extract/url-invalid
station-extract/origin-mismatch
station-extract/revision-invalid
station-extract/revision-unavailable
station-extract/object-format-unsupported
station-extract/tree-unreadable
station-extract/tree-protocol-invalid
station-extract/tree-budget-exceeded
station-extract/object-unavailable
station-extract/path-encoding-unsupported
station-extract/manifest-budget-exceeded
station-gate/schema-invalid
station-gate/evidence-reference-missing
station-gate/evidence-identity-mismatch
station-gate/topology-identity-mismatch
station-gate/unsupported-claim
station-output/path-invalid
station-output/commit-target
station-output/commit-failed
station-output/commit-rollback-failed
```

Fallback reasons belong in the successful map/receipt and may also be emitted as `warning` diagnostics. Never downgrade a hard integrity failure to a fallback.

Diagnostics must redact origin credentials and avoid absolute local paths in sidecars. Process stderr can be summarized into a bounded reason for interactive output, but successful deterministic artifacts must not include it.

## Proposed implementation seams

```text
integrations/vibery-station/
├── lib/
│   ├── canonical-json.mjs           # JSON-domain validation + canonical UTF-8 bytes
│   ├── git-object-reader.mjs        # no-checkout, no-lazy-fetch tree/blob reader
│   ├── node-workspace-evidence.mjs  # package/workspace extraction only
│   ├── station-projector.mjs        # IDs, grouping, relations, fallback
│   ├── station-gate.mjs             # independent evidence + topology reconstruction
│   └── station-output.mjs           # immutable generation + atomic current pointer
├── schemas/
│   ├── station-evidence.schema.json
│   ├── station-map.schema.json
│   └── station-extraction-receipt.schema.json
└── test/
    ├── git-object-reader.test.mjs
    ├── station-projector.test.mjs
    ├── station-gate.test.mjs
    └── station-cli.test.mjs
```

Add one narrow CLI route:

```text
node integrations/vibery-station/bin/station-map.mjs extract <bundle-root> \
  --repo-root <repository> \
  --repository-url <repository-url> \
  --revision <full-commit-sha> \
  --json
```

Stage all three logical files in one immutable generation and derive its deterministic ID from contract version plus the three final artifact hashes. Reject unknown/repeated options, unsafe/aliased/symlinked paths, conflicting existing generation bytes, malformed `CURRENT`, and bundle-directory changes between prepare and commit. Durably publish the generation first, then atomically rename one regular-file pointer containing `<generation-id>\n` over `CURRENT`. Readers resolve and validate that pointer once before opening all three generation files. Never delete prior generations in Phase 1; on pointer-restoration failure retain deterministic recovery material.

Do not refactor `repository-evidence.mjs`, renderer loading, Architecture schema, or delta rendering in this phase. That keeps the blast radius bounded and makes the new extractor independently testable.

## Test strategy

### Git object reader

- Extract commit A while the checkout is on commit B; assert A's blobs are used.
- Modify and delete tracked manifests in the working tree and add untracked manifests; assert artifact bytes are unchanged.
- Capture `HEAD`, index checksum, and `git status --porcelain=v1 -z` before/after; assert extraction does not mutate them.
- Create paths containing spaces, tabs, and newlines; assert NUL-delimited parsing is correct or the documented unsupported-path fallback occurs.
- Create a manifest symlink; assert it is not followed and causes coarse fallback.
- Add a Git replacement ref for the commit/tree/blob in the fixture; assert `GIT_NO_REPLACE_OBJECTS=1` keeps extraction on the named object.
- Assert the runner always sets no-lazy-fetch/no-prompt/no-optional-lock environment flags.
- Cover missing objects, oversized tree output, exact blob-size probes, probe/read disagreement, policy-oversized manifests, non-top-level roots, equivalent remote spellings, wrong origins, credential redaction, invalid SHA, missing commit, and non-SHA-1 object format diagnostics. A trustworthy size beyond manifest policy is coarse fallback; object/protocol inconsistency is hard failure.

### Determinism and identity

- Extract the same commit from two clones at different absolute paths and dirty states; compare ledger, map, and receipt bytes exactly.
- Run twice in one clone; compare exact bytes and SHA-256 values.
- Commit a README-only change; assert snapshot ID changes while project/room/relation IDs remain identical.
- Change a package display `name` without moving its path; assert room ID remains stable and label/evidence change is explicit.
- Move a workspace across first-segment groups; assert the affected room/relation identity delta is explicit.
- Permute object keys and dependency declarations in fixture source, then assert the projector's semantic arrays remain deterministically ordered. Raw evidence hashes may change because the committed bytes changed.

### Projection and fallback

- Root single package -> one detailed room.
- 1–5 first-segment workspace groups -> complete detailed rooms.
- Current Vibery-shaped fixture (12 packages in four groups) -> four rooms and exact aggregated cross-room relations.
- Internal declarations within one room -> ledger evidence, no room self-loop.
- Missing root manifest, malformed manifest, unsupported workspace glob, zero matches, symlink manifest, duplicate names, and >5 groups -> exactly one coarse room with exact reason codes.
- A malformed/incomplete Git tree -> hard failure, not fallback.
- Ensure no room or relation label claims service type, runtime call direction, ownership, or causal impact.

### Gate tamper cases

Starting from valid generated evidence/map bytes, independently and coherently mutate:

- selected-file omission/invention, manifest OID/digest/size, workspace patterns/membership, package fields, and declaration names/scopes;
- project, room, relation, evidence, or snapshot IDs;
- repository URL/revision/evidence hash;
- room membership or evidence references;
- relation endpoints, scopes, or supporting manifests;
- true/false/omitted fallback cause, fallback flag, reason, or confidence—including falsely downgrading a valid detailed fixture;
- a sixth room, duplicate room, omitted package, omitted allowed relation, or invented relation;
- an unknown property or schema version.

Every case must return a stable `station-gate/*` diagnostic and leave all trusted outputs byte-for-byte unchanged.

### Atomic output

- Extraction, schema, gate, generation-write, and pre-pointer failures leave the prior `CURRENT` authoritative.
- Unsafe directory/symlink/non-regular/aliased/conflicting generation or pointer state is rejected before authority changes.
- Terminate child publishers immediately before and after the sole pointer rename; once-read concurrent readers observe one complete old or new generation, never mixed files.
- Simulate bundle-root fsync failure after pointer rename; assert deterministic prior-pointer restoration and fsync.
- Simulate restoration failure; assert `station-output/commit-rollback-failed`, no success claim, and retention of both immutable generations plus pointer recovery material.
- Clean only non-authoritative temporary paths; never delete prior generations in Phase 1.

The focused suite should use temporary Git repositories and Node's built-in `node:test`; it needs no network, checkout mutation, browser, or new test framework.

## Pitfalls

1. **Reading `fs` paths under the checkout.** This makes dirty files, current branch, symlinks, and checkout state part of evidence. Read tree/blob objects only.
2. **Using line-delimited `ls-tree`.** Git paths can contain newlines and tabs. Use `-z` and Buffer parsing.
3. **Allowing replace refs.** A full SHA is not sufficient if Git replacement objects are active. Disable them.
4. **Triggering partial-clone fetches.** `cat-file` may lazily obtain missing promised objects. Disable lazy fetch and fail closed.
5. **Using labels/package names as identity.** Names can change. Derive room identity from repository identity plus structural workspace key.
6. **Hashing pretty JSON produced by insertion order.** Canonicalize recursively and define array order first.
7. **Calling declared dependencies runtime calls.** The evidence supports only “manifest declares dependency,” including its exact scope.
8. **Publishing a partial five-room map for a larger unsupported shape.** Completeness matters more than detail; use one coarse room.
9. **Treating fallback as an integrity escape hatch.** Fallback is allowed only after commit/tree integrity is established.
10. **Forcing Station rooms into existing Architecture `componentType`.** `backend`, `frontend`, and similar values would add unsupported semantics. Keep the Phase 1 IR separate.
11. **Including local paths/timing in sidecars.** That breaks clone-independent deterministic bytes and can disclose private filesystem layout.
12. **Refactoring the mature renderer evidence path concurrently.** The existing repository-evidence and delta tests are broad; isolate Phase 1 before considering shared infrastructure cleanup.

## Validation gates for Phase 1 completion

1. All three new schemas reject unknown fields and have generated zero-install validators.
2. Targeted Station tests pass under the existing sorted `node:test` runner.
3. Existing repository-evidence, architecture-delta, CLI output-path, generated-validator, and diagnostic-boundary tests still pass unchanged.
4. A current Vibery-shaped fixture produces the expected four structural rooms without an LLM.
5. Same-commit extraction is byte-identical across clone path, branch, and dirty working-tree differences.
6. Every gate-tamper and hard-failure case preserves last-known-good outputs.
7. Coarse fallback is explicit, one-room, relation-free, evidence-bound, and never described as detailed architecture.
8. No test or implementation invokes checkout mutation, install, network, or a shell-interpolated Git command.

## Deferred work

- Archify Architecture rendering adapter and neutral Station visual vocabulary.
- Architecture delta presentation for `station-map/v1` snapshots.
- LLM-authored summaries or evidence-constrained semantic grouping.
- TypeScript import/reference extraction and runtime-boundary inference.
- `pnpm-workspace.yaml`, lockfile semantics, Nx/Turbo/Bazel project graphs, polyglot repositories, nested repositories, and submodules.
- Station persistence, migration acceptance, live Blueprint/Part/agent overlays, bird's-eye UI, and Unity consumption.
- Upstream fork-sync tooling and reviewed-pin metadata beyond this extractor contract.

## Sources inspected

- `archify/SKILL.md` (complete)
- `archify/references/authoring-contract.md`, repository-evidence section
- `archify/renderers/shared/repository-evidence.mjs`
- `archify/renderers/shared/repository-location.mjs`
- `archify/renderers/shared/diagnostics.mjs`
- `archify/renderers/shared/validator.mjs`
- `archify/renderers/shared/cli.mjs`
- `archify/delta/architecture-delta.mjs`
- `archify/bin/archify.mjs`
- `archify/schemas/architecture.schema.json`
- `archify/schemas/common.schema.json`
- `archify/scripts/generate-validators.mjs`
- `scripts/run-tests.mjs`
- `archify/test/repository-evidence.test.mjs`
- `archify/test/real-repository-proof.test.mjs`
- `archify/test/architecture-delta.test.mjs`
- `archify/test/renderer-diagnostic-boundary.test.mjs`
- `archify/test/artifact-receipt-flush.test.mjs`
- `archify/test/cli-output-types.test.mjs`
- `PRODUCT.md`, `DESIGN.md`
- Part 02 contract at `/data/planning/blueprints/codebase-as-station-vertical-slice/parts/part-02.md`
- Read-only target-shape check of the current Vibery checkout's root/workspace `package.json` files

No implementation, install, network request, test run, commit, or push was performed during this research pass.
