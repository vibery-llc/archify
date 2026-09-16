import { TextDecoder } from 'node:util';
import {
  DEPENDENCY_SCOPES,
  STATION_CONTRACT_VERSION,
  STATION_LIMITS,
  STATION_PROFILE,
  STATION_SCHEMAS,
  StationDiagnosticError,
  createStationDiagnostic,
  isStationCanonicalRepositoryUrl,
  validateStationEvidence,
  validateStationMap,
} from './contracts.mjs';
import {
  canonicalJsonBytes,
  compareCodePoints,
  compareDeclarations,
  compareEvidenceIds,
  compareFallbackCodes,
  compareFiles,
  comparePackages,
  compareRelations,
  compareRooms,
  compareScopes,
  sha256Hex,
} from './canonical-json.mjs';
import {
  deriveEvidenceId,
  deriveProjectId,
  deriveRelationId,
  deriveRoomId,
  deriveSnapshotId,
} from './identity.mjs';

const UTF8 = new TextDecoder('utf-8', { fatal: true });
const REGULAR_MODES = new Set(['100644', '100755']);
const VALID_MODE_TYPES = new Set([
  '040000 tree',
  '100644 blob',
  '100755 blob',
  '120000 blob',
  '160000 commit',
]);
const HEX_40 = /^[a-f0-9]{40}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const ROOT_MARKER = 'root-package';
const MANIFEST_NAME = Buffer.from('package.json');
const COLLISION_CODES = new Set([
  'station-extract/path-case-collision',
  'station-extract/path-nfc-collision',
]);
const UNSUPPORTED_SELECTED_PATH_CODES = new Set([
  'station-extract/path-encoding-unsupported',
  'station-extract/path-control-unsupported',
  'station-extract/path-shape-unsupported',
]);

function failure(code, message, artifact, path = '/') {
  throw new StationDiagnosticError(createStationDiagnostic({
    code,
    severity: 'error',
    message,
    subject: { artifact },
    evidence: { path },
    supportedFixes: ['rebuild both artifacts from one verified immutable reader session'],
  }));
}

function sessionFailure(message, path = '/') {
  failure('station-gate/evidence-identity-mismatch', message, STATION_SCHEMAS.evidence, path);
}

