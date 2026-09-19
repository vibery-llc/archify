import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { canonicalJsonBytes, sha256Hex } from '../lib/canonical-json.mjs';
import { FALLBACK_REASON_CODES } from '../lib/contracts.mjs';
import {
  deriveEvidenceId,
  deriveProjectId,
  deriveRelationId,
  deriveRoomId,
  deriveSnapshotId,
} from '../lib/identity.mjs';

const REPOSITORY_URL = 'https://github.com/example/station-projector';
const REPOSITORY_IDENTITY = '["github.com","standard","repository","example/station-projector"]';
const PROJECT_ID = deriveProjectId(REPOSITORY_IDENTITY);
const REVISION = 'a'.repeat(40);
const TREE_OID = 'b'.repeat(40);

async function loadProjector() {
  try {
    return await import('../lib/station-projector.mjs');
  } catch (error) {
    assert.fail(`station projector must implement complete structural projection: ${error.message}`);
  }
}

function hex(kind, value, length) {
  return createHash(kind).update(value).digest('hex').slice(0, length);
}

function evidenceFile(root) {
  const filePath = root === '.' ? 'package.json' : `${root}/package.json`;
  const gitOid = hex('sha1', filePath, 40);
  return {
    id: deriveEvidenceId(filePath, gitOid),
    kind: 'git-blob',
    path: filePath,
    git_oid: gitOid,
    sha256: hex('sha256', `bytes:${filePath}`, 64),
    bytes: 100 + filePath.length,
  };
}

function packageRecord(root, name, dependencies = []) {
  const file = evidenceFile(root);
  return {
    root,
    name,
    private: true,
    manifest_evidence_id: file.id,
    workspace_pattern: root === '.' ? 'root-package' : `${root.split('/')[0]}/*`,
    declared_dependencies: dependencies.map(({ name: dependencyName, scopes }) => ({
      name: dependencyName,
      scopes: [...scopes],
    })),
  };
}

function evidenceValue({ workspacePackages = [], rootDependencies = [], rootName = '@example/root' } = {}) {
  const root = packageRecord('.', rootName, rootDependencies);
  const packages = [root, ...workspacePackages.map(({ root: packageRoot, name, dependencies = [] }) => (
    packageRecord(packageRoot, name, dependencies)
  ))];
  const files = packages.map(({ root: packageRoot }) => evidenceFile(packageRoot));
  const roots = workspacePackages.map(({ root: packageRoot }) => packageRoot);
  return {
    schema: 'station-evidence/v1',
    extractor: {
      profile: 'node-workspaces/v1',
      contract_version: 1,
      limits: {
        max_tree_bytes: 16 * 1024 * 1024,
        max_manifest_count: 512,
        max_workspace_patterns: 512,
        max_manifest_bytes: 1024 * 1024,
        max_selected_manifest_bytes: 8 * 1024 * 1024,
      },
    },
    repository: {
      id: PROJECT_ID,
      url: REPOSITORY_URL,
      revision: REVISION,
      tree_oid: TREE_OID,
      object_format: 'sha1',
    },
    files,
    workspace: {
      kind: roots.length ? 'npm-workspaces' : 'root-package',
      root_manifest_evidence_id: root.manifest_evidence_id,
      patterns: roots.length ? [...new Set(roots.map((entry) => `${entry.split('/')[0]}/*`))] : [],
      package_roots: roots.length ? roots : ['.'],
    },
    packages,
    analysis: {
      detail_eligible: true,
      discovered_manifest_count: files.length,
      selected_manifest_count: files.length,
      represented_manifest_count: packages.length,
      fallback_reason_codes: [],
    },
  };
}

function project(value) {
  return loadProjector().then(({ projectStationMap }) => projectStationMap(value, canonicalJsonBytes(value)));
}

function workspacePackages(groupCount) {
  return Array.from({ length: groupCount }, (_, index) => ({
    root: groupCount === 1 ? 'standalone' : `group-${index + 1}/package-${index + 1}`,
    name: `@example/package-${index + 1}`,
  }));
}

function topology(value) {
  return {
    project: value.project,
    rooms: value.rooms,
    relations: value.relations,
    fallback: value.fallback,
  };
}

