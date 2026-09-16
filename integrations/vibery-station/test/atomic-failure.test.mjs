import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { buildStationReceipt } from '../lib/extract.mjs';
import { createGitObjectReader } from '../lib/git-object-reader.mjs';
import { buildStationEvidence } from '../lib/node-workspace-evidence.mjs';
import { gateStationArtifacts } from '../lib/station-gate.mjs';
import {
  createStationOutputOperations,
  inspectStationPublication,
  publishStationGeneration,
  readStationGeneration,
  recoverStationPublication,
} from '../lib/station-output.mjs';
import { projectStationMap } from '../lib/station-projector.mjs';
import { commitFixture, createGitFixture } from './helpers/git-fixture.mjs';

export const ATOMIC_FAILURE_MATRIX = Object.freeze([
  'generation-file-fsync', 'regular-lock-live', 'regular-lock-stale', 'regular-lock-reused-pid',
  'regular-lock-eperm', 'regular-lock-eio', 'publisher-publisher-interleaving',
  'rename-committed-ambiguity', 'rename-authority-indeterminate', 'post-commit-cleanup',
  'post-commit-lock-release', 'interrupt-before-pointer-rename', 'interrupt-after-pointer-rename',
  'recovery-interruption', 'directory-fsync-downgrade', 'prior-generations-retained',
  'first-publication-crash', 'first-publication-parent-fsync-failure',
  'first-publication-parent-fsync-unsupported',
]);
const covered = new Set();
function cover(...rows) { rows.forEach((row) => { assert.ok(ATOMIC_FAILURE_MATRIX.includes(row)); covered.add(row); }); }

