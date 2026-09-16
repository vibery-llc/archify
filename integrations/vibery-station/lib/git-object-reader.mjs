import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseRepositoryRemote, redactRepositoryRemote } from '../../../archify/renderers/shared/repository-location.mjs';
import { throwStationDiagnostic } from './diagnostics.mjs';

const FULL_OID_RE = /^[a-f0-9]{40}$/;
const COMMAND_OUTPUT_LIMIT = 16 * 1024 * 1024;

function fail(code, message, { evidence = {}, supportedFixes = [] } = {}) {
  throwStationDiagnostic({
    code,
    severity: 'error',
    message,
    subject: { surface: 'git-object-reader' },
    evidence,
    supportedFixes,
  });
}

function minimalGitEnvironment() {
  const inherited = {};
  for (const key of ['PATH', 'SystemRoot', 'COMSPEC', 'PATHEXT']) {
    if (typeof process.env[key] === 'string') inherited[key] = process.env[key];
  }
  return {
    ...inherited,
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_NO_LAZY_FETCH: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_PAGER: 'cat',
    PAGER: 'cat',
    LC_ALL: 'C',
  };
}

function processBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  return Buffer.from(value || '');
}

function stripLineEnding(buffer) {
  let end = buffer.length;
  if (end > 0 && buffer[end - 1] === 0x0a) end -= 1;
  if (end > 0 && buffer[end - 1] === 0x0d) end -= 1;
  return buffer.subarray(0, end).toString('utf8');
}

function stationRepositoryUrl(location) {
  if (location.endpoint === 'standard' && location.provider === 'github') {
    return `https://github.com/${location.path.toLowerCase()}`;
  }
  if (location.endpoint === 'standard' && location.provider === 'gitee') {
    return `https://gitee.com/${location.path}`;
  }
  return location.url;
}

function makeGitRunner(cwd, processRunner) {
  return (args, { maxBuffer = COMMAND_OUTPUT_LIMIT } = {}) => {
    const result = processRunner('git', args, {
      cwd,
      encoding: null,
      shell: false,
      maxBuffer,
      env: minimalGitEnvironment(),
    });
    if (result?.error?.code === 'ENOENT') {
      fail('station-extract/git-unavailable', 'Git is unavailable for local object verification.', {
        supportedFixes: ['install Git and make it available on PATH'],
      });
    }
    return {
      ...result,
      stdout: processBuffer(result?.stdout),
      stderr: processBuffer(result?.stderr),
    };
  };
}

function requiredGitValue(runGit, args, code, message) {
  const result = runGit(args);
  if (result.error || result.status !== 0) fail(code, message);
  return stripLineEnding(result.stdout);
}

function resolveTopLevel(repoRoot) {
  if (typeof repoRoot !== 'string' || !repoRoot) {
    fail('station-extract/root-unreadable', 'Repository root must identify one readable local directory.', {
      supportedFixes: ['pass one readable local repository top-level directory'],
    });
  }
  try {
    return fs.realpathSync(path.resolve(repoRoot));
  } catch {
    fail('station-extract/root-unreadable', 'Repository root must identify one readable local directory.', {
      supportedFixes: ['pass one readable local repository top-level directory'],
    });
  }
}

function validateRepositoryIdentity(runGit, repositoryUrl) {
  const authored = parseRepositoryRemote(repositoryUrl, { authored: true });
  if (!authored) {
    fail('station-extract/url-invalid', 'Repository URL must be a credential-free HTTP(S) or Git SSH identity.', {
      supportedFixes: ['pass a credential-free repository URL without query, fragment, or dot segments'],
    });
  }
  const originValue = requiredGitValue(
    runGit,
    ['remote', 'get-url', 'origin'],
    'station-extract/origin-mismatch',
    'Repository origin is unavailable or does not match the authored identity.',
  );
  const origin = parseRepositoryRemote(originValue);
  if (!origin || origin.identity !== authored.identity) {
    fail('station-extract/origin-mismatch', 'Repository origin does not match the authored identity.', {
      evidence: { localOrigin: redactRepositoryRemote(originValue) },
      supportedFixes: ['use the matching local repository or correct the authored repository URL'],
    });
  }
  return stationRepositoryUrl(authored);
}

function validateRevision(runGit, revisionInput) {
  if (typeof revisionInput !== 'string' || !/^[a-f0-9]{40}$/i.test(revisionInput)) {
    fail('station-extract/revision-invalid', 'Revision must be one full 40-character SHA-1 object ID.', {
      supportedFixes: ['pass one full commit object ID instead of a branch, tag, abbreviation, or expression'],
    });
  }
  const revision = revisionInput.toLowerCase();
  const type = runGit(['cat-file', '-t', revision]);
  if (type.error || type.status !== 0 || stripLineEnding(type.stdout) !== 'commit') {
    fail('station-extract/revision-unavailable', 'Revision must name a locally available commit object directly.', {
      evidence: { revision },
      supportedFixes: ['make the exact commit object available in the local repository'],
    });
  }
  const commit = runGit(['cat-file', '-e', `${revision}^{commit}`]);
  if (commit.error || commit.status !== 0) {
    fail('station-extract/revision-unavailable', 'Revision commit is not completely available in the local object database.', {
      evidence: { revision },
      supportedFixes: ['make the exact commit and its objects available locally'],
    });
  }
  return revision;
}

export function createGitObjectReader({ repoRoot, repositoryUrl, revision: revisionInput } = {}, { processRunner = spawnSync } = {}) {
  if (typeof processRunner !== 'function') throw new TypeError('processRunner must be a function.');
  const realRoot = resolveTopLevel(repoRoot);
  const runGit = makeGitRunner(realRoot, processRunner);
  const gitRootValue = requiredGitValue(
    runGit,
    ['rev-parse', '--show-toplevel'],
    'station-extract/root-not-top-level',
    'Repository root must be an exact Git top-level directory.',
  );
  let gitRoot;
  try {
    gitRoot = fs.realpathSync(gitRootValue);
  } catch {
    fail('station-extract/root-not-top-level', 'Repository root must be an exact Git top-level directory.', {
      supportedFixes: ['pass the physical Git top-level directory'],
    });
  }
  if (gitRoot !== realRoot) {
    fail('station-extract/root-not-top-level', 'Repository root must be an exact Git top-level directory.', {
      supportedFixes: ['pass the physical Git top-level directory'],
    });
  }

  const url = validateRepositoryIdentity(runGit, repositoryUrl);
  const objectFormat = requiredGitValue(
    runGit,
    ['rev-parse', '--show-object-format'],
    'station-extract/object-format-unsupported',
    'Repository object format could not be verified as SHA-1.',
  );
  if (objectFormat !== 'sha1') {
    fail('station-extract/object-format-unsupported', 'Only SHA-1 Git object repositories are supported by this contract.', {
      evidence: { objectFormat },
      supportedFixes: ['use a SHA-1 Git repository for station-evidence/v1'],
    });
  }
  const revision = validateRevision(runGit, revisionInput);
  const treeOid = requiredGitValue(
    runGit,
    ['rev-parse', `${revision}^{tree}`],
    'station-extract/revision-unavailable',
    'Revision tree is not locally available.',
  );
  if (!FULL_OID_RE.test(treeOid)) {
    fail('station-extract/revision-unavailable', 'Revision did not resolve to one full SHA-1 tree object ID.', {
      evidence: { revision },
    });
  }

  return Object.freeze({
    repository: Object.freeze({ url, revision, treeOid, objectFormat }),
  });
}
