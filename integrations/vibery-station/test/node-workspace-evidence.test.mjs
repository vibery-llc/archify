import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { canonicalJsonBytes, sha256Hex } from '../lib/canonical-json.mjs';
import { deriveEvidenceId, deriveProjectId } from '../lib/identity.mjs';
import { createGitObjectReader } from '../lib/git-object-reader.mjs';
import { createGitFixture } from './helpers/git-fixture.mjs';

const REPOSITORY_URL = 'https://github.com/example/station-reader';
const REVISION = 'a'.repeat(40);
const TREE_OID = 'b'.repeat(40);
const MiB = 1024 * 1024;

async function loadBuilder() {
  try {
    return await import('../lib/node-workspace-evidence.mjs');
  } catch (error) {
    assert.fail(`node workspace evidence module must implement bounded immutable extraction: ${error.message}`);
  }
}

function oidFor(index) {
  return createHash('sha1').update(`blob-${index}`).digest('hex');
}

function jsonBytes(value, size) {
  const encoded = Buffer.from(`${JSON.stringify(value)}\n`);
  if (size === undefined) return encoded;
  assert.ok(encoded.length <= size);
  return Buffer.concat([encoded, Buffer.alloc(size - encoded.length, 0x20)]);
}

function fakeReader(files, {
  discovered,
  unsupportedPaths = [],
  statFailure,
  readFailure,
} = {}) {
  const calls = { stat: [], read: [] };
  const inventory = Object.entries(files).map(([filePath, specification], index) => {
    const config = Buffer.isBuffer(specification) || typeof specification === 'string'
      ? { bytes: specification }
      : specification;
    const bytes = Buffer.isBuffer(config.bytes) ? config.bytes : Buffer.from(config.bytes ?? '');
    return Object.freeze({
      mode: config.mode || '100644',
      type: config.type || 'blob',
      oid: config.oid || oidFor(index),
      path: filePath,
      pathBytes: Buffer.from(filePath),
      _bytes: bytes,
      _size: config.size ?? bytes.length,
    });
  }).sort((left, right) => Buffer.compare(left.pathBytes, right.pathBytes));
  const byOid = new Map(inventory.map((entry) => [entry.oid, entry]));
  const manifestCandidates = inventory.filter(({ path }) => path === 'package.json' || path.endsWith('/package.json'));
  const discoveredCount = discovered ?? manifestCandidates.length;
  const reader = {
    repository: Object.freeze({ url: REPOSITORY_URL, revision: REVISION, treeOid: TREE_OID, objectFormat: 'sha1' }),
    limits: Object.freeze({
      treeOutputBytes: 16 * MiB,
      manifestCount: 512,
      manifestBytes: MiB,
      totalManifestBytes: 8 * MiB,
    }),
    inventory: Object.freeze(inventory),
    unsupportedPaths: Object.freeze(unsupportedPaths),
    manifestCandidates: Object.freeze(manifestCandidates),
    manifestPolicy: Object.freeze({ discovered: discoveredCount, limit: 512, exceeded: discoveredCount > 512 }),
    statBlob(oid) {
      calls.stat.push(oid);
      if (statFailure) throw statFailure;
      const entry = byOid.get(oid);
      if (!entry) throw new Error('object unavailable');
      return entry._size;
    },
    readBlob(oid, options) {
      calls.read.push({ oid, ...options });
      if (readFailure) throw readFailure;
      const entry = byOid.get(oid);
      if (!entry) throw new Error('object unavailable');
      if (entry._bytes.length !== options.expectedSize) throw new Error('probe/read mismatch');
      return Buffer.from(entry._bytes);
    },
  };
  return { reader, calls, inventory };
}

function manifest(value, size) {
  return { bytes: jsonBytes(value, size) };
}

function fallbackCodes(result) {
  return result.value.analysis.fallback_reason_codes;
}

