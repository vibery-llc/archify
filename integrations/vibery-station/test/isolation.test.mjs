import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createGitFixture } from './helpers/git-fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INTEGRATION_ROOT = path.resolve(HERE, '..');
const REPOSITORY_ROOT = path.resolve(INTEGRATION_ROOT, '../..');
const CLI = path.join(INTEGRATION_ROOT, 'bin/station-map.mjs');
const PRELOAD = path.join(HERE, 'helpers/no-network.cjs');
const BASELINE = 'd673e8300df60a5c8166abe78787fdc78f6b8000';
const ARCHIVE_SHA256 = '2657acf353d3fadfde472b2c799eb9a1fa3a3b344129066980b9b1c5935f0883';
const CORE_PATHS = ['archify', 'viewer', 'scripts', 'examples', 'generated', 'archify.zip'];

export const ISOLATION_MATRIX = Object.freeze([
  'successful-extraction-under-no-network-preload',
  'failing-extraction-under-no-network-preload',
  'runtime-import-allowlist', 'git-command-allowlist',
  'no-update-check', 'no-brand-capture', 'no-preview', 'no-visual-check',
  'no-renderer', 'no-viewer', 'no-provider-sdk', 'no-telemetry',
  'no-fetch-http-https-net-dns', 'no-shell-command', 'no-package-manager', 'no-remote-git',
  'dependency-free-package', 'no-install-hooks', 'no-host-registration', 'no-default-root-mutation',
  'default-help-has-no-station-route', 'default-cli-smoke', 'default-cli-object-unchanged',
  'baseline-core-tree-unchanged', 'archive-object-unchanged', 'archive-sha256-unchanged',
]);

const covered = new Set();
function cover(...names) {
  names.forEach((name) => {
    assert.ok(ISOLATION_MATRIX.includes(name), `undeclared isolation row: ${name}`);
    covered.add(name);
  });
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: REPOSITORY_ROOT,
    encoding: null,
    shell: false,
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
}

function guardedExtraction(fixture, bundleRoot, revision, auditPath) {
  return run(process.execPath, [
    '--require', PRELOAD,
    CLI, 'extract', bundleRoot,
    '--repo-root', fixture.root,
    '--repository-url', fixture.repositoryUrl,
    '--revision', revision,
    '--json',
  ], {
    env: {
      ...process.env,
      STATION_PRELOAD_AUDIT: auditPath,
      GIT_TERMINAL_PROMPT: '0',
      LC_ALL: 'C',
    },
  });
}

function auditLines(auditPath) {
  return fs.readFileSync(auditPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function runtimeFiles() {
  const files = [];
  for (const directory of ['bin', 'lib']) {
    const root = path.join(INTEGRATION_ROOT, directory);
    const visit = (target) => {
      for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
        const child = path.join(target, entry.name);
        if (entry.isDirectory()) visit(child);
        else if (entry.isFile() && entry.name.endsWith('.mjs')) files.push(child);
      }
    };
    visit(root);
  }
  return files.sort();
}

function importSpecifiers(source) {
  const found = new Set();
  for (const expression of [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /^\s*import\s+['"]([^'"]+)['"]/gm,
  ]) {
    for (const match of source.matchAll(expression)) found.add(match[1]);
  }
  return [...found];
}

function git(...args) {
  return run('git', args, { encoding: 'utf8' });
}

test('real success and hard failure run beneath a throwing network/browser/process preload', () => {
  const fixture = createGitFixture({ files: {
    'package.json': `${JSON.stringify({ name: 'isolated-root' })}\n`,
  } });
  const bundleRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'station-isolation-bundle-')), 'bundle');
  const auditPath = path.join(os.tmpdir(), `station-isolation-audit-${process.pid}-${Date.now()}.jsonl`);
  const success = guardedExtraction(fixture, bundleRoot, fixture.revision, auditPath);
  assert.equal(success.status, 0, success.stderr.toString('utf8'));
  assert.equal(success.stderr.length, 0);
  const currentBefore = fs.readFileSync(path.join(bundleRoot, 'CURRENT'));
  cover('successful-extraction-under-no-network-preload');

  const failure = guardedExtraction(fixture, bundleRoot, 'f'.repeat(40), auditPath);
  assert.equal(failure.status, 1, failure.stderr.toString('utf8'));
  const envelope = JSON.parse(failure.stdout.toString('utf8'));
  assert.equal(envelope.diagnostics[0].code, 'station-extract/revision-unavailable');
  assert.deepEqual(fs.readFileSync(path.join(bundleRoot, 'CURRENT')), currentBefore);
  assert.doesNotMatch(failure.stderr.toString('utf8'), /STATION_TEST_FORBIDDEN_RUNTIME_PATH/);
  cover('failing-extraction-under-no-network-preload');

  const audit = auditLines(auditPath);
  assert.ok(audit.length > 0);
  const allowed = [
    ['rev-parse', '--show-toplevel'],
    ['remote', 'get-url', 'origin'],
    ['rev-parse', '--show-object-format'],
    ['cat-file', '-t'],
    ['cat-file', '-e'],
    ['rev-parse'],
    ['ls-tree', '-rz', '--full-tree'],
    ['cat-file', '-s'],
    ['cat-file', 'blob'],
  ];
  for (const call of audit) {
    assert.equal(path.basename(call.command), 'git');
    assert.equal(call.method, 'spawnSync');
    assert.equal(call.shell, false);
    assert.ok(allowed.some((prefix) => prefix.every((part, index) => call.args[index] === part)), JSON.stringify(call));
    assert.equal(['clone', 'fetch', 'pull', 'push', 'ls-remote', 'submodule'].includes(call.args[0]), false, JSON.stringify(call));
    if (call.args[0] === 'remote') assert.deepEqual(call.args.slice(0, 3), ['remote', 'get-url', 'origin']);
  }
  cover('git-command-allowlist', 'no-shell-command', 'no-package-manager', 'no-remote-git');
});

