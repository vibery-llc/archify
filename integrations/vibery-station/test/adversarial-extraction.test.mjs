import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { extractStationMap } from '../lib/extract.mjs';
import { createGitObjectReader, GIT_OBJECT_LIMITS } from '../lib/git-object-reader.mjs';
import {
  commitFixture,
  createCommitFromTreeRecords,
  createGitFixture,
  recordingRunner,
  runFixtureGit,
  writeBlobObject,
} from './helpers/git-fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '../bin/station-map.mjs');
const MiB = 1024 * 1024;

export const ADVERSARIAL_EXTRACTION_MATRIX = Object.freeze([
  'replacement-commit', 'replacement-tree', 'replacement-blob',
  'branch-revision', 'tag-revision', 'abbreviated-revision', 'blob-revision', 'tree-revision',
  'missing-commit', 'missing-tree', 'missing-blob', 'partial-clone-lazy-fetch-disabled',
  'wrong-origin', 'missing-origin', 'credentialed-origin-redaction', 'non-top-level-root',
  'unsupported-object-format',
  'malformed-tree-protocol', 'incomplete-tree-protocol', 'tree-output-over-budget',
  'manifest-symlink', 'manifest-gitlink', 'manifest-binary-nul', 'manifest-invalid-utf8',
  'control-character-path', 'selected-control-exact', 'selected-control-wildcard',
  'invalid-path-shape', 'case-collision', 'unicode-nfc-collision',
  'unsupported-glob', 'missing-root-manifest', 'malformed-manifest', 'oversized-manifest',
  'zero-workspace-matches', 'duplicate-package-identity', 'more-than-five-groups',
  'manifest-count-512', 'manifest-count-513',
  'manifest-bytes-1mib', 'manifest-bytes-1mib-plus-one',
  'selected-bytes-8mib', 'selected-bytes-8mib-plus-one',
  'object-unavailable', 'malformed-size-probe', 'probe-read-disagreement', 'process-output-overflow',
  'nul-safe-space-tab-newline-paths',
]);

const covered = new Set();
function cover(...names) {
  names.forEach((name) => {
    assert.ok(ADVERSARIAL_EXTRACTION_MATRIX.includes(name), `undeclared adversarial row: ${name}`);
    covered.add(name);
  });
}

function json(value) {
  return `${JSON.stringify(value)}\n`;
}

function paddedJson(value, size) {
  const bytes = Buffer.from(json(value));
  assert.ok(bytes.length <= size, `fixture JSON exceeds requested ${size} bytes`);
  return Buffer.concat([bytes, Buffer.alloc(size - bytes.length, 0x20)]);
}

function temporaryBundle() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'station-adversarial-bundle-')), 'bundle');
}

function runCli(fixture, { bundleRoot = temporaryBundle(), ...overrides } = {}) {
  const result = spawnSync(process.execPath, [
    CLI, 'extract', bundleRoot,
    '--repo-root', overrides.repoRoot ?? fixture.root,
    '--repository-url', overrides.repositoryUrl ?? fixture.repositoryUrl,
    '--revision', overrides.revision ?? fixture.revision,
    '--json',
  ], {
    encoding: null,
    shell: false,
    maxBuffer: 32 * MiB,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
  });
  if (result.error) throw result.error;
  return { result, bundleRoot };
}

function readBundle(bundleRoot) {
  const current = fs.readFileSync(path.join(bundleRoot, 'CURRENT'));
  const generationId = current.toString('utf8').trim();
  const generation = path.join(bundleRoot, 'generations', generationId);
  const evidenceBytes = fs.readFileSync(path.join(generation, 'station-evidence.json'));
  const mapBytes = fs.readFileSync(path.join(generation, 'station-map.json'));
  const receiptBytes = fs.readFileSync(path.join(generation, 'station-receipt.json'));
  return {
    current,
    generationId,
    evidenceBytes,
    mapBytes,
    receiptBytes,
    evidence: JSON.parse(evidenceBytes),
    map: JSON.parse(mapBytes),
    receipt: JSON.parse(receiptBytes),
  };
}

function authoritySnapshot(bundleRoot) {
  const bundle = readBundle(bundleRoot);
  return {
    ...bundle,
    generations: fs.readdirSync(path.join(bundleRoot, 'generations')).sort(),
  };
}