function assertWholeProjectFallback(result, expectedReasons) {
  assert.equal(result.value.analysis.detail_eligible, false);
  assert.deepEqual(fallbackCodes(result), [...expectedReasons].sort());
  assert.deepEqual(result.value.packages, []);
  assert.equal(result.value.analysis.represented_manifest_count, 0);
}

test('builds root-only evidence from one exact commit blob', async () => {
  const { buildStationEvidence } = await loadBuilder();
  const rootBytes = jsonBytes({
    name: '@example/root',
    private: true,
    dependencies: { '@example/external': '^1.0.0' },
  });
  const { reader, calls, inventory } = fakeReader({ 'package.json': rootBytes });
  const result = buildStationEvidence(reader);
  const root = inventory[0];
  const evidenceId = deriveEvidenceId('package.json', root.oid);

  assert.deepEqual(result.value.repository, {
    id: deriveProjectId('["github.com","standard","repository","example/station-reader"]'),
    url: REPOSITORY_URL,
    revision: REVISION,
    tree_oid: TREE_OID,
    object_format: 'sha1',
  });
  assert.deepEqual(result.value.files, [{
    id: evidenceId,
    kind: 'git-blob',
    path: 'package.json',
    git_oid: root.oid,
    sha256: sha256Hex(rootBytes),
    bytes: rootBytes.length,
  }]);
  assert.deepEqual(result.value.workspace, {
    kind: 'root-package',
    root_manifest_evidence_id: evidenceId,
    patterns: [],
    package_roots: ['.'],
  });
  assert.deepEqual(result.value.packages, [{
    root: '.',
    name: '@example/root',
    private: true,
    manifest_evidence_id: evidenceId,
    workspace_pattern: 'root-package',
    declared_dependencies: [{
      name: '@example/external',
      scopes: ['dependencies'],
    }],
  }]);
  assert.deepEqual(result.value.analysis, {
    detail_eligible: true,
    discovered_manifest_count: 1,
    selected_manifest_count: 1,
    represented_manifest_count: 1,
    fallback_reason_codes: [],
  });
  assert.deepEqual(result.bytes, canonicalJsonBytes(result.value));
  assert.deepEqual(calls.stat, [root.oid]);
  assert.deepEqual(calls.read, [{ oid: root.oid, expectedSize: rootBytes.length, integrityCeiling: MiB }]);
});

test('supports both npm workspace forms and exact plus terminal-segment patterns', async () => {
  const { buildStationEvidence } = await loadBuilder();
  for (const workspaces of [
    ['apps/api', 'packages/*'],
    { packages: ['packages/*', 'apps/api'] },
  ]) {
    const { reader } = fakeReader({
      'package.json': manifest({ name: '@example/root', private: true, workspaces }),
      'apps/api/package.json': manifest({ name: '@example/api' }),
      'packages/z/package.json': manifest({ name: '@example/z' }),
      'packages/a/package.json': manifest({ name: '@example/a' }),
      'packages/a/nested/package.json': manifest({ name: '@example/nested' }),
      'unselected/package.json': manifest({ name: '@example/unselected' }),
    });
    const { value } = buildStationEvidence(reader);
    assert.equal(value.workspace.kind, 'npm-workspaces');
    assert.deepEqual(value.workspace.patterns, ['apps/api', 'packages/*']);
    assert.deepEqual(value.workspace.package_roots, ['apps/api', 'packages/a', 'packages/z']);
    assert.deepEqual(value.files.map(({ path }) => path), [
      'apps/api/package.json',
      'package.json',
      'packages/a/package.json',
      'packages/z/package.json',
    ]);
    assert.deepEqual(value.packages.map(({ root, workspace_pattern: pattern }) => [root, pattern]), [
      ['.', 'root-package'],
      ['apps/api', 'apps/api'],
      ['packages/a', 'packages/*'],
      ['packages/z', 'packages/*'],
    ]);
  }
});

