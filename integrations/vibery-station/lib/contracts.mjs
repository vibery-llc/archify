import { parseRepositoryRemote } from '../../../archify/renderers/shared/repository-location.mjs';
import { throwStationDiagnostic } from './diagnostics.mjs';

export { createStationDiagnostic, StationDiagnosticError } from './diagnostics.mjs';

export const STATION_SCHEMAS = Object.freeze({
  evidence: 'station-evidence/v1',
  map: 'station-map/v1',
  receipt: 'station-extraction-receipt/v1',
});

export const STATION_PROFILE = 'node-workspaces/v1';
export const STATION_CONTRACT_VERSION = 1;
export const MAX_STRUCTURAL_ROOMS = 64;
export const STATION_LIMITS = Object.freeze({
  max_tree_bytes: 16 * 1024 * 1024,
  max_manifest_count: 512,
  max_workspace_patterns: 512,
  max_manifest_bytes: 1024 * 1024,
  max_selected_manifest_bytes: 8 * 1024 * 1024,
});

export const DEPENDENCY_SCOPES = Object.freeze([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]);

export const FALLBACK_REASON_CODES = Object.freeze([
  'station-fallback/root-manifest-missing',
  'station-fallback/workspace-shape-unsupported',
  'station-fallback/workspace-pattern-unsupported',
  'station-fallback/workspace-match-empty',
  'station-fallback/workspace-manifest-missing',
  'station-fallback/workspace-manifest-non-regular',
  'station-fallback/workspace-manifest-oversized',
  'station-fallback/workspace-manifest-binary',
  'station-fallback/workspace-manifest-encoding-unsupported',
  'station-fallback/workspace-manifest-invalid',
  'station-fallback/workspace-root-ambiguous',
  'station-fallback/path-collision',
  'station-fallback/path-unsupported',
  'station-fallback/manifest-count-exceeded',
  'station-fallback/selected-manifest-bytes-exceeded',
  'station-fallback/package-name-ambiguous',
  'station-fallback/room-count-out-of-range',
]);

export const CONTRACT_FIELDS = Object.freeze({
  evidence: Object.freeze({
    '/': Object.freeze(['schema', 'extractor', 'repository', 'files', 'workspace', 'packages', 'analysis']),
    '/extractor': Object.freeze(['profile', 'contract_version', 'limits']),
    '/extractor/limits': Object.freeze(['max_tree_bytes', 'max_manifest_count', 'max_workspace_patterns', 'max_manifest_bytes', 'max_selected_manifest_bytes']),
    '/repository': Object.freeze(['id', 'url', 'revision', 'tree_oid', 'object_format']),
    '/files/items': Object.freeze(['id', 'kind', 'path', 'git_oid', 'sha256', 'bytes']),
    '/workspace': Object.freeze(['kind', 'root_manifest_evidence_id', 'patterns', 'package_roots']),
    '/packages/items': Object.freeze(['root', 'name', 'private', 'manifest_evidence_id', 'workspace_pattern', 'declared_dependencies']),
    '/packages/items/declared_dependencies/items': Object.freeze(['name', 'scopes']),
    '/analysis': Object.freeze(['detail_eligible', 'discovered_manifest_count', 'selected_manifest_count', 'represented_manifest_count', 'fallback_reason_codes']),
  }),
  map: Object.freeze({
    '/': Object.freeze(['schema', 'snapshot', 'project', 'rooms', 'relations', 'fallback']),
    '/snapshot': Object.freeze(['id', 'project_id', 'revision', 'evidence_sha256', 'profile', 'mode']),
    '/project': Object.freeze(['id', 'label']),
    '/rooms/items': Object.freeze(['id', 'project_id', 'kind', 'structural_key', 'label', 'package_roots', 'confidence', 'evidence_ids']),
    '/relations/items': Object.freeze(['id', 'kind', 'from_room_id', 'to_room_id', 'scopes', 'evidence_ids']),
    '/fallback': Object.freeze(['used', 'reason_codes']),
  }),
  receipt: Object.freeze({
    '/': Object.freeze(['schema', 'ok', 'command', 'repository', 'extractor', 'artifacts', 'result', 'diagnostics']),
    '/repository': Object.freeze(['url', 'revision', 'tree_oid', 'object_format']),
    '/extractor': Object.freeze(['profile', 'contract_version', 'limits']),
    '/extractor/limits': Object.freeze(['max_tree_bytes', 'max_manifest_count', 'max_workspace_patterns', 'max_manifest_bytes', 'max_selected_manifest_bytes']),
    '/artifacts': Object.freeze(['evidence', 'map']),
    '/artifacts/evidence': Object.freeze(['file', 'sha256', 'bytes']),
    '/artifacts/map': Object.freeze(['file', 'sha256', 'bytes']),
    '/result': Object.freeze(['project_id', 'snapshot_id', 'mode', 'rooms', 'relations', 'fallback', 'fallback_reason_codes']),
  }),
});