function assertAuthorityUnchanged(before, bundleRoot, label) {
  const after = authoritySnapshot(bundleRoot);
  assert.deepEqual(after.current, before.current, `${label}: CURRENT changed`);
  assert.deepEqual(after.evidenceBytes, before.evidenceBytes, `${label}: evidence changed`);
  assert.deepEqual(after.mapBytes, before.mapBytes, `${label}: map changed`);
  assert.deepEqual(after.receiptBytes, before.receiptBytes, `${label}: receipt changed`);
  assert.deepEqual(after.generations, before.generations, `${label}: hard failure published a generation`);
}

function parseFailure(result) {
  assert.notEqual(result.status, 0, 'hostile hard-failure case unexpectedly succeeded');
  assert.equal(result.stderr.length, 0);
  const envelope = JSON.parse(result.stdout.toString('utf8'));
  assert.equal(envelope.ok, false);
  assert.equal(envelope.receipt, undefined);
  assert.equal(envelope.result, undefined);
  assert.equal(envelope.diagnostics.length, 1);
  assert.doesNotMatch(JSON.stringify(envelope), /station-fallback\//, 'hard failure was downgraded to coarse fallback');
  return envelope;
}

function assertCliHardFailure(fixture, bundleRoot, before, code, overrides = {}, label = code) {
  const { result } = runCli(fixture, { bundleRoot, ...overrides });
  const envelope = parseFailure(result);
  assert.equal(envelope.diagnostics[0].code, code, JSON.stringify(envelope));
  assertAuthorityUnchanged(before, bundleRoot, label);
  return envelope;
}

function assertCoarse(fixture, expectedReasons, { evidenceMayRemainDetailed = false } = {}) {
  const { result, bundleRoot } = runCli(fixture);
  assert.equal(result.status, 0, result.stderr.toString('utf8'));
  const published = readBundle(bundleRoot);
  assert.equal(published.map.snapshot.mode, 'coarse');
  assert.equal(published.map.fallback.used, true);
  assert.deepEqual(published.map.fallback.reason_codes, [...expectedReasons].sort());
  assert.equal(published.map.rooms.length, 1);
  assert.equal(published.map.rooms[0].kind, 'coarse-project');
  assert.equal(published.map.rooms[0].confidence, 'coarse');
  assert.deepEqual(published.map.rooms[0].package_roots, []);
  assert.deepEqual(published.map.relations, []);
  if (!evidenceMayRemainDetailed) {
    assert.deepEqual(published.evidence.packages, []);
    assert.equal(published.evidence.analysis.represented_manifest_count, 0);
    assert.deepEqual(published.evidence.analysis.fallback_reason_codes, [...expectedReasons].sort());
  } else {
    assert.equal(published.evidence.analysis.detail_eligible, true);
    assert.equal(published.evidence.analysis.represented_manifest_count, published.evidence.packages.length);
    assert.deepEqual(published.evidence.analysis.fallback_reason_codes, []);
  }
  return published;
}

function removeLooseObject(root, oid) {
  const objectDirectory = runFixtureGit(root, ['rev-parse', '--git-path', 'objects']);
  const objectPath = path.join(path.resolve(root, objectDirectory), oid.slice(0, 2), oid.slice(2));
  assert.equal(fs.existsSync(objectPath), true, `fixture object must be loose: ${oid}`);
  fs.unlinkSync(objectPath);
}

function treeRecord({ mode = '100644', type = 'blob', oid = '1'.repeat(40), pathBytes = Buffer.from('package.json'), terminate = true } = {}) {
  return Buffer.concat([
    Buffer.from(`${mode} ${type} ${oid}\t`, 'ascii'),
    pathBytes,
    ...(terminate ? [Buffer.from([0])] : []),
  ]);
}

function interceptedReader(fixture, intercept) {
  return createGitObjectReader({
    repoRoot: fixture.root,
    repositoryUrl: fixture.repositoryUrl,
    revision: fixture.revision,
  }, { processRunner: recordingRunner([], intercept) });
}

async function assertOrchestratorHardFailure({ fixture, intercept, code, bundleRoot, before, label }) {
  let publicationCalls = 0;
  await assert.rejects(extractStationMap({
    bundleRoot,
    repoRoot: fixture.root,
    repositoryUrl: fixture.repositoryUrl,
    revision: fixture.revision,
  }, {
    createReader(input) {
      return createGitObjectReader(input, { processRunner: recordingRunner([], intercept) });
    },
    publishGeneration() {
      publicationCalls += 1;
      throw new Error('publication must not be called');
    },
  }), (error) => {
    assert.equal(error?.diagnostic?.code, code, JSON.stringify(error?.diagnostic));
    assert.notEqual(error?.stationStage, 'publication');
    assert.doesNotMatch(JSON.stringify(error?.diagnostic), /station-fallback\//);
    return true;
  });
  assert.equal(publicationCalls, 0, `${label}: publication called`);
  assertAuthorityUnchanged(before, bundleRoot, label);
}

function successFixture() {
  return createGitFixture({ files: {
    'package.json': json({ name: 'trusted-root', private: true }),
    'README.md': 'trusted baseline\n',
  } });
}

function seedAuthority() {
  const fixture = successFixture();
  const bundleRoot = temporaryBundle();
  const seeded = runCli(fixture, { bundleRoot });
  assert.equal(seeded.result.status, 0, seeded.result.stderr.toString('utf8'));
  return { bundleRoot, before: authoritySnapshot(bundleRoot) };
}

test('active commit, tree, and blob replacement refs cannot change real-CLI evidence', () => {
  for (const kind of ['commit', 'tree', 'blob']) {
    const fixture = successFixture();
    const originalRevision = fixture.revision;
    if (kind === 'commit') {
      const alternate = commitFixture(fixture.root, { 'package.json': json({ name: 'replacement-commit' }) }, 'replacement commit');
      runFixtureGit(fixture.root, ['replace', originalRevision, alternate]);
    } else if (kind === 'tree') {
      const originalTree = runFixtureGit(fixture.root, ['rev-parse', `${originalRevision}^{tree}`]);
      const alternate = commitFixture(fixture.root, { 'package.json': json({ name: 'replacement-tree' }) }, 'replacement tree');
      const alternateTree = runFixtureGit(fixture.root, ['rev-parse', `${alternate}^{tree}`]);
      runFixtureGit(fixture.root, ['replace', originalTree, alternateTree]);
    } else {
      const originalBlob = runFixtureGit(fixture.root, ['rev-parse', `${originalRevision}:package.json`]);
      const alternateBlob = writeBlobObject(fixture.root, Buffer.from(json({ name: 'replacement-blob' })));
      runFixtureGit(fixture.root, ['replace', originalBlob, alternateBlob]);
    }
    assert.notEqual(runFixtureGit(fixture.root, ['replace', '-l']), '');
    const { result, bundleRoot } = runCli(fixture, { revision: originalRevision });
    assert.equal(result.status, 0, `${kind}: ${result.stderr.toString('utf8')}`);
    const published = readBundle(bundleRoot);
    assert.equal(published.evidence.repository.revision, originalRevision);
    assert.equal(published.evidence.packages[0].name, 'trusted-root');
    cover(`replacement-${kind}`);
  }
});

test('mutable, abbreviated, tag, and non-commit revisions fail before replacing authority', () => {
  const hostile = successFixture();
  runFixtureGit(hostile.root, ['branch', 'mutable-branch']);
  runFixtureGit(hostile.root, ['tag', 'mutable-tag']);
  const blob = runFixtureGit(hostile.root, ['rev-parse', `${hostile.revision}:package.json`]);
  const tree = runFixtureGit(hostile.root, ['rev-parse', `${hostile.revision}^{tree}`]);
  const { bundleRoot, before } = seedAuthority();
  const rows = [
    ['branch-revision', 'mutable-branch', 'station-extract/revision-invalid'],
    ['tag-revision', 'mutable-tag', 'station-extract/revision-invalid'],
    ['abbreviated-revision', hostile.revision.slice(0, 12), 'station-extract/revision-invalid'],
    ['blob-revision', blob, 'station-extract/revision-unavailable'],
    ['tree-revision', tree, 'station-extract/revision-unavailable'],
  ];
  for (const [name, revision, code] of rows) {
    assertCliHardFailure(hostile, bundleRoot, before, code, { revision }, name);
    cover(name);
  }
});

test('missing local commit, tree, and blob objects are hard failures with prior authority intact', () => {
  const { bundleRoot, before } = seedAuthority();
  const missingCommitFixture = successFixture();
  assertCliHardFailure(missingCommitFixture, bundleRoot, before, 'station-extract/revision-unavailable', {
    revision: 'f'.repeat(40),
  }, 'missing-commit');
  cover('missing-commit');

  const missingTreeFixture = successFixture();
  const tree = runFixtureGit(missingTreeFixture.root, ['rev-parse', `${missingTreeFixture.revision}^{tree}`]);
  removeLooseObject(missingTreeFixture.root, tree);
  assertCliHardFailure(missingTreeFixture, bundleRoot, before, 'station-extract/revision-unavailable', {}, 'missing-tree');
  cover('missing-tree');

  const missingBlobFixture = successFixture();
  const blob = runFixtureGit(missingBlobFixture.root, ['rev-parse', `${missingBlobFixture.revision}:package.json`]);
  removeLooseObject(missingBlobFixture.root, blob);
  assertCliHardFailure(missingBlobFixture, bundleRoot, before, 'station-extract/object-unavailable', {}, 'missing-blob');
  cover('missing-blob');
});

test('origin, root, and object-format hostility emits stable redacted diagnostics', () => {
  const { bundleRoot, before } = seedAuthority();

  const wrong = successFixture();
  runFixtureGit(wrong.root, ['remote', 'set-url', 'origin', 'https://github.com/example/wrong.git']);
  assertCliHardFailure(wrong, bundleRoot, before, 'station-extract/origin-mismatch', {}, 'wrong-origin');
  cover('wrong-origin');

  const missing = successFixture();
  runFixtureGit(missing.root, ['remote', 'remove', 'origin']);
  assertCliHardFailure(missing, bundleRoot, before, 'station-extract/origin-mismatch', {}, 'missing-origin');
  cover('missing-origin');

  const credentialed = successFixture();
  runFixtureGit(credentialed.root, ['remote', 'set-url', 'origin', 'https://user:SYNTHETIC_ORIGIN_SECRET@github.com/example/wrong.git']);
  const envelope = assertCliHardFailure(credentialed, bundleRoot, before, 'station-extract/origin-mismatch', {}, 'credentialed-origin-redaction');
  assert.doesNotMatch(JSON.stringify(envelope), /SYNTHETIC_ORIGIN_SECRET/);
  assert.match(envelope.diagnostics[0].evidence.localOrigin, /REDACTED/);
  cover('credentialed-origin-redaction');

  const nested = successFixture();
  fs.mkdirSync(path.join(nested.root, 'nested'));
  assertCliHardFailure(nested, bundleRoot, before, 'station-extract/root-not-top-level', {
    repoRoot: path.join(nested.root, 'nested'),
  }, 'non-top-level-root');
  cover('non-top-level-root');

  const shaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'station-sha256-'));
  const init = spawnSync('git', ['init', '-q', '--object-format=sha256', shaRoot], { encoding: 'utf8', shell: false });
  assert.equal(init.status, 0, `local Git lacks SHA-256 fixture support: ${init.stderr}`);
  runFixtureGit(shaRoot, ['remote', 'add', 'origin', 'https://github.com/example/station-reader.git']);
  const shaFixture = { root: shaRoot, repositoryUrl: 'https://github.com/example/station-reader', revision: 'a'.repeat(40) };
  assertCliHardFailure(shaFixture, bundleRoot, before, 'station-extract/object-format-unsupported', {}, 'unsupported-object-format');
  cover('unsupported-object-format');
});

