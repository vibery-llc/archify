import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  commitFixture,
  createCommitFromTreeRecords,
  createGitFixture,
  gitObjectId,
  recordingRunner,
  repositoryState,
  runFixtureGit,
  writeBlobObject,
} from './helpers/git-fixture.mjs';
import { createGitObjectReader, GIT_OBJECT_LIMITS } from '../lib/git-object-reader.mjs';

function expectDiagnostic(code, operation) {
  assert.throws(operation, (error) => {
    assert.equal(error?.name, 'StationDiagnosticError');
    assert.equal(error?.code, code);
    assert.equal(error?.diagnostic?.code, code);
    return true;
  });
}

function openFixture(fixture, overrides = {}, testing = {}) {
  return createGitObjectReader({
    repoRoot: fixture.root,
    repositoryUrl: fixture.repositoryUrl,
    revision: fixture.revision,
    ...overrides,
  }, testing);
}

function bufferResult({ status = 0, stdout = '', stderr = '', error } = {}) {
  return {
    status,
    stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout),
    stderr: Buffer.isBuffer(stderr) ? stderr : Buffer.from(stderr),
    ...(error ? { error } : {}),
  };
}

test('accepts only the exact top-level SHA-1 commit and uses the immutable Git environment', () => {
  const fixture = createGitFixture();
  const calls = [];
  const reader = openFixture(fixture, {}, { processRunner: recordingRunner(calls) });

  assert.deepEqual(reader.repository, {
    url: 'https://github.com/example/station-reader',
    revision: fixture.revision,
    treeOid: gitObjectId(fixture.root, ['rev-parse', `${fixture.revision}^{tree}`]),
    objectFormat: 'sha1',
  });
  assert.deepEqual(calls.map(({ command, args }) => [command, args]), [
    ['git', ['rev-parse', '--show-toplevel']],
    ['git', ['remote', 'get-url', 'origin']],
    ['git', ['rev-parse', '--show-object-format']],
    ['git', ['cat-file', '-t', fixture.revision]],
    ['git', ['cat-file', '-e', `${fixture.revision}^{commit}`]],
    ['git', ['rev-parse', `${fixture.revision}^{tree}`]],
    ['git', ['ls-tree', '-rz', '--full-tree', fixture.revision]],
  ]);
  for (const { options } of calls) {
    assert.equal(options.cwd, fixture.root);
    assert.equal(options.encoding, null);
    assert.equal(options.shell, false);
    assert.ok(Number.isSafeInteger(options.maxBuffer) && options.maxBuffer > 0);
    assert.deepEqual({
      GIT_NO_REPLACE_OBJECTS: options.env.GIT_NO_REPLACE_OBJECTS,
      GIT_NO_LAZY_FETCH: options.env.GIT_NO_LAZY_FETCH,
      GIT_OPTIONAL_LOCKS: options.env.GIT_OPTIONAL_LOCKS,
      GIT_TERMINAL_PROMPT: options.env.GIT_TERMINAL_PROMPT,
      GIT_CONFIG_NOSYSTEM: options.env.GIT_CONFIG_NOSYSTEM,
      LC_ALL: options.env.LC_ALL,
      GIT_PAGER: options.env.GIT_PAGER,
      PAGER: options.env.PAGER,
    }, {
      GIT_NO_REPLACE_OBJECTS: '1',
      GIT_NO_LAZY_FETCH: '1',
      GIT_OPTIONAL_LOCKS: '0',
      GIT_TERMINAL_PROMPT: '0',
      GIT_CONFIG_NOSYSTEM: '1',
      LC_ALL: 'C',
      GIT_PAGER: 'cat',
      PAGER: 'cat',
    });
    assert.equal(options.env.SYNTHETIC_CALLER_SECRET, undefined);
  }
});

test('normalizes equivalent standard GitHub and Gitee transport spellings', () => {
  for (const [authored, origin, expected] of [
    ['https://github.com/Example/Station-Reader.git/', 'git@github.com:example/station-reader.git', 'https://github.com/example/station-reader'],
    ['ssh://git@github.com/Example/Station-Reader.git', 'https://github.com/example/station-reader', 'https://github.com/example/station-reader'],
    ['git@github.com:Example/Station-Reader.git', 'ssh://git@github.com/example/station-reader', 'https://github.com/example/station-reader'],
    ['https://gitee.com/Example/Station-Reader.git/', 'git@gitee.com:Example/Station-Reader.git', 'https://gitee.com/Example/Station-Reader'],
    ['ssh://git@gitee.com/Example/Station-Reader.git', 'https://gitee.com/Example/Station-Reader', 'https://gitee.com/Example/Station-Reader'],
    ['git@gitee.com:Example/Station-Reader.git', 'ssh://git@gitee.com/Example/Station-Reader', 'https://gitee.com/Example/Station-Reader'],
  ]) {
    const fixture = createGitFixture({ origin });
    assert.equal(openFixture(fixture, { repositoryUrl: authored }).repository.url, expected);
  }
});

