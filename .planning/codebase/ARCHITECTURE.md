---
last_mapped_commit: d673e8300df60a5c8166abe78787fdc78f6b8000
---

# Architecture

## Scope and system shape

At the mapped commit, Archify is a Node.js ESM command-line product that compiles strict, typed JSON diagram IR into a self-contained HTML/SVG artifact. The checked-in repository also contains the Viewer source, generators, test harnesses, documentation, examples, experiments, one external host integration, and the deterministic `archify.zip` distribution.

The principal artifact pipeline is:

```text
JSON IR
  -> JSON Schema validation
  -> shared cross-entity / engineering validation
  -> optional local Git repository-evidence verification
  -> type-specific layout, geometry checks, and SVG rendering
  -> generated shared Viewer template assembly
  -> artifact-level composition checks
  -> command-specific publication and receipt
```

The five current IR types are `architecture`, `workflow`, `sequence`, `dataflow`, and `lifecycle`. The standalone HTML is the product boundary: its Viewer can inspect authored topology, but it does not author or infer new canonical topology.

## Runtime layers

### 1. CLI orchestration and process boundary

`archify/bin/archify.mjs` is the package entry point and central dispatcher. It maps the closed set of diagram types to `archify/renderers/<type>/render-<type>.mjs`, launches renderers and checkers as child Node processes, parses command-specific flags, and owns top-level receipts and exit behavior.

Current commands are:

- artifact commands: `render`, `validate`, `deliver`, `check`, `visual-check`, and `preview`;
- Architecture-only inspection: `inspect architecture` and `compare architecture`;
- Workflow-only migration: `migrate workflow ... --to-schema 2`;
- discovery/support: `guide`, `brands`, `examples`, `doctor`, and `demo`.

The CLI-to-renderer contract is deliberately narrow:

- positional arguments carry input and output paths;
- `ARCHIFY_QUALITY_PROFILE` carries a CLI quality override;
- `ARCHIFY_REPO_ROOT` carries the local evidence checkout;
- `ARCHIFY_DIAGNOSTIC_FORMAT=json` requests the renderer's structured failure boundary.

`archify/bin/archify.mjs` is executable orchestration, not an import-safe library: command dispatch runs at module top level from `process.argv`. Importable behavior lives in modules such as `archify/delta/architecture-delta.mjs`, `archify/bin/preview.mjs`, `archify/bin/visual-check.mjs`, and `archify/renderers/shared/*.mjs`.

Publication semantics vary by command:

- `render` delegates directly to a renderer and does not run the final artifact checker or stage an atomic candidate.
- `validate` renders into an OS temporary directory, runs `archify/scripts/check-render-output.mjs`, emits a receipt, and removes the temporary tree.
- `deliver` freezes the exact input bytes into a same-directory staging tree, renders and checks that snapshot, hashes specification and artifact bytes, rechecks output safety, and renames the verified candidate over the target only at the end. A failed delivery preserves the previous artifact.
- `preview` is a localhost-only watcher/server in `archify/bin/preview.mjs`; it publishes only the latest verified in-memory artifact and retains the last good revision after a failed rebuild.
- `visual-check` in `archify/bin/visual-check.mjs` uses a local Chrome DevTools pipe and writes bounded screenshot/receipt sidecars without rerendering the supplied HTML.

### 2. Shared ingestion and validation

Every typed renderer enters through `loadDiagramWithBrandMarks()` in `archify/renderers/shared/cli.mjs`. Its current order is:

1. resolve and read the input JSON;
2. call `validateSchema()` from `archify/renderers/shared/validator.mjs`;
3. validate guided-view identities and references;
4. validate optional relationship-ID uniqueness;
5. validate the optional Architecture engineering profile;
6. verify repository evidence when the IR declares it;
7. read `archify/assets/template.html`;
8. resolve and guard the output path;
9. prepare authored brand marks;
10. return the validated IR and shared assets to the type renderer.

`writeDiagram()` performs a last output-path recheck, creates the destination directory, assembles the template, and writes the HTML. This recheck closes a path-alias race for renderer writes, but only higher-level `deliver` adds candidate checking and last-known-good atomic publication.

Validation is split by responsibility:

- `archify/schemas/*.schema.json` rejects shape/type/enum/range errors and unknown properties.
- `archify/renderers/shared/validator.mjs` invokes generated standalone validators and adds identity hints to schema paths.
- `archify/renderers/shared/cli.mjs` checks cross-collection facts such as guided-view references and duplicate authored relationship IDs.
- `archify/renderers/shared/engineering-profiles.mjs` implements the opt-in Architecture `deployment-ownership` semantic contract.
- each type renderer/compiler checks layout and mode-specific semantic constraints.
- `archify/scripts/check-render-output.mjs` checks the generated artifact rather than trusting renderer success.

