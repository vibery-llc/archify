import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  commitFixture,
  createGitFixture,
  runFixtureGit,
  writeFixtureFiles,
} from './git-fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATION_CLI = path.resolve(HERE, '../../bin/station-map.mjs');
const ARTIFACT_FILES = Object.freeze({
  evidence: 'station-evidence.json',
  map: 'station-map.json',
  receipt: 'station-receipt.json',
});

export const CANONICAL_ACCEPTANCE_REPOSITORY_URL = 'https://github.com/example/station-acceptance';

export const EQUIVALENT_REMOTE_SPELLINGS = Object.freeze([
  'https://github.com/Example/Station-Acceptance.git',
  'ssh://git@github.com/Example/Station-Acceptance.git',
  'git@github.com:Example/Station-Acceptance.git',
]);

function json(value) {
  return `${JSON.stringify(value)}\n`;
}

function baseFiles() {
  return {
    'README.md': '# Station acceptance fixture\n',
    'checkout-only.txt': 'committed checkout bytes\n',
    'package.json': json({
      name: 'fixture-root',
      private: true,
      workspaces: ['apps/*', 'packages/*'],
    }),
    'apps/api/package.json': json({
      name: 'fixture-api',
      private: true,
      dependencies: { 'fixture-core': 'workspace:*' },
    }),
    'apps/jobs/package.json': json({ name: 'fixture-jobs', private: true }),
    'packages/core/package.json': json({ name: 'fixture-core', private: true }),
    'packages/util/package.json': json({ name: 'fixture-util', private: true }),
  };
}

function renamedFiles() {
  return {
    'package.json': json({
      name: 'renamed-root',
      private: true,
      workspaces: ['apps/*', 'packages/*'],
    }),
    'apps/api/package.json': json({
      name: 'renamed-api',
      private: true,
      dependencies: { 'renamed-core': 'workspace:*' },
    }),
    'apps/jobs/package.json': json({ name: 'renamed-jobs', private: true }),
    'packages/core/package.json': json({ name: 'renamed-core', private: true }),
    'packages/util/package.json': json({ name: 'renamed-util', private: true }),
  };
}

function topologyFiles() {
  return {
    'package.json': json({
      name: 'renamed-root',
      private: true,
      workspaces: ['apps/*', 'shared/*'],
    }),
    'apps/api/package.json': json({
      name: 'renamed-api',
      private: true,
      dependencies: { 'renamed-core': 'workspace:*' },
    }),
    'packages/core/package.json': null,
    'packages/util/package.json': null,
    'shared/core/package.json': json({ name: 'renamed-core', private: true }),
    'shared/util/package.json': json({ name: 'renamed-util', private: true }),
  };
}

export function createDeterminismRepository() {
  const fixture = createGitFixture({
    origin: EQUIVALENT_REMOTE_SPELLINGS[2],
    files: baseFiles(),
  });
  const base = fixture.revision;
  const readme = commitFixture(fixture.root, {
    'README.md': '# Station acceptance fixture\n\nREADME-only revision.\n',
  }, 'README only');
  const renamed = commitFixture(fixture.root, renamedFiles(), 'rename package labels');
  const topology = commitFixture(fixture.root, topologyFiles(), 'change structural package group');
  return Object.freeze({
    root: fixture.root,
    repositoryUrl: CANONICAL_ACCEPTANCE_REPOSITORY_URL,
    revisions: Object.freeze({ base, readme, renamed, topology }),
  });
}

function cloneLocal(source, target) {
  const result = spawnSync('git', ['clone', '-q', '--no-hardlinks', source, target], {
    encoding: null,
    shell: false,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
  });
  if (result.error || result.status !== 0) {
    throw new Error(`local fixture clone failed: ${result.stderr?.toString('utf8') || result.error?.message}`);
  }
}