test('the preload synchronously blocks every network client/listener/DNS and non-Git process primitive', () => {
  const probe = `
    const probes = [
      ['fetch', () => fetch('https://example.invalid')],
      ['http-client', () => require('node:http').request('http://example.invalid')],
      ['https-client', () => require('node:https').request('https://example.invalid')],
      ['http-listener', () => require('node:http').createServer()],
      ['http2', () => require('node:http2').connect('https://example.invalid')],
      ['net-client', () => require('node:net').connect(9, 'example.invalid')],
      ['net-listener', () => require('node:net').createServer()],
      ['tls', () => require('node:tls').connect(443, 'example.invalid')],
      ['udp', () => require('node:dgram').createSocket('udp4')],
      ['dns', () => require('node:dns').lookup('example.invalid', () => {})],
      ['browser-process', () => require('node:child_process').spawnSync('xdg-open', ['https://example.invalid'])],
      ['shell', () => require('node:child_process').execSync('printf forbidden')],
    ];
    const blocked = [];
    for (const [name, operation] of probes) {
      try { operation(); } catch (error) {
        if (error && error.code === 'STATION_TEST_FORBIDDEN_RUNTIME_PATH') blocked.push(name);
      }
    }
    if (blocked.length !== probes.length) throw new Error(JSON.stringify({ blocked, expected: probes.map(([name]) => name) }));
    process.stdout.write(JSON.stringify(blocked));
  `;
  const result = run(process.execPath, ['--require', PRELOAD, '-e', probe], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    'fetch', 'http-client', 'https-client', 'http-listener', 'http2',
    'net-client', 'net-listener', 'tls', 'udp', 'dns', 'browser-process', 'shell',
  ]);
  cover('no-fetch-http-https-net-dns');
});

test('the complete integration runtime import graph is local/builtin except two approved Archify helpers', () => {
  const approvedExternal = new Set([
    path.resolve(REPOSITORY_ROOT, 'archify/renderers/shared/repository-location.mjs'),
    path.resolve(REPOSITORY_ROOT, 'archify/renderers/shared/output-path.mjs'),
  ]);
  const forbiddenBuiltins = new Set([
    'node:http', 'node:https', 'node:http2', 'node:net', 'node:tls', 'node:dgram', 'node:dns',
  ]);
  const edges = [];
  for (const file of runtimeFiles()) {
    const source = fs.readFileSync(file, 'utf8');
    for (const specifier of importSpecifiers(source)) {
      edges.push({ file: path.relative(REPOSITORY_ROOT, file), specifier });
      if (specifier.startsWith('node:')) {
        assert.equal(forbiddenBuiltins.has(specifier), false, `${file} imports ${specifier}`);
        continue;
      }
      assert.ok(specifier.startsWith('.'), `${file} imports external package ${specifier}`);
      const resolved = path.resolve(path.dirname(file), specifier);
      assert.ok(resolved.startsWith(`${INTEGRATION_ROOT}${path.sep}`) || approvedExternal.has(resolved), `${file} imports ${resolved}`);
    }
  }
  assert.ok(edges.length > 0);
  assert.deepEqual([...new Set(edges.filter(({ specifier }) => specifier.startsWith('../..')).map(({ specifier, file }) => (
    path.resolve(path.dirname(path.join(REPOSITORY_ROOT, file)), specifier)
  )))].sort(), [...approvedExternal].sort());
  cover('runtime-import-allowlist');
});

