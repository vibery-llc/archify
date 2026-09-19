import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { canonicalJsonBytes, sha256Hex } from '../lib/canonical-json.mjs';
import { extractStationMap } from '../lib/extract.mjs';
import { createGitObjectReader } from '../lib/git-object-reader.mjs';
import { gateStationArtifacts } from '../lib/station-gate.mjs';
import { deriveRelationId, deriveRoomId, deriveSnapshotId } from '../lib/identity.mjs';
import { buildStationEvidence } from '../lib/node-workspace-evidence.mjs';
import { projectStationMap } from '../lib/station-projector.mjs';
import { createGitFixture } from './helpers/git-fixture.mjs';

const OTHER_40 = 'f'.repeat(40);
const OTHER_64 = 'e'.repeat(64);

export const GATE_TAMPER_MATRIX = Object.freeze([
  'evidence-schema', 'map-schema', 'profile', 'contract-version',
  'evidence-unknown-property', 'map-unknown-property',
  'repository-url', 'repository-revision', 'repository-tree', 'repository-object-format',
  'selected-file-omission', 'selected-file-invention',
  'manifest-oid', 'manifest-sha256', 'manifest-bytes', 'manifest-path', 'manifest-root', 'manifest-reference',
  'workspace-kind', 'workspace-patterns', 'workspace-membership',
  'package-name', 'package-private', 'package-root', 'dependency-name', 'dependency-scope',
  'project-id', 'evidence-id', 'room-id', 'relation-id', 'snapshot-id',
  'file-order', 'package-order', 'workspace-pattern-order', 'dependency-scope-order',
  'room-order', 'relation-order', 'package-duplication', 'analysis-count',
  'room-structural-key', 'room-label', 'room-confidence', 'room-membership', 'room-evidence-set',
  'relation-endpoint', 'relation-direction', 'relation-scope', 'relation-evidence-set',
  'relation-omission', 'relation-invention', 'relation-self-loop',
  'evidence-hash', 'fallback-false-cause', 'fallback-omitted-cause', 'fallback-unknown-cause',
  'duplicate-room', 'omitted-room', 'sixty-fifth-room',
  'invalid-utf8', 'invalid-json', 'noncanonical-json', 'noncanonical-newline',
  'coherent-evidence-map-pair', 'false-detailed-to-coarse-downgrade',
]);

const covered = new Set();
function cover(name) {
  assert.ok(GATE_TAMPER_MATRIX.includes(name), `undeclared gate tamper row: ${name}`);
  covered.add(name);
}

