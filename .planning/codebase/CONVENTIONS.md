---
last_mapped_commit: d673e8300df60a5c8166abe78787fdc78f6b8000
---

# Conventions

## JavaScript style

- Native ESM imports, usually Node built-ins first and relative imports second.
- Semicolons, single quotes, two-space indentation.
- `const` by default; `let` for changing state.
- Small named functions are preferred over classes. Classes are used for typed errors or stateful browser/runtime wrappers.
- Synchronous filesystem and child-process APIs are common in deterministic command paths; browser/preview/network paths use async APIs where required.
- Public reusable functions are named exports. Executable scripts use shebangs and set `process.exitCode` or exit explicitly.
- No formatter/linter config is present; repository tests and review conventions enforce style behaviorally.

## Naming and data shape

- JSON authored contracts use snake_case (`schema_version`, `diagram_type`, `quality_profile`, `link_mode`, `end_line`).
- JavaScript receipts and runtime objects generally use camelCase (`schemaVersion`, `proofLevel`, `rawSha256`).
- Stable semantic IDs match `^[a-zA-Z][a-zA-Z0-9_-]*$`.
- Diagram collections are type-specific: Architecture `components`/`connections`, Workflow `nodes`/`edges`, Sequence `participants`/`messages`, Dataflow `nodes`/`flows`, Lifecycle `states`/`transitions`.
- Relationship IDs remain optional for broad backwards compatibility, but become mandatory for exact Architecture Delta comparison.
- Schema objects normally use `additionalProperties: false`; extension data needs an explicit reviewed field or a separate sidecar.

## Determinism conventions

- Stable ordering is explicit; Architecture Delta uses code-point comparison rather than locale-sensitive sorting.
- Canonical JSON recursively sorts object keys and selected entity collections.
- Set-like arrays (`boundary.wraps`, component `sources`) are sorted for semantic comparison.
- Raw bytes and canonical semantic content are hashed separately when both identities matter.
- Formatting-only input changes may change raw hashes but must not change canonical Delta HTML.
- Checked-in generated outputs are byte-verified, with newline normalization only where cross-platform checkout behavior requires it.
- Canonical ZIP bytes are tied to Node 22 and recorded Git index modes.

For Phase 1 extraction, avoid locale-sensitive APIs, filesystem enumeration order, timestamps, absolute machine paths, random IDs, working-tree mtimes, and branch names in canonical output.

## Fail-closed diagnostics

Machine-facing failures use:

```json
{
  "code": "namespace/stable-code",
  "severity": "error",
  "message": "human-readable failure",
  "subject": {},
  "evidence": {},
  "supportedFixes": []
}
```

Conventions:

- A non-zero subprocess exit is never success.
- Unexpected renderer failures become `internal/unclassified`, not raw stack traces.
- Diagnostics identify the exact subject and measured evidence.
- `supportedFixes` lists only executable controls the caller can actually use.
- Secret-bearing origins are redacted before they enter errors or receipts.
- Unsupported, ambiguous, duplicate, missing, stale, or unverifiable identity is rejected rather than guessed.
- JSON mode writes one parseable JSON object; diagnostics go through the established boundary.

A Station extractor should use a distinct namespace such as `station-extract/*` and stage labels such as `arguments`, `repository`, `inventory`, `parse`, `project`, `validate`, and `commit`.

## Input capture and commit conventions

The repository's strongest mutation-safe pattern is:

- Read source bytes once.
- Freeze/copy those exact bytes or Git blobs into a private candidate area.
- Validate the captured copy.
- Build all related outputs before moving any trusted destination.
- Preflight every destination as a regular file and detect input/output aliases.
- Re-resolve aliases immediately before rename.
- Use same-directory staging for same-filesystem rename.
- Roll back paired outputs if one rename fails.
- Always remove staging directories in `finally`.

Extraction from an immutable commit should strengthen this by addressing objects by accepted full object ID and tree entries, never by a checked-out path.

## Git conventions already present

- Git commands are invoked as argument arrays without a shell.
- Repository roots are canonicalized physically.
- Evidence roots must be exact Git top-level directories.
- Repository identity compares normalized host, protocol/endpoint, path kind, and repository path; unknown hosts retain stricter transport/path distinctions.
- Authored repository URLs reject credentials, query, fragment, whitespace, control characters, backslashes, and dot segments.
- Source paths are repo-relative POSIX paths and may not address `.git`.
- Packaging reads tracked entries/modes from Git and rejects unmerged stages, symlinks, unsupported modes, path changes during reads, and untracked package content.
- Integration release packaging binds source to a full immutable commit and detached checkout.

## Compatibility conventions

From `CONTRIBUTING.md`:

- Existing schema-v1 JSON remains valid unless a reviewed breaking change includes a migration path.
- Explicit authored geometry remains authoritative.
- `standard` preserves broad compatibility; `showcase` may enforce stronger composition evidence.
- Schema/default/acceptance changes require explicit value, compatibility, and non-goals.
- Shared helpers imply shared blast radius across diagram types.
- Generated artifacts are rebuilt only from final authoritative source.

For the Station profile, opt-in isolation is therefore preferable to a new default command, schema field, or renderer behavior.

## Tests and fixtures

- Tests use `node:test` with `node:assert/strict`.
- Temporary repositories/directories use `fs.mkdtempSync(os.tmpdir())`.
- Local Git fixtures configure synthetic user identity and never require a remote server.
- CLI tests use `spawnSync(process.execPath, [cli, ...args])` and assert exit status, stdout/stderr contract, artifact presence, and preservation of trusted files.
- Security tests include credential redaction, path escapes, symlink/path aliasing, malformed identities, stale sources, and simulated filesystem failures.
- Browser tests are explicitly skipped when Chrome is unavailable; a skip is never reported as a pass.
- Exact-byte behavior is asserted where determinism is claimed.

## Documentation and claim discipline

- Deterministic artifact validation, browser evidence, and perceptual review are separate claims.
- Authored graph reachability is not called runtime impact or blast radius.
- Architecture Delta does not claim risk, mergeability, or causality.
- Repository evidence is opt-in and verified; ordinary artifacts remain source-free.
- Source identifiers, commands, protocols, and paths are preserved exactly.

A Phase 1 extractor should similarly describe its output as a deterministic projection of recognized repository evidence, not a complete understanding of runtime behavior.

## Generated-file discipline

Any change to authoritative Viewer, schema, brand, example, package, or release source has an associated freshness check. Do not include regenerated outputs in an extraction-only profile unless the authoritative upstream input actually changes. Keeping Phase 1 under `integrations/vibery-station/` avoids unrelated ZIP, Viewer, gallery, and example churn.
