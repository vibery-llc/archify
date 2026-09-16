import { TextDecoder } from 'node:util';
import { parseRepositoryRemote } from '../../../archify/renderers/shared/repository-location.mjs';
import {
  DEPENDENCY_SCOPES,
  STATION_CONTRACT_VERSION,
  STATION_LIMITS,
  STATION_PROFILE,
  STATION_SCHEMAS,
  validateStationEvidence,
} from './contracts.mjs';
import {
  canonicalJsonBytes,
  compareCodePoints,
  compareDeclarations,
  compareFallbackCodes,
  compareFiles,
  comparePackages,
  compareScopes,
  sha256Hex,
} from './canonical-json.mjs';
import { deriveEvidenceId, deriveProjectId } from './identity.mjs';

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
const ROOT_MARKER = 'root-package';
const REGULAR_MODES = new Set(['100644', '100755']);
const COLLISION_CODES = new Set([
  'station-extract/path-case-collision',
  'station-extract/path-nfc-collision',
]);
const UNSUPPORTED_SELECTED_PATH_CODES = new Set([
  'station-extract/path-encoding-unsupported',
  'station-extract/path-control-unsupported',
  'station-extract/path-shape-unsupported',
]);

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sortedUnique(values, comparator = compareCodePoints) {
  return [...new Set(values)].sort(comparator);
}

function extractorContract() {
  return {
    profile: STATION_PROFILE,
    contract_version: STATION_CONTRACT_VERSION,
    limits: { ...STATION_LIMITS },
  };
}

function repositoryContract(reader) {
  const repository = reader?.repository;
  const location = parseRepositoryRemote(repository?.url, { authored: true });
  if (!location) throw new TypeError('Reader repository URL must be one canonical repository identity.');
  return {
    id: deriveProjectId(location.identity),
    url: repository.url,
    revision: repository.revision.toLowerCase(),
    tree_oid: repository.treeOid.toLowerCase(),
    object_format: repository.objectFormat,
  };
}

function emptyWorkspace() {
  return {
    kind: 'unsupported',
    root_manifest_evidence_id: null,
    patterns: [],
    package_roots: [],
  };
}

function finish(reader, {
  files = [],
  workspace = emptyWorkspace(),
  packages = [],
  reasons = [],
  selectedCount = 0,
} = {}) {
  const fallbackReasonCodes = sortedUnique(reasons, compareFallbackCodes);
  const detailEligible = fallbackReasonCodes.length === 0;
  const value = {
    schema: STATION_SCHEMAS.evidence,
    extractor: extractorContract(),
    repository: repositoryContract(reader),
    files: [...files].sort(compareFiles),
    workspace: {
      ...workspace,
      kind: detailEligible ? workspace.kind : 'unsupported',
      patterns: sortedUnique(workspace.patterns),
      package_roots: sortedUnique(workspace.package_roots),
    },
    packages: detailEligible ? [...packages].sort(comparePackages) : [],
    analysis: {
      detail_eligible: detailEligible,
      discovered_manifest_count: reader.manifestPolicy.discovered,
      selected_manifest_count: selectedCount,
      represented_manifest_count: detailEligible ? packages.length : 0,
      fallback_reason_codes: fallbackReasonCodes,
    },
  };
  validateStationEvidence(value);
  return Object.freeze({ value, bytes: canonicalJsonBytes(value) });
}

function isRegularManifest(entry) {
  return entry?.type === 'blob' && REGULAR_MODES.has(entry.mode);
}

function fileRecord(entry, bytes) {
  return {
    id: deriveEvidenceId(entry.path, entry.oid),
    kind: 'git-blob',
    path: entry.path,
    git_oid: entry.oid,
    sha256: sha256Hex(bytes),
    bytes: bytes.length,
  };
}

function readExactManifest(reader, entry, size) {
  const bytes = reader.readBlob(entry.oid, {
    expectedSize: size,
    integrityCeiling: STATION_LIMITS.max_manifest_bytes,
  });
  if (!Buffer.isBuffer(bytes) || bytes.length !== size) {
    throw new Error('Manifest blob probe/read mismatch crossed the immutable reader boundary.');
  }
  return bytes;
}

function decodeManifest(bytes) {
  if (bytes.includes(0)) return { reason: 'station-fallback/workspace-manifest-binary' };
  let text;
  try {
    text = UTF8_DECODER.decode(bytes);
  } catch {
    return { reason: 'station-fallback/workspace-manifest-encoding-unsupported' };
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { reason: 'station-fallback/workspace-manifest-invalid' };
  }
  if (!plainObject(value)) return { reason: 'station-fallback/workspace-manifest-invalid' };
  return { value };
}

