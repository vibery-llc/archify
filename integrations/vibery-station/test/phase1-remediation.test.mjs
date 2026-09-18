import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { canonicalJsonBytes, sha256Hex } from '../lib/canonical-json.mjs';
import { buildStationReceipt } from '../lib/extract.mjs';
import { createGitObjectReader } from '../lib/git-object-reader.mjs';
import { gateStationArtifacts } from '../lib/station-gate.mjs';
import { deriveRelationId, deriveSnapshotId } from '../lib/identity.mjs';
import { buildStationEvidence } from '../lib/node-workspace-evidence.mjs';
import {
  createStationOutputOperations,
  deriveStationGenerationId,
  publishStationGeneration,
  readStationGeneration,
} from '../lib/station-output.mjs';
import { projectStationMap } from '../lib/station-projector.mjs';
import {
  commitFixture,
  createGitFixture,
  recordingRunner,
  runFixtureGit,
  writeBlobObject,
} from './helpers/git-fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '../bin/station-map.mjs');

function temporaryBundle() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'station-remediation-')), 'bundle');
}

function makeCandidate(fixture, bundleRoot) {
  const readerSession = createGitObjectReader({
    repoRoot: fixture.root,
    repositoryUrl: fixture.repositoryUrl,
    revision: fixture.revision,
  });
  const evidence = buildStationEvidence(readerSession);
  const map = projectStationMap(evidence.value, evidence.bytes);
  const gate = gateStationArtifacts(evidence.bytes, map.bytes, readerSession);
  const receipt = buildStationReceipt(gate);
  return {
    bundleRoot,
    evidenceBytes: gate.evidence_bytes,
    mapBytes: gate.map_bytes,
    receiptBytes: receipt.bytes,
    readerSession,
    protectedPaths: [fixture.root],
  };
}

function nextCandidate(fixture, bundleRoot, name) {
  fixture.revision = commitFixture(fixture.root, {
    'package.json': `${JSON.stringify({ name })}\n`,
  }, name);
  return makeCandidate(fixture, bundleRoot);
}

function artifactPaths(bundleRoot, generationId) {
  const root = path.join(bundleRoot, 'generations', generationId);
  return {
    root,
    evidence: path.join(root, 'station-evidence.json'),
    map: path.join(root, 'station-map.json'),
    receipt: path.join(root, 'station-receipt.json'),
  };
}

function coherentlyRewrite(bundleRoot, generationId, mutate) {
  const targets = artifactPaths(bundleRoot, generationId);
  const values = {
    evidence: JSON.parse(fs.readFileSync(targets.evidence, 'utf8')),
    map: JSON.parse(fs.readFileSync(targets.map, 'utf8')),
    receipt: JSON.parse(fs.readFileSync(targets.receipt, 'utf8')),
  };
  mutate(values);
  const evidenceBytes = canonicalJsonBytes(values.evidence);
  values.map.snapshot.evidence_sha256 = sha256Hex(evidenceBytes);
  values.map.snapshot.id = deriveSnapshotId(
    values.map.snapshot.project_id,
    values.map.snapshot.revision,
    values.map.snapshot.evidence_sha256,
    values.map.snapshot.profile,
  );
  const mapBytes = canonicalJsonBytes(values.map);
  values.receipt.repository = {
    url: values.evidence.repository.url,
    revision: values.evidence.repository.revision,
    tree_oid: values.evidence.repository.tree_oid,
    object_format: values.evidence.repository.object_format,
  };
  values.receipt.extractor = structuredClone(values.evidence.extractor);
  values.receipt.artifacts.evidence.sha256 = sha256Hex(evidenceBytes);
  values.receipt.artifacts.evidence.bytes = evidenceBytes.length;
  values.receipt.artifacts.map.sha256 = sha256Hex(mapBytes);
  values.receipt.artifacts.map.bytes = mapBytes.length;
  values.receipt.result = {
    project_id: values.map.project.id,
    snapshot_id: values.map.snapshot.id,
    mode: values.map.snapshot.mode,
    rooms: values.map.rooms.length,
    relations: values.map.relations.length,
    fallback: values.map.fallback.used,
    fallback_reason_codes: [...values.map.fallback.reason_codes],
  };
  const receiptBytes = canonicalJsonBytes(values.receipt);
  fs.writeFileSync(targets.evidence, evidenceBytes);
  fs.writeFileSync(targets.map, mapBytes);
  fs.writeFileSync(targets.receipt, receiptBytes);
  const rewrittenId = deriveStationGenerationId({
    evidence: sha256Hex(evidenceBytes),
    map: sha256Hex(mapBytes),
    receipt: sha256Hex(receiptBytes),
  });
  const rewrittenRoot = path.join(bundleRoot, 'generations', rewrittenId);
  fs.renameSync(targets.root, rewrittenRoot);
  fs.writeFileSync(path.join(bundleRoot, 'CURRENT'), `${rewrittenId}\n`);
  return rewrittenId;
}