export function cloneDeterminismRepository(fixture, {
  remote,
  branch,
  headRevision,
  dirty = false,
}) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'station-acceptance-clone-'));
  const root = path.join(parent, 'repository');
  cloneLocal(fixture.root, root);
  runFixtureGit(root, ['remote', 'set-url', 'origin', remote]);
  runFixtureGit(root, ['checkout', '-q', '-B', branch, headRevision]);
  if (dirty) {
    writeFixtureFiles(root, {
      'checkout-only.txt': `staged checkout bytes for ${branch}\n`,
      'README.md': null,
      'apps/api/package.json': '{"name":"dirty-checkout-only"}\n',
      'apps/ghost/package.json': '{"name":"untracked-manifest"}\n',
    });
    runFixtureGit(root, ['add', 'checkout-only.txt']);
  }
  return Object.freeze({ root, branch, remote, headRevision });
}

export function captureRepositoryState(root) {
  const status = runFixtureGit(root, ['status', '--porcelain=v1', '-z'], { encoding: null });
  return Object.freeze({
    head: runFixtureGit(root, ['rev-parse', 'HEAD']),
    branch: runFixtureGit(root, ['branch', '--show-current']),
    index: fs.readFileSync(path.join(root, '.git', 'index')),
    refs: runFixtureGit(root, ['for-each-ref', '--format=%(refname)%00%(objectname)'], { encoding: null }),
    status,
  });
}

function packageManifest(name, declarations = {}) {
  return json({ name, private: true, ...declarations });
}

export function createTwelveWorkspaceRepository({ groups, repositoryName }) {
  if (!Array.isArray(groups) || groups.length !== 4
      || new Set(groups).size !== groups.length
      || groups.some((group) => typeof group !== 'string' || !/^[a-z][a-z0-9-]*$/.test(group))) {
    throw new TypeError('Twelve-workspace fixtures require four distinct generic path-segment labels.');
  }
  if (typeof repositoryName !== 'string' || !/^[a-z][a-z0-9-]*$/.test(repositoryName)) {
    throw new TypeError('Fixture repository name must be one safe generic identity segment.');
  }

  const members = ['alpha', 'beta', 'gamma'];
  const packageNames = Array.from({ length: 12 }, (_, index) => `unit-${String(index + 1).padStart(2, '0')}`);
  const declarations = new Map([
    [0, { dependencies: { [packageNames[9]]: 'workspace:*' } }],
    [1, { optionalDependencies: { [packageNames[10]]: 'workspace:*' } }],
    [3, { devDependencies: { [packageNames[9]]: 'workspace:*' } }],
    [4, { peerDependencies: { [packageNames[11]]: 'workspace:*' } }],
    [6, {
      dependencies: { [packageNames[10]]: 'workspace:*' },
      peerDependencies: { [packageNames[9]]: 'workspace:*' },
    }],
    [9, { dependencies: { [packageNames[10]]: 'workspace:*' } }],
  ]);
  const files = {
    'README.md': '# Generic twelve-workspace acceptance fixture\n',
    'package.json': json({
      name: 'shape-root',
      private: true,
      workspaces: groups.map((group) => `${group}/*`),
    }),
  };
  let packageIndex = 0;
  for (const group of groups) {
    for (const member of members) {
      files[`${group}/${member}/package.json`] = packageManifest(
        packageNames[packageIndex],
        declarations.get(packageIndex),
      );
      packageIndex += 1;
    }
  }
  const authoredUrl = `https://github.com/Example/${repositoryName}.git`;
  const fixture = createGitFixture({ origin: authoredUrl, files });
  return Object.freeze({
    root: fixture.root,
    revision: fixture.revision,
    repositoryUrl: authoredUrl,
    groups: Object.freeze([...groups]),
  });
}

function acceptanceEnvironment(entries) {
  const environment = { ...process.env };
  for (const [key] of entries) delete environment[key];
  for (const [key, value] of entries) environment[key] = value;
  return environment;
}

function readPublishedArtifacts(bundleRoot) {
  const pointerBytes = fs.readFileSync(path.join(bundleRoot, 'CURRENT'));
  const pointer = pointerBytes.toString('utf8');
  if (!/^generation-[a-f0-9]{64}\n$/.test(pointer)) {
    throw new Error('Station fixture observed a malformed CURRENT pointer.');
  }
  const generation = path.join(bundleRoot, 'generations', pointer.slice(0, -1));
  return Object.freeze(Object.fromEntries(Object.entries(ARTIFACT_FILES).map(([name, file]) => [
    name,
    fs.readFileSync(path.join(generation, file)),
  ])));
}

