import { sha256Hex } from './canonical-json.mjs';

const HEX_40 = /^[a-f0-9]{40}$/;
const HEX_64 = /^[a-f0-9]{64}$/;
const PROJECT_ID = /^project-[a-f0-9]{64}$/;
const ROOM_ID = /^room-[a-f0-9]{64}$/;
const PROFILE = 'node-workspaces/v1';

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

function derive(prefix, ...parts) {
  return `${prefix}-${sha256Hex(Buffer.from(parts.join('\0'), 'utf8'))}`;
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
  if (profile !== PROFILE) throw new TypeError(`Profile must be ${PROFILE}.`);
  return derive(
    'snapshot',
    'station-snapshot/v1',
    match(projectId, PROJECT_ID, 'Project ID'),
    match(revision, HEX_40, 'Revision'),
    match(evidenceSha256, HEX_64, 'Evidence SHA-256'),
    profile,
  );
}
