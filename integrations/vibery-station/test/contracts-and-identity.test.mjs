import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INTEGRATION_ROOT = path.resolve(HERE, '..');
const HEX_40_A = 'a'.repeat(40);
const HEX_40_B = 'b'.repeat(40);
const HEX_64_A = 'a'.repeat(64);
const HEX_64_B = 'b'.repeat(64);
const PROJECT_ID = `project-${HEX_64_A}`;
const EVIDENCE_ID = `evidence-${HEX_64_A}`;
const ROOM_ID = `room-${HEX_64_A}`;
const SNAPSHOT_ID = `snapshot-${HEX_64_A}`;

async function loadContracts() {
  try {
    return await import('../lib/contracts.mjs');
  } catch (error) {
    assert.fail(`contracts module must implement the artifact boundary: ${error.message}`);
  }
}

async function loadCanonicalJson() {
  try {
    return await import('../lib/canonical-json.mjs');
  } catch (error) {
    assert.fail(`canonical JSON module must implement exact bytes: ${error.message}`);
  }
}

async function loadIdentity() {
  try {
    return await import('../lib/identity.mjs');
  } catch (error) {
    assert.fail(`identity module must implement versioned formulas: ${error.message}`);
  }
}

function validLimits() {
  return {
    max_tree_bytes: 16 * 1024 * 1024,
    max_manifest_count: 512,
    max_workspace_patterns: 512,
    max_manifest_bytes: 1024 * 1024,
    max_selected_manifest_bytes: 8 * 1024 * 1024,
  };
}

function validEvidence() {
  return {
    schema: 'station-evidence/v1',
    extractor: {
      profile: 'node-workspaces/v1',
      contract_version: 1,
      limits: validLimits(),
    },
    repository: {
      id: PROJECT_ID,
      url: 'https://github.com/acme/widget',
      revision: HEX_40_A,
      tree_oid: HEX_40_B,
      object_format: 'sha1',
    },
    files: [{
      id: EVIDENCE_ID,
      kind: 'git-blob',
      path: 'packages/api/package.json',
      git_oid: HEX_40_A,
      sha256: HEX_64_B,
      bytes: 123,
    }],
    workspace: {
      kind: 'npm-workspaces',
      root_manifest_evidence_id: EVIDENCE_ID,
      patterns: ['packages/*'],
      package_roots: ['packages/api'],
    },
    packages: [{
      root: 'packages/api',
      name: '@acme/api',
      private: true,
      manifest_evidence_id: EVIDENCE_ID,
      workspace_pattern: 'packages/*',
      declared_dependencies: [{
        name: '@acme/core',
        scopes: ['dependencies', 'peerDependencies'],
      }],
    }],
    analysis: {
      detail_eligible: true,
      discovered_manifest_count: 2,
      selected_manifest_count: 1,
      represented_manifest_count: 1,
      fallback_reason_codes: [],
    },
  };
}

function validMap() {
  return {
    schema: 'station-map/v1',
    snapshot: {
      id: SNAPSHOT_ID,
      project_id: PROJECT_ID,
      revision: HEX_40_A,
      evidence_sha256: HEX_64_B,
      profile: 'node-workspaces/v1',
      mode: 'structural',
    },
    project: {
      id: PROJECT_ID,
      label: 'widget',
    },
    rooms: [{
      id: ROOM_ID,
      project_id: PROJECT_ID,
      kind: 'component',
      structural_key: 'workspace-path-group:packages',
      label: 'packages',
      package_roots: ['packages/api'],
      confidence: 'high',
      evidence_ids: [EVIDENCE_ID],
    }],
    relations: [],
    fallback: {
      used: false,
      reason_codes: [],
    },
  };
}