test('projects a non-workspace root package as one exact structural room', async () => {
  const evidence = evidenceValue({ rootName: '@example/renamable-root' });
  const result = await project(evidence);
  const expectedRoomId = deriveRoomId(PROJECT_ID, 'root-package');
  const evidenceHash = sha256Hex(canonicalJsonBytes(evidence));

  assert.deepEqual(result.value, {
    schema: 'station-map/v1',
    snapshot: {
      id: deriveSnapshotId(PROJECT_ID, REVISION, evidenceHash),
      project_id: PROJECT_ID,
      revision: REVISION,
      evidence_sha256: evidenceHash,
      profile: 'node-workspaces/v1',
      mode: 'structural',
    },
    project: { id: PROJECT_ID, label: 'station-projector' },
    rooms: [{
      id: expectedRoomId,
      project_id: PROJECT_ID,
      kind: 'component',
      structural_key: 'root-package',
      label: 'root-package',
      package_roots: ['.'],
      confidence: 'high',
      evidence_ids: [evidence.packages[0].manifest_evidence_id],
    }],
    relations: [],
    fallback: { used: false, reason_codes: [] },
  });
  assert.deepEqual(result.bytes, canonicalJsonBytes(result.value));
});

test('projects every workspace package as its own exact structural room without truncation or overlap', async () => {
  for (let count = 1; count <= 6; count += 1) {
    const evidence = evidenceValue({ workspacePackages: workspacePackages(count) });
    const { value } = await project(evidence);
    assert.equal(value.snapshot.mode, 'structural');
    assert.equal(value.rooms.length, count);
    assert.deepEqual(value.rooms.map(({ id }) => id), value.rooms.map(({ id }) => id).sort());

    const projectedRoots = value.rooms.flatMap(({ package_roots: roots }) => roots).sort();
    assert.deepEqual(projectedRoots, [...evidence.workspace.package_roots].sort());
    assert.equal(new Set(projectedRoots).size, projectedRoots.length);
    for (const room of value.rooms) {
      assert.equal(room.structural_key, `workspace-package:${room.package_roots[0]}`);
      assert.equal(room.label, room.package_roots[0]);
      assert.deepEqual(room.package_roots, [room.package_roots[0]]);
      assert.deepEqual(room.evidence_ids, [...room.evidence_ids].sort());
    }
  }
});

test('aggregates only exact cross-package declared dependencies with direction, scopes, and provenance', async () => {
  const evidence = evidenceValue({
    workspacePackages: [
      {
        root: 'apps/api',
        name: '@example/api',
        dependencies: [
          { name: '@example/core', scopes: ['peerDependencies', 'dependencies'] },
          { name: '@example/ui', scopes: ['devDependencies'] },
          { name: '@example/external', scopes: ['dependencies'] },
        ],
      },
      {
        root: 'apps/worker',
        name: '@example/worker',
        dependencies: [
          { name: '@example/api', scopes: ['optionalDependencies'] },
          { name: '@example/core', scopes: ['optionalDependencies'] },
        ],
      },
      {
        root: 'packages/core',
        name: '@example/core',
        dependencies: [{ name: '@example/ui', scopes: ['peerDependencies'] }],
      },
      {
        root: 'packages/ui',
        name: '@example/ui',
        dependencies: [{ name: '@example/api', scopes: ['dependencies'] }],
      },
    ],
  });
  const { value } = await project(evidence);
  const roomByRoot = new Map(value.rooms.map((room) => [room.package_roots[0], room]));
  const packageByRoot = new Map(evidence.packages.map((entry) => [entry.root, entry]));

  assert.equal(value.rooms.length, 4);
  assert.equal(value.relations.length, 6);
  assert.deepEqual(value.relations.map(({ id }) => id), value.relations.map(({ id }) => id).sort());
  assert.deepEqual(value.relations, [
    {
      id: deriveRelationId(roomByRoot.get('apps/api').id, roomByRoot.get('packages/core').id),
      kind: 'declared-package-dependency',
      from_room_id: roomByRoot.get('apps/api').id,
      to_room_id: roomByRoot.get('packages/core').id,
      scopes: ['dependencies', 'peerDependencies'],
      evidence_ids: [packageByRoot.get('apps/api').manifest_evidence_id],
    },
    {
      id: deriveRelationId(roomByRoot.get('apps/api').id, roomByRoot.get('packages/ui').id),
      kind: 'declared-package-dependency',
      from_room_id: roomByRoot.get('apps/api').id,
      to_room_id: roomByRoot.get('packages/ui').id,
      scopes: ['devDependencies'],
      evidence_ids: [packageByRoot.get('apps/api').manifest_evidence_id],
    },
    {
      id: deriveRelationId(roomByRoot.get('apps/worker').id, roomByRoot.get('apps/api').id),
      kind: 'declared-package-dependency',
      from_room_id: roomByRoot.get('apps/worker').id,
      to_room_id: roomByRoot.get('apps/api').id,
      scopes: ['optionalDependencies'],
      evidence_ids: [packageByRoot.get('apps/worker').manifest_evidence_id],
    },
    {
      id: deriveRelationId(roomByRoot.get('apps/worker').id, roomByRoot.get('packages/core').id),
      kind: 'declared-package-dependency',
      from_room_id: roomByRoot.get('apps/worker').id,
      to_room_id: roomByRoot.get('packages/core').id,
      scopes: ['optionalDependencies'],
      evidence_ids: [packageByRoot.get('apps/worker').manifest_evidence_id],
    },
    {
      id: deriveRelationId(roomByRoot.get('packages/core').id, roomByRoot.get('packages/ui').id),
      kind: 'declared-package-dependency',
      from_room_id: roomByRoot.get('packages/core').id,
      to_room_id: roomByRoot.get('packages/ui').id,
      scopes: ['peerDependencies'],
      evidence_ids: [packageByRoot.get('packages/core').manifest_evidence_id],
    },
    {
      id: deriveRelationId(roomByRoot.get('packages/ui').id, roomByRoot.get('apps/api').id),
      kind: 'declared-package-dependency',
      from_room_id: roomByRoot.get('packages/ui').id,
      to_room_id: roomByRoot.get('apps/api').id,
      scopes: ['dependencies'],
      evidence_ids: [packageByRoot.get('packages/ui').manifest_evidence_id],
    },
  ].sort((left, right) => left.id.localeCompare(right.id)));
  assert.ok(value.relations.every((relation) => relation.from_room_id !== relation.to_room_id));
});

