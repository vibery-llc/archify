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

function captureError(code, operation) {
  let caught;
  try { operation(); } catch (error) { caught = error; }
  assert.ok(caught, `expected ${code}`);
  assert.equal(caught.code, code, JSON.stringify(caught.diagnostic));
  return caught;
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

function transactionBytes(kind, token, previousGenerationId, candidateGenerationId) {
  return canonicalJsonBytes({
    schema: kind === 'journal' ? 'station-publication-transaction/v1' : 'station-publication-committed/v1',
    token,
    previous_generation_id: previousGenerationId,
    candidate_generation_id: candidateGenerationId,
  });
}

function publicationControlSnapshot(bundleRoot) {
  const names = fs.readdirSync(bundleRoot)
    .filter((name) => name === 'CURRENT' || name.startsWith('.station-publication.'))
    .sort();
  return Object.fromEntries(names.map((name) => [name, fs.readFileSync(path.join(bundleRoot, name))]));
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

test('owner write, fsync, and close failures clean pre-authority material and remain retryable', () => {
  for (const [phase, overrides] of [
    ['write', { write() { throw Object.assign(new Error('owner write failed'), { code: 'EIO' }); } }],
    ['fsync', { fsyncFile() { throw Object.assign(new Error('owner fsync failed'), { code: 'EIO' }); } }],
    ['close', {
      close(descriptor) {
        fs.closeSync(descriptor);
        throw Object.assign(new Error('owner close failed'), { code: 'EIO' });
      },
    }],
  ]) {
    const fixture = createGitFixture();
    const bundleRoot = temporaryBundle();
    const publication = candidate(fixture, bundleRoot);
    expectCode('station-output/commit-failed', () => publishStationGeneration(publication, {
      operations: createStationOutputOperations(overrides),
    }));
    assert.deepEqual(inspectStationPublication(bundleRoot), { state: 'idle' }, phase);
    assert.equal(fs.readdirSync(bundleRoot).some((name) => name.startsWith('.station-publication.')), false, phase);
    assert.equal(publishStationGeneration(publication).state, 'committed', phase);
  }
});

test('exclusive owner collision preserves foreign bytes and inode and reports their busy or recovery state', () => {
  const token = '9'.repeat(64);
  for (const [label, foreignProbe, expectedCode, expectedInspection] of [
    ['live', () => 'foreign:1', 'station-output/publication-busy', { state: 'busy', owner_pid: 939393 }],
    ['stale', () => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); },
      'station-output/publication-lock-stale', { state: 'stale-lock', recovery_token: token }],
  ]) {
    const fixture = createGitFixture();
    const bundleRoot = temporaryBundle();
    fs.mkdirSync(bundleRoot, { recursive: true });
    const ownerPath = path.join(bundleRoot, `.station-publication.owner-${token}`);
    const foreignBytes = ownerBytes({ token, pid: 939393, processStartIdentity: 'foreign:1' });
    fs.writeFileSync(ownerPath, foreignBytes, { mode: 0o600 });
    const foreignStat = fs.lstatSync(ownerPath);
    const operations = createStationOutputOperations({
      randomToken() { return token; },
      processStartIdentity(pid) {
        if (pid === process.pid) return 'publisher:1';
        return foreignProbe();
      },
    });

    expectCode(expectedCode, () => publishStationGeneration(candidate(fixture, bundleRoot), { operations }));
    const afterStat = fs.lstatSync(ownerPath);
    assert.equal(afterStat.dev, foreignStat.dev, label);
    assert.equal(afterStat.ino, foreignStat.ino, label);
    assert.deepEqual(fs.readFileSync(ownerPath), foreignBytes, label);
    assert.deepEqual(inspectStationPublication(bundleRoot, { operations }), expectedInspection, label);
  }
});