function sortedUnique(values, comparator = compareCodePoints) {
  return [...new Set(values)].sort(comparator);
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactJson(input, artifact, validate) {
  if (!Buffer.isBuffer(input)) {
    failure('station-gate/schema-invalid', 'Gate input must be one exact Buffer.', artifact);
  }
  let text;
  try {
    text = UTF8.decode(input);
  } catch {
    failure('station-gate/schema-invalid', 'Artifact bytes are not valid UTF-8.', artifact);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    failure('station-gate/schema-invalid', 'Artifact bytes are not valid JSON.', artifact);
  }
  validate(value);
  const canonical = canonicalJsonBytes(value);
  if (!input.equals(canonical)) {
    failure(
      'station-gate/canonical-mismatch',
      'Artifact bytes are not the unique canonical JSON representation.',
      artifact,
    );
  }
  return value;
}

function repositoryIdentity(url) {
  if (!isStationCanonicalRepositoryUrl(url)) sessionFailure('Reader repository URL is not canonical.', '/repository/url');
  const parsed = new URL(url);
  const path = parsed.pathname.slice(1);
  const identityPath = parsed.hostname === 'github.com' ? path.toLowerCase() : path;
  return JSON.stringify([parsed.hostname, 'standard', 'repository', identityPath]);
}

function repositoryLabel(url) {
  return new URL(url).pathname.split('/').filter(Boolean).at(-1);
}

function pathHasManifestName(pathBytes) {
  if (pathBytes.equals(MANIFEST_NAME)) return true;
  const offset = pathBytes.length - MANIFEST_NAME.length;
  return offset > 0 && pathBytes[offset - 1] === 0x2f && pathBytes.subarray(offset).equals(MANIFEST_NAME);
}

function unsupportedInventoryFacts(inventory) {
  const facts = [];
  const found = new Set();
  const add = (entryIndex, code) => {
    const key = `${entryIndex}\0${code}`;
    if (found.has(key)) return;
    found.add(key);
    const entry = inventory[entryIndex];
    facts.push({
      code,
      path: entry.path,
      pathBytesHex: entry.pathBytes.toString('hex'),
      entryIndex,
    });
  };
  for (const [index, entry] of inventory.entries()) {
    if (entry.path === null) {
      add(index, 'station-extract/path-encoding-unsupported');
      continue;
    }
    if (CONTROL.test(entry.path)) add(index, 'station-extract/path-control-unsupported');
    const segments = entry.path.split('/');
    if (entry.path.startsWith('/') || segments.some((segment) => !segment || segment === '.' || segment === '..' || segment === '.git')) {
      add(index, 'station-extract/path-shape-unsupported');
    }
  }
  for (const [normalize, code] of [
    [(value) => value.toLowerCase(), 'station-extract/path-case-collision'],
    [(value) => value.normalize('NFC'), 'station-extract/path-nfc-collision'],
  ]) {
    const groups = new Map();
    for (const [index, entry] of inventory.entries()) {
      if (entry.path === null) continue;
      const key = normalize(entry.path);
      const group = groups.get(key) || [];
      group.push(index);
      groups.set(key, group);
    }
    for (const indexes of groups.values()) {
      if (indexes.length > 1 && new Set(indexes.map((index) => inventory[index].path)).size > 1) {
        indexes.forEach((index) => add(index, code));
      }
    }
  }
  return facts.sort((left, right) => left.entryIndex - right.entryIndex || compareCodePoints(left.code, right.code));
}

function sameJson(left, right) {
  return canonicalJsonBytes(left).equals(canonicalJsonBytes(right));
}

function verifyReaderSession(reader) {
  if (!reader || !plainObject(reader.repository) || !plainObject(reader.limits)
      || !Array.isArray(reader.inventory) || !Array.isArray(reader.manifestCandidates)
      || !Array.isArray(reader.unsupportedPaths) || !plainObject(reader.manifestPolicy)
      || typeof reader.statBlob !== 'function' || typeof reader.readBlob !== 'function') {
    sessionFailure('Gate requires one complete verified immutable reader session.');
  }
  const expectedLimits = {
    treeOutputBytes: STATION_LIMITS.max_tree_bytes,
    manifestCount: STATION_LIMITS.max_manifest_count,
    manifestBytes: STATION_LIMITS.max_manifest_bytes,
    totalManifestBytes: STATION_LIMITS.max_selected_manifest_bytes,
  };
  if (!sameJson(reader.limits, expectedLimits)) sessionFailure('Reader resource limits differ from the fixed contract.', '/extractor/limits');

  const seen = new Set();
  let previous = null;
  for (const [index, entry] of reader.inventory.entries()) {
    if (!entry || !VALID_MODE_TYPES.has(`${entry.mode} ${entry.type}`) || !HEX_40.test(entry.oid)
        || !Buffer.isBuffer(entry.pathBytes) || entry.pathBytes.length === 0) {
      sessionFailure('Reader inventory contains a malformed tree record.', `/inventory/${index}`);
    }
    const key = entry.pathBytes.toString('hex');
    if (seen.has(key)) sessionFailure('Reader inventory contains a duplicate exact path.', `/inventory/${index}`);
    seen.add(key);
    if (previous && (Buffer.compare(previous.pathBytes, entry.pathBytes) > 0
        || (Buffer.compare(previous.pathBytes, entry.pathBytes) === 0 && previous.oid > entry.oid))) {
      sessionFailure('Reader inventory is not in complete canonical tree order.', `/inventory/${index}`);
    }
    let decoded = null;
    try {
      decoded = UTF8.decode(entry.pathBytes);
    } catch {
      // Null is the only valid decoded representation for unsupported bytes.
    }
    if (entry.path !== decoded) sessionFailure('Reader path text disagrees with its exact tree bytes.', `/inventory/${index}/path`);
    previous = entry;
  }

  const candidates = reader.inventory.filter(({ pathBytes }) => pathHasManifestName(pathBytes));
  if (reader.manifestCandidates.length !== candidates.length
      || reader.manifestCandidates.some((entry, index) => entry !== candidates[index])) {
    sessionFailure('Reader manifest inventory is incomplete or invented.', '/manifestCandidates');
  }
  const policy = {
    discovered: candidates.length,
    limit: STATION_LIMITS.max_manifest_count,
    exceeded: candidates.length > STATION_LIMITS.max_manifest_count,
  };
  if (!sameJson(reader.manifestPolicy, policy)) sessionFailure('Reader manifest-count policy is inconsistent.', '/manifestPolicy');
  if (!sameJson(reader.unsupportedPaths, unsupportedInventoryFacts(reader.inventory))) {
    sessionFailure('Reader unsupported-path accounting is incomplete.', '/unsupportedPaths');
  }
  if (!isStationCanonicalRepositoryUrl(reader.repository.url)
      || !HEX_40.test(reader.repository.revision)
      || !HEX_40.test(reader.repository.treeOid)
      || reader.repository.objectFormat !== 'sha1') {
    sessionFailure('Reader repository identity is malformed.', '/repository');
  }
  return reader;
}

function emptyWorkspace() {
  return { kind: 'unsupported', root_manifest_evidence_id: null, patterns: [], package_roots: [] };
}

function evidenceResult(reader, {
  files = [], workspace = emptyWorkspace(), packages = [], reasons = [], selectedCount = 0,
} = {}) {
  const fallback = sortedUnique(reasons, compareFallbackCodes);
  const eligible = fallback.length === 0;
  return {
    schema: STATION_SCHEMAS.evidence,
    extractor: {
      profile: STATION_PROFILE,
      contract_version: STATION_CONTRACT_VERSION,
      limits: { ...STATION_LIMITS },
    },
    repository: {
      id: deriveProjectId(repositoryIdentity(reader.repository.url)),
      url: reader.repository.url,
      revision: reader.repository.revision,
      tree_oid: reader.repository.treeOid,
      object_format: reader.repository.objectFormat,
    },
    files: [...files].sort(compareFiles),
    workspace: {
      ...workspace,
      kind: eligible ? workspace.kind : 'unsupported',
      patterns: sortedUnique(workspace.patterns),
      package_roots: sortedUnique(workspace.package_roots),
    },
    packages: eligible ? [...packages].sort(comparePackages) : [],
    analysis: {
      detail_eligible: eligible,
      discovered_manifest_count: reader.manifestCandidates.length,
      selected_manifest_count: selectedCount,
      represented_manifest_count: eligible ? packages.length : 0,
      fallback_reason_codes: fallback,
    },
  };
}

function entryAt(reader, path) {
  return reader.inventory.find((entry) => entry.path === path);
}

function regular(entry) {
  return entry?.type === 'blob' && REGULAR_MODES.has(entry.mode);
}

function safeSize(reader, entry) {
  let size;
  try {
    size = reader.statBlob(entry.oid);
  } catch {
    sessionFailure('Exact blob size could not be reconfirmed.', `/objects/${entry.oid}`);
  }
  if (!Number.isSafeInteger(size) || size < 0) sessionFailure('Exact blob size probe is malformed.', `/objects/${entry.oid}`);
  return size;
}

function safeRead(reader, entry, size) {
  let value;
  try {
    value = reader.readBlob(entry.oid, {
      expectedSize: size,
      integrityCeiling: STATION_LIMITS.max_manifest_bytes,
    });
  } catch {
    sessionFailure('Exact blob bytes could not be reconfirmed.', `/objects/${entry.oid}`);
  }
  if (!Buffer.isBuffer(value) || value.length !== size) {
    sessionFailure('Blob probe and reread byte counts disagree.', `/objects/${entry.oid}`);
  }
  return value;
}

function fileFact(entry, content) {
  return {
    id: deriveEvidenceId(entry.path, entry.oid),
    kind: 'git-blob',
    path: entry.path,
    git_oid: entry.oid,
    sha256: sha256Hex(content),
    bytes: content.length,
  };
}

function decodeManifest(content) {
  if (content.includes(0)) return { reason: 'station-fallback/workspace-manifest-binary' };
  let text;
  try {
    text = UTF8.decode(content);
  } catch {
    return { reason: 'station-fallback/workspace-manifest-encoding-unsupported' };
  }
  try {
    const value = JSON.parse(text);
    return plainObject(value) ? { value } : { reason: 'station-fallback/workspace-manifest-invalid' };
  } catch {
    return { reason: 'station-fallback/workspace-manifest-invalid' };
  }
}

function validManifest(value) {
  if (typeof value?.name !== 'string' || value.name.length === 0) return false;
  if (Object.hasOwn(value, 'private') && typeof value.private !== 'boolean') return false;
  for (const scope of DEPENDENCY_SCOPES) {
    if (!Object.hasOwn(value, scope)) continue;
    if (!plainObject(value[scope])) return false;
    if (Object.entries(value[scope]).some(([name, version]) => !name || typeof version !== 'string')) return false;
  }
  return true;
}

function workspaceDeclaration(value) {
  if (!Object.hasOwn(value, 'workspaces')) return { kind: 'root-package', patterns: [] };
  let patterns;
  if (Array.isArray(value.workspaces)) patterns = value.workspaces;
  else if (plainObject(value.workspaces) && Object.keys(value.workspaces).length === 1
      && Array.isArray(value.workspaces.packages)) patterns = value.workspaces.packages;
  else return { reason: 'station-fallback/workspace-shape-unsupported' };
  if (patterns.length === 0 || patterns.some((pattern) => typeof pattern !== 'string')) {
    return { reason: 'station-fallback/workspace-shape-unsupported' };
  }
  return { kind: 'npm-workspaces', patterns };
}

function parsePattern(pattern) {
  if (!pattern || pattern.startsWith('/') || pattern.endsWith('/') || pattern.includes('\\')) return null;
  const segments = pattern.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment === '.git')) return null;
  const wild = segments.flatMap((segment, index) => (/[*?\[\]{}]/.test(segment) ? [index] : []));
  if (wild.length === 0) return { pattern, wildcard: false };
  if (wild.length === 1 && wild[0] === segments.length - 1 && segments.at(-1) === '*') {
    return { pattern, wildcard: true, prefix: segments.slice(0, -1).join('/') };
  }
  return null;
}

