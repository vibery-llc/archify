import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { canonicalJsonBytes, sha256Hex } from '../lib/canonical-json.mjs';
import { STATION_LIMITS } from '../lib/contracts.mjs';
import { createGitObjectReader } from '../lib/git-object-reader.mjs';
import { deriveRelationId, deriveRoomId, deriveSnapshotId } from '../lib/identity.mjs';
import { buildStationEvidence } from '../lib/node-workspace-evidence.mjs';
import { projectStationMap } from '../lib/station-projector.mjs';
import { createGitFixture } from './helpers/git-fixture.mjs';

const MiB = 1024 * 1024;
const OTHER_40 = 'f'.repeat(40);
const OTHER_64 = 'e'.repeat(64);

async function loadGate() {
  try {
    return await import('../lib/station-gate.mjs');
  } catch (error) {
    assert.fail(`station gate must independently reconstruct both artifacts: ${error.message}`);
  }
}

function fixtureArtifacts(files = {
  'package.json': JSON.stringify({ name: '@example/root', private: true, workspaces: ['apps/*', 'packages/*'] }),
  'apps/api/package.json': JSON.stringify({
    name: '@example/api',
    private: false,
    dependencies: { '@example/core': 'workspace:*', external: '^1' },
    devDependencies: { '@example/core': 'workspace:*' },
  }),
  'packages/core/package.json': JSON.stringify({
    name: '@example/core',
    peerDependencies: { '@example/api': 'workspace:*' },
  }),
}) {
  const fixture = createGitFixture({ files });
  const reader = createGitObjectReader({
    repoRoot: fixture.root,
    repositoryUrl: fixture.repositoryUrl,
    revision: fixture.revision,
  });
  const evidence = buildStationEvidence(reader);
  const map = projectStationMap(evidence.value, evidence.bytes);
  return { fixture, reader, evidence, map };
}

function clone(value) {
  return structuredClone(value);
}

function bytes(value) {
  return canonicalJsonBytes(value);
}

async function rejectMutation(base, target, mutate, code) {
  const { gateStationArtifacts } = await loadGate();
  const evidence = clone(base.evidence.value);
  const map = clone(base.map.value);
  mutate(target === 'evidence' ? evidence : map, { evidence, map });
  assert.throws(
    () => gateStationArtifacts(bytes(evidence), bytes(map), base.reader),
    (error) => {
      assert.equal(error?.diagnostic?.code, code);
      assert.equal(error.diagnostic.severity, 'error');
      assert.deepEqual(Object.keys(error.diagnostic), [
        'code', 'severity', 'message', 'subject', 'evidence', 'supportedFixes',
      ]);
      return true;
    },
  );
}

function oidFor(value) {
  return createHash('sha1').update(value).digest('hex');
}

function inMemoryReader(rootBytes, { size = rootBytes.length, readBytes = rootBytes, discovered = 1 } = {}) {
  const oid = oidFor(rootBytes);
  const entry = Object.freeze({
    mode: '100644',
    type: 'blob',
    oid,
    path: 'package.json',
    pathBytes: Buffer.from('package.json'),
  });
  return Object.freeze({
    repository: Object.freeze({
      url: 'https://github.com/example/station-reader',
      revision: 'a'.repeat(40),
      treeOid: 'b'.repeat(40),
      objectFormat: 'sha1',
    }),
    limits: Object.freeze({
      treeOutputBytes: 16 * MiB,
      manifestCount: 512,
      manifestBytes: MiB,
      totalManifestBytes: 8 * MiB,
    }),
    inventory: Object.freeze([entry]),
    unsupportedPaths: Object.freeze([]),
    manifestCandidates: Object.freeze([entry]),
    manifestPolicy: Object.freeze({ discovered, limit: 512, exceeded: discovered > 512 }),
    statBlob(requested) {
      assert.equal(requested, oid);
      return size;
    },
    readBlob(requested, options) {
      assert.equal(requested, oid);
      assert.deepEqual(options, { expectedSize: size, integrityCeiling: STATION_LIMITS.max_manifest_bytes });
      return Buffer.from(readBytes);
    },
  });
}

test('accepts only the exact builder/projector pair and independently returns recomputed facts', async () => {
  const { gateStationArtifacts } = await loadGate();
  const base = fixtureArtifacts();
  const result = gateStationArtifacts(base.evidence.bytes, base.map.bytes, base.reader);

  assert.equal(result.repository.url, base.evidence.value.repository.url);
  assert.equal(result.repository.revision, base.evidence.value.repository.revision);
  assert.equal(result.repository.tree_oid, base.evidence.value.repository.tree_oid);
  assert.equal(result.project_id, base.evidence.value.repository.id);
  assert.equal(result.snapshot_id, base.map.value.snapshot.id);
  assert.equal(result.mode, 'structural');
  assert.equal(result.room_count, 2);
  assert.equal(result.relation_count, 2);
  assert.equal(result.evidence_sha256, sha256Hex(base.evidence.bytes));
  assert.equal(result.map_sha256, sha256Hex(base.map.bytes));
  assert.deepEqual(result.evidence_bytes, base.evidence.bytes);
  assert.deepEqual(result.map_bytes, base.map.bytes);
  assert.equal(Object.isFrozen(result), true);
});