const HEX_40 = /^[a-f0-9]{40}$/;
const HEX_64 = /^[a-f0-9]{64}$/;
const IDS = Object.freeze({
  project: /^project-[a-f0-9]{64}$/,
  evidence: /^evidence-[a-f0-9]{64}$/,
  room: /^room-[a-f0-9]{64}$/,
  relation: /^relation-[a-f0-9]{64}$/,
  snapshot: /^snapshot-[a-f0-9]{64}$/,
});
const FORBIDDEN_PATH_PART = /[\\\u0000-\u001f\u007f]/;

function describe(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function invalid(artifact, path, expected, actual) {
  throwStationDiagnostic({
    code: 'station-gate/schema-invalid',
    severity: 'error',
    message: `${artifact} is invalid at ${path}: expected ${expected}.`,
    subject: { artifact },
    evidence: {
      path,
      expected,
      actual: actual === undefined ? 'missing' : describe(actual),
    },
    supportedFixes: ['rebuild the artifact from verified immutable repository evidence'],
  });
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function object(value, artifact, path, allowed, required = allowed) {
  if (!plainObject(value)) invalid(artifact, path, 'object', value);
  for (const field of Object.keys(value)) {
    if (!allowed.includes(field)) invalid(artifact, `${path === '/' ? '' : path}/${field}`, 'no unknown property', value[field]);
  }
  for (const field of required) {
    if (!Object.hasOwn(value, field)) invalid(artifact, `${path === '/' ? '' : path}/${field}`, 'required property', undefined);
  }
  return value;
}

function array(value, artifact, path, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    invalid(artifact, path, `array with ${min}..${max} items`, value);
  }
  return value;
}

function string(value, artifact, path, { pattern, values, min = 1 } = {}) {
  if (typeof value !== 'string' || value.length < min) invalid(artifact, path, 'string', value);
  if (pattern && !pattern.test(value)) invalid(artifact, path, `string matching ${pattern}`, value);
  if (values && !values.includes(value)) invalid(artifact, path, `one of ${values.join(', ')}`, value);
  return value;
}

function integer(value, artifact, path, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) invalid(artifact, path, `integer from ${min} to ${max}`, value);
  return value;
}

function boolean(value, artifact, path) {
  if (typeof value !== 'boolean') invalid(artifact, path, 'boolean', value);
  return value;
}

function constant(value, expected, artifact, path) {
  if (value !== expected) invalid(artifact, path, JSON.stringify(expected), value);
}

function uniqueStrings(value, artifact, path, options = {}) {
  array(value, artifact, path, options);
  value.forEach((entry, index) => string(entry, artifact, `${path}/${index}`, options));
  if (new Set(value).size !== value.length) invalid(artifact, path, 'unique string items', value);
  return value;
}

function id(value, kind, artifact, path) {
  string(value, artifact, path, { pattern: IDS[kind] });
}

function oid(value, artifact, path) {
  string(value, artifact, path, { pattern: HEX_40 });
}