test('sorts topology independently of evidence traversal order', async () => {
  const evidence = evidenceValue({
    workspacePackages: [
      { root: 'zeta/b', name: '@example/b', dependencies: [{ name: '@example/a', scopes: ['peerDependencies'] }] },
      { root: 'alpha/a', name: '@example/a' },
      { root: 'zeta/c', name: '@example/c', dependencies: [{ name: '@example/a', scopes: ['dependencies'] }] },
    ],
  });
  const permuted = structuredClone(evidence);
  permuted.files.reverse();
  permuted.packages.reverse();
  permuted.workspace.package_roots.reverse();
  permuted.workspace.patterns.reverse();

  const left = await project(evidence);
  const right = await project(permuted);
  assert.deepEqual(topology(left.value), topology(right.value));
  assert.notEqual(left.value.snapshot.evidence_sha256, right.value.snapshot.evidence_sha256);
});

test('display-name-only package changes never alter room or relation identities', async () => {
  const before = evidenceValue({
    workspacePackages: [
      { root: 'apps/api', name: '@example/api', dependencies: [{ name: '@example/core', scopes: ['dependencies'] }] },
      { root: 'packages/core', name: '@example/core' },
    ],
  });
  const after = evidenceValue({
    workspacePackages: [
      { root: 'apps/api', name: '@renamed/api', dependencies: [{ name: '@renamed/core', scopes: ['dependencies'] }] },
      { root: 'packages/core', name: '@renamed/core' },
    ],
    rootName: '@renamed/root',
  });
  const beforeMap = (await project(before)).value;
  const afterMap = (await project(after)).value;

  assert.deepEqual(beforeMap.rooms.map(({ id }) => id), afterMap.rooms.map(({ id }) => id));
  assert.deepEqual(beforeMap.relations.map(({ id }) => id), afterMap.relations.map(({ id }) => id));
  assert.notEqual(beforeMap.snapshot.evidence_sha256, afterMap.snapshot.evidence_sha256);
});

function fallbackEvidence(reasonCodes) {
  const evidence = evidenceValue();
  evidence.workspace = {
    kind: 'unsupported',
    root_manifest_evidence_id: evidence.workspace.root_manifest_evidence_id,
    patterns: [],
    package_roots: [],
  };
  evidence.packages = [];
  evidence.analysis.detail_eligible = false;
  evidence.analysis.represented_manifest_count = 0;
  evidence.analysis.fallback_reason_codes = [...reasonCodes];
  return evidence;
}