function rootsOverlap(roots) {
  const ordered = [...roots].sort(compareCodePoints);
  return ordered.some((root, index) => ordered.some((other, otherIndex) => index !== otherIndex && other.startsWith(`${root}/`)));
}

function rootsCollide(roots) {
  return [(value) => value.toLowerCase(), (value) => value.normalize('NFC')]
    .some((normalize) => new Set(roots.map(normalize)).size !== roots.length);
}

function selectEntries(reader, patterns) {
  const parsed = patterns.map(parsePattern);
  if (parsed.some((value) => value === null)) {
    return { reasons: ['station-fallback/workspace-pattern-unsupported'], selected: [], roots: [], provenance: new Map() };
  }
  const reasons = [];
  const matches = [];
  for (const pattern of parsed) {
    const prefix = pattern.prefix ? `${pattern.prefix}/` : '';
    const entries = pattern.wildcard
      ? reader.inventory.filter((entry) => {
        if (typeof entry.path !== 'string' || !entry.path.startsWith(prefix) || !entry.path.endsWith('/package.json')) return false;
        const root = entry.path.slice(0, -'/package.json'.length);
        const remainder = root.slice(prefix.length);
        return remainder.length > 0 && !remainder.includes('/');
      })
      : [entryAt(reader, `${pattern.pattern}/package.json`)].filter(Boolean);
    if (entries.length === 0) reasons.push(pattern.wildcard
      ? 'station-fallback/workspace-match-empty'
      : 'station-fallback/workspace-manifest-missing');
    entries.forEach((entry) => matches.push({
      entry,
      pattern: pattern.pattern,
      root: entry.path.slice(0, -'/package.json'.length),
    }));
  }
  const byRoot = new Map();
  for (const match of matches) {
    const group = byRoot.get(match.root) || [];
    group.push(match);
    byRoot.set(match.root, group);
  }
  const roots = [...byRoot.keys()];
  if ([...byRoot.values()].some((group) => group.length !== 1) || rootsOverlap(roots)) {
    reasons.push('station-fallback/workspace-root-ambiguous');
  }
  if (rootsCollide(roots)) reasons.push('station-fallback/path-collision');
  const selected = [...byRoot.values()].map(([match]) => match.entry);
  const selectedIndexes = new Set(selected.map((entry) => reader.inventory.indexOf(entry)));
  if (reader.unsupportedPaths.some(({ code, entryIndex }) => COLLISION_CODES.has(code) && selectedIndexes.has(entryIndex))) {
    reasons.push('station-fallback/path-collision');
  }
  if (reader.unsupportedPaths.some(({ code, entryIndex }) => (
    UNSUPPORTED_SELECTED_PATH_CODES.has(code) && selectedIndexes.has(entryIndex)
  ))) {
    reasons.push('station-fallback/path-unsupported');
  }
  return {
    reasons,
    selected,
    roots,
    provenance: new Map([...byRoot].map(([root, [match]]) => [root, match.pattern])),
  };
}