function validPackageManifest(value) {
  if (typeof value.name !== 'string' || value.name.length === 0) return false;
  if (Object.hasOwn(value, 'private') && typeof value.private !== 'boolean') return false;
  for (const scope of DEPENDENCY_SCOPES) {
    if (!Object.hasOwn(value, scope)) continue;
    if (!plainObject(value[scope])) return false;
    for (const [name, declaration] of Object.entries(value[scope])) {
      if (!name || typeof declaration !== 'string') return false;
    }
  }
  return true;
}

function workspacePatterns(value) {
  if (!Object.hasOwn(value, 'workspaces')) return { kind: 'root-package', patterns: [] };
  let patterns;
  if (Array.isArray(value.workspaces)) {
    patterns = value.workspaces;
  } else if (plainObject(value.workspaces)
      && Object.keys(value.workspaces).length === 1
      && Object.hasOwn(value.workspaces, 'packages')
      && Array.isArray(value.workspaces.packages)) {
    patterns = value.workspaces.packages;
  } else {
    return { reason: 'station-fallback/workspace-shape-unsupported' };
  }
  if (patterns.length === 0 || patterns.some((pattern) => typeof pattern !== 'string')) {
    return { reason: 'station-fallback/workspace-shape-unsupported' };
  }
  return { kind: 'npm-workspaces', patterns };
}

function parsePattern(pattern) {
  if (!pattern || pattern.startsWith('/') || pattern.endsWith('/') || pattern.includes('\\')) return null;
  const segments = pattern.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment === '.git')) return null;
  const wildcardIndexes = [];
  for (const [index, segment] of segments.entries()) {
    if (/[*?\[\]{}]/.test(segment)) wildcardIndexes.push(index);
  }
  if (wildcardIndexes.length === 0) return { pattern, segments, wildcard: false };
  if (wildcardIndexes.length === 1
      && wildcardIndexes[0] === segments.length - 1
      && segments.at(-1) === '*') {
    return { pattern, segments, wildcard: true, prefix: segments.slice(0, -1).join('/') };
  }
  return null;
}

function entryAtPath(reader, path) {
  return reader.inventory.find((entry) => entry.path === path);
}

function wildcardEntries(reader, parsed) {
  const prefix = parsed.prefix ? `${parsed.prefix}/` : '';
  return reader.inventory.filter((entry) => {
    if (typeof entry.path !== 'string' || !entry.path.startsWith(prefix) || !entry.path.endsWith('/package.json')) return false;
    const root = entry.path.slice(0, -'/package.json'.length);
    const remainder = root.slice(prefix.length);
    return remainder.length > 0 && !remainder.includes('/');
  });
}

function rootsCollide(roots) {
  for (const normalize of [(value) => value.toLowerCase(), (value) => value.normalize('NFC')]) {
    const normalized = roots.map(normalize);
    if (new Set(normalized).size !== roots.length) return true;
  }
  return false;
}

function rootsOverlap(roots) {
  const ordered = [...roots].sort(compareCodePoints);
  return ordered.some((root, index) => ordered.some((other, otherIndex) => (
    index !== otherIndex && other.startsWith(`${root}/`)
  )));
}

function selectedHasReaderClassification(reader, selectedEntries, codes) {
  const selectedIndexes = new Set(selectedEntries.map((entry) => reader.inventory.indexOf(entry)));
  return reader.unsupportedPaths.some(({ code, entryIndex }) => (
    codes.has(code) && selectedIndexes.has(entryIndex)
  ));
}

function manifestInventoryHasReaderClassification(reader, codes) {
  const manifestIndexes = new Set(reader.manifestCandidates.map((entry) => reader.inventory.indexOf(entry)));
  return reader.unsupportedPaths.some(({ code, entryIndex }) => (
    codes.has(code) && manifestIndexes.has(entryIndex)
  ));
}

