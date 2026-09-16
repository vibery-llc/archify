import fs from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { canonicalFuturePath, pathsAlias } from '../../../archify/renderers/shared/output-path.mjs';
import { canonicalJsonBytes, sha256Hex } from './canonical-json.mjs';
import {
  STATION_CONTRACT_VERSION,
  STATION_SCHEMAS,
  validateStationEvidence,
  validateStationExtractionReceipt,
  validateStationMap,
} from './contracts.mjs';
import { createStationDiagnostic, StationDiagnosticError } from './diagnostics.mjs';
import { gateStationArtifacts } from './station-gate.mjs';

const UTF8 = new TextDecoder('utf-8', { fatal: true });
const GENERATION_RE = /^generation-[a-f0-9]{64}$/;
const ARTIFACT_FILES = Object.freeze([
  ['evidenceBytes', 'station-evidence.json'],
  ['mapBytes', 'station-map.json'],
  ['receiptBytes', 'station-receipt.json'],
]);
const DIRECTORY_FSYNC_UNSUPPORTED = new Set(['EINVAL', 'ENOTSUP', 'ENOSYS']);
const WINDOWS_DIRECTORY_FSYNC_UNSUPPORTED = new Set(['EISDIR', 'EPERM']);
const RECOVERY_FILE_RE = /^CURRENT\.recovery-(generation-[a-f0-9]{64})$/;
const ROLLBACK_FAILURE_RE = /^CURRENT\.rollback-failed-(generation-[a-f0-9]{64})$/;
let temporarySequence = 0;

function fsyncUnsupported(error) {
  return DIRECTORY_FSYNC_UNSUPPORTED.has(error?.code)
    || (process.platform === 'win32' && WINDOWS_DIRECTORY_FSYNC_UNSUPPORTED.has(error?.code));
}

function fail(code, message, evidence = {}, supportedFixes = []) {
  throw new StationDiagnosticError(createStationDiagnostic({
    code,
    severity: 'error',
    message,
    subject: { surface: 'station-output' },
    evidence,
    supportedFixes,
  }));
}