function fixtureArtifacts(files = {
  'package.json': JSON.stringify({
    name: 'root',
    private: true,
    workspaces: ['apps/*', 'packages/*', 'tools/*'],
  }),
  'apps/api/package.json': JSON.stringify({
    name: 'api',
    private: false,
    dependencies: { core: 'workspace:*' },
    devDependencies: { core: 'workspace:*' },
  }),
  'packages/core/package.json': JSON.stringify({
    name: 'core',
    optionalDependencies: { tool: 'workspace:*' },
  }),
  'tools/build/package.json': JSON.stringify({ name: 'tool' }),
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

async function rejectTamper(base, row) {
  let publicationCalls = 0;
  await assert.rejects(extractStationMap({
    bundleRoot: path.join(os.tmpdir(), `station-gate-tamper-${process.pid}-${row.name}`),
    repoRoot: base.fixture.root,
    repositoryUrl: base.fixture.repositoryUrl,
    revision: base.fixture.revision,
  }, {
    createReader() { return base.reader; },
    buildEvidence() { return base.evidence; },
    projectMap() { return base.map; },
    gateArtifacts(_evidenceBytes, _mapBytes, reader) {
      return gateStationArtifacts(row.evidenceBytes, row.mapBytes, reader);
    },
    publishGeneration() {
      publicationCalls += 1;
      throw new Error('tampered artifacts must never reach publication');
    },
  }), (error) => {
    assert.equal(error?.stationStage, 'gate', `${row.name}: ${JSON.stringify(error?.diagnostic)}`);
    assert.equal(error?.diagnostic?.code, row.code, `${row.name}: ${JSON.stringify(error?.diagnostic)}`);
    assert.match(error.diagnostic.code, /^station-gate\//);
    assert.equal(error.receipt, undefined);
    assert.equal(error.result, undefined);
    return true;
  });
  assert.equal(publicationCalls, 0, `${row.name}: publication was called`);
  cover(row.name);
}

function semanticRows(base) {
  const rows = [];
  const add = (name, target, mutate, code) => {
    const evidence = clone(base.evidence.value);
    const map = clone(base.map.value);
    mutate(target === 'evidence' ? evidence : map, { evidence, map });
    rows.push({ name, evidenceBytes: canonicalJsonBytes(evidence), mapBytes: canonicalJsonBytes(map), code });
  };

  add('evidence-schema', 'evidence', (value) => { value.schema = 'station-evidence/v2'; }, 'station-gate/schema-invalid');
  add('map-schema', 'map', (value) => { value.schema = 'station-map/v2'; }, 'station-gate/schema-invalid');
  add('profile', 'evidence', (value) => { value.extractor.profile = 'node-workspaces/v2'; }, 'station-gate/schema-invalid');
  add('contract-version', 'evidence', (value) => { value.extractor.contract_version = 2; }, 'station-gate/schema-invalid');
  add('evidence-unknown-property', 'evidence', (value) => { value.unknown = true; }, 'station-gate/schema-invalid');
  add('map-unknown-property', 'map', (value) => { value.rooms[0].unknown = true; }, 'station-gate/schema-invalid');
  add('repository-url', 'evidence', (value) => { value.repository.url = 'https://github.com/example/other'; }, 'station-gate/evidence-identity-mismatch');
  add('repository-revision', 'evidence', (value) => { value.repository.revision = OTHER_40; }, 'station-gate/evidence-identity-mismatch');
  add('repository-tree', 'evidence', (value) => { value.repository.tree_oid = OTHER_40; }, 'station-gate/evidence-identity-mismatch');
  add('repository-object-format', 'evidence', (value) => { value.repository.object_format = 'sha256'; }, 'station-gate/schema-invalid');
  add('selected-file-omission', 'evidence', (value) => { value.files.pop(); }, 'station-gate/evidence-identity-mismatch');
  add('selected-file-invention', 'evidence', (value) => { value.files.push({ ...value.files[0], path: 'invented/package.json' }); }, 'station-gate/evidence-identity-mismatch');
  add('manifest-oid', 'evidence', (value) => { value.files[0].git_oid = OTHER_40; }, 'station-gate/evidence-identity-mismatch');
  add('manifest-sha256', 'evidence', (value) => { value.files[0].sha256 = OTHER_64; }, 'station-gate/evidence-identity-mismatch');
  add('manifest-bytes', 'evidence', (value) => { value.files[0].bytes += 1; }, 'station-gate/evidence-identity-mismatch');
  add('manifest-path', 'evidence', (value) => { value.files[0].path = 'invented/package.json'; }, 'station-gate/evidence-identity-mismatch');
  add('manifest-root', 'evidence', (value) => { value.packages[1].root = 'apps/invented'; }, 'station-gate/unsupported-claim');
  add('manifest-reference', 'evidence', (value) => { value.packages[1].manifest_evidence_id = `evidence-${OTHER_64}`; }, 'station-gate/evidence-reference-missing');
  add('workspace-kind', 'evidence', (value) => { value.workspace.kind = 'root-package'; }, 'station-gate/unsupported-claim');
  add('workspace-patterns', 'evidence', (value) => { value.workspace.patterns = ['apps/*']; }, 'station-gate/unsupported-claim');
  add('workspace-membership', 'evidence', (value) => { value.workspace.package_roots.pop(); }, 'station-gate/unsupported-claim');
  add('package-name', 'evidence', (value) => { value.packages[1].name = 'renamed'; }, 'station-gate/unsupported-claim');
  add('package-private', 'evidence', (value) => { value.packages[1].private = true; }, 'station-gate/unsupported-claim');
  add('package-root', 'evidence', (value) => { value.packages[1].root = 'renamed/root'; }, 'station-gate/unsupported-claim');
  add('dependency-name', 'evidence', (value) => { value.packages[1].declared_dependencies[0].name = 'other'; }, 'station-gate/unsupported-claim');
  add('dependency-scope', 'evidence', (value) => { value.packages[1].declared_dependencies[0].scopes = ['peerDependencies']; }, 'station-gate/unsupported-claim');
  add('project-id', 'evidence', (value) => { value.repository.id = `project-${OTHER_64}`; }, 'station-gate/evidence-identity-mismatch');
  add('evidence-id', 'evidence', (value) => { value.files[0].id = `evidence-${OTHER_64}`; }, 'station-gate/evidence-identity-mismatch');
  add('room-id', 'map', (value) => { value.rooms[0].id = `room-${OTHER_64}`; }, 'station-gate/topology-identity-mismatch');
  add('relation-id', 'map', (value) => { value.relations[0].id = `relation-${OTHER_64}`; }, 'station-gate/topology-identity-mismatch');
  add('snapshot-id', 'map', (value) => { value.snapshot.id = `snapshot-${OTHER_64}`; }, 'station-gate/topology-identity-mismatch');
  add('file-order', 'evidence', (value) => { value.files.reverse(); }, 'station-gate/order-mismatch');
  add('package-order', 'evidence', (value) => { value.packages.reverse(); }, 'station-gate/order-mismatch');
  add('workspace-pattern-order', 'evidence', (value) => { value.workspace.patterns.reverse(); }, 'station-gate/order-mismatch');
  add('dependency-scope-order', 'evidence', (value) => { value.packages[1].declared_dependencies[0].scopes.reverse(); }, 'station-gate/order-mismatch');
  add('room-order', 'map', (value) => { value.rooms.reverse(); }, 'station-gate/order-mismatch');
  add('relation-order', 'map', (value) => { value.relations.reverse(); }, 'station-gate/order-mismatch');
  add('package-duplication', 'evidence', (value) => { value.packages.push(clone(value.packages[0])); }, 'station-gate/unsupported-claim');
  add('analysis-count', 'evidence', (value) => { value.analysis.selected_manifest_count += 1; }, 'station-gate/unsupported-claim');
  add('room-structural-key', 'map', (value) => { value.rooms[0].structural_key = 'workspace-package:invented'; }, 'station-gate/unsupported-claim');
  add('room-label', 'map', (value) => { value.rooms[0].label = 'invented'; }, 'station-gate/unsupported-claim');
  add('room-confidence', 'map', (value) => { value.rooms[0].confidence = 'coarse'; }, 'station-gate/schema-invalid');
  add('room-membership', 'map', (value) => { value.rooms[0].package_roots = ['invented/root']; }, 'station-gate/unsupported-claim');
  add('room-evidence-set', 'map', (value) => { value.rooms[0].evidence_ids = [`evidence-${OTHER_64}`]; }, 'station-gate/unsupported-claim');
  add('relation-endpoint', 'map', (value) => { value.relations[0].to_room_id = `room-${OTHER_64}`; }, 'station-gate/unsupported-claim');
  add('relation-direction', 'map', (value) => { [value.relations[0].from_room_id, value.relations[0].to_room_id] = [value.relations[0].to_room_id, value.relations[0].from_room_id]; }, 'station-gate/unsupported-claim');
  add('relation-scope', 'map', (value) => { value.relations[0].scopes = ['peerDependencies']; }, 'station-gate/unsupported-claim');
  add('relation-evidence-set', 'map', (value) => { value.relations[0].evidence_ids = [`evidence-${OTHER_64}`]; }, 'station-gate/unsupported-claim');
  add('relation-omission', 'map', (value) => { value.relations.pop(); }, 'station-gate/unsupported-claim');
  add('relation-invention', 'map', (value) => { value.relations.push({ ...clone(value.relations[0]), id: `relation-${OTHER_64}` }); }, 'station-gate/unsupported-claim');
  add('relation-self-loop', 'map', (value) => { value.relations[0].to_room_id = value.relations[0].from_room_id; }, 'station-gate/schema-invalid');
  add('evidence-hash', 'map', (value) => { value.snapshot.evidence_sha256 = OTHER_64; }, 'station-gate/topology-identity-mismatch');
  add('sixty-fifth-room', 'map', (value) => {
    while (value.rooms.length < 65) value.rooms.push({ ...clone(value.rooms[0]), id: `room-${String(value.rooms.length).padStart(64, '0')}` });
  }, 'station-gate/schema-invalid');
  add('duplicate-room', 'map', (value) => { value.rooms.push(clone(value.rooms[0])); }, 'station-gate/unsupported-claim');
  add('omitted-room', 'map', (value) => { value.rooms.pop(); }, 'station-gate/unsupported-claim');
  return rows;
}

function byteRows(base) {
  return [
    { name: 'invalid-utf8', evidenceBytes: Buffer.from([0xff, 0x0a]), mapBytes: base.map.bytes, code: 'station-gate/schema-invalid' },
    { name: 'invalid-json', evidenceBytes: Buffer.from('{not-json}\n'), mapBytes: base.map.bytes, code: 'station-gate/schema-invalid' },
    { name: 'noncanonical-json', evidenceBytes: Buffer.from(`${JSON.stringify(base.evidence.value, null, 2)}\n`), mapBytes: base.map.bytes, code: 'station-gate/canonical-mismatch' },
    { name: 'noncanonical-newline', evidenceBytes: base.evidence.bytes, mapBytes: Buffer.concat([base.map.bytes, Buffer.from('\n')]), code: 'station-gate/canonical-mismatch' },
  ];
}

function fallbackRows() {
  const base = fixtureArtifacts({ 'README.md': 'no root manifest\n' });
  const make = (name, target, mutate, code) => {
    const evidence = clone(base.evidence.value);
    const map = clone(base.map.value);
    mutate(target === 'evidence' ? evidence : map);
    return { base, row: { name, evidenceBytes: canonicalJsonBytes(evidence), mapBytes: canonicalJsonBytes(map), code } };
  };
  return [
    make('fallback-false-cause', 'evidence', (value) => { value.analysis.fallback_reason_codes = ['station-fallback/workspace-shape-unsupported']; }, 'station-gate/unsupported-claim'),
    make('fallback-omitted-cause', 'map', (value) => { value.fallback.reason_codes = []; }, 'station-gate/schema-invalid'),
    make('fallback-unknown-cause', 'map', (value) => { value.fallback.reason_codes = ['station-fallback/not-approved']; }, 'station-gate/schema-invalid'),
  ];
}

test('independent gate rejects every evidence and topology claim mutation before publication', async () => {
  const base = fixtureArtifacts();
  assert.ok(base.map.value.rooms.length >= 3);
  assert.ok(base.map.value.relations.length >= 2);
  for (const row of [...semanticRows(base), ...byteRows(base)]) await rejectTamper(base, row);
  for (const { base: coarseBase, row } of fallbackRows()) await rejectTamper(coarseBase, row);
});

test('coherently mutated evidence and map bytes still fail immutable-reader reconstruction', async () => {
  const base = fixtureArtifacts();
  const evidence = clone(base.evidence.value);
  evidence.packages[1].name = 'coherently-renamed';
  const evidenceBytes = canonicalJsonBytes(evidence);
  const map = projectStationMap(evidence, evidenceBytes);
  await rejectTamper(base, {
    name: 'coherent-evidence-map-pair',
    evidenceBytes,
    mapBytes: map.bytes,
    code: 'station-gate/unsupported-claim',
  });
});

test('a valid detailed fixture cannot be falsely downgraded to an approved coarse reason', async () => {
  const base = fixtureArtifacts();
  const evidence = clone(base.evidence.value);
  const map = clone(base.map.value);
  const projectId = evidence.repository.id;
  const evidenceHash = sha256Hex(canonicalJsonBytes(evidence));
  map.snapshot = {
    id: deriveSnapshotId(projectId, evidence.repository.revision, evidenceHash),
    project_id: projectId,
    revision: evidence.repository.revision,
    evidence_sha256: evidenceHash,
    profile: 'node-workspaces/v1',
    mode: 'coarse',
  };
  map.rooms = [{
    id: deriveRoomId(projectId, 'project-root'),
    project_id: projectId,
    kind: 'coarse-project',
    structural_key: 'project-root',
    label: 'station-reader',
    package_roots: [],
    confidence: 'coarse',
    evidence_ids: evidence.files.map(({ id }) => id).sort(),
  }];
  map.relations = [];
  map.fallback = { used: true, reason_codes: ['station-fallback/workspace-shape-unsupported'] };
  await rejectTamper(base, {
    name: 'false-detailed-to-coarse-downgrade',
    evidenceBytes: canonicalJsonBytes(evidence),
    mapBytes: canonicalJsonBytes(map),
    code: 'station-gate/unsupported-claim',
  });
});

test('gate tamper matrix has no declared or executed omissions', () => {
  assert.equal(new Set(GATE_TAMPER_MATRIX).size, GATE_TAMPER_MATRIX.length);
  assert.deepEqual([...covered].sort(), [...GATE_TAMPER_MATRIX].sort());
});
