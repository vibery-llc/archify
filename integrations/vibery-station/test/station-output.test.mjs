import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { canonicalJsonBytes, sha256Hex } from '../lib/canonical-json.mjs';
import { deriveSnapshotId } from '../lib/identity.mjs';
import { buildStationReceipt } from '../lib/extract.mjs';
import { createGitObjectReader } from '../lib/git-object-reader.mjs';
import { gateStationArtifacts } from '../lib/station-gate.mjs';
import { buildStationEvidence } from '../lib/node-workspace-evidence.mjs';
import { projectStationMap } from '../lib/station-projector.mjs';
import { commitFixture, createGitFixture } from './helpers/git-fixture.mjs';

async function loadOutput() {
  try {
    return await import('../lib/station-output.mjs');
  } catch (error) {
    assert.fail(`station output transaction must be importable: ${error.message}`);
  }
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
  }, `candidate ${name}`);
  return makeCandidate(fixture, bundleRoot);
}

function temporaryBundle() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'station-output-parent-')), 'bundle');
}

function expectCode(code, operation) {
  assert.throws(operation, (error) => {
    assert.equal(error?.name, 'StationDiagnosticError');
    assert.equal(error?.code, code, JSON.stringify(error?.diagnostic));
    assert.equal(error?.diagnostic?.severity, 'error');
    return true;
  });
}

function anchoredRead(readStationGeneration, bundleRoot, expectedGenerationId, options = {}) {
  return readStationGeneration(bundleRoot, { ...options, expectedGenerationId });
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

function rewriteGeneration(bundleRoot, generationId, values, deriveStationGenerationId) {
  const current = artifactPaths(bundleRoot, generationId);
  const bytes = {
    evidenceBytes: canonicalJsonBytes(values.evidence),
    mapBytes: canonicalJsonBytes(values.map),
    receiptBytes: canonicalJsonBytes(values.receipt),
  };
  for (const [field, target] of [
    ['evidenceBytes', current.evidence],
    ['mapBytes', current.map],
    ['receiptBytes', current.receipt],
  ]) fs.writeFileSync(target, bytes[field]);
  const rewrittenId = deriveStationGenerationId({
    evidence: sha256Hex(bytes.evidenceBytes),
    map: sha256Hex(bytes.mapBytes),
    receipt: sha256Hex(bytes.receiptBytes),
  });
  const rewrittenRoot = path.join(bundleRoot, 'generations', rewrittenId);
  fs.renameSync(current.root, rewrittenRoot);
  fs.writeFileSync(path.join(bundleRoot, 'CURRENT'), `${rewrittenId}\n`);
  return { rewrittenId, bytes };
}

function waitForFile(file, timeout = 5000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const inspect = () => {
      if (fs.existsSync(file)) return resolve();
      if (Date.now() - started > timeout) return reject(new Error(`timed out waiting for ${path.basename(file)}`));
      setTimeout(inspect, 10);
    };
    inspect();
  });
}

