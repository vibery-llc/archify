import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { sha256Hex } from '../lib/canonical-json.mjs';
import { buildStationReceipt } from '../lib/extract.mjs';
import { createGitObjectReader } from '../lib/git-object-reader.mjs';
import { gateStationArtifacts } from '../lib/station-gate.mjs';
import { buildStationEvidence } from '../lib/node-workspace-evidence.mjs';
import {
  createStationOutputOperations,
  deriveStationGenerationId,
  publishStationGeneration,
  readStationGeneration,
} from '../lib/station-output.mjs';
import { projectStationMap } from '../lib/station-projector.mjs';
import { commitFixture, createGitFixture } from './helpers/git-fixture.mjs';

export const ATOMIC_FAILURE_MATRIX = Object.freeze([
  'generation-file-write', 'generation-file-close', 'generation-file-fsync',
  'generation-directory-rename', 'generation-directory-fsync', 'final-path-recheck',
  'temporary-pointer-write', 'temporary-pointer-fsync', 'pointer-rename', 'bundle-root-fsync',
  'pointer-restoration', 'recovery-material-handling', 'cleanup-recovery-fsync-failure',
  'publisher-publisher-interleaving', 'post-rename-fsync-newer-authority',
  'interrupt-before-pointer-rename', 'interrupt-after-pointer-rename', 'concurrent-once-resolved-reader',
  'no-prior-pointer-failure', 'malformed-path', 'aliased-path', 'symlinked-path', 'conflicting-path',
  'final-path-swap-before-rename', 'rollback-failure-retention', 'prior-generations-retained',
]);

const covered = new Set();
function cover(...names) {
  names.forEach((name) => {
    assert.ok(ATOMIC_FAILURE_MATRIX.includes(name), `undeclared atomic failure row: ${name}`);
    covered.add(name);
  });
}

function temporaryBundle() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'station-atomic-parent-')), 'bundle');
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
  fixture.revision = commitFixture(fixture.root, { 'package.json': `${JSON.stringify({ name })}\n` }, `atomic ${name}`);
  return makeCandidate(fixture, bundleRoot);
}

function exactGeneration(candidate) {
  return {
    evidenceBytes: Buffer.from(candidate.evidenceBytes),
    mapBytes: Buffer.from(candidate.mapBytes),
    receiptBytes: Buffer.from(candidate.receiptBytes),
  };
}

function snapshotAuthority(bundleRoot) {
  if (!fs.existsSync(path.join(bundleRoot, 'CURRENT'))) return null;
  const resolved = readStationGeneration(bundleRoot);
  return {
    generation_id: resolved.generation_id,
    evidenceBytes: resolved.evidenceBytes,
    mapBytes: resolved.mapBytes,
    receiptBytes: resolved.receiptBytes,
  };
}

function assertExactAuthority(expected, bundleRoot, label) {
  const actual = snapshotAuthority(bundleRoot);
  assert.ok(actual, `${label}: CURRENT disappeared`);
  assert.equal(actual.generation_id, expected.generation_id, `${label}: authority changed`);
  assert.deepEqual(actual.evidenceBytes, expected.evidenceBytes, `${label}: evidence changed`);
  assert.deepEqual(actual.mapBytes, expected.mapBytes, `${label}: map changed`);
  assert.deepEqual(actual.receiptBytes, expected.receiptBytes, `${label}: receipt changed`);
}

function expectCode(code, operation) {
  assert.throws(operation, (error) => {
    assert.equal(error?.code, code, JSON.stringify(error?.diagnostic));
    assert.equal(error?.diagnostic?.severity, 'error');
    return true;
  });
}

function seeded() {
  const fixture = createGitFixture();
  const bundleRoot = temporaryBundle();
  const oldCandidate = makeCandidate(fixture, bundleRoot);
  const old = publishStationGeneration(oldCandidate);
  return { fixture, bundleRoot, oldCandidate, old: snapshotAuthority(bundleRoot), publication: old };
}

