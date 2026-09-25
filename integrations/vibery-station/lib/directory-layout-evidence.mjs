import {
  DIRECTORY_CODE_EXTENSIONS,
  DIRECTORY_CONVENTIONAL_ROOTS,
  DIRECTORY_EXCLUDED_NAMES,
  DIRECTORY_UNITY_ASSETS_ROOT,
  DIRECTORY_UNITY_EXCLUDED_CHILDREN,
  MAX_STRUCTURAL_ROOMS,
} from './contracts.mjs';
import { compareCodePoints } from './canonical-json.mjs';
import { deriveDirectoryEvidenceId } from './identity.mjs';

const REGULAR_MODES = new Set(['100644', '100755']);
const CODE_EXTENSIONS = new Set(DIRECTORY_CODE_EXTENSIONS);
const EXCLUDED_NAMES = new Set(DIRECTORY_EXCLUDED_NAMES);
const CONVENTIONAL_ROOTS = new Set(DIRECTORY_CONVENTIONAL_ROOTS);
const UNITY_EXCLUDED = new Set(DIRECTORY_UNITY_EXCLUDED_CHILDREN);
const COLLISION_CODES = new Set([
  'station-extract/path-case-collision',
  'station-extract/path-nfc-collision',
]);
// Deepest candidate is Assets/<X>/<child>.
const MAX_CANDIDATE_DEPTH = 3;

function excludedName(name) {
  return name.startsWith('.') || EXCLUDED_NAMES.has(name);
}

function isCodeFile(fileName) {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 && CODE_EXTENSIONS.has(fileName.slice(dot + 1).toLowerCase());
}

// Index every committed regular code file under each ancestor directory up to
// the deepest possible candidate. Files beneath an excluded directory at any
// depth are not indexed at all.
function indexCodeDirectories(inventory) {
  const byDirectory = new Map();
  for (const entry of inventory) {
    if (entry.type !== 'blob' || !REGULAR_MODES.has(entry.mode) || typeof entry.path !== 'string') continue;
    const segments = entry.path.split('/');
    if (segments.length < 2 || !isCodeFile(segments.at(-1))) continue;
    const directories = segments.slice(0, -1);
    if (directories.some(excludedName)) continue;
    for (let depth = 1; depth <= Math.min(directories.length, MAX_CANDIDATE_DEPTH); depth += 1) {
      const directory = directories.slice(0, depth).join('/');
      const files = byDirectory.get(directory) || [];
      files.push({ path: entry.path, oid: entry.oid });
      byDirectory.set(directory, files);
    }
  }
  const children = new Map();
  for (const directory of byDirectory.keys()) {
    const slash = directory.lastIndexOf('/');
    const parent = slash < 0 ? '' : directory.slice(0, slash);
    const list = children.get(parent) || [];
    list.push(directory);
    children.set(parent, list);
  }
  for (const list of children.values()) list.sort(compareCodePoints);
  return { byDirectory, children };
}

function expandConventional(children, root) {
  const nested = children.get(root) || [];
  return nested.length ? nested : [root];
}

function expandedCandidates(children, topLevel) {
  const candidates = [];
  for (const directory of topLevel) {
    if (directory === DIRECTORY_UNITY_ASSETS_ROOT) {
      for (const child of children.get(directory) || []) {
        if (UNITY_EXCLUDED.has(child.slice(directory.length + 1))) continue;
        candidates.push(...expandConventional(children, child));
      }
    } else if (CONVENTIONAL_ROOTS.has(directory)) {
      candidates.push(...expandConventional(children, directory));
    } else {
      candidates.push(directory);
    }
  }
  return candidates;
}

function directoryRecord(byDirectory, root) {
  const files = [...byDirectory.get(root)].sort((left, right) => compareCodePoints(left.path, right.path));
  return {
    id: deriveDirectoryEvidenceId(root, files),
    root,
    code_file_count: files.length,
  };
}

/**
 * directory-layout/v1 selection over one immutable reader session.
 * Returns { outcome: 'selected', directories } or { outcome: 'fallback', reason }.
 */
export function selectDirectoryLayout(reader) {
  if (reader.unsupportedPaths.length) {
    const collisionOnly = reader.unsupportedPaths.every(({ code }) => COLLISION_CODES.has(code));
    return {
      outcome: 'fallback',
      reason: collisionOnly ? 'station-fallback/path-collision' : 'station-fallback/path-unsupported',
    };
  }
  const { byDirectory, children } = indexCodeDirectories(reader.inventory);
  const topLevel = children.get('') || [];
  let roots = expandedCandidates(children, topLevel);
  if (roots.length > MAX_STRUCTURAL_ROOMS) roots = topLevel;
  if (roots.length > MAX_STRUCTURAL_ROOMS) {
    return { outcome: 'fallback', reason: 'station-fallback/directory-candidates-exceeded' };
  }
  if (roots.length < 2) {
    return { outcome: 'fallback', reason: 'station-fallback/directory-rooms-insufficient' };
  }
  return {
    outcome: 'selected',
    directories: [...roots].sort(compareCodePoints).map((root) => directoryRecord(byDirectory, root)),
  };
}