The stable diagnostic shape is `{ code, severity, message, subject, evidence, supportedFixes }`. `archify/renderers/shared/diagnostics.mjs` records structured problems and, in diagnostic mode, converts uncaught renderer failures into one JSON object on stderr. Its write loop handles partial writes and `EAGAIN`, so large receipts are not silently truncated. The parent CLI fails closed to `internal/unclassified` if a renderer exits without parseable structured diagnostics; raw stacks are not copied into machine receipts.

### 3. Schema and generated-runtime boundary

`archify/schemas/common.schema.json` defines shared IDs, points, component types, variants, legends, guided views, brands, cards, locale, presets, and quality profiles. The five type schemas reference those definitions and generally apply `additionalProperties: false` at every level.

Schema-version policy is type-specific:

- Architecture, Sequence, Dataflow, and Lifecycle are schema v1.
- Workflow accepts v1 fixed geometry and v2 readable compiler layout.

Development-time AJV lives only in `archify/scripts/generate-validators.mjs`. It compiles all schemas with Draft 2020-12, `strict: true`, and `allErrors: true`, then writes `archify/renderers/shared/generated-validators.mjs`. The generator replaces AJV's remaining UCS-2 helper import with inline code and rejects any unexpected `require()`, allowing the packaged runtime to validate with no installed dependency. `npm run check:validators` byte-checks that generated runtime against schema sources.

This is an important ownership boundary: schema files are authoritative; `generated-validators.mjs` is committed build output, not an editing surface.

### 4. Type renderer boundary

Each renderer is a top-level executable module under `archify/renderers/<type>/` and owns its mode-specific semantic layout and SVG generation. Shared primitives live under `archify/renderers/shared/`:

- geometry/routing and composition collection: `geometry.mjs`;
- template ingestion/output and SVG semantic hooks: `cli.mjs`, `utils.mjs`;
- legends, text fitting, desktop readability, i18n, and brand marks;
- output-path canonicalization and alias checks;
- repository evidence and repository identity;
- diagnostics and engineering profiles.

The renderers are intentionally not hidden behind one in-process renderer abstraction. The main CLI starts the selected renderer as a child process, and the renderer calls the shared head/tail itself.

Architecture-specific rendering is concentrated in:

- `archify/renderers/architecture/render-architecture.mjs` — measurement, boundaries, routing, validation, layout receipts, and SVG;
- `archify/renderers/architecture/grid.mjs` — deterministic fixed-cell placement;
- `archify/renderers/shared/layout-report.mjs` — Architecture `--layout-json` serialization.

Architecture supports either free placement (`components[].pos`) or deterministic grid placement (`layout.mode: "grid"`, with `row`/`col`). The grid is fixed arithmetic, not repository discovery or automatic graph layout. The renderer computes boundaries from `wraps`, derives/validates routes, applies automatic port spread, validates overlaps/clearance/readability, and then emits semantic SVG hooks consumed by the Viewer and artifact checker.

Workflow differs structurally: `archify/renderers/workflow/render-workflow.mjs` is a thin adapter over the importable `workflow-compiler.mjs`, and `archify/migrations/workflow-v2.mjs` reuses that compiler. The other three mode renderers combine their layout and rendering in their executable module.

### 5. Shared Viewer boundary

The editable Viewer source is outside the packaged tree:

- `viewer/template.source.html` owns the shell, styles, and unsplit classic-script code;
- `viewer/*.js` owns focused modules such as camera, focus, route probe, semantic lens, guided views, reader/chrome layout, motion, and export cleanup.

`scripts/generate-viewer.mjs` inserts those fragments verbatim at fixed markers and atomically generates `archify/assets/template.html`. All five renderers consume the same generated template through `applyTemplate()` in `archify/renderers/shared/utils.mjs`.

The Viewer is downstream of validated IR. It reads semantic SVG/data hooks for focus, search, route/reach exploration, guided views, source evidence, presentation, and export. Canonical export cleanup removes transient Viewer state. It is therefore not a repository extractor, schema validator, or source of architectural truth.

### 6. Artifact verification boundary

`archify/scripts/check-render-output.mjs` independently parses rendered HTML/SVG and returns a JSON receipt. It checks:

- exactly one diagram SVG;
- finite numeric SVG attributes;
- orthogonal relationship primitives;
- relationship-label clearance;
- unrelated relationship crossings and ambiguous shared corridors;
- structural-frame border runs;
- route rhythm/micro-segments;
- legend clearance;
- projected desktop readability.