test('runtime graph has no update, capture, preview, visual, rendering, Viewer, provider, or telemetry route', () => {
  const sources = runtimeFiles().map((file) => ({
    file: path.relative(REPOSITORY_ROOT, file),
    source: fs.readFileSync(file, 'utf8'),
    imports: importSpecifiers(fs.readFileSync(file, 'utf8')),
  }));
  const imported = sources.flatMap(({ file, imports }) => imports.map((specifier) => `${file} -> ${specifier}`)).join('\n');
  for (const [row, pattern] of [
    ['no-update-check', /update[-_/]?check|check[-_/]?update/i],
    ['no-brand-capture', /brand[-_/]?capture|capture[-_/]?brand/i],
    ['no-preview', /(?:^|[\\/.-])preview(?:[\\/.-]|$)/i],
    ['no-visual-check', /visual[-_/]?check/i],
    ['no-viewer', /(?:^|[\\/.-])viewer(?:[\\/.-]|$)/i],
    ['no-provider-sdk', /openai|anthropic|provider[-_/]?sdk|langchain|llm[-_/]?sdk/i],
    ['no-telemetry', /telemetry|analytics|sentry|opentelemetry/i],
  ]) {
    assert.doesNotMatch(imported, pattern, row);
    cover(row);
  }
  const rendererEdges = imported.split('\n').filter((edge) => /renderers/i.test(edge));
  assert.ok(rendererEdges.length > 0, 'approved shared helper imports should be visible');
  assert.ok(rendererEdges.every((edge) => /renderers\/shared\/(?:repository-location|output-path)\.mjs$/.test(edge)), rendererEdges.join('\n'));
  cover('no-renderer');
});

test('integration package is dependency-free, inert, private, and absent from default host registration', () => {
  const packageValue = JSON.parse(fs.readFileSync(path.join(INTEGRATION_ROOT, 'package.json'), 'utf8'));
  assert.equal(packageValue.private, true);
  assert.equal(packageValue.type, 'module');
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies']) {
    assert.equal(Object.hasOwn(packageValue, field), false, field);
  }
  cover('dependency-free-package');
  assert.equal(Object.hasOwn(packageValue, 'scripts'), false);
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) assert.equal(packageValue.scripts?.[hook], undefined);
  cover('no-install-hooks');
  assert.equal(Object.hasOwn(packageValue, 'bin'), false);
  assert.equal(Object.hasOwn(packageValue, 'exports'), false);
  assert.equal(Object.hasOwn(packageValue, 'archify'), false);
  const registration = git('grep', '-n', '-E', 'vibery-station|station-map', '--', ':!integrations/vibery-station', ':!.planning');
  assert.equal(registration.status, 1, registration.stdout + registration.stderr);
  cover('no-host-registration');

  const changed = git('diff', '--name-only', BASELINE, '--');
  assert.equal(changed.status, 0, changed.stderr);
  const paths = changed.stdout.trim().split('\n').filter(Boolean);
  assert.ok(paths.length > 0);
  assert.deepEqual(paths.filter((entry) => !entry.startsWith('integrations/vibery-station/') && !entry.startsWith('.planning/')), []);
  cover('no-default-root-mutation');
});

test('default Archify help and inspect smoke remain normal and expose no Station route', () => {
  const help = run(process.execPath, ['archify/bin/archify.mjs', '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /^Usage:/);
  assert.match(help.stdout, /archify render/);
  assert.doesNotMatch(help.stdout, /station-map|vibery-station|station extract/i);
  cover('default-help-has-no-station-route');

  const smoke = run(process.execPath, [
    'archify/bin/archify.mjs', 'inspect', 'architecture', 'archify/examples/web-app.architecture.json',
  ], { encoding: 'utf8' });
  assert.equal(smoke.status, 0, smoke.stderr);
  const inspection = JSON.parse(smoke.stdout);
  assert.equal(inspection.ok, true);
  assert.equal(inspection.diagram_type, 'architecture');
  assert.ok(Array.isArray(inspection.components) && inspection.components.length > 0);
  cover('default-cli-smoke');

  const baselineObject = git('rev-parse', `${BASELINE}:archify/bin/archify.mjs`);
  const headObject = git('hash-object', 'archify/bin/archify.mjs');
  assert.equal(baselineObject.status, 0, baselineObject.stderr);
  assert.equal(headObject.status, 0, headObject.stderr);
  assert.equal(headObject.stdout.trim(), baselineObject.stdout.trim());
  cover('default-cli-object-unchanged');
});

test('mapped core tree and archive object/hash remain byte-for-byte at the approved baseline', () => {
  const diff = git('diff', '--exit-code', BASELINE, '--', ...CORE_PATHS);
  assert.equal(diff.status, 0, diff.stdout + diff.stderr);
  cover('baseline-core-tree-unchanged');

  const baselineObject = git('rev-parse', `${BASELINE}:archify.zip`);
  const currentObject = git('hash-object', 'archify.zip');
  assert.equal(baselineObject.status, 0, baselineObject.stderr);
  assert.equal(currentObject.status, 0, currentObject.stderr);
  assert.equal(currentObject.stdout.trim(), baselineObject.stdout.trim());
  cover('archive-object-unchanged');

  const archive = fs.readFileSync(path.join(REPOSITORY_ROOT, 'archify.zip'));
  assert.equal(createHash('sha256').update(archive).digest('hex'), ARCHIVE_SHA256);
  cover('archive-sha256-unchanged');
});

test('isolation matrix has no declared or executed omissions', () => {
  assert.equal(new Set(ISOLATION_MATRIX).size, ISOLATION_MATRIX.length);
  assert.deepEqual([...covered].sort(), [...ISOLATION_MATRIX].sort());
});