function temporaryBundle() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'station-atomic-')), 'bundle'); }
function candidate(fixture, bundleRoot) {
  const readerSession = createGitObjectReader({ repoRoot: fixture.root, repositoryUrl: fixture.repositoryUrl, revision: fixture.revision });
  const evidence = buildStationEvidence(readerSession);
  const map = projectStationMap(evidence.value, evidence.bytes);
  const gate = gateStationArtifacts(evidence.bytes, map.bytes, readerSession);
  const receipt = buildStationReceipt(gate);
  return { bundleRoot, evidenceBytes: gate.evidence_bytes, mapBytes: gate.map_bytes, receiptBytes: receipt.bytes, readerSession, protectedPaths: [fixture.root] };
}
function nextCandidate(fixture, bundleRoot, name) {
  fixture.revision = commitFixture(fixture.root, { 'package.json': `${JSON.stringify({ name })}\n` }, name);
  return candidate(fixture, bundleRoot);
}
function read(bundleRoot, generationId, operations) {
  return readStationGeneration(bundleRoot, { expectedGenerationId: generationId, ...(operations ? { operations } : {}) });
}
function expectCode(code, operation) {
  assert.throws(operation, (error) => { assert.equal(error?.code, code, JSON.stringify(error?.diagnostic)); return true; });
}
function waitForFile(target, timeout = 5000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const inspect = () => {
      if (fs.existsSync(target)) return resolve();
      if (Date.now() - started > timeout) return reject(new Error(`timed out waiting for ${target}`));
      setTimeout(inspect, 10);
    };
    inspect();
  });
}
function childProgram(event) {
  const root = path.dirname(new URL(import.meta.url).pathname);
  const urls = Object.fromEntries(Object.entries({
    output: '../lib/station-output.mjs', reader: '../lib/git-object-reader.mjs', evidence: '../lib/node-workspace-evidence.mjs',
    projector: '../lib/station-projector.mjs', gate: '../lib/station-gate.mjs', extract: '../lib/extract.mjs',
  }).map(([key, relative]) => [key, pathToFileURL(path.resolve(root, relative)).href]));
  return `
    import fs from 'node:fs';
    import { publishStationGeneration } from ${JSON.stringify(urls.output)};
    import { createGitObjectReader } from ${JSON.stringify(urls.reader)};
    import { buildStationEvidence } from ${JSON.stringify(urls.evidence)};
    import { projectStationMap } from ${JSON.stringify(urls.projector)};
    import { gateStationArtifacts } from ${JSON.stringify(urls.gate)};
    import { buildStationReceipt } from ${JSON.stringify(urls.extract)};
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

function ownerLock(bundleRoot, { token = 'a'.repeat(64), pid = 424242, start = 'boot:1' } = {}) {
  fs.mkdirSync(bundleRoot, { recursive: true });
  fs.writeFileSync(path.join(bundleRoot, '.station-publication.lock'), `${JSON.stringify({
    pid, process_start_identity: start, schema: 'station-publication-owner/v1', token,
  })}\n`);
}

test('mandatory regular-file fsync fails before authority changes', () => {
  const fixture = createGitFixture();
  const bundleRoot = temporaryBundle();
  const first = publishStationGeneration(candidate(fixture, bundleRoot));
  const newer = nextCandidate(fixture, bundleRoot, 'file-fsync');
  expectCode('station-output/commit-failed', () => publishStationGeneration(newer, {
    operations: createStationOutputOperations({ fsyncFile() { throw Object.assign(new Error('unsupported'), { code: 'EINVAL' }); } }),
  }));
  assert.equal(read(bundleRoot, first.generation_id).generation_id, first.generation_id);
  cover('generation-file-fsync');
});

test('owner attestation classifies live, stale, reused, EPERM, and EIO exactly', () => {
  for (const [row, probe, code] of [
    ['regular-lock-live', () => 'boot:1', 'station-output/publication-busy'],
    ['regular-lock-stale', () => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); }, 'station-output/publication-lock-stale'],
    ['regular-lock-reused-pid', () => 'boot:2', 'station-output/publication-lock-stale'],
    ['regular-lock-eperm', () => { throw Object.assign(new Error('unknown'), { code: 'EPERM' }); }, 'station-output/recovery-required'],
    ['regular-lock-eio', () => { throw Object.assign(new Error('unknown'), { code: 'EIO' }); }, 'station-output/recovery-required'],
  ]) {
    const fixture = createGitFixture();
    const bundleRoot = temporaryBundle();
    ownerLock(bundleRoot);
    const operations = createStationOutputOperations({
      processStartIdentity(pid) { return pid === process.pid ? 'self:1' : probe(); },
    });
    expectCode(code, () => publishStationGeneration(candidate(fixture, bundleRoot), { operations }));
    cover(row);
  }
});

test('two publishers cannot both cross the final authority check', () => {
  const fixture = createGitFixture();
  const bundleRoot = temporaryBundle();
  publishStationGeneration(candidate(fixture, bundleRoot));
  const left = nextCandidate(fixture, bundleRoot, 'left');
  const right = nextCandidate(fixture, bundleRoot, 'right');
  const published = publishStationGeneration(left, { barrier(name) {
    if (name === 'after-final-current-check') expectCode('station-output/publication-busy', () => publishStationGeneration(right));
  } });
  assert.equal(read(bundleRoot, published.generation_id).generation_id, published.generation_id);
  cover('publisher-publisher-interleaving');
});

test('rename errors are classified by exact post-error authority inspection', () => {
  {
    const fixture = createGitFixture();
    const bundleRoot = temporaryBundle();
    publishStationGeneration(candidate(fixture, bundleRoot));
    const result = publishStationGeneration(nextCandidate(fixture, bundleRoot, 'committed'), { operations: createStationOutputOperations({
      rename(source, target, phase) { fs.renameSync(source, target); if (phase === 'commit-current') throw Object.assign(new Error('ack lost'), { code: 'EIO' }); },
    }) });
    assert.equal(result.state, 'committed-recovery-required');
    cover('rename-committed-ambiguity');
  }
  {
    const fixture = createGitFixture();
    const bundleRoot = temporaryBundle();
    publishStationGeneration(candidate(fixture, bundleRoot));
    const current = path.join(bundleRoot, 'CURRENT');
    let uncertain = false;
    const result = publishStationGeneration(nextCandidate(fixture, bundleRoot, 'unknown'), { operations: createStationOutputOperations({
      rename(source, target, phase) { if (phase === 'commit-current') { uncertain = true; throw Object.assign(new Error('unknown'), { code: 'EIO' }); } fs.renameSync(source, target); },
      lstat(target) { if (uncertain && target === current) throw Object.assign(new Error('unknown'), { code: 'EIO' }); return fs.lstatSync(target); },
    }) });
    assert.equal(result.state, 'authority-indeterminate');
    assert.equal(result.committed, null);
    cover('rename-authority-indeterminate');
  }
});

test('cleanup and lock-release failures after known commit remain successful replacement states', () => {
  for (const [row, failPhase] of [
    ['post-commit-cleanup', 'cleanup-transaction-journal'],
    ['post-commit-lock-release', 'release-publication-lock'],
  ]) {
    const fixture = createGitFixture();
    const bundleRoot = temporaryBundle();
    const result = publishStationGeneration(candidate(fixture, bundleRoot), { operations: createStationOutputOperations({
      unlink(target, phase) { if (phase === failPhase) throw Object.assign(new Error('injected'), { code: 'EIO' }); fs.unlinkSync(target); },
    }) });
    assert.equal(result.state, 'committed-recovery-required');
    assert.equal(result.committed, true);
    assert.equal(fs.readFileSync(path.join(bundleRoot, 'CURRENT'), 'utf8'), `${result.generation_id}\n`);
    cover(row);
  }
});

test('SIGKILL before and after CURRENT rename leaves complete old or recoverable new authority', () => {
  assert.notEqual(process.platform, 'win32');
  for (const [event, row] of [
    ['before-current-rename', 'interrupt-before-pointer-rename'],
    ['after-current-rename', 'interrupt-after-pointer-rename'],
  ]) {
    const fixture = createGitFixture();
    const bundleRoot = temporaryBundle();
    const old = publishStationGeneration(candidate(fixture, bundleRoot));
    const newer = nextCandidate(fixture, bundleRoot, row);
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', childProgram(event), fixture.root, fixture.repositoryUrl, fixture.revision, bundleRoot, 'KILL', 'unused'], { encoding: 'utf8', shell: false });
    assert.equal(child.signal, 'SIGKILL', child.stderr);
    const currentId = fs.readFileSync(path.join(bundleRoot, 'CURRENT'), 'utf8').trim();
    if (event === 'before-current-rename') {
      assert.equal(currentId, old.generation_id);
      assert.equal(read(bundleRoot, old.generation_id).generation_id, old.generation_id);
    } else {
      assert.notEqual(currentId, old.generation_id);
      expectCode('station-output/recovery-required', () => read(bundleRoot, currentId));
      const root = path.join(bundleRoot, 'generations', currentId);
      assert.deepEqual(fs.readFileSync(path.join(root, 'station-receipt.json')), newer.receiptBytes);
    }
    cover(row);
  }
});

test('explicit recovery survives interruption after token reattestation and is retryable', () => {
  assert.notEqual(process.platform, 'win32');
  const fixture = createGitFixture();
  const bundleRoot = temporaryBundle();
  publishStationGeneration(candidate(fixture, bundleRoot));
  nextCandidate(fixture, bundleRoot, 'recoverable');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childProgram('after-current-rename'), fixture.root, fixture.repositoryUrl, fixture.revision, bundleRoot, 'KILL', 'unused'], { encoding: 'utf8', shell: false });
  assert.equal(child.signal, 'SIGKILL', child.stderr);
  const inspected = inspectStationPublication(bundleRoot);
  assert.equal(inspected.state, 'committed-recovery-required');
  assert.throws(() => recoverStationPublication(bundleRoot, {
    recoveryToken: inspected.recovery_token,
    barrier(name) { if (name === 'after-recovery-reattest') throw new Error('recovery interrupted'); },
  }), /recovery interrupted/);
  assert.equal(inspectStationPublication(bundleRoot).state, 'committed-recovery-required');
  const recovered = recoverStationPublication(bundleRoot, { recoveryToken: inspected.recovery_token });
  assert.equal(recovered.state, 'recovered');
  assert.equal(read(bundleRoot, inspected.generation_id).generation_id, inspected.generation_id);
  cover('recovery-interruption');
});

test('first publication crash before parent durability leaves no CURRENT and is retryable', () => {
  assert.notEqual(process.platform, 'win32');
  const fixture = createGitFixture();
  const bundleRoot = temporaryBundle();
  const child = spawnSync(process.execPath, [
    '--input-type=module', '-e', childProgram('after-bundle-root-created'),
    fixture.root, fixture.repositoryUrl, fixture.revision, bundleRoot, 'KILL', 'unused',
  ], { encoding: 'utf8', shell: false });
  assert.equal(child.signal, 'SIGKILL', child.stderr);
  assert.equal(fs.existsSync(path.join(bundleRoot, 'CURRENT')), false);
  let parentSyncs = 0;
  const result = publishStationGeneration(candidate(fixture, bundleRoot), {
    operations: createStationOutputOperations({
      fsyncDirectory(target, phase) {
        if (phase === 'publish-bundle-root') {
          parentSyncs += 1;
          assert.equal(target, path.dirname(bundleRoot));
        }
        const descriptor = fs.openSync(target, fs.constants.O_RDONLY);
        try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
      },
    }),
  });
  assert.equal(result.state, 'committed');
  assert.equal(parentSyncs, 1);
  cover('first-publication-crash');
});

test('first publication parent fsync EIO fails before authority and remains retryable', () => {
  const fixture = createGitFixture();
  const existingParent = fs.mkdtempSync(path.join(os.tmpdir(), 'station-first-parent-'));
  const bundleRoot = path.join(existingParent, 'nested', 'bundle');
  const publication = candidate(fixture, bundleRoot);
  expectCode('station-output/commit-failed', () => publishStationGeneration(publication, {
    operations: createStationOutputOperations({
      fsyncDirectory(target, phase) {
        if (phase === 'publish-bundle-root') {
          assert.equal(target, existingParent);
          throw Object.assign(new Error('parent fsync failed'), { code: 'EIO' });
        }
        const descriptor = fs.openSync(target, fs.constants.O_RDONLY);
        try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
      },
    }),
  }));
  assert.equal(fs.existsSync(path.join(bundleRoot, 'CURRENT')), false);
  assert.equal(publishStationGeneration(publication).state, 'committed');
  cover('first-publication-parent-fsync-failure');
});

test('unsupported first publication parent fsync explicitly downgrades durability wording', () => {
  const fixture = createGitFixture();
  const existingParent = fs.mkdtempSync(path.join(os.tmpdir(), 'station-first-unsupported-'));
  const bundleRoot = path.join(existingParent, 'nested', 'bundle');
  const result = publishStationGeneration(candidate(fixture, bundleRoot), {
    operations: createStationOutputOperations({
      fsyncDirectory(target, phase) {
        if (phase === 'publish-bundle-root') {
          assert.equal(target, existingParent);
          throw Object.assign(new Error('parent fsync unsupported'), { code: 'EINVAL' });
        }
        const descriptor = fs.openSync(target, fs.constants.O_RDONLY);
        try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
      },
    }),
  });
  assert.equal(result.state, 'committed');
  assert.equal(result.directory_fsync, 'unsupported-on-platform');
  assert.equal(result.durability_claim, 'atomic-rename-without-portable-directory-fsync-guarantee');
  cover('first-publication-parent-fsync-unsupported');
});

test('unsupported directory fsync downgrades claims and prior immutable generations remain', () => {
  const fixture = createGitFixture();
  const bundleRoot = temporaryBundle();
  const unsupported = Object.assign(new Error('unsupported'), { code: 'EINVAL' });
  const first = publishStationGeneration(candidate(fixture, bundleRoot), {
    operations: createStationOutputOperations({ fsyncDirectory() { throw unsupported; } }),
  });
  assert.equal(first.directory_fsync, 'unsupported-on-platform');
  const second = publishStationGeneration(nextCandidate(fixture, bundleRoot, 'second'));
  assert.ok(fs.existsSync(path.join(bundleRoot, 'generations', first.generation_id)));
  assert.ok(fs.existsSync(path.join(bundleRoot, 'generations', second.generation_id)));
  cover('directory-fsync-downgrade', 'prior-generations-retained');
});

test('a concurrent anchored reader retains one immutable generation', async () => {
  const fixture = createGitFixture();
  const bundleRoot = temporaryBundle();
  const oldCandidate = candidate(fixture, bundleRoot);
  const old = publishStationGeneration(oldCandidate);
  nextCandidate(fixture, bundleRoot, 'concurrent');
  const controls = fs.mkdtempSync(path.join(os.tmpdir(), 'station-barrier-'));
  const ready = path.join(controls, 'ready');
  const release = path.join(controls, 'release');
  const child = spawn(process.execPath, ['--input-type=module', '-e', childProgram('before-current-rename'), fixture.root, fixture.repositoryUrl, fixture.revision, bundleRoot, ready, release], { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  await waitForFile(ready);
  const resolved = read(bundleRoot, old.generation_id);
  fs.writeFileSync(release, 'go');
  const exit = await new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  assert.deepEqual(exit, { code: 0, signal: null });
  assert.deepEqual(resolved.receiptBytes, oldCandidate.receiptBytes);
});

test('atomic failure matrix has no omissions', () => {
  assert.deepEqual([...covered].sort(), [...ATOMIC_FAILURE_MATRIX].sort());
});