function expectCode(code, operation) {
  assert.throws(operation, (error) => {
    assert.equal(error?.code, code, JSON.stringify(error?.diagnostic));
    return true;
  });
}

test('resolved generations independently reconstruct every map semantic after all outer addresses are recomputed', () => {
  const rows = [
    ['project-label', ({ map }) => { map.project.label = 'forged-label'; }],
    ['room-label', ({ map }) => { map.rooms[0].label = 'forged-room'; }],
    ['room-package-roots', ({ map }) => { map.rooms[0].package_roots = [map.rooms[1].package_roots[0]]; }],
    ['room-evidence-set', ({ map }) => { map.rooms[0].evidence_ids = [...map.rooms[1].evidence_ids]; }],
    ['relation-direction', ({ map }) => {
      const relation = map.relations[0];
      [relation.from_room_id, relation.to_room_id] = [relation.to_room_id, relation.from_room_id];
      relation.id = deriveRelationId(relation.from_room_id, relation.to_room_id);
    }],
    ['relation-scopes', ({ map }) => { map.relations[0].scopes = ['peerDependencies']; }],
    ['relation-provenance', ({ map }) => { map.relations[0].evidence_ids = [...map.rooms[1].evidence_ids]; }],
    ['relation-count', ({ map }) => { map.relations.pop(); }],
    ['revision-binding', ({ map }) => { map.snapshot.revision = 'f'.repeat(40); }],
    ['mode-binding', ({ map }) => { map.snapshot.mode = 'coarse'; map.fallback = { used: true, reason_codes: ['station-fallback/room-count-out-of-range'] }; map.rooms = [map.rooms[0]]; map.rooms[0] = { ...map.rooms[0], kind: 'coarse-project', structural_key: 'project-root', package_roots: [], confidence: 'coarse' }; map.relations = []; }],
  ];
  for (const [name, mutate] of rows) {
    const fixture = createGitFixture({ files: {
      'package.json': JSON.stringify({ name: 'root', workspaces: ['apps/*', 'packages/*'] }),
      'apps/api/package.json': JSON.stringify({ name: 'api', dependencies: { core: 'workspace:*' } }),
      'packages/core/package.json': JSON.stringify({ name: 'core' }),
    } });
    const bundleRoot = temporaryBundle();
    const published = publishStationGeneration(makeCandidate(fixture, bundleRoot));
    const rewrittenId = coherentlyRewrite(bundleRoot, published.generation_id, mutate);
    expectCode('station-output/pointer-invalid', () => readStationGeneration(bundleRoot, { expectedGenerationId: rewrittenId }));
    assert.ok(fs.existsSync(path.join(bundleRoot, 'CURRENT')), name);
  }
});