function declarations(manifest) {
  const found = new Map();
  for (const scope of DEPENDENCY_SCOPES) {
    for (const [name, version] of Object.entries(manifest[scope] || {})) {
      const item = found.get(name) || { scopes: new Set(), versions: new Set() };
      item.scopes.add(scope);
      item.versions.add(version);
      found.set(name, item);
    }
  }
  return {
    values: [...found].map(([name, item]) => ({
      name,
      scopes: [...item.scopes].sort(compareScopes),
    })).sort(compareDeclarations),
    conflicting: [...found.values()].some(({ versions }) => versions.size > 1),
  };
}

function packageFact(root, pattern, manifest, file) {
  const declared = declarations(manifest);
  return {
    value: {
      root,
      name: manifest.name,
      ...(Object.hasOwn(manifest, 'private') ? { private: manifest.private } : {}),
      manifest_evidence_id: file.id,
      workspace_pattern: pattern,
      declared_dependencies: declared.values,
    },
    conflicting: declared.conflicting,
  };
}

function reconstructEvidence(reader) {
  if (reader.manifestPolicy.exceeded) {
    return evidenceResult(reader, { reasons: ['station-fallback/manifest-count-exceeded'] });
  }
  const root = entryAt(reader, 'package.json');
  if (!root) return evidenceResult(reader, { reasons: ['station-fallback/root-manifest-missing'] });
  if (!regular(root)) {
    return evidenceResult(reader, { reasons: ['station-fallback/workspace-manifest-non-regular'], selectedCount: 1 });
  }
  const rootSize = safeSize(reader, root);
  if (rootSize > STATION_LIMITS.max_manifest_bytes) {
    return evidenceResult(reader, { reasons: ['station-fallback/workspace-manifest-oversized'], selectedCount: 1 });
  }
  const rootContent = safeRead(reader, root, rootSize);
  const rootFile = fileFact(root, rootContent);
  const decodedRoot = decodeManifest(rootContent);
  if (decodedRoot.reason || !validManifest(decodedRoot.value)) {
    return evidenceResult(reader, {
      files: [rootFile],
      workspace: { ...emptyWorkspace(), root_manifest_evidence_id: rootFile.id },
      reasons: [decodedRoot.reason || 'station-fallback/workspace-manifest-invalid'],
      selectedCount: 1,
    });
  }
  const declaration = workspaceDeclaration(decodedRoot.value);
  if (declaration.reason) {
    return evidenceResult(reader, {
      files: [rootFile],
      workspace: { ...emptyWorkspace(), root_manifest_evidence_id: rootFile.id },
      reasons: [declaration.reason],
      selectedCount: 1,
    });
  }

  let selected = [root];
  let roots = ['.'];
  let provenance = new Map([['.', ROOT_MARKER]]);
  let selectionReasons = [];
  if (declaration.kind === 'npm-workspaces') {
    const selection = selectEntries(reader, declaration.patterns);
    selected = [root, ...selection.selected];
    roots = selection.roots;
    provenance = selection.provenance;
    selectionReasons = selection.reasons;
  }
  const workspace = {
    kind: declaration.kind,
    root_manifest_evidence_id: rootFile.id,
    patterns: declaration.patterns,
    package_roots: roots,
  };
  if (selectionReasons.includes('station-fallback/workspace-pattern-unsupported')) {
    return evidenceResult(reader, {
      files: [rootFile],
      workspace: { ...workspace, patterns: [] },
      reasons: selectionReasons,
      selectedCount: 1,
    });
  }
  if (selectionReasons.includes('station-fallback/path-unsupported')) {
    return evidenceResult(reader, {
      files: [rootFile],
      workspace: {
        ...emptyWorkspace(),
        root_manifest_evidence_id: rootFile.id,
        patterns: declaration.patterns,
      },
      reasons: selectionReasons,
      selectedCount: selected.length,
    });
  }

  const reasons = [...selectionReasons];
  const sizes = new Map([[root, rootSize]]);
  for (const entry of selected.slice(1)) {
    if (!regular(entry)) {
      reasons.push('station-fallback/workspace-manifest-non-regular');
      continue;
    }
    const size = safeSize(reader, entry);
    sizes.set(entry, size);
    if (size > STATION_LIMITS.max_manifest_bytes) reasons.push('station-fallback/workspace-manifest-oversized');
  }
  if ([...sizes.values()].reduce((sum, size) => sum + size, 0) > STATION_LIMITS.max_selected_manifest_bytes) {
    reasons.push('station-fallback/selected-manifest-bytes-exceeded');
  }
  if (reasons.includes('station-fallback/workspace-manifest-oversized')
      || reasons.includes('station-fallback/selected-manifest-bytes-exceeded')) {
    return evidenceResult(reader, { workspace, reasons, selectedCount: selected.length });
  }

  const files = [rootFile];
  const parsed = new Map([[root, decodedRoot.value]]);
  for (const entry of selected.slice(1)) {
    if (!regular(entry)) continue;
    const content = safeRead(reader, entry, sizes.get(entry));
    files.push(fileFact(entry, content));
    const decoded = decodeManifest(content);
    if (decoded.reason) reasons.push(decoded.reason);
    else if (!validManifest(decoded.value)) reasons.push('station-fallback/workspace-manifest-invalid');
    else parsed.set(entry, decoded.value);
  }

  const fileByPath = new Map(files.map((file) => [file.path, file]));
  const packages = [];
  for (const entry of selected) {
    const manifest = parsed.get(entry);
    const file = fileByPath.get(entry.path);
    if (!manifest || !file) continue;
    const rootPath = entry === root ? '.' : entry.path.slice(0, -'/package.json'.length);
    const result = packageFact(rootPath, entry === root ? ROOT_MARKER : provenance.get(rootPath), manifest, file);
    packages.push(result.value);
    if (result.conflicting) reasons.push('station-fallback/package-name-ambiguous');
  }
  if (new Set(packages.map(({ name }) => name)).size !== packages.length) {
    reasons.push('station-fallback/package-name-ambiguous');
  }
  return evidenceResult(reader, { files, workspace, packages, reasons, selectedCount: selected.length });
}

