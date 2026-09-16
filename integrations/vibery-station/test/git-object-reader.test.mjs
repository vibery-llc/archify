import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  createGitFixture,
  gitObjectId,
  recordingRunner,
  runFixtureGit,
} from './helpers/git-fixture.mjs';
import { createGitObjectReader } from '../lib/git-object-reader.mjs';

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
