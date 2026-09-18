import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { canonicalJsonBytes, sha256Hex } from '../lib/canonical-json.mjs';
import { STATION_LIMITS } from '../lib/contracts.mjs';
import { createGitObjectReader } from '../lib/git-object-reader.mjs';
import { deriveRelationId, deriveRoomId, deriveSnapshotId } from '../lib/identity.mjs';
import { buildStationEvidence } from '../lib/node-workspace-evidence.mjs';
import { projectStationMap } from '../lib/station-projector.mjs';
import {
  createGitFixture,
  createInvalidUtf8BackslashWorkspaceFixture,
} from './helpers/git-fixture.mjs';

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
      assert.equal(error?.diagnostic?.code, code, JSON.stringify(error?.diagnostic));
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
    (value) => { [value.relations[0].from_room_id, value.relations[0].to_room_id] = [value.relations[0].to_room_id, value.relations[0].from_room_id]; },
    (value) => { value.relations[0].scopes = ['optionalDependencies']; },
    (value) => { value.relations[0].evidence_ids = [`evidence-${OTHER_64}`]; },
  ];
  for (const mutate of cases) {
    await rejectMutation(base, 'map', mutate, 'station-gate/unsupported-claim');
  }
  await rejectMutation(base, 'map', (value) => {
    value.rooms[0].confidence = 'coarse';
  }, 'station-gate/schema-invalid');
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

test('reader and independent gate force exact whole-project fallback for backslash manifest paths', async () => {
  const { gateStationArtifacts } = await loadGate();
  for (const [label, hostilePath, expectedDiscovered, expectedSelected] of [
    ['out-of-pattern', 'outside\\package.json', 2, 2],
    ['wildcard-selected', 'packages/bad\\root/package.json', 3, 3],
  ]) {
    const base = fixtureArtifacts({
      'package.json': '{"name":"root","workspaces":["packages/*"]}\n',
      'packages/valid/package.json': '{"name":"valid"}\n',
      [hostilePath]: '{"name":"hostile"}\n',
    });
    const hostileIndex = base.reader.inventory.findIndex(({ path: candidate }) => candidate === hostilePath);
    const hostileFact = base.reader.unsupportedPaths.find(({ entryIndex }) => entryIndex === hostileIndex);

    assert.notEqual(hostileIndex, -1, `${label}: hostile path was silently omitted from inventory`);
    assert.equal(base.reader.inventory.length, 3, `${label}: inventory is incomplete`);
    assert.deepEqual(hostileFact, {
      code: 'station-extract/path-shape-unsupported',
      path: hostilePath,
      pathBytesHex: Buffer.from(hostilePath).toString('hex'),
      entryIndex: hostileIndex,
    }, label);
    assert.equal(base.evidence.value.analysis.detail_eligible, false, label);
    assert.equal(base.evidence.value.analysis.discovered_manifest_count, expectedDiscovered, label);
    assert.equal(base.evidence.value.analysis.selected_manifest_count, expectedSelected, label);
    assert.equal(base.evidence.value.analysis.represented_manifest_count, 0, label);
    assert.deepEqual(base.evidence.value.analysis.fallback_reason_codes, [
      'station-fallback/path-unsupported',
    ], label);
    assert.deepEqual(base.evidence.value.packages, [], label);
    assert.equal(base.map.value.snapshot.mode, 'coarse', label);
    assert.deepEqual(base.map.value.fallback, {
      used: true,
      reason_codes: ['station-fallback/path-unsupported'],
    }, label);
    assert.equal(base.map.value.rooms.length, 1, label);
    assert.deepEqual(base.map.value.relations, [], label);

    const accepted = gateStationArtifacts(base.evidence.bytes, base.map.bytes, base.reader);
    assert.deepEqual(accepted.evidence_bytes, base.evidence.bytes, `${label}: producer/gate evidence bytes differ`);
    assert.deepEqual(accepted.map_bytes, base.map.bytes, `${label}: producer/gate map bytes differ`);
    assert.equal(accepted.mode, 'coarse', label);
    assert.deepEqual(accepted.fallback_reason_codes, ['station-fallback/path-unsupported'], label);

    const readerWithOmittedFact = Object.freeze({
      ...base.reader,
      unsupportedPaths: Object.freeze(base.reader.unsupportedPaths.filter(({ entryIndex }) => entryIndex !== hostileIndex)),
    });
    assert.throws(
      () => gateStationArtifacts(base.evidence.bytes, base.map.bytes, readerWithOmittedFact),
      (error) => error?.diagnostic?.code === 'station-gate/evidence-identity-mismatch',
      `${label}: independent gate accepted omitted backslash classification`,
    );
  }
});