function childProgram(event) {
  const outputUrl = pathToFileURL(path.resolve('integrations/vibery-station/lib/station-output.mjs')).href;
  const readerUrl = pathToFileURL(path.resolve('integrations/vibery-station/lib/git-object-reader.mjs')).href;
  const evidenceUrl = pathToFileURL(path.resolve('integrations/vibery-station/lib/node-workspace-evidence.mjs')).href;
  const projectorUrl = pathToFileURL(path.resolve('integrations/vibery-station/lib/station-projector.mjs')).href;
  const gateUrl = pathToFileURL(path.resolve('integrations/vibery-station/lib/station-gate.mjs')).href;
  const extractUrl = pathToFileURL(path.resolve('integrations/vibery-station/lib/extract.mjs')).href;
  return `
    import fs from 'node:fs';
    import { publishStationGeneration } from ${JSON.stringify(outputUrl)};
    import { createGitObjectReader } from ${JSON.stringify(readerUrl)};
    import { buildStationEvidence } from ${JSON.stringify(evidenceUrl)};
    import { projectStationMap } from ${JSON.stringify(projectorUrl)};
    import { gateStationArtifacts } from ${JSON.stringify(gateUrl)};
    import { buildStationReceipt } from ${JSON.stringify(extractUrl)};
    const [repoRoot, repositoryUrl, revision, bundleRoot, ready, release] = process.argv.slice(1);
    const readerSession = createGitObjectReader({ repoRoot, repositoryUrl, revision });
    const evidence = buildStationEvidence(readerSession);
    const map = projectStationMap(evidence.value, evidence.bytes);
    const gate = gateStationArtifacts(evidence.bytes, map.bytes, readerSession);
    const receipt = buildStationReceipt(gate);
    publishStationGeneration({ bundleRoot, evidenceBytes: gate.evidence_bytes, mapBytes: gate.map_bytes, receiptBytes: receipt.bytes, readerSession, protectedPaths: [repoRoot] }, {
      barrier(name) {
        if (name !== ${JSON.stringify(event)}) return;
        if (ready === 'KILL') process.kill(process.pid, 'SIGKILL');
        fs.writeFileSync(ready, name);
        while (!fs.existsSync(release)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      },
    });
  `;
}

test('publishes exact immutable generation bytes and resolves CURRENT exactly once', async () => {
  const { publishStationGeneration, readStationGeneration } = await loadOutput();
  const fixture = createGitFixture();
  const bundleRoot = temporaryBundle();
  const candidate = makeCandidate(fixture, bundleRoot);
  const published = publishStationGeneration(candidate);
  assert.match(published.generation_id, /^generation-[a-f0-9]{64}$/);
  assert.equal(fs.readFileSync(path.join(bundleRoot, 'CURRENT'), 'utf8'), `${published.generation_id}\n`);
  assert.deepEqual(fs.readdirSync(path.join(bundleRoot, 'generations', published.generation_id)).sort(), [
    'station-evidence.json', 'station-map.json', 'station-receipt.json',
  ]);
  const paths = artifactPaths(bundleRoot, published.generation_id);
  assert.deepEqual(fs.readFileSync(paths.evidence), candidate.evidenceBytes);
  assert.deepEqual(fs.readFileSync(paths.map), candidate.mapBytes);
  assert.deepEqual(fs.readFileSync(paths.receipt), candidate.receiptBytes);

  let currentReads = 0;
  const resolved = anchoredRead(readStationGeneration, bundleRoot, published.generation_id, {
    operations: {
      readFile(target) {
        if (target === path.join(bundleRoot, 'CURRENT')) currentReads += 1;
        return fs.readFileSync(target);
      },
    },
  });
  assert.equal(currentReads, 1);
  assert.equal(resolved.generation_id, published.generation_id);
  assert.deepEqual(resolved.evidenceBytes, candidate.evidenceBytes);
  assert.deepEqual(resolved.mapBytes, candidate.mapBytes);
  assert.deepEqual(resolved.receiptBytes, candidate.receiptBytes);
});

test('receipt binding covers exact evidence/map hashes and counts but never itself', async () => {
  const { publishStationGeneration, readStationGeneration } = await loadOutput();
  const fixture = createGitFixture();
  const bundleRoot = temporaryBundle();
  const candidate = makeCandidate(fixture, bundleRoot);
  const published = publishStationGeneration(candidate);
  const resolved = anchoredRead(readStationGeneration, bundleRoot, published.generation_id);
  assert.equal(resolved.receipt.artifacts.evidence.sha256, sha256Hex(resolved.evidenceBytes));
  assert.equal(resolved.receipt.artifacts.evidence.bytes, resolved.evidenceBytes.length);
  assert.equal(resolved.receipt.artifacts.map.sha256, sha256Hex(resolved.mapBytes));
  assert.equal(resolved.receipt.artifacts.map.bytes, resolved.mapBytes.length);
  assert.equal(Object.hasOwn(resolved.receipt.artifacts, 'receipt'), false);
  assert.equal(Object.hasOwn(resolved.receipt, 'generation_id'), false);

  const tampered = { ...candidate, receiptBytes: Buffer.from(candidate.receiptBytes) };
  tampered.receiptBytes[tampered.receiptBytes.indexOf(Buffer.from('station-map.json'))] = 0x58;
  expectCode('station-output/candidate-invalid', () => publishStationGeneration(tampered));
});

