---
last_mapped_commit: d673e8300df60a5c8166abe78787fdc78f6b8000
---

# Structure

## Repository map

```text
.
├── archify/                         # Packaged Skill/runtime and its development tests
│   ├── SKILL.md                     # Agent-facing operating contract
│   ├── package.json                 # Node >=18 ESM package; CLI bin and npm gates
│   ├── package-lock.json            # Development dependency lock; excluded from Skill ZIP
│   ├── bin/                         # Main CLI, preview, opener, Chrome visual checker
│   ├── schemas/                     # Authoritative typed JSON IR schemas
│   ├── renderers/
│   │   ├── architecture/            # Architecture renderer and fixed grid math
│   │   ├── workflow/                # Workflow adapter, compiler, migration geometry
│   │   ├── sequence/                # Sequence renderer
│   │   ├── dataflow/                # Dataflow renderer
│   │   ├── lifecycle/               # Lifecycle renderer
│   │   └── shared/                  # Shared validation, geometry, evidence, output, template helpers
│   ├── delta/                       # Architecture comparator and Delta artifact runtime
│   ├── migrations/                  # Workflow v1 -> v2 migration logic
│   ├── recipes/                     # Scenario guide/router
│   ├── scripts/                     # Packaged checks/generators/update runtime
│   ├── assets/                      # Generated Viewer template and bundled font notice
│   ├── brand-marks/                 # Brand catalogue source and documentation
│   ├── examples/                    # Packaged JSON fixtures and selected rendered HTML
│   ├── references/                  # Detailed authoring/delivery/Viewer contracts
│   └── test/                        # Main flat Node test suite, helpers, and fixtures
├── viewer/                          # Authoritative modular Viewer source (repository-only)
├── scripts/                         # Repository build, generation, package, site, and test orchestration
├── integrations/
│   └── deepseek-harness/            # Separate host adapter/package and its own tests
├── docs/                            # GitHub Pages output, cases, assets, research, update manifest
├── examples/                        # Public checked artifacts, JSON sources, Delta receipt
├── benchmarks/                      # Ordinary-model-floor fixtures/results
├── experiments/                     # Non-product prototypes and visual investigations
├── generated/                       # Checked generated demonstration/evidence outputs
├── .github/                         # CI/release workflows, ownership, issue/PR policy
└── archify.zip                      # Committed deterministic Skill distribution
```

The repository has no root `package.json`. Package scripts run from `archify/`, while repository-wide generators and packaging scripts are reached via `../scripts/...` paths from `archify/package.json`.

## Source-of-truth and generated-file rules

| Concern | Authoritative source | Generated/derived output |
|---|---|---|
| Viewer shell/runtime | `viewer/template.source.html`, `viewer/*.js` | `archify/assets/template.html` |
| IR validation | `archify/schemas/*.schema.json` | `archify/renderers/shared/generated-validators.mjs` |
| Built-in brand data | `archify/brand-marks/catalog.json` plus simple-icons generator inputs | `archify/renderers/shared/generated-brand-marks.mjs` |
| Typed examples | JSON under `archify/examples/` or the owning docs/experiment directory | rendered `.html` examples |
| Skill archive | tracked files selected by `scripts/stage-clean-skill.mjs` | `archify.zip` |
| Site surfaces | root `scripts/*template.html`, build scripts, hand-authored docs | generated `docs/gallery.html`, `docs/guide.html`, `docs/start.html`, gallery artifacts |

`.gitattributes` identifies generated diagram/site/runtime files for Linguist and forces LF line endings repository-wide. Exact-byte golden, generator-freshness, package, and ZIP checks rely on those normalized bytes.

## Runtime entry points

### `archify/bin/`

- `archify/bin/archify.mjs` — package `bin.archify`; all command dispatch, delivery/compare transactions, top-level receipts.
- `archify/bin/preview.mjs` — importable live-preview server plus executable support through the main CLI.
- `archify/bin/visual-check.mjs` — importable Chrome discovery/CDP capture and visual-check sidecars.
- `archify/bin/open-artifact.mjs` — platform-specific best-effort artifact/loopback opener.

Use `archify.mjs` for command behavior. Reusable code should not import it because its top-level dispatch reads `process.argv` immediately.