function hash(value, artifact, path) {
  string(value, artifact, path, { pattern: HEX_64 });
}

function repositoryPath(value, artifact, path, { root = false } = {}) {
  string(value, artifact, path);
  if (root && value === '.') return;
  if (value.startsWith('/') || value.endsWith('/') || FORBIDDEN_PATH_PART.test(value)) invalid(artifact, path, 'repository-relative POSIX path', value);
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || part === '.git')) invalid(artifact, path, 'repository-relative POSIX path', value);
}

export function isStationCanonicalRepositoryUrl(value) {
  const location = parseRepositoryRemote(value, { authored: true });
  if (!location) return false;
  let canonical = location.url;
  if (location.endpoint === 'standard' && location.provider === 'github') {
    canonical = `https://github.com/${location.path.toLowerCase()}`;
  } else if (location.endpoint === 'standard' && location.provider === 'gitee') {
    canonical = `https://gitee.com/${location.path}`;
  }
  return value === canonical;
}

function canonicalRepositoryUrl(value, artifact, path) {
  if (!isStationCanonicalRepositoryUrl(value)) invalid(artifact, path, 'identity-derived Station canonical repository URL', value);
}

function limits(value, artifact, path) {
  object(value, artifact, path, CONTRACT_FIELDS[artifact === STATION_SCHEMAS.evidence ? 'evidence' : 'receipt']['/extractor/limits']);
  for (const [name, expected] of Object.entries(STATION_LIMITS)) constant(value[name], expected, artifact, `${path}/${name}`);
}

function extractor(value, artifact, contract) {
  object(value, artifact, '/extractor', CONTRACT_FIELDS[contract]['/extractor']);
  constant(value.profile, STATION_PROFILE, artifact, '/extractor/profile');
  constant(value.contract_version, STATION_CONTRACT_VERSION, artifact, '/extractor/contract_version');
  limits(value.limits, artifact, '/extractor/limits');
}

function fallbackReasons(value, artifact, path) {
  uniqueStrings(value, artifact, path);
  value.forEach((reason, index) => {
    if (!FALLBACK_REASON_CODES.includes(reason)) invalid(artifact, `${path}/${index}`, 'approved station-fallback/v1 reason', reason);
  });
}

function validateEvidenceFile(value, artifact, index) {
  const path = `/files/${index}`;
  object(value, artifact, path, CONTRACT_FIELDS.evidence['/files/items']);
  id(value.id, 'evidence', artifact, `${path}/id`);
  constant(value.kind, 'git-blob', artifact, `${path}/kind`);
  repositoryPath(value.path, artifact, `${path}/path`);
  oid(value.git_oid, artifact, `${path}/git_oid`);
  hash(value.sha256, artifact, `${path}/sha256`);
  integer(value.bytes, artifact, `${path}/bytes`, { max: STATION_LIMITS.max_manifest_bytes });
}

function validateDeclaration(value, artifact, packageIndex, declarationIndex) {
  const path = `/packages/${packageIndex}/declared_dependencies/${declarationIndex}`;
  object(value, artifact, path, CONTRACT_FIELDS.evidence['/packages/items/declared_dependencies/items']);
  string(value.name, artifact, `${path}/name`);
  uniqueStrings(value.scopes, artifact, `${path}/scopes`, { min: 1 });
  value.scopes.forEach((scope, index) => {
    if (!DEPENDENCY_SCOPES.includes(scope)) invalid(artifact, `${path}/scopes/${index}`, 'declared npm dependency scope', scope);
  });
}

function validatePackage(value, artifact, index) {
  const path = `/packages/${index}`;
  const fields = CONTRACT_FIELDS.evidence['/packages/items'];
  object(value, artifact, path, fields, fields.filter((field) => field !== 'private'));
  repositoryPath(value.root, artifact, `${path}/root`, { root: true });
  string(value.name, artifact, `${path}/name`);
  if (Object.hasOwn(value, 'private')) boolean(value.private, artifact, `${path}/private`);
  id(value.manifest_evidence_id, 'evidence', artifact, `${path}/manifest_evidence_id`);
  string(value.workspace_pattern, artifact, `${path}/workspace_pattern`);
  array(value.declared_dependencies, artifact, `${path}/declared_dependencies`);
  value.declared_dependencies.forEach((entry, declarationIndex) => validateDeclaration(entry, artifact, index, declarationIndex));
}