The SVG root communicates effective quality through `data-quality-profile` and whether gates are advisory. Under `showcase`, crossings, corridors, route rhythm, label clearance, and desktop readability become hard composition errors. `deliver` and both Architecture snapshot renders used by `compare` treat checker failure as a publication blocker.

## Architecture IR contract

`archify/schemas/architecture.schema.json` is the current Architecture truth boundary. Its core collections are:

- `components[]`: stable ID, semantic component type, label/metadata, brand, optional source references, and free/grid placement;
- `boundaries[]`: `region` or `security-group`, label, wrapped component IDs, and optional padding;
- `connections[]`: endpoints, optional stable ID/label/variant, endpoint sides, routing controls, label controls, and width;
- optional `cards[]` and presentation metadata.

Architecture metadata can include title, locale, visual/quality profile, `deployment-ownership`, guided views, legend, viewBox, output path, and repository identity. Because the schema is closed, new provenance or extractor metadata cannot be inserted without an explicit schema change.

The optional `deployment-ownership` profile is validation of authored IR, not discovery. `archify/renderers/shared/engineering-profiles.mjs` requires owners for non-external components, exact region membership, region/private-boundary consistency, private scope for databases, and labels on cross-boundary connections.

## Repository-evidence verification

### Current contract

Architecture alone supports opt-in repository evidence:

- `meta.repository`: URL, full 40-hex revision, optional provider, and `web` or `local-only` link mode;
- `components[].sources`: one to three repo-relative paths with optional line range and label.

`verifyRepositoryEvidence()` in `archify/renderers/shared/repository-evidence.mjs` activates when either repository metadata or component sources are present. It then:

1. requires matching repository metadata, a full commit SHA, and `--repo-root`;
2. parses the authored remote with `archify/renderers/shared/repository-location.mjs`;
3. resolves the physical local root and requires the Git top level itself;
4. reads and compares `origin` identity while redacting credentialed failures;
5. verifies `${revision}^{commit}` exists locally;
6. validates source paths as relative POSIX paths and rejects empty/dot/parent/`.git` segments;
7. verifies `${revision}:${path}` is a blob;
8. reads pinned blob content when needed to validate line bounds;
9. returns a verified payload with repository identity and per-component source records/links.

`writeDiagram()` embeds that payload outside the canonical SVG. `sourceEvidenceFromArtifact()` in `archify/bin/archify.mjs` reads it back into delivery/compare receipts, while Viewer source in `viewer/template.source.html` and `viewer/node-finder.js`/`viewer/focus.js` presents and searches it.

### What it does not do

Repository evidence verifies authored claims against a local Git object database. It does **not** enumerate a repository, inspect package/workspace structure, infer components, infer connections, or generate Architecture IR. It uses the supplied revision for object reads but is not a general immutable-tree extraction subsystem.

## Architecture Delta seam

`archify/delta/architecture-delta.mjs` is the importable Architecture comparison subsystem. `commandCompare()` in the CLI orchestrates it as follows:

1. resolve distinct HTML/receipt outputs;
2. read and freeze exact base/head bytes in a same-directory staging tree;
3. render and artifact-check each raw snapshot to prove the authored inputs validate;
4. canonicalize collection order only after raw validation;
5. render and artifact-check canonical base/head snapshots;
6. compare semantic IR, annotate both SVGs, construct the combined Delta SVG/HTML, and run Delta-specific validation;
7. write a receipt with raw/semantic hashes, changes, proof level, checks, and artifact hash;
8. recheck target paths and commit HTML plus receipt as a rollback-capable pair.

The comparator's identity/classification rules are explicit:

- components use `components[].id`;
- connections require `connections[].id` for comparison;
- boundaries derive identity from `kind + label`;
- component changes classify semantic, evidence, or geometry fields;
- connection changes classify topology, semantic, or geometry fields;
- boundary changes classify scope or geometry;
- title/locale/preset/quality/legend/views/viewBox/layout/cards are presentation;
- normalized repository changes are provenance.

`canonicalArchitecture()` removes `meta.output`, normalizes repository identity/revision case, sorts components/connections/boundaries, sorts component sources, and treats boundary membership as set-like. The receipt says `revision-pinned` only when both sides declared full revisions and both rendered artifacts carried verified evidence. The subsystem explicitly does not infer runtime impact, causality, risk, or mergeability.

This is a strong deterministic consumer seam for future generated Architecture snapshots; it is not a code-delta analyzer or extractor.

## Output safety and transaction patterns