test('retains semantically distinct transport, port, and path-kind identities', () => {
  for (const url of [
    'ssh://git@git.internal:2222/Platform/repo.git',
    'git@git.internal:Platform/repo.git',
    'git@git.internal:/Platform/repo.git',
  ]) {
    const fixture = createGitFixture({ origin: url });
    assert.equal(openFixture(fixture, { repositoryUrl: url }).repository.url, url);
  }
});

test('rejects mutable, abbreviated, malformed, and non-commit revisions before trust is established', () => {
  const fixture = createGitFixture();
  const blobOid = runFixtureGit(fixture.root, ['hash-object', '-w', '--stdin'], { input: 'blob bytes' });
  const treeOid = gitObjectId(fixture.root, ['rev-parse', `${fixture.revision}^{tree}`]);
  for (const revision of ['HEAD', 'main', 'v1', fixture.revision.slice(0, 12), 'g'.repeat(40), blobOid, treeOid]) {
    expectDiagnostic(
      revision === blobOid || revision === treeOid ? 'station-extract/revision-unavailable' : 'station-extract/revision-invalid',
      () => openFixture(fixture, { revision }),
    );
  }
});

test('rejects a full annotated-tag object id by checking the named object type directly', () => {
  const fixture = createGitFixture();
  runFixtureGit(fixture.root, ['tag', '-a', 'reader-v1', '-m', 'annotated fixture tag']);
  const tagOid = gitObjectId(fixture.root, ['rev-parse', 'reader-v1']);
  assert.equal(gitObjectId(fixture.root, ['cat-file', '-t', tagOid]), 'tag');
  expectDiagnostic('station-extract/revision-unavailable', () => openFixture(fixture, { revision: tagOid }));
});

