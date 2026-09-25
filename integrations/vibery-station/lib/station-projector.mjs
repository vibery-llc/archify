import { parseRepositoryRemote } from '../../../archify/renderers/shared/repository-location.mjs';
import {
  DIRECTORY_LAYOUT_PROFILE,
  MAX_STRUCTURAL_ROOMS,
  STATION_SCHEMAS,
  validateStationEvidence,
  validateStationMap,
} from './contracts.mjs';
import {
  canonicalJsonBytes,
  compareCodePoints,
  compareEvidenceIds,
  compareFallbackCodes,
  compareRelations,
  compareRooms,
  compareScopes,
  sha256Hex,
} from './canonical-json.mjs';
import { throwStationDiagnostic } from './diagnostics.mjs';
import {
  deriveProjectId,
  deriveRelationId,
  deriveRoomId,
  deriveSnapshotId,
} from './identity.mjs';

const ROOT_STRUCTURAL_KEY = 'root-package';
const COARSE_STRUCTURAL_KEY = 'project-root';
const WORKSPACE_STRUCTURAL_PREFIX = 'workspace-package:';
const DIRECTORY_STRUCTURAL_PREFIX = 'directory:';

function sortedUnique(values, comparator = compareCodePoints) {
  return [...new Set(values)].sort(comparator);
}

function integrityFailure(message, evidence = {}) {
  throwStationDiagnostic({
    code: 'station-gate/evidence-identity-mismatch',
    severity: 'error',
    message,
    subject: { artifact: STATION_SCHEMAS.evidence },
    evidence,
    supportedFixes: ['rebuild evidence from the verified immutable repository commit'],
  });
}

function exactEvidenceBytes(validatedEvidence, evidenceBytes) {
  if (!(evidenceBytes instanceof Uint8Array)) {
    integrityFailure('Station projection requires the exact evidence bytes.', { expected: 'Uint8Array' });
  }
  const supplied = Buffer.from(evidenceBytes.buffer, evidenceBytes.byteOffset, evidenceBytes.byteLength);
  const expected = canonicalJsonBytes(validatedEvidence);
  if (!supplied.equals(expected)) {
    integrityFailure('Supplied evidence bytes do not canonically encode the validated evidence value.', {
      supplied_sha256: sha256Hex(supplied),
      expected_sha256: sha256Hex(expected),
    });
  }
  return supplied;
}

function repositoryIdentity(evidence) {
  const location = parseRepositoryRemote(evidence.repository.url, { authored: true });
  if (!location) integrityFailure('Evidence repository URL has no supported canonical identity.');
  const expectedProjectId = deriveProjectId(location.identity);
  if (evidence.repository.id !== expectedProjectId) {
    integrityFailure('Evidence project identity is inconsistent with its canonical repository URL.', {
      actual_project_id: evidence.repository.id,
      expected_project_id: expectedProjectId,
    });
  }
  return {
    projectId: expectedProjectId,
    label: location.path.split('/').at(-1),
  };
}

function packageIndex(evidence) {
  const byRoot = new Map();
  const byName = new Map();
  for (const packageRecord of evidence.packages) {
    if (byRoot.has(packageRecord.root) || byName.has(packageRecord.name)) {
      integrityFailure('Detailed evidence contains ambiguous package identity.', {
        package_root: packageRecord.root,
        package_name: packageRecord.name,
      });
    }
    byRoot.set(packageRecord.root, packageRecord);
    byName.set(packageRecord.name, packageRecord);
  }
  return { byRoot, byName };
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
    evidence_ids: sortedUnique(packages.map(({ manifest_evidence_id: id }) => id), compareEvidenceIds),
  };
}

function structuralRooms(evidence, projectId, indexes) {
  if (evidence.workspace.kind === 'root-package') {
    const rootPackage = indexes.byRoot.get('.');
    if (!rootPackage || indexes.byRoot.size !== 1
        || evidence.workspace.package_roots.length !== 1 || evidence.workspace.package_roots[0] !== '.') {
      integrityFailure('Root-package evidence does not represent exactly the repository root.');
    }
    return [componentRoom(projectId, ROOT_STRUCTURAL_KEY, ROOT_STRUCTURAL_KEY, [rootPackage])];
  }
  if (evidence.workspace.kind !== 'npm-workspaces') {
    integrityFailure('Detail-eligible evidence has an unsupported workspace kind.', {
      workspace_kind: evidence.workspace.kind,
    });
  }

  if (!indexes.byRoot.has('.')) {
    integrityFailure('Detailed workspace evidence is missing its selected root package manifest.');
  }
  const declaredRoots = [...evidence.workspace.package_roots].sort(compareCodePoints);
  const representedRoots = [...indexes.byRoot.keys()].filter((root) => root !== '.').sort(compareCodePoints);
  if (new Set(declaredRoots).size !== declaredRoots.length
      || JSON.stringify(declaredRoots) !== JSON.stringify(representedRoots)) {
    integrityFailure('Detailed workspace membership is not complete and exhaustive.');
  }

  // B2 depth: one component room per full workspace package root. Each room
  // carries exactly one package root, so package-to-package declared
  // dependencies project as direct cross-room edges with no segment collapse.
  return evidence.workspace.package_roots.map((root) => {
    const packageRecord = indexes.byRoot.get(root);
    if (!packageRecord || root === '.') {
      integrityFailure('Detailed workspace membership does not resolve to one selected package.', {
        package_root: root,
      });
    }
    return componentRoom(projectId, `${WORKSPACE_STRUCTURAL_PREFIX}${root}`, root, [packageRecord]);
  }).sort(compareRooms);
}