function componentRoom(projectId, structuralKey, label, packages) {
  return {
    id: deriveRoomId(projectId, structuralKey),
    project_id: projectId,
    kind: 'component',
    structural_key: structuralKey,
    label,
    package_roots: packages.map(({ root }) => root).sort(compareCodePoints),
    confidence: 'high',
    evidence_ids: sortedUnique(packages.map(({ manifest_evidence_id }) => manifest_evidence_id), compareEvidenceIds),
  };
}

function structuralRooms(evidence, projectId, byRoot) {
  if (evidence.workspace.kind === 'root-package') {
    return [componentRoom(projectId, ROOT_MARKER, ROOT_MARKER, [byRoot.get('.')])];
  }
  const groups = new Map();
  for (const root of evidence.workspace.package_roots) {
    const segment = root.split('/')[0];
    const values = groups.get(segment) || [];
    values.push(byRoot.get(root));
    groups.set(segment, values);
  }
  return [...groups].map(([segment, packages]) => componentRoom(
    projectId,
    `workspace-path-group:${segment}`,
    segment,
    packages,
  )).sort(compareRooms);
}

function structuralRelations(evidence, rooms, byRoot) {
  const roomByRoot = new Map();
  rooms.forEach((room) => room.package_roots.forEach((root) => roomByRoot.set(root, room)));
  const roomByName = new Map();
  for (const [root, room] of roomByRoot) roomByName.set(byRoot.get(root).name, room);
  const aggregate = new Map();
  for (const [root, fromRoom] of roomByRoot) {
    const source = byRoot.get(root);
    for (const declaration of source.declared_dependencies) {
      const toRoom = roomByName.get(declaration.name);
      if (!toRoom || toRoom.id === fromRoom.id) continue;
      const key = `${fromRoom.id}\0${toRoom.id}`;
      const item = aggregate.get(key) || { fromRoom, toRoom, scopes: new Set(), evidence: new Set() };
      declaration.scopes.forEach((scope) => item.scopes.add(scope));
      item.evidence.add(source.manifest_evidence_id);
      aggregate.set(key, item);
    }
  }
  return [...aggregate.values()].map((item) => ({
    id: deriveRelationId(item.fromRoom.id, item.toRoom.id),
    kind: 'declared-package-dependency',
    from_room_id: item.fromRoom.id,
    to_room_id: item.toRoom.id,
    scopes: [...item.scopes].sort(compareScopes),
    evidence_ids: [...item.evidence].sort(compareEvidenceIds),
  })).sort(compareRelations);
}