export function validateStationEvidence(value) {
  const artifact = STATION_SCHEMAS.evidence;
  object(value, artifact, '/', CONTRACT_FIELDS.evidence['/']);
  constant(value.schema, artifact, artifact, '/schema');
  extractor(value.extractor, artifact, 'evidence');

  object(value.repository, artifact, '/repository', CONTRACT_FIELDS.evidence['/repository']);
  id(value.repository.id, 'project', artifact, '/repository/id');
  canonicalRepositoryUrl(value.repository.url, artifact, '/repository/url');
  oid(value.repository.revision, artifact, '/repository/revision');
  oid(value.repository.tree_oid, artifact, '/repository/tree_oid');
  constant(value.repository.object_format, 'sha1', artifact, '/repository/object_format');

  array(value.files, artifact, '/files');
  value.files.forEach((entry, index) => validateEvidenceFile(entry, artifact, index));

  object(value.workspace, artifact, '/workspace', CONTRACT_FIELDS.evidence['/workspace']);
  string(value.workspace.kind, artifact, '/workspace/kind', { values: ['root-package', 'npm-workspaces', 'unsupported'] });
  if (value.workspace.root_manifest_evidence_id !== null) id(value.workspace.root_manifest_evidence_id, 'evidence', artifact, '/workspace/root_manifest_evidence_id');
  uniqueStrings(value.workspace.patterns, artifact, '/workspace/patterns');
  uniqueStrings(value.workspace.package_roots, artifact, '/workspace/package_roots');
  value.workspace.package_roots.forEach((entry, index) => repositoryPath(entry, artifact, `/workspace/package_roots/${index}`, { root: true }));

  array(value.packages, artifact, '/packages');
  value.packages.forEach((entry, index) => validatePackage(entry, artifact, index));

  object(value.analysis, artifact, '/analysis', CONTRACT_FIELDS.evidence['/analysis']);
  boolean(value.analysis.detail_eligible, artifact, '/analysis/detail_eligible');
  integer(value.analysis.discovered_manifest_count, artifact, '/analysis/discovered_manifest_count');
  integer(value.analysis.selected_manifest_count, artifact, '/analysis/selected_manifest_count');
  integer(value.analysis.represented_manifest_count, artifact, '/analysis/represented_manifest_count');
  fallbackReasons(value.analysis.fallback_reason_codes, artifact, '/analysis/fallback_reason_codes');
  if (value.analysis.detail_eligible && value.analysis.fallback_reason_codes.length) invalid(artifact, '/analysis/fallback_reason_codes', 'empty when detail_eligible is true', value.analysis.fallback_reason_codes);
  if (!value.analysis.detail_eligible && !value.analysis.fallback_reason_codes.length) invalid(artifact, '/analysis/fallback_reason_codes', 'one or more reasons when detail_eligible is false', value.analysis.fallback_reason_codes);
  return value;
}

function validateRoom(value, artifact, index) {
  const path = `/rooms/${index}`;
  object(value, artifact, path, CONTRACT_FIELDS.map['/rooms/items']);
  id(value.id, 'room', artifact, `${path}/id`);
  id(value.project_id, 'project', artifact, `${path}/project_id`);
  string(value.kind, artifact, `${path}/kind`, { values: ['component', 'coarse-project'] });
  string(value.structural_key, artifact, `${path}/structural_key`);
  string(value.label, artifact, `${path}/label`);
  uniqueStrings(value.package_roots, artifact, `${path}/package_roots`);
  value.package_roots.forEach((entry, rootIndex) => repositoryPath(entry, artifact, `${path}/package_roots/${rootIndex}`, { root: true }));
  string(value.confidence, artifact, `${path}/confidence`, { values: ['high', 'coarse'] });
  uniqueStrings(value.evidence_ids, artifact, `${path}/evidence_ids`);
  value.evidence_ids.forEach((entry, evidenceIndex) => id(entry, 'evidence', artifact, `${path}/evidence_ids/${evidenceIndex}`));
}