test('rejects malformed and noncanonical exact bytes before semantic admission', async () => {
  const { gateStationArtifacts } = await loadGate();
  const base = fixtureArtifacts();
  for (const [evidenceBytes, mapBytes, code] of [
    [Buffer.from([0xff, 0x0a]), base.map.bytes, 'station-gate/schema-invalid'],
    [Buffer.from('{bad json}\n'), base.map.bytes, 'station-gate/schema-invalid'],
    [Buffer.from(`${base.evidence.bytes.toString('utf8').trimEnd()}  \n`), base.map.bytes, 'station-gate/canonical-mismatch'],
    [base.evidence.bytes, Buffer.concat([base.map.bytes, Buffer.from('\n')]), 'station-gate/canonical-mismatch'],
  ]) {
    assert.throws(
      () => gateStationArtifacts(evidenceBytes, mapBytes, base.reader),
      (error) => error?.diagnostic?.code === code,
    );
  }
});

test('rejects schema/profile/unknown-field mutations with one stable schema diagnostic', async () => {
  const base = fixtureArtifacts();
  for (const mutate of [
    (value) => { value.schema = 'station-evidence/v2'; },
    (value) => { value.extractor.profile = 'node-workspaces/v2'; },
    (value) => { value.extractor.contract_version = 2; },
    (value) => { value.extractor.limits.max_manifest_count = 511; },
    (value) => { value.unknown = true; },
  ]) {
    await rejectMutation(base, 'evidence', mutate, 'station-gate/schema-invalid');
  }
  await rejectMutation(base, 'map', (value) => { value.schema = 'station-map/v2'; }, 'station-gate/schema-invalid');
  await rejectMutation(base, 'map', (value) => { value.rooms[0].unknown = true; }, 'station-gate/schema-invalid');
});

test('rejects repository, selected-file, digest, byte-count, and every evidence identity mutation', async () => {
  const base = fixtureArtifacts();
  const cases = [
    (value) => { value.repository.url = 'https://github.com/example/other'; },
    (value) => { value.repository.revision = OTHER_40; },
    (value) => { value.repository.tree_oid = OTHER_40; },
    (value) => { value.repository.id = `project-${OTHER_64}`; },
    (value) => { value.files[0].id = `evidence-${OTHER_64}`; },
    (value) => { value.files[0].git_oid = OTHER_40; },
    (value) => { value.files[0].sha256 = OTHER_64; },
    (value) => { value.files[0].bytes += 1; },
    (value) => { value.files.pop(); },
    (value) => { value.files.push({ ...value.files[0], path: 'invented/package.json' }); },
  ];
  for (const mutate of cases) {
    await rejectMutation(base, 'evidence', mutate, 'station-gate/evidence-identity-mismatch');
  }
});

test('rejects workspace provenance, membership, package fields, declaration facts, and counts', async () => {
  const base = fixtureArtifacts();
  const cases = [
    (value) => { value.workspace.patterns = ['packages/*']; },
    (value) => { value.workspace.package_roots.pop(); },
    (value) => { value.workspace.kind = 'unsupported'; },
    (value) => { value.packages[1].name = '@example/renamed'; },
    (value) => { value.packages[1].private = true; },
    (value) => { value.packages[1].root = 'apps/renamed'; },
    (value) => { value.packages[1].workspace_pattern = 'packages/*'; },
    (value) => { value.packages[1].declared_dependencies[0].name = '@example/other'; },
    (value) => { value.packages[1].declared_dependencies[0].scopes = ['optionalDependencies']; },
    (value) => { value.analysis.discovered_manifest_count += 1; },
    (value) => { value.analysis.selected_manifest_count -= 1; },
    (value) => { value.analysis.represented_manifest_count -= 1; },
  ];
  for (const mutate of cases) {
    await rejectMutation(base, 'evidence', mutate, 'station-gate/unsupported-claim');
  }
  await rejectMutation(base, 'evidence', (value) => {
    value.packages[1].manifest_evidence_id = `evidence-${OTHER_64}`;
  }, 'station-gate/evidence-reference-missing');
});

test('rejects evidence ordering independently from canonical object-key serialization', async () => {
  const base = fixtureArtifacts();
  for (const mutate of [
    (value) => { value.files.reverse(); },
    (value) => { value.packages.reverse(); },
    (value) => { value.workspace.patterns.reverse(); },
    (value) => { value.packages[1].declared_dependencies[0].scopes.reverse(); },
  ]) {
    await rejectMutation(base, 'evidence', mutate, 'station-gate/order-mismatch');
  }
});

