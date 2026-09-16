import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { canonicalJsonBytes } from '../lib/canonical-json.mjs';
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

function temporaryBundle() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'station-architecture-')), 'bundle');
}

function candidate(fixture, bundleRoot) {
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
  fixture.revision = commitFixture(fixture.root, { 'package.json': `${JSON.stringify({ name })}\n` }, name);
  return candidate(fixture, bundleRoot);
}

function expectCode(code, operation) {
  assert.throws(operation, (error) => {
    assert.equal(error?.code, code, JSON.stringify(error?.diagnostic));
    return true;
  });
}

function read(bundleRoot, generationId, operations) {
  return readStationGeneration(bundleRoot, { expectedGenerationId: generationId, ...(operations ? { operations } : {}) });
}

function ownerBytes({ token = 'a'.repeat(64), pid = 424242, processStartIdentity = 'boot:100' } = {}) {
  return canonicalJsonBytes({
    schema: 'station-publication-owner/v1',
    token,
    pid,
    process_start_identity: processStartIdentity,
  });
}

function seedLock(bundleRoot, owner = {}) {
  fs.mkdirSync(bundleRoot, { recursive: true });
  const bytes = ownerBytes(owner);
  fs.writeFileSync(path.join(bundleRoot, '.station-publication.lock'), bytes);
  return JSON.parse(bytes);
}

test('reader requires and validates a trusted external generation anchor before any filesystem read', () => {
  const bundleRoot = temporaryBundle();
  let reads = 0;
  const operations = createStationOutputOperations({
    lstat() { reads += 1; throw new Error('must not inspect'); },
    readFile() { reads += 1; throw new Error('must not inspect'); },
  });
  expectCode('station-output/trusted-generation-required', () => readStationGeneration(bundleRoot, { operations }));
  expectCode('station-output/trusted-generation-required', () => readStationGeneration(bundleRoot, {
    expectedGenerationId: 'generation-not-a-hash', operations,
  }));
  assert.equal(reads, 0);
});

test('old trusted anchor rejects a coherent replacement bundle before artifact admission', () => {
  const fixture = createGitFixture();
  const bundleRoot = temporaryBundle();
  const first = publishStationGeneration(candidate(fixture, bundleRoot));
  const second = publishStationGeneration(nextCandidate(fixture, bundleRoot, 'replacement'));
  assert.equal(read(bundleRoot, second.generation_id).generation_id, second.generation_id);
  expectCode('station-output/generation-mismatch', () => read(bundleRoot, first.generation_id));
});

test('regular owner lock distinguishes live, stale, reused PID, EPERM, and EIO without age expiry', () => {
  for (const [label, inspectOwner, expected] of [
    ['live', () => 'boot:100', 'station-output/publication-busy'],
    ['stale', () => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); }, 'station-output/publication-lock-stale'],
    ['reused', () => 'boot:999', 'station-output/publication-lock-stale'],
    ['eperm', () => { throw Object.assign(new Error('unknown'), { code: 'EPERM' }); }, 'station-output/recovery-required'],
    ['eio', () => { throw Object.assign(new Error('unknown'), { code: 'EIO' }); }, 'station-output/recovery-required'],
  ]) {
    const fixture = createGitFixture();
    const bundleRoot = temporaryBundle();
    seedLock(bundleRoot);
    const operations = createStationOutputOperations({
      processStartIdentity(pid) {
        return pid === process.pid ? 'publisher:current' : inspectOwner();
      },
    });
    expectCode(expected, () => publishStationGeneration(candidate(fixture, bundleRoot), { operations }), label);
  }
});

test('two publishers remain mutually exclusive with a regular hard-link owner lock', () => {
  const fixture = createGitFixture();
  const bundleRoot = temporaryBundle();
  const firstCandidate = candidate(fixture, bundleRoot);
  let lockStat;
  const first = publishStationGeneration(firstCandidate, {
    barrier(name) {
      if (name !== 'after-final-current-check') return;
      lockStat = fs.lstatSync(path.join(bundleRoot, '.station-publication.lock'));
      assert.equal(lockStat.isFile(), true);
      assert.ok(lockStat.nlink >= 2);
      expectCode('station-output/publication-busy', () => publishStationGeneration(firstCandidate));
    },
  });
  assert.equal(first.state, 'committed');
});