test('reader authenticates CURRENT against the content-derived generation ID after coherent map and receipt tampering', async () => {
  const { publishStationGeneration, readStationGeneration } = await loadOutput();
  const fixture = createGitFixture();
  const bundleRoot = temporaryBundle();
  const candidate = makeCandidate(fixture, bundleRoot);
  const published = publishStationGeneration(candidate);
  const paths = artifactPaths(bundleRoot, published.generation_id);
  const map = JSON.parse(fs.readFileSync(paths.map, 'utf8'));
  const receipt = JSON.parse(fs.readFileSync(paths.receipt, 'utf8'));
  map.project.label = 'coherently-tampered-label';
  const mapBytes = canonicalJsonBytes(map);
  receipt.artifacts.map.sha256 = sha256Hex(mapBytes);
  receipt.artifacts.map.bytes = mapBytes.length;
  fs.writeFileSync(paths.map, mapBytes);
  fs.writeFileSync(paths.receipt, canonicalJsonBytes(receipt));

  expectCode('station-output/pointer-invalid', () => anchoredRead(readStationGeneration, bundleRoot, published.generation_id));
});

test('reader rejects a coherently rebound tree identity when CURRENT still names the original generation', async () => {
  const { publishStationGeneration, readStationGeneration } = await loadOutput();
  const fixture = createGitFixture();
  const bundleRoot = temporaryBundle();
  const candidate = makeCandidate(fixture, bundleRoot);
  const published = publishStationGeneration(candidate);
  const paths = artifactPaths(bundleRoot, published.generation_id);
  const evidence = JSON.parse(fs.readFileSync(paths.evidence, 'utf8'));
  const map = JSON.parse(fs.readFileSync(paths.map, 'utf8'));
  const receipt = JSON.parse(fs.readFileSync(paths.receipt, 'utf8'));
  evidence.repository.tree_oid = 'f'.repeat(40);
  const evidenceBytes = canonicalJsonBytes(evidence);
  map.snapshot.evidence_sha256 = sha256Hex(evidenceBytes);
  map.snapshot.id = deriveSnapshotId(
    map.project.id,
    map.snapshot.revision,
    map.snapshot.evidence_sha256,
    map.snapshot.profile,
  );
  const mapBytes = canonicalJsonBytes(map);
  receipt.repository.tree_oid = evidence.repository.tree_oid;
  receipt.artifacts.evidence.sha256 = sha256Hex(evidenceBytes);
  receipt.artifacts.evidence.bytes = evidenceBytes.length;
  receipt.artifacts.map.sha256 = sha256Hex(mapBytes);
  receipt.artifacts.map.bytes = mapBytes.length;
  receipt.result.snapshot_id = map.snapshot.id;
  fs.writeFileSync(paths.evidence, evidenceBytes);
  fs.writeFileSync(paths.map, mapBytes);
  fs.writeFileSync(paths.receipt, canonicalJsonBytes(receipt));

  expectCode('station-output/pointer-invalid', () => anchoredRead(readStationGeneration, bundleRoot, published.generation_id));
});