test('malformed, incomplete, and over-budget tree streams fail through the real orchestrator reader seam', async () => {
  const fixture = successFixture();
  const { bundleRoot, before } = seedAuthority();
  const rows = [
    ['malformed-tree-protocol', { stdout: Buffer.from('not-a-tree-record\0') }, 'station-extract/tree-protocol-invalid'],
    ['incomplete-tree-protocol', { stdout: treeRecord({ terminate: false }) }, 'station-extract/tree-protocol-invalid'],
    ['tree-output-over-budget', { stdout: Buffer.alloc(GIT_OBJECT_LIMITS.treeOutputBytes + 1) }, 'station-extract/tree-budget-exceeded'],
  ];
  for (const [name, replacement, code] of rows) {
    await assertOrchestratorHardFailure({
      fixture,
      bundleRoot,
      before,
      code,
      label: name,
      intercept(_command, args) {
        if (args[0] === 'ls-tree') return { status: 0, stderr: Buffer.alloc(0), ...replacement };
        return null;
      },
    });
    cover(name);
  }
});

test('non-regular, binary, encoding, path-collision, and unsupported workspace inputs yield only exact coarse truth', () => {
  const symlink = createGitFixture({ files: { 'target.json': json({ name: 'target' }), 'package.json': { symlink: 'target.json' } } });
  assertCoarse(symlink, ['station-fallback/workspace-manifest-non-regular']);
  cover('manifest-symlink');

  const gitlinkBase = successFixture();
  const synthetic = createCommitFromTreeRecords(gitlinkBase.root, [{
    mode: '160000', type: 'commit', oid: gitlinkBase.revision, pathBytes: Buffer.from('package.json'),
  }]);
  assertCoarse({ ...gitlinkBase, revision: synthetic.revision }, ['station-fallback/workspace-manifest-non-regular']);
  cover('manifest-gitlink');

  assertCoarse(createGitFixture({ files: { 'package.json': Buffer.from('{"name":"root"}\0') } }), [
    'station-fallback/workspace-manifest-binary',
  ]);
  cover('manifest-binary-nul');

  assertCoarse(createGitFixture({ files: { 'package.json': Buffer.from([0xff]) } }), [
    'station-fallback/workspace-manifest-encoding-unsupported',
  ]);
  cover('manifest-invalid-utf8');

  const control = createGitFixture({ files: { 'odd\tname/package.json': json({ name: 'odd' }) } });
  const controlReader = createGitObjectReader({
    repoRoot: control.root,
    repositoryUrl: control.repositoryUrl,
    revision: control.revision,
  });
  assert.ok(controlReader.unsupportedPaths.some(({ code }) => code === 'station-extract/path-control-unsupported'));
  assertCoarse(control, ['station-fallback/root-manifest-missing']);
  cover('control-character-path');

  const caseCollision = createGitFixture({ files: {
    'package.json': json({ name: 'root', workspaces: ['packages/*'] }),
    'packages/Foo/package.json': json({ name: 'upper' }),
    'packages/foo/package.json': json({ name: 'lower' }),
  } });
  assertCoarse(caseCollision, ['station-fallback/path-collision']);
  cover('case-collision');

  const nfcCollision = createGitFixture({ files: {
    'package.json': json({ name: 'root', workspaces: ['packages/*'] }),
    'packages/café/package.json': json({ name: 'composed' }),
    'packages/café/package.json': json({ name: 'decomposed' }),
  } });
  assertCoarse(nfcCollision, ['station-fallback/path-collision']);
  cover('unicode-nfc-collision');
});