function exists(operations, target) {
  try {
    operations.lstat(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

const BASE_OPERATIONS = Object.freeze({
  lstat: (target) => fs.lstatSync(target),
  stat: (target) => fs.statSync(target),
  readFile: (target) => fs.readFileSync(target),
  readdir: (target) => fs.readdirSync(target),
  mkdir: (target, options) => fs.mkdirSync(target, options),
  openExclusive: (target) => fs.openSync(target, 'wx', 0o600),
  write: (descriptor, bytes, offset) => fs.writeSync(descriptor, bytes, offset, bytes.length - offset),
  fsyncFile: (descriptor) => fs.fsyncSync(descriptor),
  close: (descriptor) => fs.closeSync(descriptor),
  rename: (source, target) => fs.renameSync(source, target),
  unlink: (target) => fs.unlinkSync(target),
  removeTree: (target) => fs.rmSync(target, { recursive: true, force: true }),
  fsyncDirectory(target) {
    const descriptor = fs.openSync(target, fs.constants.O_RDONLY);
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    return 'complete';
  },
});

export function createStationOutputOperations(overrides = {}) {
  return Object.freeze({ ...BASE_OPERATIONS, ...overrides });
}

function strictJson(bytes, schema, validate, code = 'station-output/candidate-invalid') {
  if (!Buffer.isBuffer(bytes)) fail(code, 'Station artifacts must be exact Buffers.', { artifact: schema });
  let value;
  try {
    value = JSON.parse(UTF8.decode(bytes));
    validate(value);
  } catch {
    fail(code, 'Station artifact failed strict validation.', { artifact: schema });
  }
  if (!bytes.equals(canonicalJsonBytes(value))) {
    fail(code, 'Station artifact is not canonical exact JSON.', { artifact: schema });
  }
  return value;
}

function candidateFacts(candidate) {
  if (!candidate || !Buffer.isBuffer(candidate.evidenceBytes)
      || !Buffer.isBuffer(candidate.mapBytes) || !Buffer.isBuffer(candidate.receiptBytes)) {
    fail('station-output/candidate-invalid', 'Publication requires three exact candidate Buffers.');
  }
  let gated;
  try {
    gated = gateStationArtifacts(candidate.evidenceBytes, candidate.mapBytes, candidate.readerSession);
  } catch {
    fail('station-output/candidate-invalid', 'Evidence and map failed the independent publication gate.');
  }
  const evidence = strictJson(candidate.evidenceBytes, STATION_SCHEMAS.evidence, validateStationEvidence);
  const map = strictJson(candidate.mapBytes, STATION_SCHEMAS.map, validateStationMap);
  const receipt = strictJson(candidate.receiptBytes, STATION_SCHEMAS.receipt, validateStationExtractionReceipt);
  const expectedReceiptFacts = {
    repository: gated.repository,
    artifacts: {
      evidence: { file: 'station-evidence.json', sha256: gated.evidence_sha256, bytes: candidate.evidenceBytes.length },
      map: { file: 'station-map.json', sha256: gated.map_sha256, bytes: candidate.mapBytes.length },
    },
    result: {
      project_id: gated.project_id,
      snapshot_id: gated.snapshot_id,
      mode: gated.mode,
      rooms: gated.room_count,
      relations: gated.relation_count,
      fallback: gated.fallback,
      fallback_reason_codes: [...gated.fallback_reason_codes],
    },
  };
  for (const key of ['repository', 'artifacts', 'result']) {
    if (!canonicalJsonBytes(receipt[key]).equals(canonicalJsonBytes(expectedReceiptFacts[key]))) {
      fail('station-output/candidate-invalid', 'Receipt does not bind the exact gated extraction result.', { field: key });
    }
  }
  if (map.snapshot.evidence_sha256 !== sha256Hex(candidate.evidenceBytes)
      || receipt.artifacts.map.sha256 !== sha256Hex(candidate.mapBytes)) {
    fail('station-output/candidate-invalid', 'Candidate hash binding is inconsistent.');
  }
  return Object.freeze({
    evidence,
    map,
    receipt,
    hashes: Object.freeze({
      evidence: sha256Hex(candidate.evidenceBytes),
      map: sha256Hex(candidate.mapBytes),
      receipt: sha256Hex(candidate.receiptBytes),
    }),
  });
}

export function deriveStationGenerationId(hashes) {
  const material = Buffer.from([
    'station-generation/v1',
    String(STATION_CONTRACT_VERSION),
    hashes.evidence,
    hashes.map,
    hashes.receipt,
  ].join('\0'), 'utf8');
  return `generation-${sha256Hex(material)}`;
}

function canonicalAuthored(target, label) {
  const authored = path.resolve(target);
  let canonical;
  try {
    canonical = canonicalFuturePath(authored);
  } catch {
    fail('station-output/path-invalid', `Could not canonicalize ${label}.`, { path: label });
  }
  if (canonical !== authored) {
    fail('station-output/path-invalid', `${label} contains a symbolic-link or filesystem alias component.`, { path: label });
  }
  return authored;
}

function regularFile(operations, target, label) {
  let stat;
  try {
    stat = operations.lstat(target);
  } catch {
    fail('station-output/path-invalid', `${label} is missing or unreadable.`, { path: label });
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail('station-output/path-invalid', `${label} must be one regular non-symbolic file.`, { path: label });
  }
  return stat;
}

function directory(operations, target, label) {
  let stat;
  try {
    stat = operations.lstat(target);
  } catch {
    fail('station-output/path-invalid', `${label} is missing or unreadable.`, { path: label });
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail('station-output/path-invalid', `${label} must be one physical directory.`, { path: label });
  }
  return stat;
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function parsePointer(bytes) {
  let text;
  try {
    text = UTF8.decode(bytes);
  } catch {
    fail('station-output/pointer-invalid', 'CURRENT is not valid UTF-8.');
  }
  if (!text.endsWith('\n') || !GENERATION_RE.test(text.slice(0, -1))) {
    fail('station-output/pointer-invalid', 'CURRENT must contain exactly one generation ID and LF.');
  }
  return text.slice(0, -1);
}

function verifyGenerationFiles(operations, generationPath, expected) {
  directory(operations, generationPath, 'generation');
  const observed = operations.readdir(generationPath).sort();
  const names = ARTIFACT_FILES.map(([, name]) => name).sort();
  if (observed.length !== names.length || observed.some((name, index) => name !== names[index])) {
    fail(expected ? 'station-output/generation-conflict' : 'station-output/pointer-invalid', 'Immutable generation has a conflicting file inventory.');
  }
  const contents = {};
  for (const [field, name] of ARTIFACT_FILES) {
    const target = path.join(generationPath, name);
    regularFile(operations, target, name);
    contents[field] = Buffer.from(operations.readFile(target));
    if (expected && !contents[field].equals(expected[field])) {
      fail('station-output/generation-conflict', 'Existing immutable generation bytes conflict with the deterministic candidate.', { artifact: name });
    }
  }
  return contents;
}

function validateResolvedContents(contents) {
  const code = 'station-output/pointer-invalid';
  const evidence = strictJson(contents.evidenceBytes, STATION_SCHEMAS.evidence, validateStationEvidence, code);
  const map = strictJson(contents.mapBytes, STATION_SCHEMAS.map, validateStationMap, code);
  const receipt = strictJson(contents.receiptBytes, STATION_SCHEMAS.receipt, validateStationExtractionReceipt, code);
  if (receipt.artifacts.evidence.sha256 !== sha256Hex(contents.evidenceBytes)
      || receipt.artifacts.evidence.bytes !== contents.evidenceBytes.length
      || receipt.artifacts.map.sha256 !== sha256Hex(contents.mapBytes)
      || receipt.artifacts.map.bytes !== contents.mapBytes.length
      || map.snapshot.evidence_sha256 !== receipt.artifacts.evidence.sha256
      || evidence.repository.revision !== receipt.repository.revision
      || map.snapshot.id !== receipt.result.snapshot_id) {
    fail('station-output/pointer-invalid', 'CURRENT generation receipt binding is inconsistent.');
  }
  return receipt;
}

function readPreviousPointer(operations, bundleRoot, generationsPath, currentPath) {
  if (!exists(operations, currentPath)) return null;
  const stat = regularFile(operations, currentPath, 'CURRENT');
  const bytes = Buffer.from(operations.readFile(currentPath));
  const generationId = parsePointer(bytes);
  const generationPath = canonicalAuthored(path.join(generationsPath, generationId), 'current generation');
  const contents = verifyGenerationFiles(operations, generationPath);
  validateResolvedContents(contents);
  return Object.freeze({ stat, bytes, generationId });
}

function writeExclusive(operations, target, bytes) {
  let descriptor;
  try {
    descriptor = operations.openExclusive(target);
    let offset = 0;
    while (offset < bytes.length) {
      const written = operations.write(descriptor, bytes, offset);
      if (!Number.isSafeInteger(written) || written <= 0) throw new Error('short write');
      offset += written;
    }
    try {
      operations.fsyncFile(descriptor, target);
    } catch (error) {
      if (!fsyncUnsupported(error)) throw error;
    }
  } finally {
    if (descriptor !== undefined) operations.close(descriptor);
  }
}

function syncDirectory(operations, target, phase, durability) {
  try {
    operations.fsyncDirectory(target, phase);
  } catch (error) {
    if (!fsyncUnsupported(error)) throw error;
    durability.unsupported = true;
  }
}

function safeUnlink(operations, target, phase) {
  try {
    operations.unlink(target, phase);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function safeRemoveTree(operations, target) {
  try {
    operations.removeTree(target);
  } catch {
    // Non-authoritative staging is best-effort cleanup after authority is known.
  }
}

function recoveryState(operations, bundleRoot) {
  const names = operations.readdir(bundleRoot);
  const failureMarkers = names.filter((name) => ROLLBACK_FAILURE_RE.test(name)).sort();
  const recoveryFiles = names.filter((name) => RECOVERY_FILE_RE.test(name)).sort();
  return { failureMarkers, recoveryFiles };
}

function assertNoUnresolvedRecovery(operations, bundleRoot, { readers = false } = {}) {
  const state = recoveryState(operations, bundleRoot);
  if (state.failureMarkers.length || (!readers && state.recoveryFiles.length)) {
    fail('station-output/recovery-required', 'Bundle contains retained pointer-recovery material requiring deterministic manual inspection.', {
      failure_markers: state.failureMarkers,
      ...(!readers ? { recovery_files: state.recoveryFiles } : {}),
    }, ['follow the retained recovery marker, verify CURRENT once, and preserve every immutable generation']);
  }
}

function assertProtectedPaths(bundleRoot, targets, protectedPaths = []) {
  for (const protectedPath of protectedPaths) {
    for (const [label, target] of [['bundle root', bundleRoot], ...targets]) {
      let alias = false;
      try {
        alias = pathsAlias(target, protectedPath);
      } catch {
        fail('station-output/path-invalid', 'Output alias preflight could not be completed.', { path: label });
      }
      if (alias) fail('station-output/path-invalid', `${label} aliases a protected input.`, { path: label });
    }
  }
}

function restorePreviousPointer({
  operations, bundleRoot, currentPath, previous, generationId, recoveryPath, durability,
}) {
  const restorePath = path.join(bundleRoot, `.CURRENT.restore-${generationId}`);
  try {
    if (previous) {
      safeUnlink(operations, restorePath, 'prepare-restore');
      writeExclusive(operations, restorePath, previous.bytes);
      operations.rename(restorePath, currentPath, 'restore-current');
    } else {
      operations.unlink(currentPath, 'restore-current');
    }
    syncDirectory(operations, bundleRoot, 'restore-current', durability);
    safeUnlink(operations, recoveryPath, 'cleanup-recovery');
    syncDirectory(operations, bundleRoot, 'cleanup-recovery', durability);
  } catch {
    const failureMarker = path.join(bundleRoot, `CURRENT.rollback-failed-${generationId}`);
    try {
      if (!exists(operations, failureMarker)) {
        writeExclusive(operations, failureMarker, canonicalJsonBytes({
          code: 'station-output/commit-rollback-failed',
          candidate_generation_id: generationId,
          previous_generation_id: previous?.generationId ?? null,
          recovery_file: path.basename(recoveryPath),
        }));
        syncDirectory(operations, bundleRoot, 'retain-rollback-failure', durability);
      }
    } catch {
      // The original recovery file and immutable generations remain the primary material.
    }
    fail('station-output/commit-rollback-failed', 'CURRENT commit failed and prior authority could not be durably restored.', {
      previous_generation_id: previous?.generationId ?? null,
      candidate_generation_id: generationId,
      recovery_file: path.basename(recoveryPath),
      failure_marker: path.basename(failureMarker),
      manual_recovery: previous
        ? `atomically replace CURRENT with ${previous.generationId} plus LF`
        : 'atomically remove CURRENT',
    }, ['use the retained recovery file to restore CURRENT; do not delete either immutable generation']);
  }
  fail('station-output/commit-failed', 'CURRENT commit durability failed; prior authority was restored.', {
    previous_generation_id: previous?.generationId ?? null,
    candidate_generation_id: generationId,
  });
}

export function publishStationGeneration(candidate, { operations: suppliedOperations, barrier = () => {} } = {}) {
  const operations = suppliedOperations
    ? createStationOutputOperations(suppliedOperations)
    : createStationOutputOperations();
  const facts = candidateFacts(candidate);
  const generationId = deriveStationGenerationId(facts.hashes);
  const bundleRoot = canonicalAuthored(candidate.bundleRoot, 'bundle root');
  const generationsPath = canonicalAuthored(path.join(bundleRoot, 'generations'), 'generations');
  const generationPath = canonicalAuthored(path.join(generationsPath, generationId), 'candidate generation');
  const currentPath = canonicalAuthored(path.join(bundleRoot, 'CURRENT'), 'CURRENT');
  const protectedTargets = [
    ['generations', generationsPath],
    ['candidate generation', generationPath],
    ['CURRENT', currentPath],
  ];
  assertProtectedPaths(bundleRoot, protectedTargets, candidate.protectedPaths);

  try {
    operations.mkdir(bundleRoot, { recursive: true, mode: 0o700 });
    operations.mkdir(generationsPath, { recursive: true, mode: 0o700 });
  } catch {
    fail('station-output/path-invalid', 'Bundle directories could not be created as physical directories.');
  }
  const bundleIdentity = directory(operations, bundleRoot, 'bundle root');
  const generationsIdentity = directory(operations, generationsPath, 'generations');
  assertNoUnresolvedRecovery(operations, bundleRoot);
  if (exists(operations, generationPath)) verifyGenerationFiles(operations, generationPath, candidate);
  const previous = readPreviousPointer(operations, bundleRoot, generationsPath, currentPath);
  temporarySequence += 1;
  const suffix = `${process.pid}-${temporarySequence}`;
  const stagingPath = path.join(generationsPath, `.station-stage-${generationId}-${suffix}`);
  const pointerPath = path.join(bundleRoot, `.CURRENT.candidate-${generationId}-${suffix}`);
  const recoveryPath = path.join(bundleRoot, `CURRENT.recovery-${generationId}`);
  assertProtectedPaths(bundleRoot, [
    ...protectedTargets,
    ['staging generation', stagingPath],
    ['pointer candidate', pointerPath],
    ['pointer recovery', recoveryPath],
  ], candidate.protectedPaths);
  const durability = { unsupported: false };
  let stagingCreated = false;
  let stagingIdentity;
  let pointerCommitted = false;
  let recoveryCreated = false;
  let reused = false;

  try {
    if (exists(operations, generationPath)) {
      verifyGenerationFiles(operations, generationPath, candidate);
      reused = true;
    } else {
      operations.mkdir(stagingPath, { recursive: false, mode: 0o700 });
      stagingCreated = true;
      stagingIdentity = directory(operations, stagingPath, 'staging generation');
      for (const [field, name] of ARTIFACT_FILES) {
        writeExclusive(operations, path.join(stagingPath, name), candidate[field]);
      }
      barrier('after-staging-files', { generation_id: generationId });
      const stagedContents = verifyGenerationFiles(operations, stagingPath, candidate);
      candidateFacts({ ...candidate, ...stagedContents });
      syncDirectory(operations, stagingPath, 'staging-generation', durability);
      barrier('before-generation-rename', { generation_id: generationId });
      if (!sameIdentity(directory(operations, bundleRoot, 'bundle root'), bundleIdentity)
          || !sameIdentity(directory(operations, generationsPath, 'generations'), generationsIdentity)
          || !sameIdentity(directory(operations, stagingPath, 'staging generation'), stagingIdentity)) {
        fail('station-output/path-invalid', 'Output parent or staging identity changed before generation publication.');
      }
      canonicalAuthored(stagingPath, 'staging generation');
      canonicalAuthored(generationPath, 'candidate generation');
      if (exists(operations, generationPath)) {
        verifyGenerationFiles(operations, generationPath, candidate);
        safeRemoveTree(operations, stagingPath);
        stagingCreated = false;
        reused = true;
      } else {
        operations.rename(stagingPath, generationPath, 'publish-generation');
        stagingCreated = false;
        syncDirectory(operations, generationsPath, 'publish-generation', durability);
      }
    }
    verifyGenerationFiles(operations, generationPath, candidate);
    barrier('after-generation-published', { generation_id: generationId });

    writeExclusive(operations, pointerPath, Buffer.from(`${generationId}\n`, 'utf8'));
    const pointerIdentity = regularFile(operations, pointerPath, 'pointer candidate');
    const recoveryBytes = previous ? previous.bytes : Buffer.from('NONE\n', 'utf8');
    if (exists(operations, recoveryPath)) {
      fail('station-output/recovery-required', 'Candidate recovery path already exists and will not be deleted automatically.', {
        recovery_file: path.basename(recoveryPath),
      });
    }
    writeExclusive(operations, recoveryPath, recoveryBytes);
    const recoveryIdentity = regularFile(operations, recoveryPath, 'pointer recovery');
    recoveryCreated = true;
    syncDirectory(operations, bundleRoot, 'prepare-current', durability);
    barrier('before-current-rename', { generation_id: generationId });

    if (!sameIdentity(directory(operations, bundleRoot, 'bundle root'), bundleIdentity)
        || !sameIdentity(directory(operations, generationsPath, 'generations'), generationsIdentity)) {
      fail('station-output/path-invalid', 'Output parent identity changed before CURRENT publication.');
    }
    canonicalAuthored(currentPath, 'CURRENT');
    canonicalAuthored(generationPath, 'candidate generation');
    canonicalAuthored(pointerPath, 'pointer candidate');
    canonicalAuthored(recoveryPath, 'pointer recovery');
    if (!sameIdentity(regularFile(operations, pointerPath, 'pointer candidate'), pointerIdentity)
        || !sameIdentity(regularFile(operations, recoveryPath, 'pointer recovery'), recoveryIdentity)) {
      fail('station-output/path-invalid', 'Pointer candidate or recovery identity changed before CURRENT publication.');
    }
    verifyGenerationFiles(operations, generationPath, candidate);
    if (previous) {
      const currentStat = regularFile(operations, currentPath, 'CURRENT');
      if (!sameIdentity(currentStat, previous.stat)
          || !operations.readFile(currentPath).equals(previous.bytes)) {
        fail('station-output/path-invalid', 'CURRENT changed after publication preflight.');
      }
    } else if (exists(operations, currentPath)) {
      fail('station-output/path-invalid', 'CURRENT appeared after publication preflight.');
    }
    operations.rename(pointerPath, currentPath, 'commit-current');
    pointerCommitted = true;
    barrier('after-current-rename', { generation_id: generationId });
    syncDirectory(operations, bundleRoot, 'commit-current', durability);
    safeUnlink(operations, recoveryPath, 'cleanup-recovery');
    recoveryCreated = false;
    syncDirectory(operations, bundleRoot, 'cleanup-recovery', durability);
    return Object.freeze({
      generation_id: generationId,
      reused,
      directory_fsync: durability.unsupported ? 'unsupported-on-platform' : 'complete',
      durability_claim: durability.unsupported
        ? 'atomic-rename-without-portable-directory-fsync-guarantee'
        : 'atomic-rename-with-directory-fsync',
    });
  } catch (error) {
    if (pointerCommitted) {
      restorePreviousPointer({
        operations, bundleRoot, currentPath, previous, generationId, recoveryPath, durability,
      });
    }
    if (stagingCreated) safeRemoveTree(operations, stagingPath);
    try { safeUnlink(operations, pointerPath, 'cleanup-pointer'); } catch { /* retain on cleanup failure */ }
    if (recoveryCreated) {
      try { safeUnlink(operations, recoveryPath, 'cleanup-recovery'); } catch { /* retain on cleanup failure */ }
    }
    if (error instanceof StationDiagnosticError) throw error;
    fail('station-output/commit-failed', 'Immutable generation publication failed before CURRENT commit.');
  }
}

export function readStationGeneration(bundleRootInput, { operations: suppliedOperations } = {}) {
  const operations = suppliedOperations
    ? createStationOutputOperations(suppliedOperations)
    : createStationOutputOperations();
  const bundleRoot = canonicalAuthored(bundleRootInput, 'bundle root');
  const generationsPath = canonicalAuthored(path.join(bundleRoot, 'generations'), 'generations');
  const currentPath = canonicalAuthored(path.join(bundleRoot, 'CURRENT'), 'CURRENT');
  directory(operations, bundleRoot, 'bundle root');
  assertNoUnresolvedRecovery(operations, bundleRoot, { readers: true });
  regularFile(operations, currentPath, 'CURRENT');
  const pointerBytes = Buffer.from(operations.readFile(currentPath));
  const generationId = parsePointer(pointerBytes);
  directory(operations, generationsPath, 'generations');
  const generationPath = canonicalAuthored(path.join(generationsPath, generationId), 'current generation');
  const contents = verifyGenerationFiles(operations, generationPath);
  const receipt = validateResolvedContents(contents);
  return Object.freeze({
    generation_id: generationId,
    evidenceBytes: Buffer.from(contents.evidenceBytes),
    mapBytes: Buffer.from(contents.mapBytes),
    receiptBytes: Buffer.from(contents.receiptBytes),
    receipt: Object.freeze(receipt),
  });
}