function validateRelation(value, artifact, index) {
  const path = `/relations/${index}`;
  object(value, artifact, path, CONTRACT_FIELDS.map['/relations/items']);
  id(value.id, 'relation', artifact, `${path}/id`);
  constant(value.kind, 'declared-package-dependency', artifact, `${path}/kind`);
  id(value.from_room_id, 'room', artifact, `${path}/from_room_id`);
  id(value.to_room_id, 'room', artifact, `${path}/to_room_id`);
  if (value.from_room_id === value.to_room_id) invalid(artifact, `${path}/to_room_id`, 'room ID distinct from from_room_id', value.to_room_id);
  uniqueStrings(value.scopes, artifact, `${path}/scopes`, { min: 1 });
  value.scopes.forEach((scope, scopeIndex) => {
    if (!DEPENDENCY_SCOPES.includes(scope)) invalid(artifact, `${path}/scopes/${scopeIndex}`, 'declared npm dependency scope', scope);
  });
  uniqueStrings(value.evidence_ids, artifact, `${path}/evidence_ids`, { min: 1 });
  value.evidence_ids.forEach((entry, evidenceIndex) => id(entry, 'evidence', artifact, `${path}/evidence_ids/${evidenceIndex}`));
}

export function validateStationMap(value) {
  const artifact = STATION_SCHEMAS.map;
  object(value, artifact, '/', CONTRACT_FIELDS.map['/']);
  constant(value.schema, artifact, artifact, '/schema');

  object(value.snapshot, artifact, '/snapshot', CONTRACT_FIELDS.map['/snapshot']);
  id(value.snapshot.id, 'snapshot', artifact, '/snapshot/id');
  id(value.snapshot.project_id, 'project', artifact, '/snapshot/project_id');
  oid(value.snapshot.revision, artifact, '/snapshot/revision');
  hash(value.snapshot.evidence_sha256, artifact, '/snapshot/evidence_sha256');
  constant(value.snapshot.profile, STATION_PROFILE, artifact, '/snapshot/profile');
  string(value.snapshot.mode, artifact, '/snapshot/mode', { values: ['structural', 'coarse'] });

  object(value.project, artifact, '/project', CONTRACT_FIELDS.map['/project']);
  id(value.project.id, 'project', artifact, '/project/id');
  string(value.project.label, artifact, '/project/label');
  if (value.snapshot.project_id !== value.project.id) invalid(artifact, '/snapshot/project_id', 'project.id', value.snapshot.project_id);

  array(value.rooms, artifact, '/rooms', { min: 1, max: MAX_STRUCTURAL_ROOMS });
  value.rooms.forEach((entry, index) => validateRoom(entry, artifact, index));
  for (const [index, room] of value.rooms.entries()) {
    if (room.project_id !== value.project.id) invalid(artifact, `/rooms/${index}/project_id`, 'project.id', room.project_id);
  }
  array(value.relations, artifact, '/relations');
  value.relations.forEach((entry, index) => validateRelation(entry, artifact, index));

  object(value.fallback, artifact, '/fallback', CONTRACT_FIELDS.map['/fallback']);
  boolean(value.fallback.used, artifact, '/fallback/used');
  fallbackReasons(value.fallback.reason_codes, artifact, '/fallback/reason_codes');

  if (value.snapshot.mode === 'coarse') {
    if (!value.fallback.used) invalid(artifact, '/fallback/used', 'true in coarse mode', value.fallback.used);
    if (value.fallback.reason_codes.length < 1) invalid(artifact, '/fallback/reason_codes', 'one or more fallback reasons', value.fallback.reason_codes);
    if (value.rooms.length !== 1) invalid(artifact, '/rooms', 'exactly one room in coarse mode', value.rooms);
    if (value.relations.length !== 0) invalid(artifact, '/relations', 'no relations in coarse mode', value.relations);
    const [room] = value.rooms;
    if (room.kind !== 'coarse-project' || room.structural_key !== 'project-root' || room.confidence !== 'coarse' || room.package_roots.length) {
      invalid(artifact, '/rooms/0', 'coarse-project room without detailed membership', room);
    }
  } else {
    if (value.fallback.used) invalid(artifact, '/fallback/used', 'false in structural mode', value.fallback.used);
    if (value.fallback.reason_codes.length) invalid(artifact, '/fallback/reason_codes', 'empty in structural mode', value.fallback.reason_codes);
    value.rooms.forEach((room, index) => {
      if (room.kind !== 'component' || room.confidence !== 'high' || room.package_roots.length < 1) {
        invalid(artifact, `/rooms/${index}`, 'high-confidence component room with package membership', room);
      }
    });
  }
  return value;
}