test('reader cross-checks receipt tree, project, mode, and counts after generation authentication', async () => {
  const { deriveStationGenerationId, publishStationGeneration, readStationGeneration } = await loadOutput();
  const rows = [
    ['tree', ({ receipt }) => { receipt.repository.tree_oid = 'f'.repeat(40); }],
    ['project', ({ receipt }) => { receipt.result.project_id = `project-${'f'.repeat(64)}`; }],
    ['counts', ({ receipt }) => { receipt.result.relations += 1; }],
  ];
  for (const [label, mutate] of rows) {
    const fixture = createGitFixture();
    const bundleRoot = temporaryBundle();
    const published = publishStationGeneration(makeCandidate(fixture, bundleRoot));
    const paths = artifactPaths(bundleRoot, published.generation_id);
    const values = {
      evidence: JSON.parse(fs.readFileSync(paths.evidence, 'utf8')),
      map: JSON.parse(fs.readFileSync(paths.map, 'utf8')),
      receipt: JSON.parse(fs.readFileSync(paths.receipt, 'utf8')),
    };
    mutate(values);
    const { rewrittenId } = rewriteGeneration(bundleRoot, published.generation_id, values, deriveStationGenerationId);
    expectCode('station-output/pointer-invalid', () => anchoredRead(readStationGeneration, bundleRoot, rewrittenId));
    assert.ok(fs.existsSync(path.join(bundleRoot, 'CURRENT')), label);
  }
});

test('reuses an identical generation without rewriting it and rejects a conflicting one', async () => {
  const { publishStationGeneration } = await loadOutput();
  const fixture = createGitFixture();
  const bundleRoot = temporaryBundle();
  const candidate = makeCandidate(fixture, bundleRoot);
  const first = publishStationGeneration(candidate);
  const generation = artifactPaths(bundleRoot, first.generation_id);
  const before = fs.statSync(generation.evidence).ino;
  const second = publishStationGeneration(candidate);
  assert.equal(second.generation_id, first.generation_id);
  assert.equal(second.reused, true);
  assert.equal(fs.statSync(generation.evidence).ino, before);

  fs.writeFileSync(generation.evidence, 'conflict\n');
  expectCode('station-output/generation-conflict', () => publishStationGeneration(candidate));
});

test('rejects malformed pointers, non-regular targets, symlink components, and protected aliases', async () => {
  const { publishStationGeneration, readStationGeneration } = await loadOutput();
  const fixture = createGitFixture();
  for (const pointer of ['missing-newline', `generation-${'a'.repeat(63)}\n`, `generation-${'a'.repeat(64)}\nextra`]) {
    const bundleRoot = temporaryBundle();
    fs.mkdirSync(bundleRoot, { recursive: true });
    fs.writeFileSync(path.join(bundleRoot, 'CURRENT'), pointer);
    expectCode('station-output/pointer-invalid', () => anchoredRead(readStationGeneration, bundleRoot, `generation-${'a'.repeat(64)}`));
  }
  {
    const bundleRoot = temporaryBundle();
    fs.mkdirSync(path.join(bundleRoot, 'CURRENT'), { recursive: true });
    expectCode('station-output/path-invalid', () => publishStationGeneration(makeCandidate(fixture, bundleRoot)));
  }
  {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'station-output-link-'));
    const physical = path.join(parent, 'physical');
    const alias = path.join(parent, 'alias');
    fs.mkdirSync(physical);
    fs.symlinkSync(physical, alias);
    expectCode('station-output/path-invalid', () => publishStationGeneration(makeCandidate(fixture, alias)));
  }
  expectCode('station-output/path-invalid', () => publishStationGeneration(makeCandidate(fixture, fixture.root)));
});

