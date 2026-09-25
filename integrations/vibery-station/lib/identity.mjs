import { sha256Hex } from './canonical-json.mjs';

const HEX_40 = /^[a-f0-9]{40}$/;
const HEX_64 = /^[a-f0-9]{64}$/;
const PROJECT_ID = /^project-[a-f0-9]{64}$/;
const ROOM_ID = /^room-[a-f0-9]{64}$/;
const PROFILE = 'node-workspaces/v1';
const PROFILES = new Set([PROFILE, 'directory-layout/v1']);

function text(value, name) {
  if (typeof value !== 'string' || !value) throw new TypeError(`${name} must be a non-empty string.`);
  if (value.includes('\0')) throw new TypeError(`${name} must not contain NUL separators.`);
  return value;
}

function match(value, pattern, name) {
  text(value, name);
  if (!pattern.test(value)) throw new TypeError(`${name} is malformed.`);
  return value;
}

function repositoryPath(value) {
  text(value, 'Evidence path');
  if (value.startsWith('/') || value.endsWith('/') || /[\\\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError('Evidence path must be a repository-relative POSIX path.');
  }
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || part === '.git')) {
    throw new TypeError('Evidence path must be a repository-relative POSIX path.');
  }
  return value;
}

function deriveFromParts(prefix, parts) {
  return `${prefix}-${sha256Hex(Buffer.from(parts.join('\0'), 'utf8'))}`;
}

function derive(prefix, ...parts) {
  return deriveFromParts(prefix, parts);
}

export function deriveProjectId(canonicalRepositoryIdentity) {
  return derive('project', 'station-project/v1', text(canonicalRepositoryIdentity, 'Canonical repository identity'));
}

export function deriveEvidenceId(path, gitOid) {
  return derive(
    'evidence',
    'station-evidence/v1',
    'git-blob',
    repositoryPath(path),
    match(gitOid, HEX_40, 'Git OID'),
  );
}

// A directory room's evidence ID binds its root to every code file it counts
// (exact path and blob OID), so any committed change to that code changes it.
export function deriveDirectoryEvidenceId(root, codeFiles) {
  if (!Array.isArray(codeFiles) || codeFiles.length === 0) throw new TypeError('Directory evidence requires code files.');
  const prefix = `${repositoryPath(root)}/`;
  const parts = codeFiles.map(({ path, oid }) => {
    if (!repositoryPath(path).startsWith(prefix)) throw new TypeError('Directory code file lies outside its root.');
    return `${path}\0${match(oid, HEX_40, 'Git OID')}`;
  });
  for (let index = 1; index < parts.length; index += 1) {
    if (!(parts[index - 1] < parts[index])) throw new TypeError('Directory code files must be unique and path-ordered.');
  }
  // Pass the file list as one array: spreading it into arguments overflows the
  // call stack on directories with very many files.
  return deriveFromParts('evidence', ['station-evidence/v1', 'git-directory', root].concat(parts));
}

export function deriveRoomId(projectId, structuralKey) {
  return derive(
    'room',
    'station-room/v1',
    match(projectId, PROJECT_ID, 'Project ID'),
    text(structuralKey, 'Structural key'),
  );
}

export function deriveRelationId(fromRoomId, toRoomId) {
  return derive(
    'relation',
    'station-relation/v1',
    'declared-package-dependency',
    match(fromRoomId, ROOM_ID, 'From-room ID'),
    match(toRoomId, ROOM_ID, 'To-room ID'),
  );
}

export function deriveSnapshotId(projectId, revision, evidenceSha256, profile = PROFILE) {
  if (!PROFILES.has(profile)) throw new TypeError(`Profile must be one of ${[...PROFILES].join(', ')}.`);
  return derive(
    'snapshot',
    'station-snapshot/v1',
    match(projectId, PROJECT_ID, 'Project ID'),
    match(revision, HEX_40, 'Revision'),
    match(evidenceSha256, HEX_64, 'Evidence SHA-256'),
    profile,
  );
}