### Typed renderer executables

- `archify/renderers/architecture/render-architecture.mjs`
- `archify/renderers/workflow/render-workflow.mjs`
- `archify/renderers/sequence/render-sequence.mjs`
- `archify/renderers/dataflow/render-dataflow.mjs`
- `archify/renderers/lifecycle/render-lifecycle.mjs`

These modules execute at import/top level and are launched as child processes. Their common load/write path is `archify/renderers/shared/cli.mjs`.

### Importable domain modules

- `archify/delta/architecture-delta.mjs` — Architecture canonicalization, comparison, SVG annotation, Delta HTML, Delta validation.
- `archify/migrations/workflow-v2.mjs` — pure-ish parsed-document migration and serialization.
- `archify/renderers/workflow/workflow-compiler.mjs` — Workflow compiler used by renderer and migration.
- `archify/renderers/shared/*.mjs` — focused common contracts listed below.
- `archify/recipes/scenarios.mjs` — guide recommendation/list formatting.

## `archify/renderers/shared/` responsibilities

| Path | Responsibility |
|---|---|
| `cli.mjs` | Common renderer ingestion, cross-reference validation, template loading, guarded writing, SVG semantic attributes |
| `validator.mjs` | Dispatch to checked-in standalone schema validators; path/identity-rich schema diagnostics |
| `generated-validators.mjs` | Generated zero-install AJV output; do not edit directly |
| `diagnostics.mjs` | Diagnostic normalization, recording, fail-closed renderer stderr boundary |
| `geometry.mjs` | Routing primitives, automatic port spread, collision/clearance/rhythm collectors and diagnostics |
| `output-path.mjs` | Symlink/case/normalization-aware path canonicalization and alias prevention |
| `repository-location.mjs` | Remote parsing, canonical identity, redaction, forge source-link construction |
| `repository-evidence.mjs` | Architecture authored-source verification against a local pinned Git revision |
| `engineering-profiles.mjs` | Architecture `deployment-ownership` checks |
| `brand-marks.mjs` | Built-in and digest-pinned brand resolution/rendering; capture safety logic |
| `legend.mjs` | Legend resolution, measurement, placement, and relationship obstacles |
| `layout-report.mjs` | Architecture layout-report serialization |
| `desktop-readability.mjs` | Shared desktop projection thresholds |
| `text-fit.mjs` | Node text width/size calculations |
| `i18n.mjs` | Supported locale catalog and template localization |
| `utils.mjs` | Template substitution, cards, SVG definitions/sigils, escaping/text units |

Generated modules (`generated-validators.mjs`, `generated-brand-marks.mjs`) are runtime inputs but not hand-maintained architecture seams.

## Architecture-specific locations

### IR and rendering

- Schema: `archify/schemas/architecture.schema.json`
- Shared schema definitions: `archify/schemas/common.schema.json`
- Renderer: `archify/renderers/architecture/render-architecture.mjs`
- Grid placement: `archify/renderers/architecture/grid.mjs`
- Layout report helpers: `archify/renderers/shared/layout-report.mjs`
- Deployment semantics: `archify/renderers/shared/engineering-profiles.mjs`
- Examples:
  - `archify/examples/web-app.architecture.json`
  - `archify/examples/production-deployment.architecture.json`
  - `archify/examples/brand-aware-delivery.architecture.json`

### Repository evidence

- Shape contract: `archify/schemas/architecture.schema.json` (`meta.repository`, `components[].sources`)
- Verification: `archify/renderers/shared/repository-evidence.mjs`
- Remote identity/link logic: `archify/renderers/shared/repository-location.mjs`
- HTML embedding: `applyTemplate()` in `archify/renderers/shared/utils.mjs`
- CLI receipt extraction: `sourceEvidenceFromArtifact()` in `archify/bin/archify.mjs`
- Viewer consumers: source-evidence shell code in `viewer/template.source.html`, plus `viewer/focus.js` and `viewer/node-finder.js`
- Core tests: `archify/test/repository-evidence.test.mjs`, `archify/test/real-repository-proof.test.mjs`, `archify/test/repository-language-metadata.test.mjs`
- Checked real proof: `docs/cases/mco-runtime.architecture.json` and matching HTML