function failBeforePointer(row) {
  const state = seeded();
  const candidate = nextCandidate(state.fixture, state.bundleRoot, row.name);
  expectCode(row.code || 'station-output/commit-failed', () => publishStationGeneration(candidate, row.options(state, candidate)));
  row.afterFailure?.(state);
  assertExactAuthority(state.old, state.bundleRoot, row.name);
  cover(row.name);
}

function waitForFile(target, timeout = 5000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const inspect = () => {
      if (fs.existsSync(target)) return resolve();
      if (Date.now() - started > timeout) return reject(new Error(`timed out waiting for ${path.basename(target)}`));
      setTimeout(inspect, 10);
    };
    inspect();
  });
}

function childProgram(event) {
  const modules = Object.fromEntries(Object.entries({
    output: '../lib/station-output.mjs',
    reader: '../lib/git-object-reader.mjs',
    evidence: '../lib/node-workspace-evidence.mjs',
    projector: '../lib/station-projector.mjs',
    gate: '../lib/station-gate.mjs',
    extract: '../lib/extract.mjs',
  }).map(([name, relative]) => [name, pathToFileURL(path.resolve(path.dirname(new URL(import.meta.url).pathname), relative)).href]));
  return `
    import fs from 'node:fs';
    import { publishStationGeneration } from ${JSON.stringify(modules.output)};
    import { createGitObjectReader } from ${JSON.stringify(modules.reader)};
    import { buildStationEvidence } from ${JSON.stringify(modules.evidence)};
    import { projectStationMap } from ${JSON.stringify(modules.projector)};
    import { gateStationArtifacts } from ${JSON.stringify(modules.gate)};
    import { buildStationReceipt } from ${JSON.stringify(modules.extract)};
    const [repoRoot, repositoryUrl, revision, bundleRoot, ready, release] = process.argv.slice(1);
    const readerSession = createGitObjectReader({ repoRoot, repositoryUrl, revision });
    const evidence = buildStationEvidence(readerSession);
    const map = projectStationMap(evidence.value, evidence.bytes);
    const gate = gateStationArtifacts(evidence.bytes, map.bytes, readerSession);
    const receipt = buildStationReceipt(gate);
    publishStationGeneration({
      bundleRoot,
      evidenceBytes: gate.evidence_bytes,
      mapBytes: gate.map_bytes,
      receiptBytes: receipt.bytes,
      readerSession,
      protectedPaths: [repoRoot],
    }, {
      barrier(name) {
        if (name !== ${JSON.stringify(event)}) return;
        if (ready === 'KILL') process.kill(process.pid, 'SIGKILL');
        fs.writeFileSync(ready, name);
        while (!fs.existsSync(release)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      },
    });
  `;
}

test('file write, close, fsync, generation rename/fsync, and final recheck failures preserve all prior bytes', () => {
  let writeCalls = 0;
  failBeforePointer({
    name: 'generation-file-write',
    options() {
      return { operations: createStationOutputOperations({
        write(descriptor, bytes, offset) {
          writeCalls += 1;
          if (writeCalls === 1) throw new Error('synthetic generation write failure');
          return fs.writeSync(descriptor, bytes, offset, bytes.length - offset);
        },
      }) };
    },
  });

  let closeCalls = 0;
  failBeforePointer({
    name: 'generation-file-close',
    options() {
      return { operations: createStationOutputOperations({
        close(descriptor) {
          fs.closeSync(descriptor);
          closeCalls += 1;
          if (closeCalls === 1) throw new Error('synthetic generation close failure');
        },
      }) };
    },
  });

  failBeforePointer({
    name: 'generation-file-fsync',
    options() {
      return { operations: createStationOutputOperations({
        fsyncFile() { throw new Error('synthetic generation fsync failure'); },
      }) };
    },
  });

  failBeforePointer({
    name: 'generation-directory-rename',
    options() {
      return { operations: createStationOutputOperations({
        rename(source, target, phase) {
          if (phase === 'publish-generation') throw new Error('synthetic generation rename failure');
          fs.renameSync(source, target);
        },
      }) };
    },
  });

  failBeforePointer({
    name: 'generation-directory-fsync',
    options() {
      return { operations: createStationOutputOperations({
        fsyncDirectory(target, phase) {
          if (phase === 'publish-generation') throw new Error('synthetic generations fsync failure');
          const descriptor = fs.openSync(target, fs.constants.O_RDONLY);
          try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
        },
      }) };
    },
  });

  failBeforePointer({
    name: 'final-path-recheck',
    code: 'station-output/path-invalid',
    options(state) {
      return { barrier(name) {
        if (name !== 'before-current-rename') return;
        const current = path.join(state.bundleRoot, 'CURRENT');
        const saved = path.join(state.bundleRoot, 'saved-current');
        fs.renameSync(current, saved);
        fs.symlinkSync(saved, current);
      } };
    },
    afterFailure(state) {
      const current = path.join(state.bundleRoot, 'CURRENT');
      const saved = path.join(state.bundleRoot, 'saved-current');
      fs.unlinkSync(current);
      fs.renameSync(saved, current);
    },
  });
});