function validReceipt() {
  return {
    schema: 'station-extraction-receipt/v1',
    ok: true,
    command: 'station extract',
    repository: {
      url: 'https://github.com/acme/widget',
      revision: HEX_40_A,
      tree_oid: HEX_40_B,
      object_format: 'sha1',
    },
    extractor: {
      profile: 'node-workspaces/v1',
      contract_version: 1,
      limits: validLimits(),
    },
    artifacts: {
      evidence: {
        file: 'station-evidence.json',
        sha256: HEX_64_A,
        bytes: 123,
      },
      map: {
        file: 'station-map.json',
        sha256: HEX_64_B,
        bytes: 456,
      },
    },
    result: {
      project_id: PROJECT_ID,
      snapshot_id: SNAPSHOT_ID,
      mode: 'structural',
      rooms: 1,
      relations: 0,
      fallback: false,
      fallback_reason_codes: [],
    },
    diagnostics: [],
  };
}

function clone(value) {
  return structuredClone(value);
}

function schemaAt(schema, pointer) {
  if (pointer === '/') return schema;
  return pointer.split('/').slice(1).reduce((node, segment) => {
    if (segment === 'items') return node.items;
    return node.properties[segment];
  }, schema);
}

function collectObjectSchemas(schema, pointer = '/', found = []) {
  if (!schema || typeof schema !== 'object') return found;
  if (schema.type === 'object') found.push([pointer, schema]);
  for (const [name, child] of Object.entries(schema.properties || {})) {
    collectObjectSchemas(child, `${pointer === '/' ? '' : pointer}/${name}`, found);
  }
  if (schema.items) collectObjectSchemas(schema.items, `${pointer === '/' ? '' : pointer}/items`, found);
  for (const child of schema.allOf || []) collectObjectSchemas(child, pointer, found);
  for (const child of schema.anyOf || []) collectObjectSchemas(child, pointer, found);
  for (const child of schema.oneOf || []) collectObjectSchemas(child, pointer, found);
  if (schema.then) collectObjectSchemas(schema.then, pointer, found);
  if (schema.else) collectObjectSchemas(schema.else, pointer, found);
  return found;
}

test('integration package is private native ESM for Node 18+ with no lifecycle or dependencies', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(INTEGRATION_ROOT, 'package.json'), 'utf8'));
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.type, 'module');
  assert.equal(packageJson.engines.node, '>=18');
  assert.equal(packageJson.dependencies, undefined);
  assert.equal(packageJson.devDependencies, undefined);
  assert.equal(packageJson.scripts?.install, undefined);
  assert.equal(packageJson.scripts?.postinstall, undefined);
  assert.equal(packageJson.scripts?.prepare, undefined);
  assert.equal(packageJson.bin, undefined);
});

test('all three schemas close every object and match runtime closed-field sets', async () => {
  const { CONTRACT_FIELDS } = await loadContracts();
  const documents = {
    evidence: JSON.parse(fs.readFileSync(path.join(INTEGRATION_ROOT, 'schemas/station-evidence.schema.json'), 'utf8')),
    map: JSON.parse(fs.readFileSync(path.join(INTEGRATION_ROOT, 'schemas/station-map.schema.json'), 'utf8')),
    receipt: JSON.parse(fs.readFileSync(path.join(INTEGRATION_ROOT, 'schemas/station-extraction-receipt.schema.json'), 'utf8')),
  };

  assert.equal(documents.evidence.$id, 'https://vibery.dev/schemas/station-evidence-v1.json');
  assert.equal(documents.map.$id, 'https://vibery.dev/schemas/station-map-v1.json');
  assert.equal(documents.receipt.$id, 'https://vibery.dev/schemas/station-extraction-receipt-v1.json');

  for (const [artifact, schema] of Object.entries(documents)) {
    for (const [pointer, objectSchema] of collectObjectSchemas(schema)) {
      assert.equal(objectSchema.additionalProperties, false, `${artifact}${pointer} must reject unknown fields`);
    }
    for (const [pointer, fields] of Object.entries(CONTRACT_FIELDS[artifact])) {
      assert.deepEqual(Object.keys(schemaAt(schema, pointer).properties).sort(), [...fields].sort(), `${artifact}${pointer}`);
    }
  }
});