function selectWorkspaceEntries(reader, patterns) {
  const parsedPatterns = patterns.map(parsePattern);
  if (parsedPatterns.some((pattern) => pattern === null)) {
    return { reasons: ['station-fallback/workspace-pattern-unsupported'], selected: [], roots: [], provenance: new Map() };
  }

  const reasons = [];
  const matches = [];
  for (const parsed of parsedPatterns) {
    const entries = parsed.wildcard
      ? wildcardEntries(reader, parsed)
      : [entryAtPath(reader, `${parsed.pattern}/package.json`)].filter(Boolean);
    if (entries.length === 0) {
      reasons.push(parsed.wildcard
        ? 'station-fallback/workspace-match-empty'
        : 'station-fallback/workspace-manifest-missing');
    }
    for (const entry of entries) {
      matches.push({ entry, pattern: parsed.pattern, root: entry.path.slice(0, -'/package.json'.length) });
    }
  }

  const byRoot = new Map();
  for (const match of matches) {
    const group = byRoot.get(match.root) || [];
    group.push(match);
    byRoot.set(match.root, group);
  }
  if ([...byRoot.values()].some((group) => group.length !== 1) || rootsOverlap([...byRoot.keys()])) {
    reasons.push('station-fallback/workspace-root-ambiguous');
  }
  if (rootsCollide([...byRoot.keys()])) reasons.push('station-fallback/path-collision');

  const selected = [...byRoot.values()].map(([match]) => match.entry);
  if (selectedHasReaderClassification(reader, selected, COLLISION_CODES)) {
    reasons.push('station-fallback/path-collision');
  }
  if (selectedHasReaderClassification(reader, selected, UNSUPPORTED_SELECTED_PATH_CODES)) {
    reasons.push('station-fallback/path-unsupported');
  }
  return {
    reasons,
    selected,
    roots: [...byRoot.keys()],
    provenance: new Map([...byRoot].map(([root, [match]]) => [root, match.pattern])),
  };
}

function manifestDeclarations(manifest) {
  const declarations = new Map();
  for (const scope of DEPENDENCY_SCOPES) {
    for (const [name, declaredVersion] of Object.entries(manifest[scope] || {})) {
      const current = declarations.get(name) || { scopes: new Set(), versions: new Set() };
      current.scopes.add(scope);
      current.versions.add(declaredVersion);
      declarations.set(name, current);
    }
  }
  return {
    values: [...declarations].map(([name, declaration]) => ({
      name,
      scopes: [...declaration.scopes].sort(compareScopes),
    })).sort(compareDeclarations),
    conflicting: [...declarations.values()].some(({ versions }) => versions.size > 1),
  };
}

function packageRecord(root, pattern, manifest, file) {
  const declarations = manifestDeclarations(manifest);
  return {
    value: {
      root,
      name: manifest.name,
      ...(Object.hasOwn(manifest, 'private') ? { private: manifest.private } : {}),
      manifest_evidence_id: file.id,
      workspace_pattern: pattern,
      declared_dependencies: declarations.values,
    },
    conflicting: declarations.conflicting,
  };
}

function assertReader(reader) {
  if (!reader || !Array.isArray(reader.inventory) || !Array.isArray(reader.manifestCandidates)
      || !Array.isArray(reader.unsupportedPaths) || !reader.manifestPolicy
      || typeof reader.statBlob !== 'function' || typeof reader.readBlob !== 'function') {
    throw new TypeError('buildStationEvidence requires one complete immutable Git object reader session.');
  }
}