test('rejects unsupported, empty, ambiguous, overlapping, and colliding workspace selection as fallback', async () => {
  const { buildStationEvidence } = await loadBuilder();
  const cases = [
    {
      files: { 'package.json': manifest({ name: 'root', workspaces: ['packages/**'] }) },
      reasons: ['station-fallback/workspace-pattern-unsupported'],
    },
    {
      files: { 'package.json': manifest({ name: 'root', workspaces: ['packages/*'] }) },
      reasons: ['station-fallback/workspace-match-empty'],
    },
    {
      files: { 'package.json': manifest({ name: 'root', workspaces: ['packages/missing'] }) },
      reasons: ['station-fallback/workspace-manifest-missing'],
    },
    {
      files: {
        'package.json': manifest({ name: 'root', workspaces: ['packages/*', 'packages/a'] }),
        'packages/a/package.json': manifest({ name: 'a' }),
      },
      reasons: ['station-fallback/workspace-root-ambiguous'],
    },
    {
      files: {
        'package.json': manifest({ name: 'root', workspaces: ['packages', 'packages/a'] }),
        'packages/package.json': manifest({ name: 'packages' }),
        'packages/a/package.json': manifest({ name: 'a' }),
      },
      reasons: ['station-fallback/workspace-root-ambiguous'],
    },
    {
      files: {
        'package.json': manifest({ name: 'root', workspaces: ['packages/*'] }),
        'packages/Foo/package.json': manifest({ name: 'upper' }),
        'packages/foo/package.json': manifest({ name: 'lower' }),
      },
      reasons: ['station-fallback/path-collision'],
    },
    {
      files: {
        'package.json': manifest({ name: 'root', workspaces: ['packages/*'] }),
        'packages/café/package.json': manifest({ name: 'composed' }),
        'packages/café/package.json': manifest({ name: 'decomposed' }),
      },
      reasons: ['station-fallback/path-collision'],
    },
  ];
  for (const { files, reasons } of cases) {
    assertWholeProjectFallback(buildStationEvidence(fakeReader(files).reader), reasons);
  }
});

test('rejects malformed workspace declarations and invalid path segments', async () => {
  const { buildStationEvidence } = await loadBuilder();
  for (const workspaces of [
    'packages/*',
    {},
    { packages: 'packages/*' },
    { packages: ['packages/*'], extra: true },
    [],
  ]) {
    const result = buildStationEvidence(fakeReader({
      'package.json': manifest({ name: 'root', workspaces }),
    }).reader);
    assertWholeProjectFallback(result, ['station-fallback/workspace-shape-unsupported']);
  }
  for (const pattern of ['', '.', '..', '/packages', 'packages/', 'packages/../apps', 'packages//apps', 'packages/a*', 'packages/?']) {
    const result = buildStationEvidence(fakeReader({
      'package.json': manifest({ name: 'root', workspaces: [pattern] }),
    }).reader);
    assertWholeProjectFallback(result, ['station-fallback/workspace-pattern-unsupported']);
  }
});

test('classifies missing, non-regular, binary, invalid UTF-8, malformed JSON, and invalid manifest fields', async () => {
  const { buildStationEvidence } = await loadBuilder();
  assertWholeProjectFallback(buildStationEvidence(fakeReader({}).reader), [
    'station-fallback/root-manifest-missing',
  ]);
  assertWholeProjectFallback(buildStationEvidence(fakeReader({
    'package.json': { mode: '120000', bytes: 'target' },
  }).reader), ['station-fallback/workspace-manifest-non-regular']);

  const invalidCases = [
    [Buffer.from('{"name":"root"}\0'), 'station-fallback/workspace-manifest-binary'],
    [Buffer.from([0xff]), 'station-fallback/workspace-manifest-encoding-unsupported'],
    [Buffer.from('{not json}\n'), 'station-fallback/workspace-manifest-invalid'],
    [jsonBytes({ private: true }), 'station-fallback/workspace-manifest-invalid'],
    [jsonBytes({ name: 'root', private: 'yes' }), 'station-fallback/workspace-manifest-invalid'],
    [jsonBytes({ name: 'root', dependencies: [] }), 'station-fallback/workspace-manifest-invalid'],
    [jsonBytes({ name: 'root', dependencies: { dep: 1 } }), 'station-fallback/workspace-manifest-invalid'],
  ];
  for (const [bytes, reason] of invalidCases) {
    const result = buildStationEvidence(fakeReader({ 'package.json': bytes }).reader);
    assertWholeProjectFallback(result, [reason]);
    assert.equal(result.value.analysis.selected_manifest_count, 1);
  }
});

