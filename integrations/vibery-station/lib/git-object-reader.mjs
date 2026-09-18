import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { parseRepositoryRemote } from '../../../archify/renderers/shared/repository-location.mjs';
import { throwStationDiagnostic } from './diagnostics.mjs';

const FULL_OID_RE = /^[a-f0-9]{40}$/;
const TREE_RECORD_RE = /^(040000|100644|100755|120000|160000) (blob|tree|commit) ([a-f0-9]{40})$/;
const VALID_MODE_TYPES = new Set(['040000 tree', '100644 blob', '100755 blob', '120000 blob', '160000 commit']);
const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/;
const MANIFEST_SUFFIX = Buffer.from('package.json');
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

export const GIT_OBJECT_LIMITS = Object.freeze({
  treeOutputBytes: 16 * 1024 * 1024,
  manifestCount: 512,
  manifestBytes: 1024 * 1024,
  totalManifestBytes: 8 * 1024 * 1024,
});

const COMMAND_OUTPUT_LIMIT = GIT_OBJECT_LIMITS.treeOutputBytes;

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

function redactStationRemote(value) {
  return String(value || '')
    .replace(/^((?:https?|ssh):\/\/)[^/]*@/i, '$1REDACTED@')
    .replace(/^[^/@]+@(?=[^/:]+:)/, 'REDACTED@')
    .replace(/[?#].*$/s, '?REDACTED');
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
      evidence: { localOrigin: redactStationRemote(originValue) },
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

function treeFailure(code, message) {
  fail(code, message, {
    supportedFixes: ['make the complete commit tree available locally within the fixed reader budget'],
  });
}

function pathHasManifestName(pathBytes) {
  if (pathBytes.equals(MANIFEST_SUFFIX)) return true;
  if (pathBytes.length <= MANIFEST_SUFFIX.length || pathBytes[pathBytes.length - MANIFEST_SUFFIX.length - 1] !== 0x2f) return false;
  return pathBytes.subarray(pathBytes.length - MANIFEST_SUFFIX.length).equals(MANIFEST_SUFFIX);
}

function parseTreeInventory(output) {
  if (output.length > GIT_OBJECT_LIMITS.treeOutputBytes) {
    treeFailure('station-extract/tree-budget-exceeded', 'Commit tree output exceeded the fixed 16 MiB integrity ceiling.');
  }
  if (output.length > 0 && output[output.length - 1] !== 0) {
    treeFailure('station-extract/tree-protocol-invalid', 'Commit tree output ended without its required NUL terminator.');
  }

  const inventory = [];
  const seenPaths = new Set();
  let start = 0;
  while (start < output.length) {
    const end = output.indexOf(0, start);
    if (end < 0 || end === start) {
      treeFailure('station-extract/tree-protocol-invalid', 'Commit tree output contained an empty or incomplete record.');
    }
    const record = output.subarray(start, end);
    const tab = record.indexOf(0x09);
    if (tab < 0) treeFailure('station-extract/tree-protocol-invalid', 'Commit tree output contained a record without a path delimiter.');
    const header = record.subarray(0, tab).toString('ascii');
    const match = TREE_RECORD_RE.exec(header);
    if (!match || !VALID_MODE_TYPES.has(`${match?.[1]} ${match?.[2]}`)) {
      treeFailure('station-extract/tree-protocol-invalid', 'Commit tree output contained an invalid mode, type, or object ID.');
    }
    const pathBytes = Buffer.from(record.subarray(tab + 1));
    if (pathBytes.length === 0) treeFailure('station-extract/tree-protocol-invalid', 'Commit tree output contained an empty path.');
    const pathKey = pathBytes.toString('hex');
    if (seenPaths.has(pathKey)) treeFailure('station-extract/tree-protocol-invalid', 'Commit tree output contained a duplicate exact path.');
    seenPaths.add(pathKey);

    let decodedPath = null;
    try {
      decodedPath = UTF8_DECODER.decode(pathBytes);
    } catch {
      // Raw bytes remain authoritative; the unsupported classification is added below.
    }
    inventory.push({ mode: match[1], type: match[2], oid: match[3], path: decodedPath, pathBytes });
    start = end + 1;
  }

  inventory.sort((left, right) => Buffer.compare(left.pathBytes, right.pathBytes) || (left.oid < right.oid ? -1 : left.oid > right.oid ? 1 : 0));
  const unsupportedPaths = [];
  const classified = new Set();
  const classify = (entryIndex, code) => {
    const key = `${entryIndex}\0${code}`;
    if (classified.has(key)) return;
    classified.add(key);
    const entry = inventory[entryIndex];
    unsupportedPaths.push(Object.freeze({
      code,
      path: entry.path,
      pathBytesHex: entry.pathBytes.toString('hex'),
      entryIndex,
    }));
  };

  for (const [entryIndex, entry] of inventory.entries()) {
    if (entry.pathBytes.includes(0x5c)) classify(entryIndex, 'station-extract/path-shape-unsupported');
    if (entry.path === null) {
      classify(entryIndex, 'station-extract/path-encoding-unsupported');
      continue;
    }
    if (CONTROL_CHARACTER_RE.test(entry.path)) classify(entryIndex, 'station-extract/path-control-unsupported');
    const segments = entry.path.split('/');
    if (entry.path.startsWith('/') || entry.path.includes('\\')
        || segments.some((segment) => !segment || segment === '.' || segment === '..' || segment === '.git')) {
      classify(entryIndex, 'station-extract/path-shape-unsupported');
    }
  }

  for (const [keyForPath, code] of [
    [(value) => value.toLowerCase(), 'station-extract/path-case-collision'],
    [(value) => value.normalize('NFC'), 'station-extract/path-nfc-collision'],
  ]) {
    const groups = new Map();
    for (const [entryIndex, entry] of inventory.entries()) {
      if (entry.path === null) continue;
      const key = keyForPath(entry.path);
      const group = groups.get(key) || [];
      group.push(entryIndex);
      groups.set(key, group);
    }
    for (const indexes of groups.values()) {
      if (indexes.length < 2) continue;
      const exact = new Set(indexes.map((entryIndex) => inventory[entryIndex].path));
      if (exact.size > 1) for (const entryIndex of indexes) classify(entryIndex, code);
    }
  }

  unsupportedPaths.sort((left, right) => left.entryIndex - right.entryIndex || (left.code < right.code ? -1 : left.code > right.code ? 1 : 0));
  const frozenInventory = inventory.map((entry) => Object.freeze(entry));
  const manifestCandidates = frozenInventory.filter(({ pathBytes }) => pathHasManifestName(pathBytes));
  return {
    inventory: Object.freeze(frozenInventory),
    unsupportedPaths: Object.freeze(unsupportedPaths),
    manifestCandidates: Object.freeze(manifestCandidates),
    manifestPolicy: Object.freeze({
      discovered: manifestCandidates.length,
      limit: GIT_OBJECT_LIMITS.manifestCount,
      exceeded: manifestCandidates.length > GIT_OBJECT_LIMITS.manifestCount,
    }),
  };
}

function enumerateTree(runGit, revision) {
  const result = runGit(['ls-tree', '-rz', '--full-tree', revision], { maxBuffer: GIT_OBJECT_LIMITS.treeOutputBytes });
  if (result.error?.code === 'ENOBUFS' || result.stdout.length > GIT_OBJECT_LIMITS.treeOutputBytes) {
    treeFailure('station-extract/tree-budget-exceeded', 'Commit tree output exceeded the fixed 16 MiB integrity ceiling.');
  }
  if (result.error || result.status !== 0) {
    treeFailure('station-extract/tree-unreadable', 'Commit tree could not be enumerated completely from the local object database.');
  }
  return parseTreeInventory(result.stdout);
}

function requireObjectId(oid) {
  if (typeof oid !== 'string' || !FULL_OID_RE.test(oid)) {
    fail('station-extract/object-unavailable', 'Blob object ID must be one exact lowercase SHA-1 object ID.');
  }
  return oid;
}

function createBlobOperations(runGit) {
  const statBlob = (oidInput) => {
    const oid = requireObjectId(oidInput);
    const result = runGit(['cat-file', '-s', oid], { maxBuffer: 1024 });
    if (result.error || result.status !== 0) {
      fail('station-extract/object-unavailable', 'Blob size is unavailable from the local object database.', {
        evidence: { oid },
      });
    }
    const text = result.stdout.toString('ascii');
    if (!/^(?:0|[1-9][0-9]*)\n$/.test(text)) {
      fail('station-extract/object-size-invalid', 'Blob size probe did not return one canonical non-negative decimal.', {
        evidence: { oid },
      });
    }
    const size = Number(text.slice(0, -1));
    if (!Number.isSafeInteger(size)) {
      fail('station-extract/object-size-invalid', 'Blob size exceeds the exact integer range supported by this contract.', {
        evidence: { oid },
      });
    }
    return size;
  };

  const readBlob = (oidInput, { expectedSize, integrityCeiling } = {}) => {
    const oid = requireObjectId(oidInput);
    if (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || !Number.isSafeInteger(integrityCeiling) || integrityCeiling < 0) {
      throw new TypeError('expectedSize and integrityCeiling must be non-negative safe integers.');
    }
    if (expectedSize > integrityCeiling) {
      fail('station-extract/object-budget-exceeded', 'Blob read was refused because its proven size exceeds the integrity ceiling.', {
        evidence: { oid, expectedSize, integrityCeiling },
      });
    }
    const processCeiling = Math.max(64 * 1024, integrityCeiling + 1);
    const result = runGit(['cat-file', 'blob', oid], { maxBuffer: processCeiling });
    if (result.error?.code === 'ENOBUFS' || result.stdout.length > integrityCeiling) {
      fail('station-extract/object-budget-exceeded', 'Blob output exceeded the caller-provided integrity ceiling.', {
        evidence: { oid, expectedSize, integrityCeiling },
      });
    }
    if (result.error || result.status !== 0) {
      fail('station-extract/object-unavailable', 'Blob bytes are unavailable from the local object database.', {
        evidence: { oid },
      });
    }
    if (result.stdout.length !== expectedSize) {
      fail('station-extract/object-size-mismatch', 'Blob byte count disagrees with its exact prior size probe.', {
        evidence: { oid, expectedSize, actualSize: result.stdout.length },
      });
    }
    return Buffer.from(result.stdout);
  };
  return { statBlob, readBlob };
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

  const tree = enumerateTree(runGit, revision);
  const blobs = createBlobOperations(runGit);
  return Object.freeze({
    repository: Object.freeze({ url, revision, treeOid, objectFormat }),
    limits: GIT_OBJECT_LIMITS,
    ...tree,
    ...blobs,
  });
}