test('reader, producer, and independent gate fail closed for invalid UTF-8 raw-backslash manifest bytes', async () => {
  const { gateStationArtifacts } = await loadGate();
  const fixture = createInvalidUtf8BackslashWorkspaceFixture();
  const reader = createGitObjectReader({
    repoRoot: fixture.root,
    repositoryUrl: fixture.repositoryUrl,
    revision: fixture.revision,
  });
  const hostileIndex = reader.inventory.findIndex(({ pathBytes }) => pathBytes.equals(fixture.hostilePathBytes));
  const hostileFacts = reader.unsupportedPaths.filter(({ entryIndex }) => entryIndex === hostileIndex);

  assert.notEqual(hostileIndex, -1, 'combined-defect path was silently omitted');
  assert.equal(reader.inventory.length, 3);
  assert.equal(reader.manifestCandidates.length, 2);
  assert.deepEqual(hostileFacts.map(({ code }) => code), [
    'station-extract/path-encoding-unsupported',
    'station-extract/path-shape-unsupported',
  ]);

  const evidence = buildStationEvidence(reader);
  const map = projectStationMap(evidence.value, evidence.bytes);
  assert.equal(evidence.value.analysis.discovered_manifest_count, 2);
  assert.equal(evidence.value.analysis.selected_manifest_count, 2);
  assert.equal(evidence.value.analysis.represented_manifest_count, 0);
  assert.equal(evidence.value.analysis.detail_eligible, false);
  assert.deepEqual(evidence.value.analysis.fallback_reason_codes, ['station-fallback/path-unsupported']);
  assert.deepEqual(evidence.value.packages, []);
  assert.equal(map.value.snapshot.mode, 'coarse');
  assert.deepEqual(map.value.fallback.reason_codes, ['station-fallback/path-unsupported']);
  assert.equal(map.value.rooms.length, 1);
  assert.deepEqual(map.value.relations, []);

  const accepted = gateStationArtifacts(evidence.bytes, map.bytes, reader);
  assert.equal(accepted.mode, 'coarse');
  assert.deepEqual(accepted.fallback_reason_codes, ['station-fallback/path-unsupported']);
  assert.deepEqual(accepted.evidence_bytes, evidence.bytes);
  assert.deepEqual(accepted.map_bytes, map.bytes);

  const readerWithShapeFactOmitted = Object.freeze({
    ...reader,
    unsupportedPaths: Object.freeze(reader.unsupportedPaths.filter(({ code, entryIndex }) => (
      code !== 'station-extract/path-shape-unsupported' || entryIndex !== hostileIndex
    ))),
  });
  assert.throws(
    () => gateStationArtifacts(evidence.bytes, map.bytes, readerWithShapeFactOmitted),
    (error) => error?.diagnostic?.code === 'station-gate/evidence-identity-mismatch',
    'independent gate accepted decode-first omission of raw backslash classification',
  );
});

test('independent gate includes the selected root manifest in alias collision classification', async () => {
  const { gateStationArtifacts } = await loadGate();
  const base = fixtureArtifacts({
    'package.json': '{"name":"root"}\n',
    'PACKAGE.JSON': '{"name":"alias"}\n',
  });
  assert.ok(base.reader.unsupportedPaths.some(({ code, path }) => (
    code === 'station-extract/path-case-collision' && path === 'package.json'
  )));
  assert.deepEqual(base.evidence.value.analysis.fallback_reason_codes, ['station-fallback/path-collision']);
  const accepted = gateStationArtifacts(base.evidence.bytes, base.map.bytes, base.reader);
  assert.equal(accepted.mode, 'coarse');
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

test('returns publication buffers and metadata that callers cannot mutate', async () => {
  const { gateStationArtifacts } = await loadGate();
  const base = fixtureArtifacts();
  const result = gateStationArtifacts(base.evidence.bytes, base.map.bytes, base.reader);

  const exposedEvidence = result.evidence_bytes;
  const exposedMap = result.map_bytes;
  exposedEvidence.fill(0);
  exposedMap.fill(0);
  assert.deepEqual(result.evidence_bytes, base.evidence.bytes);
  assert.deepEqual(result.map_bytes, base.map.bytes);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.repository), true);
  assert.equal(Object.isFrozen(result.fallback_reason_codes), true);
  assert.throws(() => { result.mode = 'coarse'; }, TypeError);
});

