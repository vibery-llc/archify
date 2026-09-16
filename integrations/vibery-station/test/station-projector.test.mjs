import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { canonicalJsonBytes, sha256Hex } from '../lib/canonical-json.mjs';
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

test('projects every complete one-to-five workspace path group without truncation or overlap', async () => {
  for (let count = 1; count <= 5; count += 1) {
    const evidence = evidenceValue({ workspacePackages: workspacePackages(count) });
    const { value } = await project(evidence);
    assert.equal(value.snapshot.mode, 'structural');
    assert.equal(value.rooms.length, count);
    assert.deepEqual(value.rooms.map(({ id }) => id), value.rooms.map(({ id }) => id).sort());

    const projectedRoots = value.rooms.flatMap(({ package_roots: roots }) => roots).sort();
    assert.deepEqual(projectedRoots, [...evidence.workspace.package_roots].sort());
    assert.equal(new Set(projectedRoots).size, projectedRoots.length);
    for (const room of value.rooms) {
      const segment = room.package_roots[0].split('/')[0];
      assert.equal(room.structural_key, `workspace-path-group:${segment}`);
      assert.equal(room.label, segment);
      assert.ok(room.package_roots.every((root) => root.split('/')[0] === segment));
      assert.deepEqual(room.evidence_ids, [...room.evidence_ids].sort());
    }
  }
});

test('aggregates only exact cross-room package declarations with direction, scopes, and provenance', async () => {
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
  const apps = value.rooms.find(({ label }) => label === 'apps');
  const packages = value.rooms.find(({ label }) => label === 'packages');
  const packageByRoot = new Map(evidence.packages.map((entry) => [entry.root, entry]));

  assert.equal(value.relations.length, 2);
  assert.deepEqual(value.relations.map(({ id }) => id), value.relations.map(({ id }) => id).sort());
  assert.deepEqual(value.relations, [
    {
      id: deriveRelationId(apps.id, packages.id),
      kind: 'declared-package-dependency',
      from_room_id: apps.id,
      to_room_id: packages.id,
      scopes: ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'],
      evidence_ids: [
        packageByRoot.get('apps/api').manifest_evidence_id,
        packageByRoot.get('apps/worker').manifest_evidence_id,
      ].sort(),
    },
    {
      id: deriveRelationId(packages.id, apps.id),
      kind: 'declared-package-dependency',
      from_room_id: packages.id,
      to_room_id: apps.id,
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