test('owner unlink followed by directory fsync EIO reports unknown durability without a missing recovery token', () => {
  const fixture = createGitFixture();
  const bundleRoot = temporaryBundle();
  const token = '8'.repeat(64);
  const operations = createStationOutputOperations({
    randomToken() { return token; },
    processStartIdentity() { return 'publisher:1'; },
    fsyncDirectory(target, phase) {
      if (phase === 'cleanup-publication-owner') {
        throw Object.assign(new Error('owner unlink durability unknown'), { code: 'EIO' });
      }
      const descriptor = fs.openSync(target, fs.constants.O_RDONLY);
      try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    },
  });

  const result = publishStationGeneration(candidate(fixture, bundleRoot), { operations });
  assert.equal(result.state, 'committed-durability-unknown');
  assert.equal(result.committed, true);
  assert.equal(result.recovery_required, false);
  assert.equal(result.directory_fsync, 'unknown');
  assert.equal(result.durability_claim, 'commit-observed-owner-release-durability-unknown');
  assert.equal(Object.hasOwn(result, 'recovery_token'), false);
  assert.deepEqual(inspectStationPublication(bundleRoot, { operations }), { state: 'idle' });
  expectCode('station-output/recovery-token-mismatch', () => recoverStationPublication(bundleRoot, {
    recoveryToken: token, operations,
  }));
});

test('hard-link failure before acquisition cleans owner material and remains retryable', () => {
  const fixture = createGitFixture();
  const bundleRoot = temporaryBundle();
  const publication = candidate(fixture, bundleRoot);
  expectCode('station-output/commit-failed', () => publishStationGeneration(publication, {
    operations: createStationOutputOperations({
      link() { throw Object.assign(new Error('link failed'), { code: 'EIO' }); },
    }),
  }));
  assert.deepEqual(inspectStationPublication(bundleRoot), { state: 'idle' });
  assert.equal(publishStationGeneration(publication).state, 'committed');
});

