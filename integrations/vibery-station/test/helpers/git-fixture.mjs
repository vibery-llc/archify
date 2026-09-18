import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function commandFailure(args, result) {
  const detail = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : String(result.stderr || '');
  throw new Error(`git ${args.join(' ')} failed (${result.status}): ${detail}`);
}

export function runFixtureGit(root, args, { encoding = 'utf8', input } = {}) {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding,
    input,
    shell: false,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
  });
  if (result.error || result.status !== 0) commandFailure(args, result);
  return encoding === null ? result.stdout : result.stdout.trim();
}

export function createGitFixture({
  origin = 'git@github.com:Example/Station-Reader.git',
  files = { 'package.json': '{"name":"station-reader-fixture"}\n' },
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'station-git-reader-'));
  runFixtureGit(root, ['init', '-q']);
  runFixtureGit(root, ['config', 'user.name', 'Station Tests']);
  runFixtureGit(root, ['config', 'user.email', 'station@example.test']);
  runFixtureGit(root, ['remote', 'add', 'origin', origin]);
  writeFixtureFiles(root, files);
  runFixtureGit(root, ['add', '--all']);
  runFixtureGit(root, ['commit', '-q', '-m', 'fixture A']);
  return {
    root,
    origin,
    repositoryUrl: 'https://github.com/example/station-reader',
    revision: runFixtureGit(root, ['rev-parse', 'HEAD']),
  };
}

export function createInvalidUtf8BackslashWorkspaceFixture() {
  const fixture = createGitFixture({ files: {
    'package.json': '{"name":"root","workspaces":["packages/*"]}\n',
    'packages/valid/package.json': '{"name":"valid"}\n',
  } });
  const hostilePathBytes = Buffer.from('ff5c7061636b6167652e6a736f6e', 'hex');
  const hostileOid = writeBlobObject(fixture.root, Buffer.from('{"name":"hostile"}\n'));
  const synthetic = createCommitFromTreeRecords(fixture.root, [
    {
      mode: '100644',
      type: 'blob',
      oid: gitObjectId(fixture.root, ['rev-parse', `${fixture.revision}:package.json`]),
      pathBytes: Buffer.from('package.json'),
    },
    {
      mode: '040000',
      type: 'tree',
      oid: gitObjectId(fixture.root, ['rev-parse', `${fixture.revision}:packages`]),
      pathBytes: Buffer.from('packages'),
    },
    { mode: '100644', type: 'blob', oid: hostileOid, pathBytes: hostilePathBytes },
  ], { message: 'invalid UTF-8 raw-backslash manifest' });
  return { ...fixture, revision: synthetic.revision, hostilePathBytes };
}

export function createPromisorFixture({
  origin = 'git@github.com:Example/Station-Reader.git',
  files = { 'package.json': '{"name":"station-reader-fixture"}\n' },
} = {}) {
  const source = createGitFixture({ origin, files });
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'station-git-promisor-'));
  const remote = path.join(parent, 'remote.git');
  const root = path.join(parent, 'partial');
  runFixtureGit(source.root, ['clone', '--quiet', '--bare', source.root, remote]);
  runFixtureGit(remote, ['config', 'uploadpack.allowFilter', 'true']);
  runFixtureGit(remote, ['config', 'uploadpack.allowAnySHA1InWant', 'true']);
  runFixtureGit(source.root, [
    'clone', '--quiet', '--no-checkout', '--filter=blob:none', pathToFileURL(remote).href, root,
  ]);
  runFixtureGit(root, ['remote', 'rename', 'origin', 'promisor-source']);
  runFixtureGit(root, ['remote', 'add', 'origin', origin]);
  return {
    root,
    origin,
    repositoryUrl: source.repositoryUrl,
    revision: source.revision,
    sourceRoot: source.root,
    remote,
  };
}

export function writeFixtureFiles(root, files) {
  for (const [relativePath, value] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    if (value === null) {
      fs.rmSync(target, { force: true, recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (typeof value === 'object' && value !== null && Object.hasOwn(value, 'symlink')) {
      fs.symlinkSync(value.symlink, target);
    } else {
      fs.writeFileSync(target, value);
    }
  }
}

export function commitFixture(root, files, message = 'fixture change') {
  writeFixtureFiles(root, files);
  runFixtureGit(root, ['add', '--all']);
  runFixtureGit(root, ['commit', '-q', '-m', message]);
  return runFixtureGit(root, ['rev-parse', 'HEAD']);
}

export function repositoryState(root) {
  return {
    head: runFixtureGit(root, ['rev-parse', 'HEAD']),
    index: fs.readFileSync(path.join(root, '.git', 'index')),
    status: runFixtureGit(root, ['status', '--porcelain=v1', '-z'], { encoding: null }),
  };
}

export function recordingRunner(calls, intercept) {
  return (command, args, options) => {
    calls.push({ command, args: [...args], options: { ...options, env: { ...options.env } } });
    const replacement = intercept?.(command, args, options);
    if (replacement) return replacement;
    return spawnSync(command, args, options);
  };
}

export function gitObjectId(root, args) {
  return runFixtureGit(root, args);
}

export function writeBlobObject(root, bytes) {
  return runFixtureGit(root, ['hash-object', '-w', '--stdin'], { input: bytes });
}

export function createCommitFromTreeRecords(root, records, { allowMissing = false, message = 'synthetic tree' } = {}) {
  const ordered = [...records].sort((left, right) => Buffer.compare(left.pathBytes, right.pathBytes));
  const chunks = [];
  for (const record of ordered) {
    chunks.push(Buffer.from(`${record.mode} ${record.type} ${record.oid}\t`, 'ascii'));
    chunks.push(record.pathBytes);
    chunks.push(Buffer.from([0]));
  }
  const args = ['mktree', '-z', ...(allowMissing ? ['--missing'] : [])];
  const treeOid = runFixtureGit(root, args, { encoding: null, input: Buffer.concat(chunks) }).toString('utf8').trim();
  const revision = runFixtureGit(root, ['commit-tree', treeOid], { input: `${message}\n` });
  return { revision, treeOid };
}