### Architecture Delta

- Comparator/artifact runtime: `archify/delta/architecture-delta.mjs`
- CLI orchestration: `commandCompare()` in `archify/bin/archify.mjs`
- Base/head fixtures: `archify/examples/checkout-platform.base.architecture.json`, `archify/examples/checkout-platform.head.architecture.json`
- Public checked outputs: `examples/checkout-platform-delta.html`, `examples/checkout-platform-delta.receipt.json`
- Tests: `archify/test/architecture-delta.test.mjs`

### Artifact acceptance

- Static artifact checker: `archify/scripts/check-render-output.mjs`
- Browser evidence runner: `archify/bin/visual-check.mjs`
- Delivery contract: `archify/references/delivery-contract.md`
- Relevant tests: `archify/test/render-output-checks.test.mjs`, `archify/test/delivery-contract.test.mjs`, `archify/test/visual-check.test.mjs`

## Viewer source organization

`viewer/README.md` documents module ownership and ordering. Current fragment files are:

- adaptive frame: `reader-layout.js`, `viewer-chrome-layout.js`, `viewer-camera.js`;
- discovery/navigation: `semantic-radar.js`, `node-finder.js`, `route-probe.js`;
- semantic interaction: `focus.js`, `intent-trace.js`, `semantic-lens.js`, `guided-views.js`;
- motion/export: `motion-governor.js`, `export.js`, `export-cleanup.js`;
- shell: `template.source.html`.

`scripts/generate-viewer.mjs` owns the exact insertion marker list and order. Export is the one nested fragment owner: `export.js` contains the `EXPORT_CLEANUP` marker expanded from `export-cleanup.js`. `npm run check:viewer` verifies that the packaged generated template is current without writing it.

## Schema and generator organization

`archify/schemas/` contains one file per type and `common.schema.json`; `schemas/README.md` is the human contract. `archify/scripts/generate-validators.mjs` is development-only and imports AJV. The resulting validator module is checked in and included in the ZIP.

Brand generation follows the same pattern:

- source catalogue: `archify/brand-marks/catalog.json`;
- development generator: `archify/scripts/generate-brand-marks.mjs`;
- packaged generated runtime: `archify/renderers/shared/generated-brand-marks.mjs`.

Tests `generate-validators.test.mjs`, `generate-viewer.test.mjs`, and `brand-marks.test.mjs` enforce these boundaries, while the npm `check:*` scripts reject stale generated output before the main test runner.

## Test organization

### Discovery and runners

- `archify/test/golden.mjs` is a custom pre-suite golden/version harness.
- `scripts/run-tests.mjs` discovers every top-level `archify/test/*.test.mjs`, sorts paths, and invokes `node --test` with concurrency two when the Node version supports the flag.
- `archify/test/webm-artifact.smoke.mjs` and `archify/test/site-language-integration.mjs` form the separate `test:webm` script.
- `archify/test/helpers/` contains reusable browser/XML/font helpers.
- `archify/test/fixtures/` contains JSON/migration fixtures and v1 baselines.

At the mapped commit there are 110 top-level `*.test.mjs` files, 13 of them named `*-browser.test.mjs`, plus non-`*.test.mjs` smoke/golden scripts. Browser files generally self-skip without `ARCHIFY_CHROME`; CI also has a dedicated Chrome/ffmpeg job that runs selected browser suites explicitly.

### Tests are grouped by behavior, not mirrored source directories

The test directory is intentionally flat. Common groups are:

- CLI, receipts, paths, preview, delivery, visual check;
- schema/generator/golden/v1 compatibility;
- per-renderer geometry and semantics;
- Architecture evidence, engineering profile, and Delta;
- Viewer source/output and browser behavior;
- packaging, update contract, release identity, and archive gates;
- docs/gallery/guide/start-page contracts.

When adding a focused runtime feature, place its top-level `*.test.mjs` in `archify/test/` so the existing runner discovers it. Put only reusable support under `helpers/` and stable data under `fixtures/`.

Integration tests remain integration-owned. For example, `integrations/deepseek-harness/test/` is not discovered by `scripts/run-tests.mjs`; its package/acceptance commands run separately.