test('uses bounded diagnostics without absolute paths, secrets, stacks, warnings, or fallback results', async () => {
  const { gateStationArtifacts } = await loadGate();
  const base = fixtureArtifacts();
  const unsafeReader = Object.freeze({
    ...base.reader,
    repository: Object.freeze({
      ...base.reader.repository,
      url: 'https://user:super-secret@github.com/example/station-reader',
    }),
  });
  assert.throws(
    () => gateStationArtifacts(base.evidence.bytes, base.map.bytes, unsafeReader),
    (error) => {
      const serialized = JSON.stringify(error.diagnostic);
      assert.equal(error.diagnostic.code, 'station-gate/evidence-identity-mismatch');
      assert.equal(error.diagnostic.severity, 'error');
      assert.doesNotMatch(serialized, /super-secret|station-git-reader-|stack|warning/i);
      assert.doesNotMatch(serialized, new RegExp(base.fixture.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.equal(error.result, undefined);
      return true;
    },
  );
});

test('rejects false, replaced, unknown, and omitted fallback causes without a partial result', async () => {
  const base = fixtureArtifacts({ 'README.md': 'no manifest\n' });
  assert.equal(base.map.value.snapshot.mode, 'coarse');
  await rejectMutation(base, 'evidence', (value) => {
    value.analysis.fallback_reason_codes = ['station-fallback/workspace-shape-unsupported'];
  }, 'station-gate/unsupported-claim');
  await rejectMutation(base, 'map', (value) => {
    value.fallback.reason_codes = ['station-fallback/workspace-shape-unsupported'];
  }, 'station-gate/unsupported-claim');
  await rejectMutation(base, 'map', (value) => {
    value.fallback.reason_codes = [];
  }, 'station-gate/schema-invalid');
  await rejectMutation(base, 'map', (value) => {
    value.fallback.reason_codes = ['station-fallback/not-approved'];
  }, 'station-gate/schema-invalid');
});

test('rejects every coarse-room shape, evidence, relation, count, confidence, and mode mutation', async () => {
  const base = fixtureArtifacts({ 'README.md': 'no manifest\n' });
  await rejectMutation(base, 'map', (value) => {
    value.rooms[0].id = `room-${OTHER_64}`;
  }, 'station-gate/topology-identity-mismatch');
  for (const mutate of [
    (value) => { value.rooms[0].label = 'invented'; },
    (value) => { value.rooms[0].evidence_ids = [`evidence-${OTHER_64}`]; },
  ]) {
    await rejectMutation(base, 'map', mutate, 'station-gate/unsupported-claim');
  }
  for (const mutate of [
    (value) => { value.snapshot.mode = 'structural'; },
    (value) => { value.fallback.used = false; },
    (value) => { value.rooms[0].kind = 'component'; },
    (value) => { value.rooms[0].structural_key = 'root-package'; },
    (value) => { value.rooms[0].package_roots = ['.']; },
    (value) => { value.rooms[0].confidence = 'high'; },
    (value) => { value.rooms.push(clone(value.rooms[0])); },
    (value) => {
      value.relations.push({
        id: deriveRelationId(deriveRoomId(value.project.id, 'project-root'), deriveRoomId(value.project.id, 'invented')),
        kind: 'declared-package-dependency',
        from_room_id: deriveRoomId(value.project.id, 'project-root'),
        to_room_id: deriveRoomId(value.project.id, 'invented'),
        scopes: ['dependencies'],
        evidence_ids: [`evidence-${OTHER_64}`],
      });
    },
  ]) {
    await rejectMutation(base, 'map', mutate, 'station-gate/schema-invalid');
  }
});