test('temporary pointer write/fsync, pointer rename, and post-rename bundle fsync boundaries are fail-closed', () => {
  failBeforePointer({
    name: 'temporary-pointer-write',
    options() {
      return { operations: createStationOutputOperations({
        openExclusive(target) {
          if (path.basename(target).startsWith('.CURRENT.candidate-')) throw new Error('synthetic pointer write failure');
          return fs.openSync(target, 'wx', 0o600);
        },
      }) };
    },
  });

  failBeforePointer({
    name: 'temporary-pointer-fsync',
    options() {
      return { operations: createStationOutputOperations({
        fsyncFile(descriptor, target) {
          if (path.basename(target || '').startsWith('.CURRENT.candidate-')) throw new Error('synthetic pointer fsync failure');
          fs.fsyncSync(descriptor);
        },
      }) };
    },
  });

  failBeforePointer({
    name: 'pointer-rename',
    options() {
      return { operations: createStationOutputOperations({
        rename(source, target, phase) {
          if (phase === 'commit-current') throw new Error('synthetic pointer rename failure');
          fs.renameSync(source, target);
        },
      }) };
    },
  });

  const state = seeded();
  const candidate = nextCandidate(state.fixture, state.bundleRoot, 'bundle-root-fsync');
  const operations = createStationOutputOperations({
    fsyncDirectory(target, phase) {
      if (target === state.bundleRoot && phase === 'commit-current') throw new Error('synthetic bundle fsync failure');
      const descriptor = fs.openSync(target, fs.constants.O_RDONLY);
      try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    },
  });
  expectCode('station-output/commit-failed', () => publishStationGeneration(candidate, { operations }));
  assertExactAuthority(state.old, state.bundleRoot, 'bundle-root-fsync');
  cover('bundle-root-fsync');
});

test('two publishers interleave without an older candidate replacing newer authority', () => {
  const state = seeded();
  const candidateA = nextCandidate(state.fixture, state.bundleRoot, 'publisher-a');
  const candidateB = nextCandidate(state.fixture, state.bundleRoot, 'publisher-b');
  let publicationB;
  expectCode('station-output/path-invalid', () => publishStationGeneration(candidateA, {
    barrier(name) {
      if (name === 'before-current-rename') publicationB = publishStationGeneration(candidateB);
    },
  }));
  assert.ok(publicationB);
  const current = snapshotAuthority(state.bundleRoot);
  assert.equal(current.generation_id, publicationB.generation_id);
  assert.deepEqual(current, { generation_id: publicationB.generation_id, ...exactGeneration(candidateB) });
  cover('publisher-publisher-interleaving');
});

