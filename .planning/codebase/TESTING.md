---
last_mapped_commit: d673e8300df60a5c8166abe78787fdc78f6b8000
---

# Testing

## Test stack

- Test runner: built-in `node:test`.
- Assertions: `node:assert/strict`.
- Main discovery: `scripts/run-tests.mjs` reads and sorts flat `archify/test/*.test.mjs` files and runs with concurrency 2 when supported.
- Golden harness: `archify/test/golden.mjs`.
- Browser harness: custom Chrome DevTools Protocol implementation in `archify/bin/visual-check.mjs` and related test helpers.
- Integration-owned tests: `integrations/deepseek-harness/test/*.test.mjs`.

At the mapped commit there are 110 top-level `*.test.mjs` files under `archify/test/`, plus special smoke/integration scripts and 9 DeepSeek integration tests.

## Main local gate

From `archify/`:

```sh
npm test
```

This runs, in order:

1. Viewer generated-template freshness.
2. Brand-mark bundle freshness.
3. Standalone-validator freshness.
4. Release identity checks.
5. Golden rendering/schema/version tests.
6. The sorted Node test suite.

Development dependencies are needed for generator freshness and parser-based tests. The packaged runtime itself remains zero-install.

## CI matrix

`.github/workflows/ci.yml` covers:

- Node 18, 20, 22, and 24 for the main suite.
- A dedicated Chrome job for real Viewer/browser behavior.
- ffmpeg-backed WebM decoding and rejection of static recordings.
- Node 22 exact-byte ZIP freshness.
- published update-manifest/release checks.
- packaged Skill smoke tests on Linux, macOS, and Windows.
- GitHub Pages deployment only after required jobs pass.

A browser test skipped for missing Chrome is explicitly considered skipped, not passed.

## Test styles

### Pure/unit tests

Import pure modules and assert exact structures, classifications, and errors. `archify/test/architecture-delta.test.mjs` directly imports canonicalization/comparison helpers and verifies deterministic ordering and fail-closed identity behavior.

### CLI contract tests

Spawn `process.execPath` with `archify/bin/archify.mjs`, then assert:

- exact exit code,
- parseable JSON receipts,
- stage and diagnostic code,
- stdout/stderr separation,
- output hashes/bytes,
- absence or preservation of destination files.

### Mutation/race tests

Preload small CommonJS shims to replace an input after its first read or simulate write failures. These tests prove captured bytes are authoritative and old artifacts survive failures without timing races.

### Local Git fixtures

`archify/test/repository-evidence.test.mjs` creates temporary repositories, commits files, configures synthetic remotes, and exercises local Git only. Coverage includes:

- GitHub, Gitee, and local-only remotes,
- HTTPS/SSH/SCP identity distinctions,
- credentials and query-token redaction,
- missing roots/remotes/revisions/blobs,
- path traversal and `.git` access,
- line-range bounds,
- trusted-artifact preservation,
- preview/compare forwarding of `--repo-root`.

### Golden/generated tests

Fresh renderer output must match checked-in public and packaged examples. Generated Viewer, validators, brands, site surfaces, package archive, and release identity have dedicated freshness gates.

### Browser tests

Viewer features are tested against actual DOM, events, theme state, exports, responsive layout, and Chrome screenshots. They are separate from static HTML/SVG validation.

## Existing tests closest to Phase 1

| Concern | Existing test/source |
|---|---|
| Immutable commit/blob evidence | `archify/test/repository-evidence.test.mjs` |
| Real pinned-repository proof | `archify/test/real-repository-proof.test.mjs` |
| Canonical IR and deterministic Delta | `archify/test/architecture-delta.test.mjs` |
| Captured-input race resistance | snapshot replacement cases in `architecture-delta.test.mjs` |
| Stable diagnostic envelope | `archify/test/repair-receipt.test.mjs`, `renderer-diagnostic-boundary.test.mjs` |
| Output alias/symlink safety | `archify/test/output-path.test.mjs` |
| Atomic delivery | `archify/test/delivery-contract.test.mjs`, `cli.test.mjs` |
| Tracked-only immutable package source | `archify/test/clean-skill-staging.test.mjs`, DeepSeek adapter tests |
| Cross-platform archive bytes/modes | `archify/test/release-package-gates.test.mjs` |
| Zero-install packaged runtime | `scripts/package-smoke.mjs`, package-smoke CI |

## Phase 1 test contract to add

Keep tests under the Station integration unless a core primitive is changed.

### Commit acceptance

- Accept exactly one locally available full commit object ID.
- Reject branch names, abbreviated SHAs, tags unless explicitly peeled and recorded by a separate contract, missing objects, non-commit objects, and repository/root mismatch.
- Prove extraction output is unchanged when the working tree, index, branch, or `HEAD` changes after input acceptance.
- Disable or reject Git replacement-object behavior.

### Tree inventory

- Deterministically enumerate tree entries independent of filesystem order.
- Define and test regular files, executable files, symlinks, gitlinks/submodules, trees, empty files, binary files, invalid UTF-8, and unusual but valid Git paths.
- Reject or explicitly account for case/Unicode-normalization collisions across supported filesystems.
- Enforce file-count, per-blob, total-byte, path-length, and subprocess-output limits with stable diagnostics.
- Record every ignored entry category and count; never silently drop unsupported evidence.

### Extraction determinism

- Same repository + commit + profile version produces byte-identical IR and receipt across repeated runs.
- Working-tree line endings, file permissions, current directory, absolute clone path, locale, timezone, and environment ordering do not affect canonical bytes.
- Stable IDs survive unrelated file additions and ordering changes.
- Duplicate/ambiguous component or relationship identity fails rather than receiving order-dependent suffixes.

### IR validity

- Generated output passes `validateSchema('architecture', ...)`.
- Every connection endpoint exists.
- Every connection has a stable ID for Delta compatibility.
- Every emitted source path resolves to a blob at the pinned commit and obeys the current max-three-sources contract.
- Profile metadata lives in a separate receipt, not an unsupported Architecture field.
- Empty or unsupported repositories return a classified failure unless an explicitly documented empty projection is accepted.

### Delta compatibility

- Two extracted commits with equivalent semantics produce no authored changes even if inventory order differs.
- File/component moves, additions, removals, and relationship changes produce expected stable classifications.
- No shared stable component identity fails closed.
- `proofLevel` becomes `revision-pinned` only after both generated IRs pass existing repository evidence verification.

### Transaction safety

- Existing IR/receipt outputs survive any inventory, parse, projection, schema, renderer, checker, or commit failure.
- Paired IR/receipt commit preflights both targets and rolls back partial renames.
- Input/output path aliases and symlink swaps are rejected.
- Temporary staging is removed after both success and failure.

### Profile isolation

- Installing/enabling the Station profile adds only its named capability.
- Disabling/removing it leaves the base Station profile and default Archify behavior unchanged.
- No network calls, telemetry, update checks, browser launch, preview server, or brand capture occur during extraction.
- Default `archify` CLI help and existing packaged Skill bytes remain unchanged if Phase 1 is truly integration-only.

## Mapping-run verification status

No source tests were run during this mapping pass. The task requested static brownfield mapping only, prohibited installation/network use, and made no implementation change requiring execution evidence.