test('known commit never rolls back and reports post-rename fsync, cleanup, and lock failures as committed recovery', () => {
  for (const [label, overrides] of [
    ['fsync', {
      fsyncDirectory(target, phase) {
        if (phase === 'commit-current') throw Object.assign(new Error('fsync failed'), { code: 'EIO' });
        const descriptor = fs.openSync(target, fs.constants.O_RDONLY);
        try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
      },
    }],
    ['cleanup', {
      unlink(target, phase) {
        if (phase === 'cleanup-transaction-journal') throw Object.assign(new Error('cleanup failed'), { code: 'EIO' });
        fs.unlinkSync(target);
      },
    }],
    ['release', {
      unlink(target, phase) {
        if (phase === 'release-publication-lock') throw Object.assign(new Error('release failed'), { code: 'EIO' });
        fs.unlinkSync(target);
      },
    }],
  ]) {
    const fixture = createGitFixture();
    const bundleRoot = temporaryBundle();
    const old = publishStationGeneration(candidate(fixture, bundleRoot));
    const newer = nextCandidate(fixture, bundleRoot, `post-commit-${label}`);
    const result = publishStationGeneration(newer, { operations: createStationOutputOperations(overrides) });
    assert.equal(result.state, 'committed-recovery-required', label);
    assert.equal(result.committed, true, label);
    assert.notEqual(result.generation_id, old.generation_id, label);
    assert.equal(fs.readFileSync(path.join(bundleRoot, 'CURRENT'), 'utf8'), `${result.generation_id}\n`, label);
  }
});

test('rename ambiguity returns committed recovery or authority indeterminate rather than generic failure', () => {
  {
    const fixture = createGitFixture();
    const bundleRoot = temporaryBundle();
    publishStationGeneration(candidate(fixture, bundleRoot));
    const result = publishStationGeneration(nextCandidate(fixture, bundleRoot, 'rename-committed'), {
      operations: createStationOutputOperations({
        rename(source, target, phase) {
          fs.renameSync(source, target);
          if (phase === 'commit-current') throw Object.assign(new Error('lost acknowledgement'), { code: 'EIO' });
        },
      }),
    });
    assert.equal(result.state, 'committed-recovery-required');
    assert.equal(result.committed, true);
  }
  {
    const fixture = createGitFixture();
    const bundleRoot = temporaryBundle();
    publishStationGeneration(candidate(fixture, bundleRoot));
    let ambiguous = false;
    const current = path.join(bundleRoot, 'CURRENT');
    const result = publishStationGeneration(nextCandidate(fixture, bundleRoot, 'rename-indeterminate'), {
      operations: createStationOutputOperations({
        rename(source, target, phase) {
          if (phase === 'commit-current') {
            ambiguous = true;
            throw Object.assign(new Error('unknown rename outcome'), { code: 'EIO' });
          }
          fs.renameSync(source, target);
        },
        lstat(target) {
          if (ambiguous && target === current) throw Object.assign(new Error('inspection unavailable'), { code: 'EIO' });
          return fs.lstatSync(target);
        },
      }),
    });
    assert.equal(result.state, 'authority-indeterminate');
    assert.equal(result.committed, null);
  }
});

test('inspection is read-only and explicit stale-owner recovery requires token reattestation', () => {
  const fixture = createGitFixture();
  const bundleRoot = temporaryBundle();
  const published = publishStationGeneration(candidate(fixture, bundleRoot));
  const owner = seedLock(bundleRoot, { token: 'b'.repeat(64), pid: 525252, processStartIdentity: 'boot:200' });
  const operations = createStationOutputOperations({
    processStartIdentity() { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); },
  });
  const before = fs.readdirSync(bundleRoot).sort();
  const inspection = inspectStationPublication(bundleRoot, { operations });
  assert.equal(inspection.state, 'stale-lock');
  assert.equal(inspection.recovery_token, owner.token);
  assert.deepEqual(fs.readdirSync(bundleRoot).sort(), before);
  expectCode('station-output/recovery-token-mismatch', () => recoverStationPublication(bundleRoot, {
    recoveryToken: 'c'.repeat(64), operations,
  }));
  const recovered = recoverStationPublication(bundleRoot, { recoveryToken: owner.token, operations });
  assert.equal(recovered.state, 'recovered');
  assert.equal(read(bundleRoot, published.generation_id).generation_id, published.generation_id);
});

test('regular-file fsync is mandatory while unsupported directory fsync only downgrades durability', () => {
  {
    const fixture = createGitFixture();
    const bundleRoot = temporaryBundle();
    const unsupported = Object.assign(new Error('file fsync unsupported'), { code: 'EINVAL' });
    expectCode('station-output/commit-failed', () => publishStationGeneration(candidate(fixture, bundleRoot), {
      operations: createStationOutputOperations({ fsyncFile() { throw unsupported; } }),
    }));
  }
  {
    const fixture = createGitFixture();
    const bundleRoot = temporaryBundle();
    const unsupported = Object.assign(new Error('directory fsync unsupported'), { code: 'EINVAL' });
    const result = publishStationGeneration(candidate(fixture, bundleRoot), {
      operations: createStationOutputOperations({ fsyncDirectory() { throw unsupported; } }),
    });
    assert.equal(result.state, 'committed');
    assert.equal(result.directory_fsync, 'unsupported-on-platform');
  }
});