function assertCoarseMap(result, evidence, expectedReasons, expectedLabel = 'station-projector') {
  const evidenceBytes = canonicalJsonBytes(evidence);
  const evidenceHash = sha256Hex(evidenceBytes);
  const roomId = deriveRoomId(PROJECT_ID, 'project-root');
  assert.equal(result.value.snapshot.mode, 'coarse');
  assert.equal(result.value.snapshot.evidence_sha256, evidenceHash);
  assert.equal(result.value.snapshot.id, deriveSnapshotId(PROJECT_ID, REVISION, evidenceHash));
  assert.deepEqual(result.value.project, { id: PROJECT_ID, label: 'station-projector' });
  assert.deepEqual(result.value.rooms, [{
    id: roomId,
    project_id: PROJECT_ID,
    kind: 'coarse-project',
    structural_key: 'project-root',
    label: expectedLabel,
    package_roots: [],
    confidence: 'coarse',
    evidence_ids: [...new Set(evidence.files.map(({ id }) => id))].sort(),
  }]);
  assert.deepEqual(result.value.relations, []);
  assert.deepEqual(result.value.fallback, {
    used: true,
    reason_codes: [...expectedReasons].sort(),
  });
  assert.deepEqual(result.bytes, canonicalJsonBytes(result.value));
}

test('collapses every evidence-builder fallback reason to one evidence-bound coarse room', async () => {
  const builderReasons = FALLBACK_REASON_CODES.filter((reason) => (
    reason !== 'station-fallback/room-count-out-of-range'
  ));
  assert.equal(builderReasons.length, 16);
  for (const reason of builderReasons) {
    const evidence = fallbackEvidence([reason]);
    assertCoarseMap(await project(evidence), evidence, [reason]);
  }

  const combined = fallbackEvidence([
    'station-fallback/workspace-manifest-invalid',
    'station-fallback/path-collision',
    'station-fallback/workspace-manifest-invalid',
  ]);
  combined.analysis.fallback_reason_codes = [
    'station-fallback/workspace-manifest-invalid',
    'station-fallback/path-collision',
  ];
  assertCoarseMap(await project(combined), combined, [
    'station-fallback/path-collision',
    'station-fallback/workspace-manifest-invalid',
  ]);
});

test('collapses zero or more-than-64 workspace packages without retaining partial detail', async () => {
  const zeroGroups = evidenceValue();
  zeroGroups.workspace = {
    kind: 'npm-workspaces',
    root_manifest_evidence_id: zeroGroups.workspace.root_manifest_evidence_id,
    patterns: ['packages/*'],
    package_roots: [],
  };
  assertCoarseMap(await project(zeroGroups), zeroGroups, [
    'station-fallback/room-count-out-of-range',
  ], '@example/root');

  const sixtyFivePackages = evidenceValue({ workspacePackages: workspacePackages(65) });
  const result = await project(sixtyFivePackages);
  assertCoarseMap(result, sixtyFivePackages, [
    'station-fallback/room-count-out-of-range',
  ], '@example/root');
  assert.equal(result.value.rooms[0].evidence_ids.length, 66);
  assert.ok(result.value.rooms[0].evidence_ids.includes(sixtyFivePackages.workspace.root_manifest_evidence_id));
});

test('rejects malformed, identity-inconsistent, unknown, or byte-tampered evidence as hard diagnostics', async () => {
  const { projectStationMap } = await loadProjector();
  const exact = evidenceValue();
  const tamperedBytes = Buffer.concat([canonicalJsonBytes(exact), Buffer.from('\n')]);
  await assert.rejects(
    async () => projectStationMap(exact, tamperedBytes),
    (error) => error?.diagnostic?.code === 'station-gate/evidence-identity-mismatch',
  );

  const inconsistent = evidenceValue();
  inconsistent.repository.url = 'https://github.com/example/different-project';
  await assert.rejects(
    async () => projectStationMap(inconsistent, canonicalJsonBytes(inconsistent)),
    (error) => error?.diagnostic?.code === 'station-gate/evidence-identity-mismatch',
  );

  const malformed = evidenceValue();
  malformed.unknown = true;
  await assert.rejects(
    async () => projectStationMap(malformed, canonicalJsonBytes(malformed)),
    (error) => error?.diagnostic?.code === 'station-gate/schema-invalid',
  );

  const unknownReason = fallbackEvidence(['station-fallback/not-approved']);
  await assert.rejects(
    async () => projectStationMap(unknownReason, canonicalJsonBytes(unknownReason)),
    (error) => error?.diagnostic?.code === 'station-gate/schema-invalid',
  );
});