test('strict validators accept the exact v1 artifact contracts', async () => {
  const {
    validateStationEvidence,
    validateStationMap,
    validateStationExtractionReceipt,
  } = await loadContracts();

  const evidence = validEvidence();
  const map = validMap();
  const receipt = validReceipt();
  assert.equal(validateStationEvidence(evidence), evidence);
  assert.equal(validateStationMap(map), map);
  assert.equal(validateStationExtractionReceipt(receipt), receipt);
});

test('contracts reject unknown fields at every artifact boundary', async () => {
  const {
    validateStationEvidence,
    validateStationMap,
    validateStationExtractionReceipt,
  } = await loadContracts();

  for (const [validator, value, mutate] of [
    [validateStationEvidence, validEvidence(), (candidate) => { candidate.extra = true; }],
    [validateStationEvidence, validEvidence(), (candidate) => { candidate.repository.branch = 'main'; }],
    [validateStationEvidence, validEvidence(), (candidate) => { candidate.files[0].absolute_path = '/tmp/repo'; }],
    [validateStationMap, validMap(), (candidate) => { candidate.rooms[0].layout = { x: 1, y: 2 }; }],
    [validateStationExtractionReceipt, validReceipt(), (candidate) => { candidate.duration_ms = 4; }],
    [validateStationExtractionReceipt, validReceipt(), (candidate) => { candidate.artifacts.receipt = { sha256: HEX_64_A }; }],
  ]) {
    const candidate = clone(value);
    mutate(candidate);
    assert.throws(() => validator(candidate), (error) => error?.diagnostic?.code === 'station-gate/schema-invalid');
  }
});

test('contracts reject unsupported versions, transport spellings, and malformed identities', async () => {
  const {
    validateStationEvidence,
    validateStationMap,
    validateStationExtractionReceipt,
  } = await loadContracts();

  const cases = [
    [validateStationEvidence, validEvidence(), (value) => { value.schema = 'station-evidence/v2'; }],
    [validateStationEvidence, validEvidence(), (value) => { value.extractor.profile = 'node-workspaces/v2'; }],
    [validateStationEvidence, validEvidence(), (value) => { value.extractor.contract_version = 2; }],
    [validateStationEvidence, validEvidence(), (value) => { value.repository.url = 'git@github.com:acme/widget.git'; }],
    [validateStationEvidence, validEvidence(), (value) => { value.repository.url = 'https://github.com/Acme/Widget.git'; }],
    [validateStationEvidence, validEvidence(), (value) => { value.repository.id = 'project-not-a-hash'; }],
    [validateStationEvidence, validEvidence(), (value) => { value.repository.revision = 'a'.repeat(39); }],
    [validateStationEvidence, validEvidence(), (value) => { value.files[0].git_oid = 'z'.repeat(40); }],
    [validateStationEvidence, validEvidence(), (value) => { value.files[0].sha256 = 'A'.repeat(64); }],
    [validateStationMap, validMap(), (value) => { value.rooms[0].id = 'room-nope'; }],
    [validateStationMap, validMap(), (value) => { value.snapshot.evidence_sha256 = '0'.repeat(63); }],
    [validateStationExtractionReceipt, validReceipt(), (value) => { value.artifacts.map.sha256 = '0'.repeat(65); }],
  ];

  for (const [validator, fixture, mutate] of cases) {
    const candidate = clone(fixture);
    mutate(candidate);
    assert.throws(() => validator(candidate), (error) => error?.diagnostic?.code === 'station-gate/schema-invalid');
  }
});

test('receipt rejects all volatile fields and any self-hash', async () => {
  const { validateStationExtractionReceipt } = await loadContracts();
  for (const field of ['timestamp', 'duration', 'absolute_path', 'branch', 'host', 'pid', 'git_version', 'runtime_version', 'sha256', 'self_hash']) {
    const receipt = validReceipt();
    receipt[field] = field === 'pid' ? 1 : 'forbidden';
    assert.throws(() => validateStationExtractionReceipt(receipt), (error) => {
      assert.equal(error?.diagnostic?.code, 'station-gate/schema-invalid');
      assert.match(error.diagnostic.evidence.path, new RegExp(`/${field}$`));
      return true;
    });
  }
});