test('never emits whichever workspace manifests happened to parse', async () => {
  const { buildStationEvidence } = await loadBuilder();
  const { reader } = fakeReader({
    'package.json': manifest({ name: 'root', workspaces: ['packages/*'] }),
    'packages/good/package.json': manifest({ name: 'good' }),
    'packages/bad/package.json': Buffer.from('{bad json}\n'),
  });
  const result = buildStationEvidence(reader);
  assertWholeProjectFallback(result, ['station-fallback/workspace-manifest-invalid']);
  assert.equal(result.value.files.length, 3);
  assert.equal(result.value.analysis.selected_manifest_count, 3);
});

test('enforces manifest count and exact per-file boundaries before detail reads', async () => {
  const { buildStationEvidence } = await loadBuilder();
  const exactCount = fakeReader({ 'package.json': manifest({ name: 'root' }) }, { discovered: 512 });
  assert.equal(buildStationEvidence(exactCount.reader).value.analysis.detail_eligible, true);

  const excessCount = fakeReader({ 'package.json': manifest({ name: 'root' }) }, { discovered: 513 });
  assertWholeProjectFallback(buildStationEvidence(excessCount.reader), ['station-fallback/manifest-count-exceeded']);
  assert.equal(excessCount.calls.stat.length, 0);
  assert.equal(excessCount.calls.read.length, 0);

  const exactSize = fakeReader({ 'package.json': manifest({ name: 'root' }, MiB) });
  assert.equal(buildStationEvidence(exactSize.reader).value.analysis.detail_eligible, true);
  const excessSize = fakeReader({ 'package.json': { bytes: jsonBytes({ name: 'root' }), size: MiB + 1 } });
  assertWholeProjectFallback(buildStationEvidence(excessSize.reader), ['station-fallback/workspace-manifest-oversized']);
  assert.equal(excessSize.calls.read.length, 0);
});

test('enforces aggregate selected-byte boundaries without reading workspace details after excess is known', async () => {
  const { buildStationEvidence } = await loadBuilder();
  const makeFiles = (lastSize) => {
    const files = {
      'package.json': manifest({ name: 'root', workspaces: ['packages/*'] }, MiB),
    };
    for (let index = 0; index < 7; index += 1) {
      files[`packages/p${index}/package.json`] = manifest({ name: `p${index}` }, index === 6 ? lastSize : MiB);
    }
    return files;
  };
  const exact = fakeReader(makeFiles(MiB));
  assert.equal(buildStationEvidence(exact.reader).value.analysis.detail_eligible, true);
  const excess = fakeReader(makeFiles(MiB + 1));
  assertWholeProjectFallback(buildStationEvidence(excess.reader), [
    'station-fallback/selected-manifest-bytes-exceeded',
    'station-fallback/workspace-manifest-oversized',
  ]);
  assert.equal(excess.calls.read.length, 1, 'only the root declaration read needed to discover selection is allowed');
});