test('every caught failure before pointer rename preserves complete prior authority', async () => {
  const { publishStationGeneration, readStationGeneration } = await loadOutput();
  for (const event of ['after-staging-files', 'before-generation-rename', 'after-generation-published', 'before-current-rename']) {
    const fixture = createGitFixture();
    const bundleRoot = temporaryBundle();
    const oldCandidate = makeCandidate(fixture, bundleRoot);
    const old = publishStationGeneration(oldCandidate);
    const candidate = nextCandidate(fixture, bundleRoot, `next-${event}`);
    expectCode('station-output/commit-failed', () => publishStationGeneration(candidate, {
      barrier(name) {
        if (name === event) throw new Error('synthetic interruption');
      },
    }));
    const current = anchoredRead(readStationGeneration, bundleRoot, old.generation_id);
    assert.equal(current.generation_id, old.generation_id, event);
    assert.deepEqual(current.evidenceBytes, oldCandidate.evidenceBytes, event);
    assert.deepEqual(current.mapBytes, oldCandidate.mapBytes, event);
    assert.deepEqual(current.receiptBytes, oldCandidate.receiptBytes, event);
  }
});

test('abrupt child termination immediately before and after pointer rename selects old or new complete generation', async (t) => {
  if (process.platform === 'win32') return t.skip('SIGKILL interruption semantics are POSIX-specific');
  const { publishStationGeneration, readStationGeneration } = await loadOutput();
  for (const [event, expected] of [['before-current-rename', 'old'], ['after-current-rename', 'new']]) {
    const fixture = createGitFixture();
    const bundleRoot = temporaryBundle();
    const oldCandidate = makeCandidate(fixture, bundleRoot);
    const old = publishStationGeneration(oldCandidate);
    const newer = nextCandidate(fixture, bundleRoot, `abrupt-${event}`);
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', childProgram(event), fixture.root, fixture.repositoryUrl, fixture.revision, bundleRoot, 'KILL', 'unused'], {
      encoding: 'utf8', shell: false,
    });
    assert.equal(child.signal, 'SIGKILL', `${event}: ${child.stderr}`);
    if (expected === 'old') {
      const current = anchoredRead(readStationGeneration, bundleRoot, old.generation_id);
      assert.equal(current.generation_id, old.generation_id);
      assert.deepEqual(current.receiptBytes, oldCandidate.receiptBytes);
    } else {
      const generationId = fs.readFileSync(path.join(bundleRoot, 'CURRENT'), 'utf8').trim();
      expectCode('station-output/recovery-required', () => anchoredRead(readStationGeneration, bundleRoot, generationId));
      assert.notEqual(generationId, old.generation_id);
      assert.deepEqual(fs.readFileSync(artifactPaths(bundleRoot, generationId).receipt), newer.receiptBytes);
    }
  }
});