test('map fallback shape is closed and mechanically distinct from structural mode', async () => {
  const { validateStationMap } = await loadContracts();
  const map = validMap();
  map.snapshot.mode = 'coarse';
  map.rooms = [{
    id: ROOM_ID,
    project_id: PROJECT_ID,
    kind: 'coarse-project',
    structural_key: 'project-root',
    label: 'widget',
    package_roots: [],
    confidence: 'coarse',
    evidence_ids: [EVIDENCE_ID],
  }];
  map.fallback = {
    used: true,
    reason_codes: ['station-fallback/workspace-shape-unsupported'],
  };
  assert.equal(validateStationMap(map), map);

  const invalid = clone(map);
  invalid.relations.push({
    id: `relation-${HEX_64_A}`,
    kind: 'declared-package-dependency',
    from_room_id: ROOM_ID,
    to_room_id: `room-${HEX_64_B}`,
    scopes: ['dependencies'],
    evidence_ids: [EVIDENCE_ID],
  });
  assert.throws(() => validateStationMap(invalid), (error) => error?.diagnostic?.code === 'station-gate/schema-invalid');
});

test('diagnostics use the exact Station envelope and schema failures expose it', async () => {
  const { createStationDiagnostic, validateStationEvidence } = await loadContracts();
  const diagnostic = createStationDiagnostic({
    code: 'station-gate/schema-invalid',
    severity: 'error',
    message: 'Artifact contains an unsupported field.',
    subject: { artifact: 'station-evidence/v1' },
    evidence: { path: '/extra' },
    supportedFixes: ['remove the unsupported field', 'remove the unsupported field'],
  });
  assert.deepEqual(diagnostic, {
    code: 'station-gate/schema-invalid',
    severity: 'error',
    message: 'Artifact contains an unsupported field.',
    subject: { artifact: 'station-evidence/v1' },
    evidence: { path: '/extra' },
    supportedFixes: ['remove the unsupported field'],
  });
  assert.deepEqual(Object.keys(diagnostic), ['code', 'severity', 'message', 'subject', 'evidence', 'supportedFixes']);

  const evidence = validEvidence();
  evidence.extra = true;
  assert.throws(() => validateStationEvidence(evidence), (error) => {
    assert.deepEqual(Object.keys(error.diagnostic), ['code', 'severity', 'message', 'subject', 'evidence', 'supportedFixes']);
    assert.equal(error.diagnostic.code, 'station-gate/schema-invalid');
    assert.equal(error.diagnostic.evidence.path, '/extra');
    return true;
  });
});

test('canonical JSON emits exact compact UTF-8 bytes with one trailing LF', async () => {
  const { canonicalJsonBytes, canonicalJsonText } = await loadCanonicalJson();
  const value = {
    zebra: 1,
    alpha: { 'ä': 2, z: 1 },
    array: [{ b: true, a: null }, 'x'],
  };
  const expected = Buffer.from('{"alpha":{"z":1,"ä":2},"array":[{"a":null,"b":true},"x"],"zebra":1}\n', 'utf8');
  const bytes = canonicalJsonBytes(value);
  assert.ok(Buffer.isBuffer(bytes));
  assert.deepEqual(bytes, expected);
  assert.equal(canonicalJsonText(value), expected.toString('utf8'));
  assert.equal(bytes.at(-1), 0x0a);
  assert.notEqual(bytes.at(-2), 0x0a);
});

test('canonical JSON is equal for recursively permuted object keys and preserves arrays', async () => {
  const { canonicalJsonBytes } = await loadCanonicalJson();
  const left = { outer: { beta: 2, alpha: 1 }, list: ['second', 'first'] };
  const right = { list: ['second', 'first'], outer: { alpha: 1, beta: 2 } };
  assert.deepEqual(canonicalJsonBytes(left), canonicalJsonBytes(right));
  assert.match(canonicalJsonBytes(left).toString('utf8'), /"list":\["second","first"\]/);
});