export function runStationAcceptance({
  repoRoot,
  repositoryUrl,
  revision,
  cwd = os.tmpdir(),
  envEntries = [],
}) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'station-acceptance-bundle-'));
  const bundleRoot = path.join(parent, 'bundle');
  const result = spawnSync(process.execPath, [
    STATION_CLI,
    'extract',
    bundleRoot,
    '--repo-root', repoRoot,
    '--repository-url', repositoryUrl,
    '--revision', revision,
    '--json',
  ], {
    cwd,
    encoding: null,
    shell: false,
    maxBuffer: 32 * 1024 * 1024,
    env: acceptanceEnvironment(envEntries),
  });
  if (result.error) throw result.error;
  const artifacts = result.status === 0 ? readPublishedArtifacts(bundleRoot) : Object.freeze({});
  return Object.freeze({ result, bundleRoot, artifacts });
}

// Directory-layout fixtures: ordinary repositories without npm workspace
// members. Each returns a committed fixture ready for createGitObjectReader.

export function viteAppFiles() {
  return {
    'package.json': json({ name: 'vite-app', private: true, scripts: { dev: 'vite' } }),
    'index.html': '<!doctype html><div id="root"></div>\n',
    'vite.config.ts': 'export default {};\n',
    'src/main.tsx': 'import "./components/Button";\n',
    'src/components/Button.tsx': 'export const Button = () => null;\n',
    'src/components/Card.tsx': 'export const Card = () => null;\n',
    'src/lib/api.ts': 'export const api = 1;\n',
    'src/pages/Home.tsx': 'export default function Home() { return null; }\n',
    'public/favicon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>\n',
    'public/robots.txt': 'User-agent: *\n',
  };
}

export function flatPythonFiles() {
  return {
    'pyproject.toml': '[project]\nname = "flat"\n',
    'README.md': '# flat python\n',
    'app/__init__.py': '',
    'app/main.py': 'print("hi")\n',
    'tests/test_main.py': 'def test_ok():\n    assert True\n',
    'scripts/deploy.sh': '#!/bin/sh\necho deploy\n',
    'docs/index.md': '# docs\n',
  };
}

export function unityFiles() {
  return {
    'Assets/Scripts/Player/PlayerController.cs': 'public class PlayerController {}\n',
    'Assets/Scripts/Player/PlayerController.cs.meta': 'guid: 1\n',
    'Assets/Scripts/UI/Hud.cs': 'public class Hud {}\n',
    'Assets/Art/hero.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    'Assets/Art/hero.png.meta': 'guid: 2\n',
    'Assets/Plugins/Vendor/Lib.cs': 'public class VendorLib {}\n',
    'ProjectSettings/ProjectSettings.asset': 'm_Name: fixture\n',
    'Packages/manifest.json': json({ dependencies: {} }),
    'Library/Bee/Generated.cs': 'public class Generated {}\n',
  };
}

export function tinySinglePackageFiles() {
  return {
    'package.json': '{"name":"tiny-single"}\n',
    'index.js': 'module.exports = 1;\n',
  };
}

export function wideDirectoryFiles({ conventionalChildren = 0, topLevel = 0, manifest = false } = {}) {
  const files = manifest ? { 'package.json': json({ name: 'wide' }) } : { 'README.md': '# wide\n' };
  for (let index = 0; index < conventionalChildren; index += 1) {
    files[`src/m${String(index).padStart(3, '0')}/index.ts`] = `export const m = ${index};\n`;
  }
  for (let index = 0; index < topLevel; index += 1) {
    files[`d${String(index).padStart(3, '0')}/main.go`] = 'package main\n';
  }
  return files;
}

export function createDirectoryFixture(files, { origin = 'git@github.com:Example/Station-Reader.git' } = {}) {
  return createGitFixture({ origin, files });
}