test('selected tab and newline manifest paths produce the typed whole-project fallback for exact and wildcard patterns', () => {
  const rows = [
    ['selected-control-exact', 'packages/odd\troom', ['packages/odd\troom']],
    ['selected-control-wildcard', 'packages/odd\nroom', ['packages/*']],
  ];
  for (const [name, root, workspaces] of rows) {
    const fixture = createGitFixture({ files: {
      'package.json': json({ name: 'root', workspaces }),
      [`${root}/package.json`]: json({ name: 'selected-control' }),
    } });
    assertCoarse(fixture, ['station-fallback/path-unsupported']);
    cover(name);
  }
});

test('invalid raw path shape remains fully inventoried and cannot produce partial detail', async () => {
  const fixture = successFixture();
  const invalidOutput = treeRecord({ pathBytes: Buffer.from('../invalid/package.json') });
  const reader = interceptedReader(fixture, (_command, args) => (args[0] === 'ls-tree'
    ? { status: 0, stdout: invalidOutput, stderr: Buffer.alloc(0) }
    : null));
  assert.deepEqual(reader.unsupportedPaths.map(({ code }) => code), ['station-extract/path-shape-unsupported']);
  let candidate;
  const result = await extractStationMap({
    bundleRoot: temporaryBundle(),
    repoRoot: fixture.root,
    repositoryUrl: fixture.repositoryUrl,
    revision: fixture.revision,
  }, {
    createReader() { return reader; },
    publishGeneration(value) { candidate = value; return { generation_id: `generation-${'a'.repeat(64)}` }; },
  });
  assert.equal(result.receipt.result.mode, 'coarse');
  assert.deepEqual(result.receipt.result.fallback_reason_codes, ['station-fallback/root-manifest-missing']);
  assert.deepEqual(JSON.parse(candidate.evidenceBytes).packages, []);
  assert.deepEqual(JSON.parse(candidate.mapBytes).relations, []);
  cover('invalid-path-shape');
});