test('post-rename fsync failure preserves a newer publisher instead of restoring stale authority', () => {
  const state = seeded();
  const candidateA = nextCandidate(state.fixture, state.bundleRoot, 'failed-publisher');
  const candidateB = nextCandidate(state.fixture, state.bundleRoot, 'newer-publisher');
  let publicationB;
  const operations = createStationOutputOperations({
    fsyncDirectory(target, phase) {
      if (target === state.bundleRoot && phase === 'commit-current') {
        publicationB = publishStationGeneration(candidateB);
        throw new Error('synthetic failed-publisher fsync');
      }
      const descriptor = fs.openSync(target, fs.constants.O_RDONLY);
      try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    },
  });
  expectCode('station-output/commit-failed', () => publishStationGeneration(candidateA, { operations }));
  assert.ok(publicationB);
  const current = snapshotAuthority(state.bundleRoot);
  assert.equal(current.generation_id, publicationB.generation_id);
  assert.deepEqual(current, { generation_id: publicationB.generation_id, ...exactGeneration(candidateB) });
  cover('post-rename-fsync-newer-authority');
});

test('cleanup-recovery fsync failure reports only recovery material that still exists', () => {
  const state = seeded();
  const candidate = nextCandidate(state.fixture, state.bundleRoot, 'cleanup-recovery-fsync');
  const operations = createStationOutputOperations({
    fsyncDirectory(target, phase) {
      if (target === state.bundleRoot && phase === 'cleanup-recovery') {
        throw new Error('synthetic cleanup recovery fsync failure');
      }
      const descriptor = fs.openSync(target, fs.constants.O_RDONLY);
      try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    },
  });
  let diagnostic;
  assert.throws(() => publishStationGeneration(candidate, { operations }), (error) => {
    diagnostic = error.diagnostic;
    assert.equal(error.code, 'station-output/commit-rollback-failed');
    return true;
  });
  const declared = [diagnostic.evidence.recovery_file, diagnostic.evidence.failure_marker]
    .filter(Boolean)
    .map((name) => path.join(state.bundleRoot, name));
  assert.ok(declared.length > 0);
  assert.ok(declared.every((target) => fs.existsSync(target)), JSON.stringify(diagnostic));
  cover('cleanup-recovery-fsync-failure');
});

test('a final path swap after the first recheck is detected before CURRENT rename', () => {
  const state = seeded();
  const candidate = nextCandidate(state.fixture, state.bundleRoot, 'final-path-swap');
  let injected = false;
  expectCode('station-output/path-invalid', () => publishStationGeneration(candidate, {
    barrier(name) {
      if (name !== 'after-current-recheck') return;
      injected = true;
      const current = path.join(state.bundleRoot, 'CURRENT');
      const saved = path.join(state.bundleRoot, 'saved-current-final');
      fs.renameSync(current, saved);
      fs.symlinkSync(saved, current);
    },
  }));
  assert.equal(injected, true);
  const current = path.join(state.bundleRoot, 'CURRENT');
  const saved = path.join(state.bundleRoot, 'saved-current-final');
  fs.unlinkSync(current);
  fs.renameSync(saved, current);
  assertExactAuthority(state.old, state.bundleRoot, 'final-path-swap-before-rename');
  cover('final-path-swap-before-rename');
});

test('no-prior-pointer failure leaves no partial generation authoritative', () => {
  const fixture = createGitFixture();
  const bundleRoot = temporaryBundle();
  const candidate = makeCandidate(fixture, bundleRoot);
  expectCode('station-output/commit-failed', () => publishStationGeneration(candidate, {
    barrier(name) {
      if (name === 'before-current-rename') throw new Error('synthetic first-publication failure');
    },
  }));
  assert.equal(fs.existsSync(path.join(bundleRoot, 'CURRENT')), false);
  for (const generation of fs.readdirSync(path.join(bundleRoot, 'generations'))) {
    const files = fs.readdirSync(path.join(bundleRoot, 'generations', generation)).sort();
    assert.deepEqual(files, ['station-evidence.json', 'station-map.json', 'station-receipt.json']);
  }
  cover('no-prior-pointer-failure');
});

