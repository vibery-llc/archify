---
last_mapped_commit: d673e8300df60a5c8166abe78787fdc78f6b8000
---

# Concerns

## Phase 1 risk summary

The repository already has strong verification and transaction primitives, but it does **not** have a repository extractor. The main planning risk is accidentally treating evidence verification or authored IR comparison as source-code analysis. A Station substrate must define a new, narrow projection contract without widening default Archify behavior.

## Repository-evidence limitations

### Verification is not extraction

`verifyRepositoryEvidence()` validates authored repository metadata and source references. It does not inventory a commit, detect languages, parse source, infer components, derive edges, or prove runtime behavior.

### Working-tree independence is partial but useful

Source existence/content is checked through `${revision}:${path}`, so dirty working-tree content does not affect source verification. However, repository root and `origin` are read from the mutable checkout configuration. Extraction receipts should distinguish immutable commit/tree facts from local checkout identity facts.

### Full SHA-1 assumption

The Architecture schema and verifier require exactly 40 hexadecimal characters. Git repositories using SHA-256 object format are outside the current contract. Phase 1 must either explicitly support only 40-hex repositories or keep a Station receipt capable of recording other object formats without claiming compatibility with `meta.repository.revision`.

### Origin is mandatory

Current evidence requires an `origin` remote matching authored repository identity. Local repositories without `origin` cannot receive existing verified evidence even when their commit object is available. Do not silently invent an origin.

### Source cardinality is small

Architecture components allow 1–3 source references. An extractor must deterministically select representative sources and record omitted evidence in its sidecar; it cannot attach an unbounded file list to a component.

### Symlink mode is not checked by evidence verifier

`${revision}:path` reports a symlink object as a blob. The verifier checks object type `blob` but not tree mode `120000`, so a symlink could be treated like source text. The extractor must inventory tree modes and explicitly reject or account for symlinks rather than inheriting this ambiguity.

## Immutable Git extraction hazards

- **Replacement objects:** Git replace refs can change how an object ID is interpreted. Use `GIT_NO_REPLACE_OBJECTS=1` (or equivalent explicit rejection) so a full SHA actually identifies the read commit/tree.
- **Mutable refs:** branch names, tags, abbreviated SHAs, and rev expressions are not immutable inputs. Accept a full object ID and verify `^{commit}` without resolving a moving name inside the canonical contract.
- **Shallow/partial clones:** missing trees/blobs must fail as unavailable; extraction must never fetch or downgrade silently.
- **Submodules/gitlinks:** tree mode `160000` names another commit whose objects may be unavailable. Define a bounded top-level representation or reject; do not recurse implicitly.
- **Large blobs/repositories:** existing Git calls have a 16 MiB `maxBuffer`, but a general inventory can exceed it. Add explicit file-count, blob-size, total-byte, and output limits with diagnostics.
- **Binary and invalid UTF-8 content:** text parsing must detect/reject/account for these deterministically. Replacement decoding would fabricate evidence.
- **Path portability:** Git permits names that collide by case or Unicode normalization on supported filesystems. Object-level reading avoids checkout loss, but emitted paths and staged artifacts still need collision policy.
- **Repository config/environment:** sanitize Git environment and avoid user aliases, external filters, textconv, paging, prompts, SSH, and network. Fixed plumbing commands should be used with no shell.
- **Hash algorithm and commit/tree identity:** record both accepted commit object ID and resolved tree object ID in the Station receipt.

## IR identity hazards

### Stable IDs are mandatory for useful deltas

Architecture schema does not require connection IDs, but Delta does. Generated IDs must derive from stable semantics, not traversal index. Collisions or ambiguous identity should fail with evidence rather than append order-dependent suffixes.

### Boundary identity is weak

Boundaries have no authored ID. Delta derives identity from `kind + label`, so renaming a boundary appears as removal/addition and duplicate kind/label is rejected. Avoid depending on boundaries for the primary extraction identity model.

### Strict schema blocks provenance extensions

Architecture uses `additionalProperties: false` at every relevant level. Extractor version, parser version, inventory digest, ignored paths, limits, confidence, and warnings belong in a separate Station receipt unless a future reviewed schema change is approved.

### Canonicalization scope is Architecture-specific

`canonicalArchitecture()` sorts components, connections, boundaries, wraps, and sources, but preserves order for cards and guided views. A generated extractor should omit optional presentation content unless it has a deterministic contract.