test('concurrent once-resolved reader remains on old generation while publication pauses', async () => {
  const { publishStationGeneration, readStationGeneration } = await loadOutput();
  const fixture = createGitFixture();
  const bundleRoot = temporaryBundle();
  const oldCandidate = makeCandidate(fixture, bundleRoot);
  const old = publishStationGeneration(oldCandidate);
  const newer = nextCandidate(fixture, bundleRoot, 'concurrent-new');
  const control = fs.mkdtempSync(path.join(os.tmpdir(), 'station-output-barrier-'));
  const ready = path.join(control, 'ready');
  const release = path.join(control, 'release');
  const child = spawn(process.execPath, ['--input-type=module', '-e', childProgram('before-current-rename'), fixture.root, fixture.repositoryUrl, fixture.revision, bundleRoot, ready, release], {
    stdio: ['ignore', 'pipe', 'pipe'], shell: false,
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  await waitForFile(ready);
  const onceResolved = anchoredRead(readStationGeneration, bundleRoot, old.generation_id);
  assert.equal(onceResolved.generation_id, old.generation_id);
  fs.writeFileSync(release, 'continue');
  const status = await new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  assert.deepEqual(status, { code: 0, signal: null }, stderr);
  const currentId = fs.readFileSync(path.join(bundleRoot, 'CURRENT'), 'utf8').trim();
  const current = anchoredRead(readStationGeneration, bundleRoot, currentId);
  assert.notEqual(current.generation_id, old.generation_id);
  assert.deepEqual(current.receiptBytes, newer.receiptBytes);
  assert.deepEqual(onceResolved.evidenceBytes, oldCandidate.evidenceBytes);
  assert.deepEqual(onceResolved.mapBytes, oldCandidate.mapBytes);
  assert.deepEqual(onceResolved.receiptBytes, oldCandidate.receiptBytes);
});

test('detects final path swaps immediately before publication', async () => {
  const { publishStationGeneration } = await loadOutput();
  const fixture = createGitFixture();
  const bundleRoot = temporaryBundle();
  publishStationGeneration(makeCandidate(fixture, bundleRoot));
  const candidate = nextCandidate(fixture, bundleRoot, 'path-swap');
  expectCode('station-output/path-invalid', () => publishStationGeneration(candidate, {
    barrier(name) {
      if (name !== 'before-current-rename') return;
      const current = path.join(bundleRoot, 'CURRENT');
      const saved = path.join(bundleRoot, 'saved-current');
      fs.renameSync(current, saved);
      fs.symlinkSync(saved, current);
    },
  }));
});

test('post-rename bundle fsync failure preserves the committed replacement and requests recovery', async () => {
  const { createStationOutputOperations, publishStationGeneration } = await loadOutput();
  const fixture = createGitFixture();
  const bundleRoot = temporaryBundle();
  const old = publishStationGeneration(makeCandidate(fixture, bundleRoot));
  const candidate = nextCandidate(fixture, bundleRoot, 'forward-only');
  const operations = createStationOutputOperations({
    fsyncDirectory(target, phase) {
      if (target === bundleRoot && phase === 'commit-current') throw Object.assign(new Error('synthetic parent fsync failure'), { code: 'EIO' });
      const descriptor = fs.openSync(target, fs.constants.O_RDONLY);
      try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    },
  });
  const result = publishStationGeneration(candidate, { operations });
  assert.equal(result.state, 'committed-recovery-required');
  assert.equal(result.committed, true);
  assert.notEqual(result.generation_id, old.generation_id);
  assert.equal(fs.readFileSync(path.join(bundleRoot, 'CURRENT'), 'utf8'), `${result.generation_id}\n`);
});

test('post-commit failure never invokes a restoration rename', async () => {
  const { createStationOutputOperations, publishStationGeneration } = await loadOutput();
  const fixture = createGitFixture();
  const bundleRoot = temporaryBundle();
  publishStationGeneration(makeCandidate(fixture, bundleRoot));
  const candidate = nextCandidate(fixture, bundleRoot, 'no-rollback');
  let restorationAttempted = false;
  const operations = createStationOutputOperations({
    fsyncDirectory(target, phase) {
      if (target === bundleRoot && phase === 'commit-current') throw Object.assign(new Error('synthetic parent fsync failure'), { code: 'EIO' });
      const descriptor = fs.openSync(target, fs.constants.O_RDONLY);
      try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    },
    rename(source, target, phase) {
      if (phase === 'restore-current') restorationAttempted = true;
      fs.renameSync(source, target);
    },
  });
  const result = publishStationGeneration(candidate, { operations });
  assert.equal(result.state, 'committed-recovery-required');
  assert.equal(restorationAttempted, false);
});

test('documents unsupported directory fsync without claiming portable durability', async () => {
  const { createStationOutputOperations, publishStationGeneration } = await loadOutput();
  const fixture = createGitFixture();
  const bundleRoot = temporaryBundle();
  const unsupported = Object.assign(new Error('directory fsync unsupported'), { code: 'EINVAL' });
  const operations = createStationOutputOperations({
    fsyncDirectory() { throw unsupported; },
  });
  const result = publishStationGeneration(makeCandidate(fixture, bundleRoot), { operations });
  assert.equal(result.directory_fsync, 'unsupported-on-platform');
  assert.equal(result.durability_claim, 'atomic-rename-without-portable-directory-fsync-guarantee');
});
