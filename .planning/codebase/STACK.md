---
last_mapped_commit: d673e8300df60a5c8166abe78787fdc78f6b8000
---

# Stack

## Snapshot

- **Mapped commit:** `d673e8300df60a5c8166abe78787fdc78f6b8000`
- **Branch at mapping time:** `feat/station-fail-closed-extractor` (byte-identical to local and `origin/main` at mapping time)
- **Primary package:** `archify/`
- **Package version:** `2.17.0-dev.1`; Skill metadata version `2.17`
- **Runtime:** Node.js `>=18`
- **Module system:** native ESM (`"type": "module"`), mostly `.mjs`; Viewer fragments are classic browser `.js` assembled into one HTML template.
- **Primary artifact model:** typed JSON intermediate representation (IR) rendered to self-contained HTML with inline SVG and browser JavaScript.

## Languages and formats

| Surface | Technology | Evidence |
|---|---|---|
| CLI, renderers, validators, packaging | JavaScript / Node ESM | `archify/bin/*.mjs`, `archify/renderers/**/*.mjs`, `scripts/*.mjs` |
| Viewer runtime | Browser JavaScript, HTML, CSS, inline SVG | `viewer/*.js`, `viewer/template.source.html` |
| Diagram contracts | JSON Schema draft 2020-12 | `archify/schemas/*.schema.json` |
| Diagram sources and receipts | JSON | `archify/examples/*.json`, `examples/*.receipt.json` |
| CI and integration composition | YAML | `.github/workflows/*.yml`, `integrations/deepseek-harness/cordis.patch.yml` |
| Archive build | Bash plus Node | `scripts/build-zip.sh`, `scripts/write-deterministic-zip.mjs` |

## Dependency model

`archify/package.json` declares no production dependencies. The clean packaged Skill removes scripts and development dependencies, and checked-in standalone validators make render/validate/deliver usable without installation.

Development dependencies are deliberately narrow:

- `ajv` `^8.17.1`: compile JSON Schemas into `archify/renderers/shared/generated-validators.mjs`.
- `parse5` `7.3.0`: HTML parsing in development checks/tests.
- `saxes` `6.0.0`: XML/SVG checks in development tests.
- `simple-icons` `16.28.0`: generate bundled brand vectors.
- `fast-uri` is pinned via an override to `3.1.5`.

## Platform and external executable assumptions

- **Git** is an explicit local runtime dependency for repository evidence (`spawnSync('git', ...)` in `archify/renderers/shared/repository-evidence.mjs`).
- **Chrome/Chromium** is optional for `visual-check` and browser tests; resolution is controlled by `ARCHIFY_CHROME` and `ARCHIFY_CHROME_NO_SANDBOX`.
- **ffmpeg** is a CI-only dependency for the real WebM smoke path.
- **npm/pnpm** appear in package and integration acceptance workflows, not in the zero-install renderer runtime.
- **Node 22** is required only for canonical ZIP bytes; supported runtime remains Node 18+.

## Main executable surfaces

`archify/bin/archify.mjs` is the single user-facing dispatcher. It recognizes:

- `render`, `validate`, `deliver`, `preview`
- `compare architecture`
- `migrate workflow`
- `inspect`, `check`, `visual-check`
- `guide`, `brands`, `examples`, `doctor`, `demo`

Each diagram renderer is also an executable module under `archify/renderers/<type>/render-<type>.mjs`. The top-level CLI spawns those modules in a child Node process rather than importing a renderer API.

## Build and generated surfaces

Authoritative inputs and their generated outputs are intentionally separate:

| Authoritative input | Generated output | Freshness gate |
|---|---|---|
| `viewer/template.source.html` + `viewer/*.js` | `archify/assets/template.html` | `npm run check:viewer` |
| `archify/schemas/*.schema.json` | `archify/renderers/shared/generated-validators.mjs` | `npm run check:validators` |
| `archify/brand-marks/catalog.json` + `simple-icons` | `archify/renderers/shared/generated-brand-marks.mjs` | `npm run check:brand-marks` |
| typed example JSON | checked-in example HTML | `archify/test/golden.mjs` |
| tracked clean Skill tree | `archify.zip` | CI exact-byte rebuild on Node 22 |

Do not edit generated files directly.

## Phase 1 fit

The existing stack supports an offline, deterministic Station profile without introducing a new language or parser runtime. The narrowest compatible implementation is Node ESM under a new Station-specific integration/profile boundary, using local Git object reads and emitting existing Architecture JSON IR plus a separate extraction receipt. No source-network dependency is needed or appropriate for this phase.