test('every documented structural fallback cause is exact and never preserves partial packages or relations', () => {
  const rows = [
    ['unsupported-glob', { 'package.json': json({ name: 'root', workspaces: ['packages/**'] }) }, ['station-fallback/workspace-pattern-unsupported']],
    ['missing-root-manifest', { 'README.md': 'no package manifest\n' }, ['station-fallback/root-manifest-missing']],
    ['malformed-manifest', { 'package.json': '{not json}\n' }, ['station-fallback/workspace-manifest-invalid']],
    ['oversized-manifest', { 'package.json': paddedJson({ name: 'root' }, MiB + 1) }, ['station-fallback/workspace-manifest-oversized']],
    ['zero-workspace-matches', { 'package.json': json({ name: 'root', workspaces: ['packages/*'] }) }, ['station-fallback/workspace-match-empty']],
    ['duplicate-package-identity', {
      'package.json': json({ name: 'root', workspaces: ['packages/*'] }),
      'packages/a/package.json': json({ name: 'same' }),
      'packages/b/package.json': json({ name: 'same' }),
    }, ['station-fallback/package-name-ambiguous']],
    ['more-than-five-groups', Object.fromEntries([
      ['package.json', json({ name: 'root', workspaces: ['a/*', 'b/*', 'c/*', 'd/*', 'e/*', 'f/*'] })],
      ...['a', 'b', 'c', 'd', 'e', 'f'].map((group) => [`${group}/one/package.json`, json({ name: `${group}-one` })]),
    ]), ['station-fallback/room-count-out-of-range']],
  ];
  for (const [name, files, reasons] of rows) {
    assertCoarse(
      createGitFixture({ files }),
      reasons,
      { evidenceMayRemainDetailed: name === 'more-than-five-groups' },
    );
    cover(name);
  }
});