test('malformed, aliased, symlinked, and conflicting publication paths fail closed', () => {
  {
    const state = seeded();
    fs.writeFileSync(path.join(state.bundleRoot, 'CURRENT'), 'malformed\n');
    expectCode('station-output/pointer-invalid', () => publishStationGeneration(nextCandidate(state.fixture, state.bundleRoot, 'malformed')));
    cover('malformed-path');
  }
  {
    const fixture = createGitFixture();
    expectCode('station-output/path-invalid', () => publishStationGeneration(makeCandidate(fixture, fixture.root)));
    cover('aliased-path');
  }
  {
    const fixture = createGitFixture();
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'station-atomic-link-'));
    const physical = path.join(parent, 'physical');
    const alias = path.join(parent, 'alias');
    fs.mkdirSync(physical);
    fs.symlinkSync(physical, alias);
    expectCode('station-output/path-invalid', () => publishStationGeneration(makeCandidate(fixture, alias)));
    cover('symlinked-path');
  }
  {
    const state = seeded();
    const target = path.join(state.bundleRoot, 'generations', state.publication.generation_id, 'station-map.json');
    fs.writeFileSync(target, 'conflicting immutable bytes\n');
    expectCode('station-output/generation-conflict', () => publishStationGeneration(state.oldCandidate));
    cover('conflicting-path');
  }
});

test('unresolved recovery material blocks publication without deleting authority or generations', () => {
  const state = seeded();
  const candidate = nextCandidate(state.fixture, state.bundleRoot, 'recovery-blocked');
  const generationId = deriveStationGenerationId({
    evidence: sha256Hex(candidate.evidenceBytes),
    map: sha256Hex(candidate.mapBytes),
    receipt: sha256Hex(candidate.receiptBytes),
  });
  fs.writeFileSync(path.join(state.bundleRoot, `CURRENT.recovery-${generationId}`), state.old.generation_id + '\n');
  expectCode('station-output/recovery-required', () => publishStationGeneration(candidate));
  assertExactAuthority(state.old, state.bundleRoot, 'recovery-material-handling');
  assert.ok(fs.existsSync(path.join(state.bundleRoot, `CURRENT.recovery-${generationId}`)));
  cover('recovery-material-handling');
});

test('post-pointer restoration failure returns only rollback-failed and retains deterministic recovery state', () => {
  const state = seeded();
  const candidate = nextCandidate(state.fixture, state.bundleRoot, 'rollback-failure');
  const operations = createStationOutputOperations({
    fsyncDirectory(target, phase) {
      if (target === state.bundleRoot && phase === 'commit-current') throw new Error('synthetic post-pointer fsync failure');
      const descriptor = fs.openSync(target, fs.constants.O_RDONLY);
      try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    },
    rename(source, target, phase) {
      if (phase === 'restore-current') throw new Error('synthetic pointer restoration failure');
      fs.renameSync(source, target);
    },
  });
  let diagnostic;
  assert.throws(() => publishStationGeneration(candidate, { operations }), (error) => {
    diagnostic = error.diagnostic;
    assert.equal(error.code, 'station-output/commit-rollback-failed');
    assert.notEqual(error.code, 'station-output/commit-failed');
    return true;
  });
  assert.equal(diagnostic.code, 'station-output/commit-rollback-failed');
  assert.equal(diagnostic.evidence.previous_generation_id, state.old.generation_id);
  assert.match(diagnostic.evidence.candidate_generation_id, /^generation-[a-f0-9]{64}$/);
  assert.equal(diagnostic.evidence.recovery_file, `CURRENT.recovery-${diagnostic.evidence.candidate_generation_id}`);
  assert.equal(diagnostic.evidence.failure_marker, `CURRENT.rollback-failed-${diagnostic.evidence.candidate_generation_id}`);
  assert.ok(fs.existsSync(path.join(state.bundleRoot, diagnostic.evidence.recovery_file)));
  assert.ok(fs.existsSync(path.join(state.bundleRoot, diagnostic.evidence.failure_marker)));
  assert.ok(fs.existsSync(path.join(state.bundleRoot, 'generations', state.old.generation_id)));
  assert.ok(fs.existsSync(path.join(state.bundleRoot, 'generations', diagnostic.evidence.candidate_generation_id)));
  expectCode('station-output/recovery-required', () => readStationGeneration(state.bundleRoot));
  cover('pointer-restoration', 'rollback-failure-retention');
});