test('post-rename failures are forward-only and expose committed recovery without rollback', () => {
  const fixture = createGitFixture();
  const bundleRoot = temporaryBundle();
  const original = publishStationGeneration(makeCandidate(fixture, bundleRoot));
  const replacement = nextCandidate(fixture, bundleRoot, 'forward-only');
  let restorationAttempted = false;
  const result = publishStationGeneration(replacement, {
    operations: createStationOutputOperations({
      fsyncDirectory(target, phase) {
        if (target === bundleRoot && phase === 'commit-current') {
          throw Object.assign(new Error('commit fsync failure'), { code: 'EIO' });
        }
        const descriptor = fs.openSync(target, fs.constants.O_RDONLY);
        try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
      },
      rename(source, target, phase) {
        if (phase === 'restore-current') restorationAttempted = true;
        fs.renameSync(source, target);
      },
    }),
  });
  assert.equal(result.state, 'committed-recovery-required');
  assert.equal(result.committed, true);
  assert.equal(restorationAttempted, false);
  assert.notEqual(result.generation_id, original.generation_id);
  expectCode('station-output/recovery-required', () => readStationGeneration(bundleRoot, {
    expectedGenerationId: result.generation_id,
  }));
});

test('real CLI redacts credentials from SCP-like remotes in typed diagnostics', () => {
  const secret = 'SYNTHETIC_SCP_SECRET';
  const fixture = createGitFixture();
  runFixtureGit(fixture.root, ['remote', 'set-url', 'origin', `user:${secret}@example.test:owner/repo.git`]);
  const result = spawnSync(process.execPath, [
    CLI, 'extract', temporaryBundle(),
    '--repo-root', fixture.root,
    '--repository-url', 'https://example.test/other/repo.git',
    '--revision', fixture.revision,
    '--json',
  ], { encoding: 'utf8', shell: false });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.diagnostics[0].code, 'station-extract/origin-mismatch');
  assert.doesNotMatch(result.stdout, new RegExp(secret));
  assert.match(envelope.diagnostics[0].evidence.localOrigin, /REDACTED/);
});

function treeRecord(mode, type, oid, pathBytes) {
  return Buffer.concat([Buffer.from(`${mode} ${type} ${oid}\t`, 'ascii'), pathBytes, Buffer.from([0])]);
}

test('valid workspaces with traversal-shaped or non-UTF-8 manifest candidates cannot silently remain detailed', () => {
  for (const [label, hostilePath, classification] of [
    ['traversal', Buffer.from('packages/../escape/package.json'), 'station-extract/path-shape-unsupported'],
    ['non-utf8', Buffer.from([0xff, ...Buffer.from('/package.json')]), 'station-extract/path-encoding-unsupported'],
  ]) {
    const fixture = createGitFixture();
    const rootOid = writeBlobObject(fixture.root, Buffer.from(JSON.stringify({ name: 'root', workspaces: ['packages/*'] })));
    const validOid = writeBlobObject(fixture.root, Buffer.from(JSON.stringify({ name: 'valid' })));
    const hostileOid = writeBlobObject(fixture.root, Buffer.from(JSON.stringify({ name: 'hostile' })));
    const output = Buffer.concat([
      treeRecord('100644', 'blob', rootOid, Buffer.from('package.json')),
      treeRecord('100644', 'blob', validOid, Buffer.from('packages/valid/package.json')),
      treeRecord('100644', 'blob', hostileOid, hostilePath),
    ]);
    const reader = createGitObjectReader({
      repoRoot: fixture.root,
      repositoryUrl: fixture.repositoryUrl,
      revision: fixture.revision,
    }, {
      processRunner: recordingRunner([], (_command, args) => (args[0] === 'ls-tree'
        ? { status: 0, stdout: output, stderr: Buffer.alloc(0) }
        : null)),
    });
    assert.ok(reader.unsupportedPaths.some(({ code }) => code === classification), label);
    assert.equal(reader.manifestPolicy.discovered, 3, label);
    const evidence = buildStationEvidence(reader).value;
    assert.equal(evidence.analysis.detail_eligible, false, label);
    assert.deepEqual(evidence.analysis.fallback_reason_codes, ['station-fallback/path-unsupported'], label);
    assert.deepEqual(evidence.packages, [], label);
    assert.equal(evidence.analysis.discovered_manifest_count, 3, label);
  }
});