test('512-manifest and one-MiB policy boundaries are executable on both sides', () => {
  const exactFiles = {
    'package.json': json({ name: 'root', workspaces: ['packages/*'] }),
  };
  for (let index = 0; index < 511; index += 1) {
    exactFiles[`packages/p${String(index).padStart(3, '0')}/package.json`] = json({ name: `p${index}` });
  }
  const exact = createGitFixture({ files: exactFiles });
  const exactRun = runCli(exact);
  assert.equal(exactRun.result.status, 0, exactRun.result.stderr.toString('utf8'));
  const exactPublished = readBundle(exactRun.bundleRoot);
  assert.equal(exactPublished.evidence.analysis.discovered_manifest_count, 512);
  assert.equal(exactPublished.evidence.analysis.detail_eligible, true);
  assert.equal(exactPublished.map.snapshot.mode, 'structural');
  cover('manifest-count-512');

  exactFiles['packages/p511/package.json'] = json({ name: 'p511' });
  const excess = createGitFixture({ files: exactFiles });
  const excessPublished = assertCoarse(excess, ['station-fallback/manifest-count-exceeded']);
  assert.equal(excessPublished.evidence.analysis.discovered_manifest_count, 513);
  assert.equal(excessPublished.evidence.analysis.selected_manifest_count, 0);
  cover('manifest-count-513');

  const exactSize = createGitFixture({ files: { 'package.json': paddedJson({ name: 'root' }, MiB) } });
  const exactSizeRun = runCli(exactSize);
  assert.equal(exactSizeRun.result.status, 0, exactSizeRun.result.stderr.toString('utf8'));
  assert.equal(readBundle(exactSizeRun.bundleRoot).map.snapshot.mode, 'structural');
  cover('manifest-bytes-1mib');

  assertCoarse(createGitFixture({ files: { 'package.json': paddedJson({ name: 'root' }, MiB + 1) } }), [
    'station-fallback/workspace-manifest-oversized',
  ]);
  cover('manifest-bytes-1mib-plus-one');
});