test('child termination immediately before and after CURRENT rename selects only complete old or new bytes', () => {
  assert.notEqual(process.platform, 'win32', 'Phase 1 requires executable SIGKILL boundary evidence on this host');
  for (const [event, expectation, row] of [
    ['before-current-rename', 'old', 'interrupt-before-pointer-rename'],
    ['after-current-rename', 'new', 'interrupt-after-pointer-rename'],
  ]) {
    const state = seeded();
    const newer = nextCandidate(state.fixture, state.bundleRoot, row);
    const child = spawnSync(process.execPath, [
      '--input-type=module', '-e', childProgram(event),
      state.fixture.root, state.fixture.repositoryUrl, state.fixture.revision, state.bundleRoot, 'KILL', 'unused',
    ], { encoding: 'utf8', shell: false });
    assert.equal(child.signal, 'SIGKILL', `${event}: ${child.stderr}`);
    const current = snapshotAuthority(state.bundleRoot);
    if (expectation === 'old') {
      assertExactAuthority(state.old, state.bundleRoot, row);
    } else {
      assert.deepEqual(current.evidenceBytes, newer.evidenceBytes);
      assert.deepEqual(current.mapBytes, newer.mapBytes);
      assert.deepEqual(current.receiptBytes, newer.receiptBytes);
    }
    cover(row);
  }
});

test('a concurrent reader resolves CURRENT once and retains one complete immutable generation', async () => {
  const state = seeded();
  const newer = nextCandidate(state.fixture, state.bundleRoot, 'concurrent');
  const control = fs.mkdtempSync(path.join(os.tmpdir(), 'station-atomic-barrier-'));
  const ready = path.join(control, 'ready');
  const release = path.join(control, 'release');
  const child = spawn(process.execPath, [
    '--input-type=module', '-e', childProgram('before-current-rename'),
    state.fixture.root, state.fixture.repositoryUrl, state.fixture.revision, state.bundleRoot, ready, release,
  ], { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  await waitForFile(ready);

  let currentReads = 0;
  const onceResolved = readStationGeneration(state.bundleRoot, { operations: {
    readFile(target) {
      if (target === path.join(state.bundleRoot, 'CURRENT')) currentReads += 1;
      return fs.readFileSync(target);
    },
  } });
  assert.equal(currentReads, 1);
  assert.equal(onceResolved.generation_id, state.old.generation_id);
  fs.writeFileSync(release, 'continue');
  const exit = await new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  assert.deepEqual(exit, { code: 0, signal: null }, stderr);
  const current = snapshotAuthority(state.bundleRoot);
  assert.deepEqual(current.evidenceBytes, newer.evidenceBytes);
  assert.deepEqual(current.mapBytes, newer.mapBytes);
  assert.deepEqual(current.receiptBytes, newer.receiptBytes);
  assert.deepEqual(onceResolved.evidenceBytes, state.old.evidenceBytes);
  assert.deepEqual(onceResolved.mapBytes, state.old.mapBytes);
  assert.deepEqual(onceResolved.receiptBytes, state.old.receiptBytes);
  cover('concurrent-once-resolved-reader');
});

test('successful publications retain every prior immutable generation', () => {
  const state = seeded();
  const ids = [state.old.generation_id];
  for (const name of ['retained-two', 'retained-three']) {
    const candidate = nextCandidate(state.fixture, state.bundleRoot, name);
    ids.push(publishStationGeneration(candidate).generation_id);
  }
  assert.deepEqual(fs.readdirSync(path.join(state.bundleRoot, 'generations')).sort(), [...ids].sort());
  for (const id of ids) {
    assert.deepEqual(fs.readdirSync(path.join(state.bundleRoot, 'generations', id)).sort(), [
      'station-evidence.json', 'station-map.json', 'station-receipt.json',
    ]);
  }
  cover('prior-generations-retained');
});

test('atomic failure matrix has no declared or executed omissions', () => {
  assert.equal(new Set(ATOMIC_FAILURE_MATRIX).size, ATOMIC_FAILURE_MATRIX.length);
  assert.deepEqual([...covered].sort(), [...ATOMIC_FAILURE_MATRIX].sort());
});