test('canonical JSON rejects every value outside the JSON data domain', async () => {
  const { canonicalJsonBytes } = await loadCanonicalJson();
  const sparse = [];
  sparse[1] = 'present';
  const cyclic = {};
  cyclic.self = cyclic;
  const symbolKey = { valid: true };
  symbolKey[Symbol('ignored-by-json')] = true;
  const decoratedArray = [];
  decoratedArray.extra = true;

  const invalidValues = [
    undefined,
    () => true,
    Symbol('value'),
    1n,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    { nested: undefined },
    [undefined],
    sparse,
    cyclic,
    new Date('2020-01-01T00:00:00Z'),
    new Map([['key', 'value']]),
    Buffer.from('not-json'),
    symbolKey,
    decoratedArray,
  ];
  for (const value of invalidValues) {
    assert.throws(() => canonicalJsonBytes(value), /canonical JSON/i);
  }
});

test('exact-byte SHA-256 helpers hash the supplied bytes without normalization', async () => {
  const { sha256Bytes, sha256Hex } = await loadCanonicalJson();
  const bytes = Buffer.from('abc', 'utf8');
  assert.equal(sha256Hex(bytes), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.deepEqual(
    sha256Bytes(bytes),
    Buffer.from('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'hex'),
  );
  assert.notEqual(sha256Hex(Buffer.from('abc\n', 'utf8')), sha256Hex(bytes));
  assert.throws(() => sha256Hex('abc'), /bytes/i);
});

test('domain comparators use direct code-point ordering and documented tie breakers', async () => {
  const {
    compareCodePoints,
    compareDeclarations,
    compareEvidenceIds,
    compareFallbackCodes,
    compareFiles,
    comparePackages,
    compareRelations,
    compareRooms,
    compareScopes,
  } = await loadCanonicalJson();

  assert.deepEqual(['ä', 'z', 'a'].sort(compareCodePoints), ['a', 'z', 'ä']);
  assert.deepEqual([
    { path: 'b', git_oid: 'a' },
    { path: 'a', git_oid: 'b' },
    { path: 'a', git_oid: 'a' },
  ].sort(compareFiles), [
    { path: 'a', git_oid: 'a' },
    { path: 'a', git_oid: 'b' },
    { path: 'b', git_oid: 'a' },
  ]);
  assert.deepEqual([
    { root: 'packages/z', name: 'a' },
    { root: 'packages/a', name: 'z' },
    { root: 'packages/a', name: 'a' },
  ].sort(comparePackages).map(({ root, name }) => `${root}:${name}`), [
    'packages/a:a',
    'packages/a:z',
    'packages/z:a',
  ]);
  assert.deepEqual([
    { name: 'z', scope: 'dependencies' },
    { name: 'a', scope: 'peerDependencies' },
    { name: 'a', scope: 'dependencies' },
  ].sort(compareDeclarations).map(({ name, scope }) => `${name}:${scope}`), [
    'a:dependencies',
    'a:peerDependencies',
    'z:dependencies',
  ]);
  assert.deepEqual([{ id: 'room-b' }, { id: 'room-a' }].sort(compareRooms).map(({ id }) => id), ['room-a', 'room-b']);
  assert.deepEqual([{ id: 'relation-b' }, { id: 'relation-a' }].sort(compareRelations).map(({ id }) => id), ['relation-a', 'relation-b']);
  assert.deepEqual(['evidence-b', 'evidence-a'].sort(compareEvidenceIds), ['evidence-a', 'evidence-b']);
  assert.deepEqual(['peerDependencies', 'dependencies'].sort(compareScopes), ['dependencies', 'peerDependencies']);
  assert.deepEqual(['station-fallback/z', 'station-fallback/a'].sort(compareFallbackCodes), ['station-fallback/a', 'station-fallback/z']);
});

test('versioned identity formulas match fixed NUL-separated vectors', async () => {
  const {
    deriveEvidenceId,
    deriveProjectId,
    deriveRelationId,
    deriveRoomId,
    deriveSnapshotId,
  } = await loadIdentity();
  const repositoryIdentity = '["github.com","standard","repository","acme/widget"]';
  const projectId = deriveProjectId(repositoryIdentity);
  assert.equal(projectId, 'project-e1360725e7d03a8c31bee35794c45c940544089357cd8261e4ee8e49f0a734fd');
  assert.equal(
    deriveEvidenceId('packages/api/package.json', HEX_40_A),
    'evidence-35b19ae1eed4c5017e100b706532f1eee04dea073a8032167bbbae151bb42433',
  );
  const fromRoomId = deriveRoomId(projectId, 'workspace-path-group:packages');
  const toRoomId = deriveRoomId(projectId, 'workspace-path-group:apps');
  assert.equal(fromRoomId, 'room-23d30ddddb103ef58d6c7392b0bf2a76a39853518a3a4da53c23ae0820ac4db2');
  assert.equal(toRoomId, 'room-49ae7eba2e5643c52e4659681e5dfaaa339307450d7113ec37d897cb4eca9dde');
  assert.equal(
    deriveRelationId(fromRoomId, toRoomId),
    'relation-7edc83f72f0e7a632238b074918663447a78ce8d3463849373b6325214ba37a0',
  );
  assert.equal(
    deriveSnapshotId(projectId, HEX_40_B, 'c'.repeat(64), 'node-workspaces/v1'),
    'snapshot-66b800bc0af15f8e83cb605c27761e5ee9b00e58e5af32a7531a4f740ea37056',
  );
});

test('durable topology identities exclude revision, labels, layout, and traversal order', async () => {
  const {
    deriveProjectId,
    deriveRelationId,
    deriveRoomId,
    deriveSnapshotId,
  } = await loadIdentity();
  const identity = '["github.com","standard","repository","acme/widget"]';
  const before = {
    project: deriveProjectId(identity),
    label: 'Old label',
    layout: { x: 10, y: 20 },
    revision: HEX_40_A,
  };
  const after = {
    project: deriveProjectId(identity),
    label: 'New label',
    layout: { x: 900, y: 1 },
    revision: HEX_40_B,
  };
  const beforeRooms = ['workspace-path-group:apps', 'workspace-path-group:packages']
    .map((key) => deriveRoomId(before.project, key));
  const afterRooms = ['workspace-path-group:packages', 'workspace-path-group:apps']
    .map((key) => deriveRoomId(after.project, key));

  assert.equal(before.project, after.project);
  assert.deepEqual([...beforeRooms].sort(), [...afterRooms].sort());
  assert.equal(deriveRelationId(beforeRooms[0], beforeRooms[1]), deriveRelationId(afterRooms[1], afterRooms[0]));
  assert.notEqual(
    deriveSnapshotId(before.project, before.revision, HEX_64_A),
    deriveSnapshotId(after.project, after.revision, HEX_64_A),
  );
  assert.notEqual(
    deriveSnapshotId(before.project, before.revision, HEX_64_A),
    deriveSnapshotId(before.project, before.revision, HEX_64_B),
  );
});

test('identity inputs reject ambiguous NUL separators and malformed fixed-width facts', async () => {
  const { deriveEvidenceId, deriveProjectId, deriveRoomId, deriveSnapshotId } = await loadIdentity();
  assert.throws(() => deriveProjectId('identity\0suffix'), /NUL/i);
  assert.throws(() => deriveEvidenceId('../package.json', HEX_40_A), /path/i);
  assert.throws(() => deriveEvidenceId('package.json', 'a'.repeat(39)), /OID/i);
  assert.throws(() => deriveRoomId(PROJECT_ID, 'group\0other'), /NUL/i);
  assert.throws(() => deriveSnapshotId(PROJECT_ID, HEX_40_A, 'a'.repeat(63)), /SHA-256/i);
});