function reconstructMap(evidence, evidenceBytes) {
  const projectId = deriveProjectId(repositoryIdentity(evidence.repository.url));
  const label = repositoryLabel(evidence.repository.url);
  const evidenceHash = sha256Hex(evidenceBytes);
  let reasons = evidence.analysis.fallback_reason_codes;
  let rooms;
  let relations = [];
  if (evidence.analysis.detail_eligible) {
    const byRoot = new Map(evidence.packages.map((value) => [value.root, value]));
    rooms = structuralRooms(evidence, projectId, byRoot);
    if (rooms.length < 1 || rooms.length > 5) reasons = ['station-fallback/room-count-out-of-range'];
    else relations = structuralRelations(evidence, rooms, byRoot);
  }
  if (reasons.length) {
    const rootPackage = evidence.packages.find(({ root }) => root === '.');
    rooms = [{
      id: deriveRoomId(projectId, 'project-root'),
      project_id: projectId,
      kind: 'coarse-project',
      structural_key: 'project-root',
      label: rootPackage?.name || label,
      package_roots: [],
      confidence: 'coarse',
      evidence_ids: sortedUnique(evidence.files.map(({ id }) => id), compareEvidenceIds),
    }];
    relations = [];
  }
  const coarse = reasons.length > 0;
  return {
    schema: STATION_SCHEMAS.map,
    snapshot: {
      id: deriveSnapshotId(projectId, evidence.repository.revision, evidenceHash, STATION_PROFILE),
      project_id: projectId,
      revision: evidence.repository.revision,
      evidence_sha256: evidenceHash,
      profile: STATION_PROFILE,
      mode: coarse ? 'coarse' : 'structural',
    },
    project: { id: projectId, label },
    rooms,
    relations,
    fallback: { used: coarse, reason_codes: sortedUnique(reasons, compareFallbackCodes) },
  };
}