function aggregateFixture(totalBytes) {
  const workspaceCount = 8;
  const rootSize = 512;
  const remaining = totalBytes - rootSize;
  const base = Math.floor(remaining / workspaceCount);
  const files = {
    'package.json': paddedJson({ name: 'root', workspaces: ['packages/*'] }, rootSize),
  };
  for (let index = 0; index < workspaceCount; index += 1) {
    const size = index === workspaceCount - 1 ? remaining - (base * (workspaceCount - 1)) : base;
    assert.ok(size <= MiB);
    files[`packages/p${index}/package.json`] = paddedJson({ name: `p${index}` }, size);
  }
  return createGitFixture({ files });
}

test('eight-MiB selected-byte policy boundary is detailed at equality and coarse one byte over', () => {
  const exact = aggregateFixture(8 * MiB);
  const exactRun = runCli(exact);
  assert.equal(exactRun.result.status, 0, exactRun.result.stderr.toString('utf8'));
  assert.equal(readBundle(exactRun.bundleRoot).map.snapshot.mode, 'structural');
  cover('selected-bytes-8mib');

  assertCoarse(aggregateFixture((8 * MiB) + 1), ['station-fallback/selected-manifest-bytes-exceeded']);
  cover('selected-bytes-8mib-plus-one');
});

test('unavailable objects, malformed probes, probe/read disagreement, and output overflow are hard failures', async () => {
  const fixture = successFixture();
  const { bundleRoot, before } = seedAuthority();
  const rows = [
    ['object-unavailable', 'station-extract/object-unavailable', (_command, args) => (
      args[0] === 'cat-file' && args[1] === '-s'
        ? { status: 128, stdout: Buffer.alloc(0), stderr: Buffer.from('missing object') }
        : null
    )],
    ['malformed-size-probe', 'station-extract/object-size-invalid', (_command, args) => (
      args[0] === 'cat-file' && args[1] === '-s'
        ? { status: 0, stdout: Buffer.from('01\n'), stderr: Buffer.alloc(0) }
        : null
    )],
    ['probe-read-disagreement', 'station-extract/object-size-mismatch', (_command, args, options) => {
      if (args[0] !== 'cat-file' || args[1] !== 'blob') return null;
      const actual = spawnSync(_command, args, options);
      return { ...actual, stdout: actual.stdout.subarray(0, Math.max(0, actual.stdout.length - 1)) };
    }],
    ['process-output-overflow', 'station-extract/object-budget-exceeded', (_command, args) => {
      if (args[0] !== 'cat-file' || args[1] !== 'blob') return null;
      return {
        status: null,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        error: Object.assign(new Error('synthetic maxBuffer overflow'), { code: 'ENOBUFS' }),
      };
    }],
  ];
  for (const [name, code, intercept] of rows) {
    await assertOrchestratorHardFailure({ fixture, intercept, code, bundleRoot, before, label: name });
    cover(name);
  }
});

test('NUL tree framing preserves spaces, tabs, and newlines without record splitting', () => {
  const fixture = createGitFixture({ files: {
    'package.json': json({ name: 'root' }),
    'ordinary space.txt': 'space\n',
    'ordinary\ttab.txt': 'tab\n',
    'ordinary\nnewline.txt': 'newline\n',
  } });
  const reader = createGitObjectReader({
    repoRoot: fixture.root,
    repositoryUrl: fixture.repositoryUrl,
    revision: fixture.revision,
  });
  assert.equal(reader.inventory.length, 4);
  assert.deepEqual(reader.inventory.map(({ path: value }) => value).sort(), [
    'ordinary\nnewline.txt', 'ordinary\ttab.txt', 'ordinary space.txt', 'package.json',
  ].sort());
  assert.equal(reader.inventory.filter(({ path: value }) => value === 'ordinary\ttab.txt').length, 1);
  assert.equal(reader.inventory.filter(({ path: value }) => value === 'ordinary\nnewline.txt').length, 1);
  const run = runCli(fixture);
  assert.equal(run.result.status, 0, run.result.stderr.toString('utf8'));
  assert.equal(readBundle(run.bundleRoot).map.snapshot.mode, 'structural');
  cover('nul-safe-space-tab-newline-paths');
});

test('adversarial extraction matrix has no declared or executed omissions', () => {
  assert.equal(new Set(ADVERSARIAL_EXTRACTION_MATRIX).size, ADVERSARIAL_EXTRACTION_MATRIX.length);
  assert.deepEqual([...covered].sort(), [...ADVERSARIAL_EXTRACTION_MATRIX].sort());
});