test('rejects project/snapshot identities, evidence hash, revision, and every topology ID class', async () => {
  const base = fixtureArtifacts();
  const cases = [
    (value) => { value.snapshot.id = `snapshot-${OTHER_64}`; },
    (value) => { value.snapshot.project_id = `project-${OTHER_64}`; value.project.id = `project-${OTHER_64}`; value.rooms.forEach((room) => { room.project_id = `project-${OTHER_64}`; }); },
    (value) => { value.snapshot.revision = OTHER_40; },
    (value) => { value.snapshot.evidence_sha256 = OTHER_64; },
    (value) => { value.rooms[0].id = `room-${OTHER_64}`; },
    (value) => { value.relations[0].id = `relation-${OTHER_64}`; },
  ];
  for (const mutate of cases) {
    await rejectMutation(base, 'map', mutate, 'station-gate/topology-identity-mismatch');
  }
});

test('rejects room membership/evidence/confidence and relation endpoints/scopes/evidence', async () => {
  const base = fixtureArtifacts();
  const cases = [
    (value) => { value.rooms[0].package_roots = ['invented/root']; },
    (value) => { value.rooms[0].evidence_ids = [`evidence-${OTHER_64}`]; },
    (value) => { value.rooms[0].label = 'invented'; },
    (value) => { value.rooms[0].structural_key = 'workspace-path-group:invented'; },
    (value) => { value.rooms[0].confidence = 'coarse'; },
    (value) => { [value.relations[0].from_room_id, value.relations[0].to_room_id] = [value.relations[0].to_room_id, value.relations[0].from_room_id]; },
    (value) => { value.relations[0].scopes = ['optionalDependencies']; },
    (value) => { value.relations[0].evidence_ids = [`evidence-${OTHER_64}`]; },
  ];
  for (const mutate of cases) {
    await rejectMutation(base, 'map', mutate, 'station-gate/unsupported-claim');
  }
});

test('rejects omitted, invented, self-loop, and reordered topology', async () => {
  const base = fixtureArtifacts();
  await rejectMutation(base, 'map', (value) => { value.rooms.reverse(); }, 'station-gate/order-mismatch');
  await rejectMutation(base, 'map', (value) => { value.relations.reverse(); }, 'station-gate/order-mismatch');
  await rejectMutation(base, 'map', (value) => { value.relations.pop(); }, 'station-gate/unsupported-claim');
  await rejectMutation(base, 'map', (value) => {
    value.relations.push({ ...value.relations[0], id: `relation-${OTHER_64}` });
  }, 'station-gate/unsupported-claim');
  await rejectMutation(base, 'map', (value) => {
    value.relations[0].to_room_id = value.relations[0].from_room_id;
  }, 'station-gate/schema-invalid');
});

test('rejects a false coarse fallback for a valid detailed repository', async () => {
  const base = fixtureArtifacts();
  await rejectMutation(base, 'map', (value, { evidence }) => {
    const projectId = evidence.repository.id;
    const evidenceHash = sha256Hex(bytes(evidence));
    value.snapshot = {
      id: deriveSnapshotId(projectId, evidence.repository.revision, evidenceHash),
      project_id: projectId,
      revision: evidence.repository.revision,
      evidence_sha256: evidenceHash,
      profile: 'node-workspaces/v1',
      mode: 'coarse',
    };
    value.rooms = [{
      id: deriveRoomId(projectId, 'project-root'),
      project_id: projectId,
      kind: 'coarse-project',
      structural_key: 'project-root',
      label: 'station-reader',
      package_roots: [],
      confidence: 'coarse',
      evidence_ids: evidence.files.map(({ id }) => id).sort(),
    }];
    value.relations = [];
    value.fallback = { used: true, reason_codes: ['station-fallback/workspace-shape-unsupported'] };
  }, 'station-gate/unsupported-claim');
});

test('independently proves exact policy-size excess as fallback', async () => {
  const { gateStationArtifacts } = await loadGate();
  const rootBytes = Buffer.from('{"name":"root"}\n');
  const reader = inMemoryReader(rootBytes, { size: MiB + 1 });
  const evidence = buildStationEvidence(reader);
  const map = projectStationMap(evidence.value, evidence.bytes);
  const result = gateStationArtifacts(evidence.bytes, map.bytes, reader);

  assert.equal(result.mode, 'coarse');
  assert.deepEqual(result.fallback_reason_codes, ['station-fallback/workspace-manifest-oversized']);
  assert.equal(result.room_count, 1);
  assert.equal(result.relation_count, 0);
});

test('treats object probe/read inconsistency as a typed hard failure, never fallback', async () => {
  const { gateStationArtifacts } = await loadGate();
  const base = fixtureArtifacts({ 'package.json': '{"name":"root"}\n' });
  const inconsistent = Object.freeze({
    ...base.reader,
    readBlob(oid, options) {
      const actual = base.reader.readBlob(oid, options);
      return actual.subarray(0, actual.length - 1);
    },
  });
  assert.throws(
    () => gateStationArtifacts(base.evidence.bytes, base.map.bytes, inconsistent),
    (error) => {
      assert.equal(error?.diagnostic?.code, 'station-gate/evidence-identity-mismatch');
      assert.equal(error?.diagnostic?.severity, 'error');
      assert.equal(error?.result, undefined);
      return true;
    },
  );
});