`archify/renderers/shared/output-path.mjs` canonicalizes existing path prefixes, follows symlinks with cycle detection, probes filesystem case/normalization semantics, checks inode aliases, constrains `meta.output`, enforces extensions, and prevents input/output or output/output aliasing.

Several current flows apply stronger transaction patterns on top:

- `deliver`: one candidate, check, final rename;
- `compare`: HTML/receipt pair, backups, rollback on partial commit;
- Workflow migration: candidate JSON plus render/check before final rename;
- `scripts/stage-clean-skill.mjs`: preflight tracked inputs, snapshot stable files, clean staging on failure;
- `integrations/deepseek-harness/scripts/release-source.mjs`: read committed Git blobs and materialize a detached pinned source checkout.

The recurring invariant is “capture/freeze first, validate candidate bytes, then publish.” Direct `render` is intentionally a lower-level exception and should not be mistaken for the trusted delivery transaction.

## Packaging and release architecture

The development package is rooted at `archify/package.json` (`type: module`, Node `>=18`). AJV, parse5, saxes, and simple-icons are development dependencies used by generators/tests, not required by the staged Skill runtime.

Packaging is repository-owned:

1. `scripts/stage-clean-skill.mjs` enumerates tracked `archify/` index entries, rejects unmerged/symlink/non-regular inputs, snapshots bytes and Git modes, excludes tests/lockfile/generator-only files, verifies notices, and removes scripts/dev dependencies from staged `package.json`.
2. `scripts/build-zip.sh` requires Node 22 for canonical bytes, invokes the stager, and calls `scripts/write-deterministic-zip.mjs` with Git-index modes.
3. `scripts/package-smoke.mjs` validates the extracted package without dependency installation and exercises CLI, all modes, compare, migration, delivery, update-check disable behavior, and safety failures.
4. `.github/workflows/ci.yml` checks exact ZIP freshness and smoke-tests the committed archive on Linux, macOS, and Windows.
5. `.github/workflows/release.yml` rebuilds, smokes, byte-compares, and only then uploads `archify.zip` for a matching tag.

`archify.zip` is therefore a committed deterministic release artifact, while `viewer/`, root `scripts/`, development tests, and generator dependencies remain repository-only.

## Test architecture

The main package suite uses Node's built-in test runner and custom deterministic scripts:

- `archify/test/golden.mjs` renders all five modes and compares checked-in root and packaged HTML examples, exercises negative schema cases, and checks release/version identity.
- `scripts/run-tests.mjs` discovers sorted top-level `archify/test/*.test.mjs` files and runs them with bounded concurrency where supported.
- browser tests use the local Chrome harness from `archify/bin/visual-check.mjs` and generally skip when `ARCHIFY_CHROME` is absent;
- `npm run test:webm` is a separate real-browser/decoder smoke path;
- package/release tests import root build modules and inspect workflow/package contracts;
- fixtures live under `archify/test/fixtures/`, while integration-owned tests live under their integration directory.

Architecture-critical coverage is concentrated in `architecture-delta.test.mjs`, `repository-evidence.test.mjs`, `real-repository-proof.test.mjs`, `engineering-profile.test.mjs`, `grid.test.mjs`, `layout-rules.test.mjs`, `automatic-port-spread.test.mjs`, `render-output-checks.test.mjs`, `output-path.test.mjs`, and CLI/delivery tests. The suite tests last-known-good preservation, identity exactness, credential redaction, deterministic output, and package behavior in addition to happy-path rendering.

## Current boundaries versus recommendations

### Current facts

- No repository-to-Architecture extractor exists at this commit.
- No `archify/station/` implementation or Station schema/CLI route exists.
- Repository evidence validates already-authored references only.
- Architecture Delta compares validated authored Architecture IR only.
- Architecture component types (`frontend`, `backend`, and so on) carry semantics and are not neutral repository-room categories.

### Recommended extension seams (not current implementation)

For a future immutable codebase-mapping/Station extractor, the narrowest compatible approach is to add an isolated importable subsystem rather than widen the Viewer or overload repository-evidence verification. Such a subsystem should:

- read one explicit commit through local Git tree/blob objects rather than working-tree files;
- reuse `repository-location.mjs` identity/redaction rules and the existing diagnostic shape;
- produce its own strict evidence/map schemas and standalone generated validators when its vocabulary is not truthfully representable by Architecture component types;
- use deterministic stable IDs and canonical bytes;
- stage all related outputs and publish them with generalized multi-target rollback;
- adapt into existing Architecture validation/delivery/Delta only in a later explicit projection layer whose semantic claims are evidence-backed.

These are extension recommendations derived from existing seams. They do not describe code present at the mapped commit.