function firstDifference(actual, expected, path = '') {
  if (Object.is(actual, expected)) return null;
  if ((Array.isArray(actual) && Array.isArray(expected))
      || (plainObject(actual) && plainObject(expected))) {
    if (sameJson(actual, expected)) return null;
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length === expected.length) {
      const left = actual.map((value) => canonicalJsonBytes(value).toString('utf8')).sort(compareCodePoints);
      const right = expected.map((value) => canonicalJsonBytes(value).toString('utf8')).sort(compareCodePoints);
      if (left.every((value, index) => value === right[index])) return { path: path || '/', order: true };
    }
    const length = Math.min(actual.length, expected.length);
    for (let index = 0; index < length; index += 1) {
      const difference = firstDifference(actual[index], expected[index], `${path}/${index}`);
      if (difference) return difference;
    }
    return { path: path || '/', order: false };
  }
  if (plainObject(actual) && plainObject(expected)) {
    const keys = sortedUnique([...Object.keys(actual), ...Object.keys(expected)]);
    for (const key of keys) {
      if (!Object.hasOwn(actual, key) || !Object.hasOwn(expected, key)) return { path: `${path}/${key}`, order: false };
      const difference = firstDifference(actual[key], expected[key], `${path}/${key}`);
      if (difference) return difference;
    }
  }
  return { path: path || '/', order: false };
}