test('rejects unreadable and nested roots without leaking absolute paths', () => {
  const fixture = createGitFixture({ files: { 'nested/package.json': '{}\n' } });
  const nested = path.join(fixture.root, 'nested');
  expectDiagnostic('station-extract/root-not-top-level', () => openFixture(fixture, { repoRoot: nested }));
  const missing = path.join(fixture.root, 'does-not-exist');
  assert.throws(() => openFixture(fixture, { repoRoot: missing }), (error) => {
    assert.equal(error.code, 'station-extract/root-unreadable');
    assert.doesNotMatch(JSON.stringify(error.diagnostic), new RegExp(fixture.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    return true;
  });
});

test('rejects malformed or credentialed authored URLs and redacts mismatched origins', () => {
  const fixture = createGitFixture();
  for (const repositoryUrl of [
    'https://user:SYNTHETIC_URL_SECRET@github.com/example/station-reader',
    'https://github.com/example/../station-reader',
    'file:///tmp/repository',
    'not a URL',
  ]) {
    assert.throws(() => openFixture(fixture, { repositoryUrl }), (error) => {
      assert.equal(error.code, 'station-extract/url-invalid');
      assert.doesNotMatch(JSON.stringify(error.diagnostic), /SYNTHETIC_URL_SECRET/);
      return true;
    });
  }

  runFixtureGit(fixture.root, ['remote', 'set-url', 'origin', 'https://user:SYNTHETIC_ORIGIN_SECRET@github.com/example/other.git']);
  assert.throws(() => openFixture(fixture), (error) => {
    assert.equal(error.code, 'station-extract/origin-mismatch');
    assert.doesNotMatch(JSON.stringify(error.diagnostic), /SYNTHETIC_ORIGIN_SECRET/);
    assert.match(error.diagnostic.evidence.localOrigin, /^https:\/\/REDACTED@/);
    return true;
  });
});

test('rejects non-SHA-1 object formats and unavailable commits without exposing process output', () => {
  const fixture = createGitFixture();
  const formatRunner = recordingRunner([], (_command, args) => {
    if (args.join(' ') === 'rev-parse --show-object-format') return bufferResult({ stdout: 'sha256\n' });
    return null;
  });
  expectDiagnostic('station-extract/object-format-unsupported', () => openFixture(fixture, {}, { processRunner: formatRunner }));

  const missingRunner = recordingRunner([], (_command, args) => {
    if (args[0] === 'cat-file' && args[1] === '-t') {
      return bufferResult({ status: 128, stderr: `SYNTHETIC_GIT_SECRET ${fixture.root}\n` });
    }
    return null;
  });
  assert.throws(() => openFixture(fixture, {}, { processRunner: missingRunner }), (error) => {
    assert.equal(error.code, 'station-extract/revision-unavailable');
    assert.doesNotMatch(JSON.stringify(error.diagnostic), /SYNTHETIC_GIT_SECRET/);
    assert.doesNotMatch(JSON.stringify(error.diagnostic), new RegExp(fixture.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    return true;
  });
});

test('maps process launch failure to a stable Git-unavailable diagnostic', () => {
  const fixture = createGitFixture();
  const error = Object.assign(new Error('SYNTHETIC launch detail'), { code: 'ENOENT' });
  const processRunner = () => bufferResult({ status: null, error });
  assert.throws(() => openFixture(fixture, {}, { processRunner }), (observed) => {
    assert.equal(observed.code, 'station-extract/git-unavailable');
    assert.doesNotMatch(JSON.stringify(observed.diagnostic), /SYNTHETIC launch detail/);
    return true;
  });
});

function encodedTreeRecord({ mode = '100644', type = 'blob', oid = '1'.repeat(40), pathBytes }) {
  return Buffer.concat([
    Buffer.from(`${mode} ${type} ${oid}\t`, 'ascii'),
    pathBytes,
    Buffer.from([0]),
  ]);
}

function treeRunner(fixture, replacement, calls = []) {
  return recordingRunner(calls, (_command, args) => {
    if (args[0] === 'ls-tree') return replacement;
    return null;
  });
}

test('enumerates one complete NUL-delimited inventory with exact modes and unusual paths', () => {
  const fixture = createGitFixture();
  const ordinaryBlob = writeBlobObject(fixture.root, Buffer.from('ordinary bytes'));
  const symlinkBlob = writeBlobObject(fixture.root, Buffer.from('ordinary.txt'));
  const synthetic = createCommitFromTreeRecords(fixture.root, [
    { mode: '100644', type: 'blob', oid: ordinaryBlob, pathBytes: Buffer.from('ordinary.txt') },
    { mode: '100755', type: 'blob', oid: ordinaryBlob, pathBytes: Buffer.from('run script.sh') },
    { mode: '100644', type: 'blob', oid: ordinaryBlob, pathBytes: Buffer.from('tab\tname.txt') },
    { mode: '100644', type: 'blob', oid: ordinaryBlob, pathBytes: Buffer.from('line\nname.txt') },
    { mode: '120000', type: 'blob', oid: symlinkBlob, pathBytes: Buffer.from('manifest-link') },
    { mode: '160000', type: 'commit', oid: fixture.revision, pathBytes: Buffer.from('vendor-module') },
  ]);
  const reader = openFixture(fixture, { revision: synthetic.revision });

  assert.deepEqual(reader.inventory.map(({ mode, type, path }) => ({ mode, type, path })), [
    { mode: '100644', type: 'blob', path: 'line\nname.txt' },
    { mode: '120000', type: 'blob', path: 'manifest-link' },
    { mode: '100644', type: 'blob', path: 'ordinary.txt' },
    { mode: '100755', type: 'blob', path: 'run script.sh' },
    { mode: '100644', type: 'blob', path: 'tab\tname.txt' },
    { mode: '160000', type: 'commit', path: 'vendor-module' },
  ]);
  assert.deepEqual(reader.unsupportedPaths.map(({ code, path }) => ({ code, path })), [
    { code: 'station-extract/path-control-unsupported', path: 'line\nname.txt' },
    { code: 'station-extract/path-control-unsupported', path: 'tab\tname.txt' },
  ]);
  assert.ok(reader.inventory.every(({ pathBytes }) => Buffer.isBuffer(pathBytes)));
});

test('classifies invalid UTF-8, unsafe shapes, and case/NFC aliases without dropping inventory entries', () => {
  const fixture = createGitFixture();
  const oid = writeBlobObject(fixture.root, Buffer.from('{}\n'));
  const records = [
    encodedTreeRecord({ oid, pathBytes: Buffer.from([0xff, 0x2e, 0x6a, 0x73, 0x6f, 0x6e]) }),
    encodedTreeRecord({ oid, pathBytes: Buffer.from('/absolute/package.json') }),
    encodedTreeRecord({ oid, pathBytes: Buffer.from('../parent/package.json') }),
    encodedTreeRecord({ oid, pathBytes: Buffer.from('.git/config') }),
    encodedTreeRecord({ oid, pathBytes: Buffer.from('Foo/package.json') }),
    encodedTreeRecord({ oid, pathBytes: Buffer.from('foo/package.json') }),
    encodedTreeRecord({ oid, pathBytes: Buffer.from('café/package.json') }),
    encodedTreeRecord({ oid, pathBytes: Buffer.from('café/package.json') }),
  ];
  const reader = openFixture(fixture, {}, {
    processRunner: treeRunner(fixture, bufferResult({ stdout: Buffer.concat(records) })),
  });
  assert.equal(reader.inventory.length, records.length);
  assert.equal(reader.inventory[0].path, null);
  assert.deepEqual(new Set(reader.unsupportedPaths.map(({ code }) => code)), new Set([
    'station-extract/path-encoding-unsupported',
    'station-extract/path-shape-unsupported',
    'station-extract/path-case-collision',
    'station-extract/path-nfc-collision',
  ]));
});

test('rejects malformed, unterminated, duplicate, or internally inconsistent tree protocol', () => {
  const fixture = createGitFixture();
  const valid = encodedTreeRecord({ pathBytes: Buffer.from('package.json') });
  const malformedCases = [
    valid.subarray(0, -1),
    Buffer.from('not a tree record\0'),
    encodedTreeRecord({ mode: '100644', type: 'tree', pathBytes: Buffer.from('bad-mode-type') }),
    encodedTreeRecord({ mode: '100600', type: 'blob', pathBytes: Buffer.from('bad-mode') }),
    encodedTreeRecord({ oid: 'z'.repeat(40), pathBytes: Buffer.from('bad-oid') }),
    Buffer.concat([valid, valid]),
    Buffer.concat([valid, Buffer.from([0])]),
  ];
  for (const stdout of malformedCases) {
    expectDiagnostic('station-extract/tree-protocol-invalid', () => openFixture(fixture, {}, {
      processRunner: treeRunner(fixture, bufferResult({ stdout })),
    }));
  }
});

test('rejects tree output overflow and unreadable enumeration as hard failures', () => {
  const fixture = createGitFixture();
  const calls = [];
  expectDiagnostic('station-extract/tree-budget-exceeded', () => openFixture(fixture, {}, {
    processRunner: treeRunner(fixture, bufferResult({ stdout: Buffer.alloc(GIT_OBJECT_LIMITS.treeOutputBytes + 1) }), calls),
  }));
  const treeCall = calls.find(({ args }) => args[0] === 'ls-tree');
  assert.equal(treeCall.options.maxBuffer, GIT_OBJECT_LIMITS.treeOutputBytes);

  const overflow = Object.assign(new Error('stdout maxBuffer length exceeded'), { code: 'ENOBUFS' });
  expectDiagnostic('station-extract/tree-budget-exceeded', () => openFixture(fixture, {}, {
    processRunner: treeRunner(fixture, bufferResult({ status: null, error: overflow })),
  }));
  expectDiagnostic('station-extract/tree-unreadable', () => openFixture(fixture, {}, {
    processRunner: treeRunner(fixture, bufferResult({ status: 128, stderr: 'missing tree' })),
  }));
});

test('returns every discovered manifest and explicitly reports count-policy fallback', () => {
  const fixture = createGitFixture();
  const records = [];
  for (let index = 0; index <= GIT_OBJECT_LIMITS.manifestCount; index += 1) {
    records.push(encodedTreeRecord({ pathBytes: Buffer.from(`packages/p${String(index).padStart(3, '0')}/package.json`) }));
  }
  const reader = openFixture(fixture, {}, {
    processRunner: treeRunner(fixture, bufferResult({ stdout: Buffer.concat(records) })),
  });
  assert.equal(reader.inventory.length, GIT_OBJECT_LIMITS.manifestCount + 1);
  assert.equal(reader.manifestCandidates.length, GIT_OBJECT_LIMITS.manifestCount + 1);
  assert.deepEqual(reader.manifestPolicy, {
    discovered: GIT_OBJECT_LIMITS.manifestCount + 1,
    limit: GIT_OBJECT_LIMITS.manifestCount,
    exceeded: true,
  });
  assert.deepEqual(GIT_OBJECT_LIMITS, {
    treeOutputBytes: 16 * 1024 * 1024,
    manifestCount: 512,
    manifestBytes: 1024 * 1024,
    totalManifestBytes: 8 * 1024 * 1024,
  });
});

test('probes exact blob sizes and reads exact object bytes without replacement influence', () => {
  const fixture = createGitFixture();
  const reader = openFixture(fixture);
  const manifest = reader.manifestCandidates.find(({ path: candidate }) => candidate === 'package.json');
  const original = Buffer.from('{"name":"station-reader-fixture"}\n');
  assert.equal(reader.statBlob(manifest.oid), original.length);
  assert.deepEqual(reader.readBlob(manifest.oid, {
    expectedSize: original.length,
    integrityCeiling: GIT_OBJECT_LIMITS.manifestBytes,
  }), original);

  const replacement = writeBlobObject(fixture.root, Buffer.from('replacement bytes'));
  runFixtureGit(fixture.root, ['replace', manifest.oid, replacement]);
  const replacedReader = openFixture(fixture);
  assert.equal(replacedReader.statBlob(manifest.oid), original.length);
  assert.deepEqual(replacedReader.readBlob(manifest.oid, {
    expectedSize: original.length,
    integrityCeiling: GIT_OBJECT_LIMITS.manifestBytes,
  }), original);
});

test('rejects malformed probes, probe/read disagreement, overflow, and unavailable objects', () => {
  const fixture = createGitFixture();
  const base = openFixture(fixture);
  const oid = base.manifestCandidates[0].oid;
  for (const stdout of ['01\n', '-1\n', '1.0\n', ' 1\n', `${Number.MAX_SAFE_INTEGER}0\n`]) {
    const reader = openFixture(fixture, {}, {
      processRunner: recordingRunner([], (_command, args) => args[0] === 'cat-file' && args[1] === '-s'
        ? bufferResult({ stdout }) : null),
    });
    expectDiagnostic('station-extract/object-size-invalid', () => reader.statBlob(oid));
  }

  expectDiagnostic('station-extract/object-size-mismatch', () => base.readBlob(oid, {
    expectedSize: 1,
    integrityCeiling: GIT_OBJECT_LIMITS.manifestBytes,
  }));
  expectDiagnostic('station-extract/object-budget-exceeded', () => base.readBlob(oid, {
    expectedSize: GIT_OBJECT_LIMITS.manifestBytes + 1,
    integrityCeiling: GIT_OBJECT_LIMITS.manifestBytes,
  }));

  const overflow = Object.assign(new Error('stdout maxBuffer length exceeded'), { code: 'ENOBUFS' });
  const overflowReader = openFixture(fixture, {}, {
    processRunner: recordingRunner([], (_command, args) => args[0] === 'cat-file' && args[1] === 'blob'
      ? bufferResult({ status: null, error: overflow }) : null),
  });
  expectDiagnostic('station-extract/object-budget-exceeded', () => overflowReader.readBlob(oid, {
    expectedSize: 10,
    integrityCeiling: 10,
  }));

  const missingOid = 'f'.repeat(40);
  const synthetic = createCommitFromTreeRecords(fixture.root, [
    { mode: '100644', type: 'blob', oid: missingOid, pathBytes: Buffer.from('package.json') },
  ], { allowMissing: true });
  const missingReader = openFixture(fixture, { revision: synthetic.revision });
  expectDiagnostic('station-extract/object-unavailable', () => missingReader.statBlob(missingOid));
  expectDiagnostic('station-extract/object-unavailable', () => missingReader.readBlob(missingOid, {
    expectedSize: 1,
    integrityCeiling: 1,
  }));
});

test('reads commit A while the worktree is on B and leaves HEAD, index, and dirty state untouched', () => {
  const fixture = createGitFixture();
  const revisionA = fixture.revision;
  const revisionB = commitFixture(fixture.root, {
    'package.json': '{"name":"fixture-b"}\n',
    'only-b.txt': 'B\n',
  }, 'fixture B');
  assert.notEqual(revisionB, revisionA);
  fs.writeFileSync(path.join(fixture.root, 'package.json'), 'dirty B\n');
  fs.rmSync(path.join(fixture.root, 'only-b.txt'));
  fs.writeFileSync(path.join(fixture.root, 'untracked-package.json'), '{}\n');
  const before = repositoryState(fixture.root);
  const calls = [];
  const reader = openFixture(fixture, { revision: revisionA }, { processRunner: recordingRunner(calls) });
  const manifest = reader.manifestCandidates[0];
  const size = reader.statBlob(manifest.oid);
  assert.deepEqual(reader.readBlob(manifest.oid, { expectedSize: size, integrityCeiling: GIT_OBJECT_LIMITS.manifestBytes }),
    Buffer.from('{"name":"station-reader-fixture"}\n'));
  const after = repositoryState(fixture.root);
  assert.equal(after.head, before.head);
  assert.deepEqual(after.index, before.index);
  assert.deepEqual(after.status, before.status);
  assert.ok(calls.every(({ args }) => ['rev-parse', 'remote', 'cat-file', 'ls-tree'].includes(args[0])));
  assert.ok(calls.every(({ options }) => options.env.GIT_NO_LAZY_FETCH === '1'));
});
