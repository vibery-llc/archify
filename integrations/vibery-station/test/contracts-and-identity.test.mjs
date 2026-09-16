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

function validLimits() {
  return {
    max_tree_bytes: 16 * 1024 * 1024,
    max_manifest_count: 512,
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