test('ambiguous hard-link and acquisition-directory fsync failures retain token recovery authority', () => {
  for (const phase of ['hard-link-acknowledgement', 'acquisition-directory-fsync']) {
    const fixture = createGitFixture();
    const bundleRoot = temporaryBundle();
    const publication = candidate(fixture, bundleRoot);
    let stale = false;
    const operations = createStationOutputOperations({
      processStartIdentity() {
        if (stale) throw Object.assign(new Error('publisher gone'), { code: 'ESRCH' });
        return 'test-process:1';
      },
      ...(phase === 'hard-link-acknowledgement' ? {
        link(source, target) {
          fs.linkSync(source, target);
          throw Object.assign(new Error('link acknowledgement lost'), { code: 'EIO' });
        },
      } : {
        fsyncDirectory(target, syncPhase) {
          if (syncPhase === 'acquire-publication-lock') {
            throw Object.assign(new Error('lock directory fsync failed'), { code: 'EIO' });
          }
          const descriptor = fs.openSync(target, fs.constants.O_RDONLY);
          try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
        },
      }),
    });
    const error = captureError('station-output/recovery-required', () => publishStationGeneration(publication, { operations }));
    const token = error.diagnostic.evidence.recovery_token;
    assert.match(token, /^[a-f0-9]{64}$/, phase);
    stale = true;
    assert.deepEqual(inspectStationPublication(bundleRoot, { operations }), {
      state: 'stale-lock', recovery_token: token,
    }, phase);
    assert.equal(recoverStationPublication(bundleRoot, { recoveryToken: token, operations }).state, 'recovered', phase);
    assert.deepEqual(inspectStationPublication(bundleRoot), { state: 'idle' }, phase);
    assert.equal(publishStationGeneration(publication).state, 'committed', phase);
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

test('stale lock rejects journal and committed metadata owned by a different token without changing bytes', () => {
  for (const kind of ['journal', 'committed']) {
    const fixture = createGitFixture();
    const bundleRoot = temporaryBundle();
    const published = publishStationGeneration(candidate(fixture, bundleRoot));
    const owner = seedLock(bundleRoot, { token: 'a'.repeat(64), pid: 616161, processStartIdentity: 'boot:300' });
    const marker = kind === 'journal' ? '.station-publication.transaction' : '.station-publication.committed';
    fs.writeFileSync(path.join(bundleRoot, marker), transactionBytes(
      kind, 'b'.repeat(64), published.generation_id, `generation-${'c'.repeat(64)}`,
    ));
    const operations = createStationOutputOperations({
      processStartIdentity() { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); },
    });
    const before = publicationControlSnapshot(bundleRoot);
    assert.deepEqual(inspectStationPublication(bundleRoot, { operations }), {
      state: 'authority-indeterminate', recovery_token: owner.token,
    }, kind);
    expectCode('station-output/authority-indeterminate', () => recoverStationPublication(bundleRoot, {
      recoveryToken: owner.token, operations,
    }));
    assert.deepEqual(publicationControlSnapshot(bundleRoot), before, kind);
  }
});

test('contradictory prepared and committed markers are indeterminate and preserved byte-for-byte', () => {
  const fixture = createGitFixture();
  const bundleRoot = temporaryBundle();
  const published = publishStationGeneration(candidate(fixture, bundleRoot));
  const owner = seedLock(bundleRoot, { token: 'd'.repeat(64), pid: 717171, processStartIdentity: 'boot:400' });
  fs.writeFileSync(path.join(bundleRoot, '.station-publication.transaction'), transactionBytes(
    'journal', owner.token, published.generation_id, `generation-${'e'.repeat(64)}`,
  ));
  fs.writeFileSync(path.join(bundleRoot, '.station-publication.committed'), transactionBytes(
    'committed', owner.token, published.generation_id, `generation-${'f'.repeat(64)}`,
  ));
  const operations = createStationOutputOperations({
    processStartIdentity() { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); },
  });
  const before = publicationControlSnapshot(bundleRoot);
  assert.deepEqual(inspectStationPublication(bundleRoot, { operations }), {
    state: 'authority-indeterminate', recovery_token: owner.token,
  });
  expectCode('station-output/authority-indeterminate', () => recoverStationPublication(bundleRoot, {
    recoveryToken: owner.token, operations,
  }));
  assert.deepEqual(publicationControlSnapshot(bundleRoot), before);
});

test('malicious partial committed marker remains indeterminate and is preserved byte-for-byte', () => {
  const fixture = createGitFixture();
  const bundleRoot = temporaryBundle();
  const published = publishStationGeneration(candidate(fixture, bundleRoot));
  const owner = seedLock(bundleRoot, { token: '3'.repeat(64), pid: 727272, processStartIdentity: 'boot:450' });
  const nextGeneration = `generation-${'4'.repeat(64)}`;
  fs.writeFileSync(path.join(bundleRoot, '.station-publication.transaction'), transactionBytes(
    'journal', owner.token, published.generation_id, nextGeneration,
  ));
  const contradictory = transactionBytes(
    'committed', owner.token, published.generation_id, `generation-${'5'.repeat(64)}`,
  ).subarray(0, 96);
  fs.writeFileSync(path.join(bundleRoot, '.station-publication.committed'), contradictory);
  const operations = createStationOutputOperations({
    processStartIdentity() { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); },
  });
  const before = publicationControlSnapshot(bundleRoot);
  assert.deepEqual(inspectStationPublication(bundleRoot, { operations }), {
    state: 'authority-indeterminate', recovery_token: owner.token,
  });
  expectCode('station-output/authority-indeterminate', () => recoverStationPublication(bundleRoot, {
    recoveryToken: owner.token, operations,
  }));
  assert.deepEqual(publicationControlSnapshot(bundleRoot), before);
});

test('matching prepared and committed markers remain explicitly recoverable', () => {
  const fixture = createGitFixture();
  const bundleRoot = temporaryBundle();
  const published = publishStationGeneration(candidate(fixture, bundleRoot));
  const owner = seedLock(bundleRoot, { token: '1'.repeat(64), pid: 818181, processStartIdentity: 'boot:500' });
  const nextGeneration = `generation-${'2'.repeat(64)}`;
  fs.writeFileSync(path.join(bundleRoot, '.station-publication.transaction'), transactionBytes(
    'journal', owner.token, published.generation_id, nextGeneration,
  ));
  fs.writeFileSync(path.join(bundleRoot, '.station-publication.committed'), transactionBytes(
    'committed', owner.token, published.generation_id, nextGeneration,
  ));
  const operations = createStationOutputOperations({
    processStartIdentity() { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); },
  });
  assert.deepEqual(inspectStationPublication(bundleRoot, { operations }), {
    state: 'stale-lock', recovery_token: owner.token,
  });
  assert.deepEqual(recoverStationPublication(bundleRoot, { recoveryToken: owner.token, operations }), {
    state: 'recovered', committed: false, generation_id: published.generation_id,
    directory_fsync: 'complete',
  });
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