function mismatch(artifact, actual, expected) {
  const difference = firstDifference(actual, expected);
  let code = 'station-gate/unsupported-claim';
  if (difference.order) code = 'station-gate/order-mismatch';
  else if (artifact === STATION_SCHEMAS.evidence) {
    if (/manifest_evidence_id|root_manifest_evidence_id|evidence_ids/.test(difference.path)) {
      code = 'station-gate/evidence-reference-missing';
    } else if (/^\/(extractor|repository|files)(?:\/|$)/.test(difference.path)) {
      code = 'station-gate/evidence-identity-mismatch';
    }
  } else if (/^\/(snapshot\/(id|project_id|revision|evidence_sha256|profile)|project\/id|rooms\/\d+\/(id|project_id)|relations\/\d+\/id)/.test(difference.path)) {
    code = 'station-gate/topology-identity-mismatch';
  }
  failure(code, 'Artifact claims do not match independent immutable recomputation.', artifact, difference.path);
}

export function gateStationArtifacts(evidenceBytes, mapBytes, readerSession) {
  const suppliedEvidence = Buffer.isBuffer(evidenceBytes) ? Buffer.from(evidenceBytes) : evidenceBytes;
  const suppliedMap = Buffer.isBuffer(mapBytes) ? Buffer.from(mapBytes) : mapBytes;
  const evidence = exactJson(suppliedEvidence, STATION_SCHEMAS.evidence, validateStationEvidence);
  const map = exactJson(suppliedMap, STATION_SCHEMAS.map, validateStationMap);
  const reader = verifyReaderSession(readerSession);
  const expectedEvidence = reconstructEvidence(reader);
  validateStationEvidence(expectedEvidence);
  if (!sameJson(evidence, expectedEvidence)) mismatch(STATION_SCHEMAS.evidence, evidence, expectedEvidence);
  const expectedEvidenceBytes = canonicalJsonBytes(expectedEvidence);
  if (!suppliedEvidence.equals(expectedEvidenceBytes)) mismatch(STATION_SCHEMAS.evidence, evidence, expectedEvidence);

  const expectedMap = reconstructMap(expectedEvidence, expectedEvidenceBytes);
  validateStationMap(expectedMap);
  if (!sameJson(map, expectedMap)) mismatch(STATION_SCHEMAS.map, map, expectedMap);
  const expectedMapBytes = canonicalJsonBytes(expectedMap);
  if (!suppliedMap.equals(expectedMapBytes)) mismatch(STATION_SCHEMAS.map, map, expectedMap);

  const acceptedEvidence = Buffer.from(suppliedEvidence);
  const acceptedMap = Buffer.from(suppliedMap);
  return Object.freeze({
    get evidence_bytes() { return Buffer.from(acceptedEvidence); },
    get map_bytes() { return Buffer.from(acceptedMap); },
    evidence_sha256: sha256Hex(acceptedEvidence),
    map_sha256: sha256Hex(acceptedMap),
    repository: Object.freeze({
      url: expectedEvidence.repository.url,
      revision: expectedEvidence.repository.revision,
      tree_oid: expectedEvidence.repository.tree_oid,
      object_format: expectedEvidence.repository.object_format,
    }),
    project_id: expectedEvidence.repository.id,
    snapshot_id: expectedMap.snapshot.id,
    mode: expectedMap.snapshot.mode,
    room_count: expectedMap.rooms.length,
    relation_count: expectedMap.relations.length,
    fallback: expectedMap.fallback.used,
    fallback_reason_codes: Object.freeze([...expectedMap.fallback.reason_codes]),
  });
}