function receiptArtifact(value, artifact, name) {
  const path = `/artifacts/${name}`;
  object(value, artifact, path, CONTRACT_FIELDS.receipt[path]);
  constant(value.file, name === 'evidence' ? 'station-evidence.json' : 'station-map.json', artifact, `${path}/file`);
  hash(value.sha256, artifact, `${path}/sha256`);
  integer(value.bytes, artifact, `${path}/bytes`, { min: 1 });
}

export function validateStationExtractionReceipt(value) {
  const artifact = STATION_SCHEMAS.receipt;
  object(value, artifact, '/', CONTRACT_FIELDS.receipt['/']);
  constant(value.schema, artifact, artifact, '/schema');
  constant(value.ok, true, artifact, '/ok');
  constant(value.command, 'station extract', artifact, '/command');

  object(value.repository, artifact, '/repository', CONTRACT_FIELDS.receipt['/repository']);
  canonicalRepositoryUrl(value.repository.url, artifact, '/repository/url');
  oid(value.repository.revision, artifact, '/repository/revision');
  oid(value.repository.tree_oid, artifact, '/repository/tree_oid');
  constant(value.repository.object_format, 'sha1', artifact, '/repository/object_format');
  extractor(value.extractor, artifact, 'receipt');

  object(value.artifacts, artifact, '/artifacts', CONTRACT_FIELDS.receipt['/artifacts']);
  receiptArtifact(value.artifacts.evidence, artifact, 'evidence');
  receiptArtifact(value.artifacts.map, artifact, 'map');

  object(value.result, artifact, '/result', CONTRACT_FIELDS.receipt['/result']);
  id(value.result.project_id, 'project', artifact, '/result/project_id');
  id(value.result.snapshot_id, 'snapshot', artifact, '/result/snapshot_id');
  string(value.result.mode, artifact, '/result/mode', { values: ['structural', 'coarse'] });
  integer(value.result.rooms, artifact, '/result/rooms', { min: 1, max: MAX_STRUCTURAL_ROOMS });
  integer(value.result.relations, artifact, '/result/relations');
  boolean(value.result.fallback, artifact, '/result/fallback');
  fallbackReasons(value.result.fallback_reason_codes, artifact, '/result/fallback_reason_codes');
  if (value.result.mode === 'coarse' || value.result.fallback) {
    if (value.result.mode !== 'coarse' || !value.result.fallback || value.result.rooms !== 1 || value.result.relations !== 0 || !value.result.fallback_reason_codes.length) {
      invalid(artifact, '/result', 'coarse result with one room, no relations, and fallback reasons', value.result);
    }
  } else if (value.result.fallback_reason_codes.length) {
    invalid(artifact, '/result/fallback_reason_codes', 'empty in structural mode', value.result.fallback_reason_codes);
  }

  array(value.diagnostics, artifact, '/diagnostics', { max: 0 });
  return value;
}