test('propagates stat, unavailable-object, and probe/read mismatch failures instead of converting them to fallback', async () => {
  const { buildStationEvidence } = await loadBuilder();
  const statFailure = new Error('synthetic stat integrity failure');
  assert.throws(
    () => buildStationEvidence(fakeReader({ 'package.json': manifest({ name: 'root' }) }, { statFailure }).reader),
    (error) => error === statFailure,
  );
  const readFailure = new Error('synthetic object unavailable');
  assert.throws(
    () => buildStationEvidence(fakeReader({ 'package.json': manifest({ name: 'root' }) }, { readFailure }).reader),
    (error) => error === readFailure,
  );
  assert.throws(
    () => buildStationEvidence(fakeReader({
      'package.json': { bytes: jsonBytes({ name: 'root' }), size: 1 },
    }).reader),
    /mismatch/i,
  );
});

test('emits exact scoped declarations, evidence links, and canonical ledger bytes', async () => {
  const { buildStationEvidence } = await loadBuilder();
  const files = {
    'package.json': manifest({
      name: '@example/root',
      private: true,
      workspaces: ['packages/*'],
      dependencies: { '@example/a': 'workspace:*', zed: '^1' },
      devDependencies: { '@example/a': 'workspace:*', alpha: '^2' },
      optionalDependencies: { zed: '^1' },
      peerDependencies: { '@example/a': 'workspace:*' },
      scripts: { postinstall: 'must-not-run' },
      imports: { '#internal': './src/index.js' },
    }),
    'packages/a/package.json': manifest({
      name: '@example/a',
      dependencies: { external: '^3' },
    }),
  };
  const { reader } = fakeReader(files);
  const result = buildStationEvidence(reader);

  assert.deepEqual(result.value.packages.map(({ root, name, private: privateValue, workspace_pattern, declared_dependencies }) => ({
    root,
    name,
    ...(privateValue === undefined ? {} : { private: privateValue }),
    workspace_pattern,
    declared_dependencies,
  })), [{
    root: '.',
    name: '@example/root',
    private: true,
    workspace_pattern: 'root-package',
    declared_dependencies: [
      { name: '@example/a', scopes: ['dependencies', 'devDependencies', 'peerDependencies'] },
      { name: 'alpha', scopes: ['devDependencies'] },
      { name: 'zed', scopes: ['dependencies', 'optionalDependencies'] },
    ],
  }, {
    root: 'packages/a',
    name: '@example/a',
    workspace_pattern: 'packages/*',
    declared_dependencies: [{ name: 'external', scopes: ['dependencies'] }],
  }]);

  const fileById = new Map(result.value.files.map((file) => [file.id, file]));
  for (const packageRecord of result.value.packages) {
    const file = fileById.get(packageRecord.manifest_evidence_id);
    assert.ok(file);
    assert.equal(file.path, packageRecord.root === '.' ? 'package.json' : `${packageRecord.root}/package.json`);
    assert.equal(file.id, deriveEvidenceId(file.path, file.git_oid));
    assert.equal(file.bytes, files[file.path].bytes.length);
    assert.equal(file.sha256, sha256Hex(files[file.path].bytes));
  }
  assert.deepEqual(result.bytes, canonicalJsonBytes(result.value));
  assert.equal(result.bytes.at(-1), 0x0a);
});

test('sorts package and declaration facts independently of source key and workspace order', async () => {
  const { buildStationEvidence } = await loadBuilder();
  const left = buildStationEvidence(fakeReader({
    'package.json': manifest({
      name: 'root',
      workspaces: ['z/*', 'a/*'],
      peerDependencies: { beta: '1', alpha: '1' },
      dependencies: { alpha: '1' },
    }),
    'a/one/package.json': manifest({ private: false, name: 'one', devDependencies: { zed: '1', alpha: '1' } }),
    'z/two/package.json': manifest({ name: 'two' }),
  }).reader).value;
  const right = buildStationEvidence(fakeReader({
    'package.json': manifest({
      dependencies: { alpha: '1' },
      peerDependencies: { alpha: '1', beta: '1' },
      workspaces: ['a/*', 'z/*'],
      name: 'root',
    }),
    'a/one/package.json': manifest({ devDependencies: { alpha: '1', zed: '1' }, name: 'one', private: false }),
    'z/two/package.json': manifest({ name: 'two', scripts: { test: 'ignored' } }),
  }).reader).value;

  assert.deepEqual(left.workspace, right.workspace);
  assert.deepEqual(left.packages, right.packages);
  assert.deepEqual(left.packages.map(({ root }) => root), ['.', 'a/one', 'z/two']);
  assert.deepEqual(left.packages[0].declared_dependencies, [
    { name: 'alpha', scopes: ['dependencies', 'peerDependencies'] },
    { name: 'beta', scopes: ['peerDependencies'] },
  ]);
});