## Packaging and release locations

### Development package

`archify/package.json` defines:

- executable: `archify/bin/archify.mjs`;
- source/runtime generators and freshness checks;
- main `npm test` composition;
- Node `>=18` support;
- development-only dependencies.

### Clean Skill staging

`scripts/stage-clean-skill.mjs` is the canonical selector for release content. It:

- reads tracked `archify/` entries from the Git index;
- requires stage-zero regular files with supported Git modes;
- rejects symlinked source paths and unstable snapshots;
- excludes `archify/test/`, `node_modules`, the lockfile, and development generators;
- requires license/notices, standalone validators, update runtime, and release metadata;
- writes a clean `package.json` without scripts/dev dependencies;
- records Git modes for the archive writer.

### Deterministic archive and smoke

- `scripts/build-zip.sh` — Node-22 canonical archive entry point.
- `scripts/write-deterministic-zip.mjs` — deterministic ZIP writer.
- `scripts/package-smoke.mjs` — no-install runtime acceptance of an extracted Skill.
- `archify.zip` — committed bytes checked by CI and release.
- `.github/workflows/ci.yml` — matrix tests, browser/WebM evidence, ZIP freshness, public manifest binding, cross-platform package smoke, Pages deployment.
- `.github/workflows/release.yml` — tag/version gates, tests, archive build/smoke/freshness, GitHub Release upload.

## Other repository areas

### `integrations/deepseek-harness/`

This is a separate npm adapter with its own package metadata, release pin, library, scripts, and tests. `scripts/release-source.mjs` reads adapter files from committed Git blobs and prepares a detached checkout of a full pinned Archify source commit. It demonstrates immutable-source packaging, but it does not add rendering/extraction behavior to the default Archify CLI.

### `docs/`

Contains deployed GitHub Pages content, source-backed cases, images, research notes, and `docs/skill-updates/archify/stable.json`. Much of the HTML is checked generated output. The CI Pages job deploys this directory only after repository gates pass and only if the run still targets current `main`.

### `examples/`

Contains public copies of rendered examples and authoring inputs. Golden tests compare fresh renderer output against both these root examples and packaged `archify/examples/` HTML, so the two locations serve different distribution surfaces but are byte-coupled for selected fixtures.

### `benchmarks/`, `experiments/`, `generated/`

These are evidence/prototype/output areas, not runtime imports for normal CLI rendering. They may contain checked HTML, screenshots, fixture outputs, or research implementations; do not infer that code under them is packaged merely because it is tracked.

## Where to place changes

### Current conventions

- Shared renderer behavior: `archify/renderers/shared/`.
- Mode-specific behavior: `archify/renderers/<type>/` and that type's schema.
- Main command orchestration: `archify/bin/archify.mjs`; extract importable logic into a separate module rather than growing only top-level dispatch code.
- Viewer behavior: edit `viewer/`, then regenerate `archify/assets/template.html`.
- Schema change: edit schema source, regenerate validators, add focused schema/runtime tests.
- Package selection/release behavior: root `scripts/` and package/release tests.
- Host-specific adapter behavior: `integrations/<host>/`, not the default runtime.

### Recommended future Station/extractor placement (not present now)

No Station implementation exists at the mapped commit. If the planned immutable codebase mapping remains a default Archify capability, the repository's current seams support a new isolated tree such as:

```text
archify/station/
├── canonical-json.mjs
├── git-object-reader.mjs
├── node-workspace-evidence.mjs
├── station-projector.mjs
├── station-gate.mjs
└── station-output.mjs
```

with dedicated strict schemas under `archify/schemas/`, generated standalone validators, and top-level tests under `archify/test/`. A narrow `station extract` route can then remain orchestration in `archify/bin/archify.mjs` while the extractor is importable/testable.

That is a recommendation, not a description of the current tree. It should not overload `repository-evidence.mjs`, force neutral Station rooms into semantic Architecture component types, or move extraction into Viewer code. If the capability is host-specific instead, the existing `integrations/deepseek-harness/` layout is the precedent for keeping an adapter, release pin, scripts, and tests outside the default Skill package.