// directory-layout/v1: one layout-confidence room per selected directory.
// Rooms carry no relations; directory structure says nothing about
// dependencies.
function directoryRooms(evidence, projectId) {
  return evidence.directories.map(({ id, root }) => ({
    id: deriveRoomId(projectId, `${DIRECTORY_STRUCTURAL_PREFIX}${root}`),
    project_id: projectId,
    kind: 'component',
    structural_key: `${DIRECTORY_STRUCTURAL_PREFIX}${root}`,
    label: root,
    package_roots: [root],
    confidence: 'layout',
    evidence_ids: [id],
  })).sort(compareRooms);
}

function structuralRelations(evidence, rooms, indexes) {
  const roomByRoot = new Map();
  for (const room of rooms) {
    for (const root of room.package_roots) roomByRoot.set(root, room);
  }
  const roomByPackageName = new Map();
  for (const [root, room] of roomByRoot) {
    const packageRecord = indexes.byRoot.get(root);
    roomByPackageName.set(packageRecord.name, room);
  }

  const aggregate = new Map();
  for (const [root, fromRoom] of roomByRoot) {
    const declaringPackage = indexes.byRoot.get(root);
    for (const declaration of declaringPackage.declared_dependencies) {
      const toRoom = roomByPackageName.get(declaration.name);
      if (!toRoom || toRoom.id === fromRoom.id) continue;
      const key = `${fromRoom.id}\0${toRoom.id}`;
      const current = aggregate.get(key) || {
        fromRoom,
        toRoom,
        scopes: new Set(),
        evidenceIds: new Set(),
      };
      declaration.scopes.forEach((scope) => current.scopes.add(scope));
      current.evidenceIds.add(declaringPackage.manifest_evidence_id);
      aggregate.set(key, current);
    }
  }

  return [...aggregate.values()].map(({ fromRoom, toRoom, scopes, evidenceIds }) => ({
    id: deriveRelationId(fromRoom.id, toRoom.id),
    kind: 'declared-package-dependency',
    from_room_id: fromRoom.id,
    to_room_id: toRoom.id,
    scopes: [...scopes].sort(compareScopes),
    evidence_ids: [...evidenceIds].sort(compareEvidenceIds),
  })).sort(compareRelations);
}

function coarseRoom(evidence, projectId, repositoryLabel) {
  const rootPackage = evidence.packages.find(({ root }) => root === '.');
  return {
    id: deriveRoomId(projectId, COARSE_STRUCTURAL_KEY),
    project_id: projectId,
    kind: 'coarse-project',
    structural_key: COARSE_STRUCTURAL_KEY,
    label: rootPackage?.name || repositoryLabel,
    package_roots: [],
    confidence: 'coarse',
    evidence_ids: sortedUnique(evidence.files.map(({ id }) => id), compareEvidenceIds),
  };
}

function coarseMap(evidence, evidenceHash, project, reasons) {
  return assembleMap(
    evidence,
    evidenceHash,
    project,
    [coarseRoom(evidence, project.projectId, project.label)],
    [],
    sortedUnique(reasons, compareFallbackCodes),
  );
}

function assembleMap(evidence, evidenceHash, project, rooms, relations, reasons) {
  const coarse = reasons.length > 0;
  const value = {
    schema: STATION_SCHEMAS.map,
    snapshot: {
      id: deriveSnapshotId(project.projectId, evidence.repository.revision, evidenceHash, evidence.extractor.profile),
      project_id: project.projectId,
      revision: evidence.repository.revision,
      evidence_sha256: evidenceHash,
      profile: evidence.extractor.profile,
      mode: coarse ? 'coarse' : 'structural',
    },
    project: {
      id: project.projectId,
      label: project.label,
    },
    rooms,
    relations,
    fallback: {
      used: coarse,
      reason_codes: reasons,
    },
  };
  validateStationMap(value);
  return Object.freeze({ value, bytes: canonicalJsonBytes(value) });
}

export function projectStationMap(validatedEvidence, evidenceBytes) {
  validateStationEvidence(validatedEvidence);
  const exactBytes = exactEvidenceBytes(validatedEvidence, evidenceBytes);
  const project = repositoryIdentity(validatedEvidence);
  const evidenceHash = sha256Hex(exactBytes);

  if (!validatedEvidence.analysis.detail_eligible) {
    return coarseMap(
      validatedEvidence,
      evidenceHash,
      project,
      validatedEvidence.analysis.fallback_reason_codes,
    );
  }

  if (validatedEvidence.extractor.profile === DIRECTORY_LAYOUT_PROFILE) {
    return assembleMap(
      validatedEvidence,
      evidenceHash,
      project,
      directoryRooms(validatedEvidence, project.projectId),
      [],
      [],
    );
  }

  const indexes = packageIndex(validatedEvidence);
  const rooms = structuralRooms(validatedEvidence, project.projectId, indexes);
  if (rooms.length < 1 || rooms.length > MAX_STRUCTURAL_ROOMS) {
    return coarseMap(validatedEvidence, evidenceHash, project, [
      'station-fallback/room-count-out-of-range',
    ]);
  }

  return assembleMap(
    validatedEvidence,
    evidenceHash,
    project,
    rooms,
    structuralRelations(validatedEvidence, rooms, indexes),
    [],
  );
}