test('duplicate package names and conflicting scoped declarations force explicit whole-project ambiguity fallback', async () => {
  const { buildStationEvidence } = await loadBuilder();
  const duplicate = buildStationEvidence(fakeReader({
    'package.json': manifest({ name: 'root', workspaces: ['packages/*'] }),
    'packages/a/package.json': manifest({ name: 'same' }),
    'packages/b/package.json': manifest({ name: 'same' }),
  }).reader);
  assertWholeProjectFallback(duplicate, ['station-fallback/package-name-ambiguous']);
  assert.equal(duplicate.value.files.length, 3);

  const conflict = buildStationEvidence(fakeReader({
    'package.json': manifest({
      name: 'root',
      dependencies: { dep: '^1' },
      peerDependencies: { dep: '^2' },
    }),
  }).reader);
  assertWholeProjectFallback(conflict, ['station-fallback/package-name-ambiguous']);
});

test('aggregate excess alone is fallback while the exact eight-MiB boundary remains detailed', async () => {
  const { buildStationEvidence } = await loadBuilder();
  const makeAggregate = (workspaceCount) => {
    const rootSize = 512;
    const remaining = 8 * MiB - rootSize;
    const baseSize = Math.floor(remaining / workspaceCount);
    const files = {
      'package.json': manifest({ name: 'root', workspaces: ['packages/*'] }, rootSize),
    };
    for (let index = 0; index < workspaceCount; index += 1) {
      const exactRemainder = index === workspaceCount - 1 ? remaining - (baseSize * (workspaceCount - 1)) : baseSize;
      files[`packages/p${index}/package.json`] = manifest({ name: `p${index}` }, exactRemainder);
    }
    return files;
  };
  const exact = buildStationEvidence(fakeReader(makeAggregate(8)).reader);
  assert.equal(exact.value.analysis.detail_eligible, true);
  const excessFiles = makeAggregate(8);
  excessFiles['packages/extra/package.json'] = manifest({ name: 'extra' }, 64);
  const excess = buildStationEvidence(fakeReader(excessFiles).reader);
  assertWholeProjectFallback(excess, ['station-fallback/selected-manifest-bytes-exceeded']);
});

test('integrates with the immutable Git object reader and excludes local or volatile fields', async () => {
  const { buildStationEvidence } = await loadBuilder();
  const fixture = createGitFixture({
    files: {
      'package.json': JSON.stringify({ name: 'root', workspaces: ['packages/*'] }),
      'packages/a/package.json': JSON.stringify({ name: 'a', dependencies: { external: '^1' } }),
    },
  });
  const reader = createGitObjectReader({
    repoRoot: fixture.root,
    repositoryUrl: fixture.repositoryUrl,
    revision: fixture.revision,
  });
  const result = buildStationEvidence(reader);
  assert.equal(result.value.analysis.detail_eligible, true);
  assert.deepEqual(result.value.workspace.package_roots, ['packages/a']);
  const serialized = result.bytes.toString('utf8');
  assert.doesNotMatch(serialized, /repoRoot|localRoot|absolute|branch|timestamp|stderr|runtime|process|scripts|imports/);
  assert.doesNotMatch(serialized, new RegExp(fixture.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