export function buildStationEvidence(reader) {
  assertReader(reader);
  if (reader.manifestPolicy.exceeded) {
    return finish(reader, {
      reasons: ['station-fallback/manifest-count-exceeded'],
      selectedCount: 0,
    });
  }

  const rootEntry = entryAtPath(reader, 'package.json');
  if (!rootEntry) {
    return finish(reader, { reasons: ['station-fallback/root-manifest-missing'] });
  }
  if (!isRegularManifest(rootEntry)) {
    return finish(reader, {
      reasons: ['station-fallback/workspace-manifest-non-regular'],
      selectedCount: 1,
    });
  }

  const rootSize = reader.statBlob(rootEntry.oid);
  if (rootSize > STATION_LIMITS.max_manifest_bytes) {
    return finish(reader, {
      reasons: ['station-fallback/workspace-manifest-oversized'],
      selectedCount: 1,
    });
  }
  const rootBytes = readExactManifest(reader, rootEntry, rootSize);
  const rootFile = fileRecord(rootEntry, rootBytes);
  const decodedRoot = decodeManifest(rootBytes);
  if (decodedRoot.reason || !validPackageManifest(decodedRoot.value)) {
    return finish(reader, {
      files: [rootFile],
      workspace: { ...emptyWorkspace(), root_manifest_evidence_id: rootFile.id },
      reasons: [decodedRoot.reason || 'station-fallback/workspace-manifest-invalid'],
      selectedCount: 1,
    });
  }

  const declaration = workspacePatterns(decodedRoot.value);
  if (declaration.reason) {
    return finish(reader, {
      files: [rootFile],
      workspace: { ...emptyWorkspace(), root_manifest_evidence_id: rootFile.id },
      reasons: [declaration.reason],
      selectedCount: 1,
    });
  }

  let selectedEntries = [rootEntry];
  let roots = ['.'];
  let provenance = new Map([['.', ROOT_MARKER]]);
  let selectionReasons = [];
  if (declaration.kind === 'npm-workspaces') {
    const selection = selectWorkspaceEntries(reader, declaration.patterns);
    selectedEntries = [rootEntry, ...selection.selected];
    roots = selection.roots;
    provenance = selection.provenance;
    selectionReasons = selection.reasons;
  }
  if (manifestInventoryHasReaderClassification(reader, UNSUPPORTED_SELECTED_PATH_CODES)) {
    selectionReasons.push('station-fallback/path-unsupported');
  }

  const workspace = {
    kind: declaration.kind,
    root_manifest_evidence_id: rootFile.id,
    patterns: declaration.patterns,
    package_roots: roots,
  };
  if (selectionReasons.includes('station-fallback/workspace-pattern-unsupported')) {
    return finish(reader, {
      files: [rootFile],
      workspace: { ...workspace, patterns: [] },
      reasons: selectionReasons,
      selectedCount: 1,
    });
  }
  if (selectionReasons.includes('station-fallback/path-unsupported')) {
    return finish(reader, {
      files: [rootFile],
      workspace: {
        ...emptyWorkspace(),
        root_manifest_evidence_id: rootFile.id,
        patterns: declaration.patterns,
      },
      reasons: selectionReasons,
      selectedCount: selectedEntries.length,
    });
  }

  const reasons = [...selectionReasons];
  const sizes = new Map([[rootEntry, rootSize]]);
  for (const entry of selectedEntries.slice(1)) {
    if (!isRegularManifest(entry)) {
      reasons.push('station-fallback/workspace-manifest-non-regular');
      continue;
    }
    const size = reader.statBlob(entry.oid);
    sizes.set(entry, size);
    if (size > STATION_LIMITS.max_manifest_bytes) reasons.push('station-fallback/workspace-manifest-oversized');
  }
  const selectedBytes = [...sizes.values()].reduce((sum, size) => sum + size, 0);
  if (selectedBytes > STATION_LIMITS.max_selected_manifest_bytes) {
    reasons.push('station-fallback/selected-manifest-bytes-exceeded');
  }
  if (reasons.includes('station-fallback/workspace-manifest-oversized')
      || reasons.includes('station-fallback/selected-manifest-bytes-exceeded')) {
    return finish(reader, {
      workspace,
      reasons,
      selectedCount: selectedEntries.length,
    });
  }

  const files = [rootFile];
  const parsed = new Map([[rootEntry, decodedRoot.value]]);
  for (const entry of selectedEntries.slice(1)) {
    if (!isRegularManifest(entry)) continue;
    const bytes = readExactManifest(reader, entry, sizes.get(entry));
    files.push(fileRecord(entry, bytes));
    const decoded = decodeManifest(bytes);
    if (decoded.reason) {
      reasons.push(decoded.reason);
    } else if (!validPackageManifest(decoded.value)) {
      reasons.push('station-fallback/workspace-manifest-invalid');
    } else {
      parsed.set(entry, decoded.value);
    }
  }

  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const packages = [];
  for (const entry of selectedEntries) {
    const manifest = parsed.get(entry);
    const file = filesByPath.get(entry.path);
    if (!manifest || !file) continue;
    const root = entry === rootEntry ? '.' : entry.path.slice(0, -'/package.json'.length);
    const packageResult = packageRecord(root, entry === rootEntry ? ROOT_MARKER : provenance.get(root), manifest, file);
    packages.push(packageResult.value);
    if (packageResult.conflicting) reasons.push('station-fallback/package-name-ambiguous');
  }
  const packageNames = packages.map(({ name }) => name);
  if (new Set(packageNames).size !== packageNames.length) {
    reasons.push('station-fallback/package-name-ambiguous');
  }

  return finish(reader, {
    files,
    workspace,
    packages,
    reasons,
    selectedCount: selectedEntries.length,
  });
}
