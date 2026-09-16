---
last_mapped_commit: d673e8300df60a5c8166abe78787fdc78f6b8000
---

# Integrations

## Local Git

Git is the central integration for the requested Phase 1 substrate.

### Current use

`archify/renderers/shared/repository-evidence.mjs` invokes Git with `spawnSync` and a 16 MiB buffer to:

- resolve the top-level directory,
- read the `origin` remote,
- verify a commit object,
- check a path's object type,
- read a pinned blob for line-count verification.

`archify/renderers/shared/repository-location.mjs` normalizes repository identity without contacting a remote server or reading SSH config.

Packaging and adapter release scripts use additional local Git surfaces:

- `git ls-files --stage -z` for tracked paths and index modes,
- `git ls-tree -r -z` and `git cat-file blob` for committed adapter bytes,
- detached checkout of a full source commit,
- local shared clone for release snapshots.

These are the strongest existing patterns for immutable, local-only extraction.

## GitHub and Gitee

Repository evidence can create revision/blob/line links for canonical HTTPS GitHub or Gitee repositories. Link generation is downstream presentation only; evidence verification is local.

Unknown/internal repositories are supported through `link_mode: "local-only"`, retaining strict local origin/commit/blob checks while omitting web links.

No remote fetch is performed by repository evidence. A missing pinned commit fails with a diagnostic asking the caller to make it available.

## Filesystem

The project has extensive filesystem trust-boundary handling:

- physical root resolution,
- symlink/future-path canonicalization,
- input/output alias checks,
- same-directory candidates and atomic rename,
- tracked-only package staging,
- file identity/state checks before and after reads,
- mode preservation from the Git index,
- refusal of unmerged entries and symlinks in release staging.

A Station extractor should prefer Git object access over checkout/filesystem traversal. The filesystem should hold only staging and final outputs.

## Browser / Chrome

`archify/bin/visual-check.mjs` finds Chrome and uses the Chrome DevTools Protocol for bounded desktop evidence. Viewer browser tests use the same local browser boundary. Environment variables:

- `ARCHIFY_CHROME`
- `ARCHIFY_CHROME_NO_SANDBOX`

This integration is unrelated to extraction and should not be loaded or required by the Station Phase 1 profile.

## Loopback preview

`archify/bin/preview.mjs` starts an explicit random-port `127.0.0.1` preview server, watches one JSON source, and retains the last verified artifact. It forwards repository root and quality settings.

This is opt-in authoring infrastructure, not part of deterministic commit extraction.

## Existing network-capable code

Two existing features can use the network:

1. `archify/scripts/check-update.mjs` checks a stable update manifest.
2. `archify/renderers/shared/brand-marks.mjs` can capture a user-authored remote brand URL after DNS/address safety checks and digest pinning.

Built-in brand lookup is local. Ordinary rendering with no captured remote brand and repository evidence verification are local.

The Station extractor must not invoke either network-capable path. Profile acceptance should enforce no network client, no update check, and no brand capture during extraction.

## DeepSeek Harness integration precedent

`integrations/deepseek-harness/` is the only current host-profile integration.

Key properties:

- opt-in package identity (`@tt-a1i/archify-dsh`),
- minimal adapter with no render tools, telemetry, network client, credentials, background service, or install hooks,
- profile-specific filesystem Skill provider,
- `includeDefaultRoots: false`,
- package root resolved from installed package identity rather than string concatenation,
- `release.json` binds full source commit, Skill version, and host version,
- package source is read from committed Git blobs, not mutable working-tree files,
- a detached snapshot is staged through the canonical clean-Skill stager,
- integration-owned tests and distribution acceptance verify install, discovery, composition, smoke behavior, uninstall, and base-profile restoration.

This is the structural model for a Vibery Station profile: opt-in, independently testable, pinned, removable, and unable to alter the base profile implicitly.

## Vibery Station status

No Vibery Station profile, package manifest, registration API, or test harness exists in the mapped checkout. Phase 1 planning must not assume a host API shape from this repository. Host-specific registration, permission, artifact, and lifecycle contracts must be supplied by Station or implemented entirely under a new integration boundary.

## Package and release integration

The packaged Skill is built by:

1. `scripts/stage-clean-skill.mjs` selecting safe tracked `archify/` files,
2. package-manifest cleanup,
3. `scripts/write-deterministic-zip.mjs` writing canonical ZIP bytes using Git-recorded modes.

`archify.zip` is committed and CI checks exact reconstruction on Node 22. A Station-only extraction profile should not modify this archive in Phase 1 unless Station is intended to consume the public Skill package itself.

## Environment/configuration inputs relevant to behavior

| Input | Owner | Effect |
|---|---|---|
| `ARCHIFY_QUALITY_PROFILE` | renderer CLI | overrides standard/showcase rendering policy |
| `ARCHIFY_REPO_ROOT` | repository evidence | local repository used for commit/blob verification |
| `ARCHIFY_DIAGNOSTIC_FORMAT=json` | renderer boundary | structured machine failure payload |
| `ARCHIFY_CHROME` | visual check/tests | browser executable path |
| `ARCHIFY_CHROME_NO_SANDBOX` | visual check/tests | controlled CI browser launch mode |
| `ARCHIFY_MCO_REPO_ROOT` | real proof test | optional local clone for pinned MCO reproduction |

The extraction receipt should include all profile-owned semantic inputs explicitly rather than depending on ambient environment variables.

## Trust boundaries for Phase 1

1. **Station request -> profile:** validate repository path, exact commit, profile/options, and output paths.
2. **Profile -> Git executable:** fixed executable/subcommands, argument arrays, bounded output, sanitized environment, no shell, no fetch.
3. **Git object database -> extractor:** validate object type/mode/path/size/encoding before parsing.
4. **Extractor -> Architecture IR:** deterministic stable identities, explicit ignored/unsupported accounting, no guessed facts.
5. **IR -> Archify validator/evidence verifier:** existing schema and commit/blob proof.
6. **Candidate -> final Station artifacts:** atomic commit of IR and extraction receipt; optionally downstream Archify HTML/Delta as separate proven stages.