### Existing comparator is authored-fact comparison

Architecture Delta compares two IR snapshots; it does not infer code impact, ownership, call graphs, or merge safety. Profile/UI copy must preserve that limitation.

## Process/API seams

### Main CLI is monolithic and executable

`archify/bin/archify.mjs` is 2,126 lines and dispatches at import time. Adding extraction directly there increases regression scope; importing it as a library is unsafe. A profile-owned command should call stable modules or spawn the CLI deliberately.

### Renderers are executable modules

Type renderers perform top-level argument parsing/rendering. There is no common in-process `render(diagram)` API. Profile code should not refactor renderers merely to implement extraction.

### Shared helpers are internal, not versioned public APIs

`repository-location.mjs`, `validator.mjs`, and Delta exports are technically importable but not declared package exports. A separately distributed Station adapter that imports them by relative path becomes pinned to the exact Archify source commit. That is acceptable only with release metadata and acceptance tests similar to DeepSeek Harness.

### Diagnostic state is import-time global

`ARCHIFY_DIAGNOSTIC_FORMAT` is captured when `diagnostics.mjs` loads, and the renderer boundary installs a process-global uncaught-exception handler. Profile extraction should own its top-level failure boundary rather than casually importing executable renderer orchestration.

## Network isolation

The repository contains optional network-capable update checking and remote brand capture. “No network” is not guaranteed merely by using Archify code. The Station profile must use an allowlisted module graph or explicit acceptance instrumentation proving extraction cannot reach those paths.

Do not run:

- `scripts/check-update.mjs`,
- `brands capture`,
- package installers,
- Git fetch/pull/clone against remote URLs,
- preview/open/browser paths.

## Packaging and upstream-preservation risk

Any core change can trigger validator/template/example/archive freshness work. A Station-only profile avoids changing `archify.zip`, generated Viewer assets, schemas, and public examples. If a core primitive is unavoidable, make it a behavior-preserving extraction of existing logic with focused tests before adding profile behavior.

The existing DeepSeek integration reads adapter bytes from Git `HEAD`, while its bundled Skill source is separately pinned in `release.json`. A Station package should similarly distinguish profile code identity from the Archify source identity it embeds or imports.

## Scale and maintainability hotspots

- `archify/renderers/workflow/workflow-compiler.mjs`: 4,400 lines.
- `archify/bin/archify.mjs`: 2,126 lines.
- `viewer/guided-views.js`: 1,729 lines.
- `viewer/focus.js`: 1,440 lines.
- `archify/renderers/shared/geometry.mjs`: 1,423 lines.
- `archify/delta/architecture-delta.mjs`: 1,223 lines.

Phase 1 should avoid these unrelated hotspots except the pure canonical/delta interface.

## Open planning decisions

1. Which source languages and repository signals are recognized in Phase 1?
2. Is an unsupported repository a classified failure or a valid empty/partial projection?
3. What exact file-count/blob-size/total-byte/time limits apply?
4. How are symlinks, submodules, vendored/generated files, lockfiles, binaries, and archives handled and reported?
5. What stable-ID derivation survives moves while remaining evidence-based?
6. Does Station need only Architecture IR + receipt, or also downstream HTML and commit-to-commit Delta artifacts?
7. What Station profile API, permission model, artifact location, and uninstall/disable contract are authoritative?
8. Is 40-hex SHA-1-only acceptable for Phase 1?
9. Must local repositories without `origin` be supported, and if so how is repository identity represented without weakening existing Archify evidence claims?
10. Is extraction intended to be language-neutral inventory projection or true syntax-aware code analysis? The latter needs explicit parser dependencies and a larger support matrix.

## Recommended Phase 1 guardrails

- Local repository only; no fetch and no network fallback.
- Full locally available commit object ID only.
- Git replacement objects disabled.
- Tree/blob plumbing only; no working-tree source reads.
- Fixed allowlist of recognized evidence and explicit accounting for everything else.
- Existing Architecture v1 IR as output; separate Station extraction receipt.
- Deterministic stable IDs and connection IDs on every generated entity.
- Existing schema/evidence validation as downstream gates.
- Pairwise atomic IR/receipt commit.
- Profile-local implementation/tests; no default CLI, Viewer, schema, or package behavior changes.
