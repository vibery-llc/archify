import { randomBytes } from 'node:crypto';
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
import { gateStationArtifacts, verifyStationMapFromEvidence } from './station-gate.mjs';

const UTF8 = new TextDecoder('utf-8', { fatal: true });
const GENERATION_RE = /^generation-[a-f0-9]{64}$/;
const ARTIFACT_FILES = Object.freeze([
  ['evidenceBytes', 'station-evidence.json'],
  ['mapBytes', 'station-map.json'],
  ['receiptBytes', 'station-receipt.json'],
]);
const DIRECTORY_FSYNC_UNSUPPORTED = new Set(['EINVAL', 'ENOTSUP', 'ENOSYS']);
const WINDOWS_DIRECTORY_FSYNC_UNSUPPORTED = new Set(['EISDIR', 'EPERM']);
const PUBLICATION_LOCK_NAME = '.station-publication.lock';
const PUBLICATION_JOURNAL_NAME = '.station-publication.transaction';
const PUBLICATION_COMMITTED_NAME = '.station-publication.committed';
const OWNER_SCHEMA = 'station-publication-owner/v1';
const JOURNAL_SCHEMA = 'station-publication-transaction/v1';
const COMMITTED_SCHEMA = 'station-publication-committed/v1';
const TOKEN_RE = /^[a-f0-9]{64}$/;
const OWNER_NAME_RE = /^\.station-publication\.owner-([a-f0-9]{64})$/;
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

function linuxProcessStartIdentity(pid) {
  const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
  const close = stat.lastIndexOf(')');
  if (close < 0) throw Object.assign(new Error('malformed process stat'), { code: 'EIO' });
  const fields = stat.slice(close + 2).trim().split(/\s+/);
  const startTicks = fields[19];
  if (!/^[0-9]+$/.test(startTicks || '')) throw Object.assign(new Error('malformed process start identity'), { code: 'EIO' });
  let boot = 'unknown-boot';
  try { boot = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(); } catch { /* start ticks still discriminate reuse during one boot */ }
  return `${boot}:${startTicks}`;
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
  link: (source, target) => fs.linkSync(source, target),
  unlink: (target) => fs.unlinkSync(target),
  randomToken: () => randomBytes(32).toString('hex'),
  processStartIdentity: (pid) => linuxProcessStartIdentity(pid),
  signalProcess: (pid, signal) => process.kill(pid, signal),
  removeTree: (target) => fs.rmSync(target, { recursive: true, force: true }),
  removeDirectory: (target) => fs.rmdirSync(target),
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

function validateResolvedContents(contents, generationId) {
  const code = 'station-output/pointer-invalid';
  strictJson(contents.evidenceBytes, STATION_SCHEMAS.evidence, validateStationEvidence, code);
  strictJson(contents.mapBytes, STATION_SCHEMAS.map, validateStationMap, code);
  const receipt = strictJson(contents.receiptBytes, STATION_SCHEMAS.receipt, validateStationExtractionReceipt, code);
  const hashes = {
    evidence: sha256Hex(contents.evidenceBytes),
    map: sha256Hex(contents.mapBytes),
    receipt: sha256Hex(contents.receiptBytes),
  };
  if (generationId !== deriveStationGenerationId(hashes)) {
    fail(code, 'CURRENT generation ID does not authenticate its exact artifact bytes.');
  }

  let verified;
  try {
    verified = verifyStationMapFromEvidence(contents.evidenceBytes, contents.mapBytes);
  } catch {
    fail(code, 'CURRENT generation map is not the complete deterministic projection of its evidence.');
  }
  const expectedReceipt = {
    schema: STATION_SCHEMAS.receipt,
    ok: true,
    command: 'station extract',
    repository: {
      url: verified.evidence.repository.url,
      revision: verified.evidence.repository.revision,
      tree_oid: verified.evidence.repository.tree_oid,
      object_format: verified.evidence.repository.object_format,
    },
    extractor: verified.evidence.extractor,
    artifacts: {
      evidence: { file: 'station-evidence.json', sha256: hashes.evidence, bytes: contents.evidenceBytes.length },
      map: { file: 'station-map.json', sha256: hashes.map, bytes: contents.mapBytes.length },
    },
    result: {
      project_id: verified.map.project.id,
      snapshot_id: verified.map.snapshot.id,
      mode: verified.map.snapshot.mode,
      rooms: verified.map.rooms.length,
      relations: verified.map.relations.length,
      fallback: verified.map.fallback.used,
      fallback_reason_codes: verified.map.fallback.reason_codes,
    },
    diagnostics: [],
  };
  if (!canonicalJsonBytes(receipt).equals(canonicalJsonBytes(expectedReceipt))) {
    fail(code, 'CURRENT generation receipt does not bind every exact evidence and map claim.');
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
  validateResolvedContents(contents, generationId);
  return Object.freeze({ stat, bytes, generationId });
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

function strictWriteExclusive(operations, target, bytes) {
  let descriptor;
  let primaryError;
  try {
    descriptor = operations.openExclusive(target);
    let offset = 0;
    while (offset < bytes.length) {
      const written = operations.write(descriptor, bytes, offset);
      if (!Number.isSafeInteger(written) || written <= 0) throw new Error('short write');
      offset += written;
    }
    operations.fsyncFile(descriptor, target);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (descriptor !== undefined) {
      try { operations.close(descriptor); } catch (closeError) { if (!primaryError) throw closeError; }
    }
  }
}

function publicationPaths(bundleRoot, token) {
  return {
    lock: path.join(bundleRoot, PUBLICATION_LOCK_NAME),
    journal: path.join(bundleRoot, PUBLICATION_JOURNAL_NAME),
    committed: path.join(bundleRoot, PUBLICATION_COMMITTED_NAME),
    owner: token ? path.join(bundleRoot, `.station-publication.owner-${token}`) : null,
    pointer: token ? path.join(bundleRoot, `.CURRENT.candidate-${token}`) : null,
    current: path.join(bundleRoot, 'CURRENT'),
    generations: path.join(bundleRoot, 'generations'),
  };
}

function exactCanonicalObject(operations, target, label) {
  regularFile(operations, target, label);
  const bytes = Buffer.from(operations.readFile(target));
  let value;
  try { value = JSON.parse(UTF8.decode(bytes)); } catch { fail('station-output/recovery-required', `${label} is malformed.`); }
  if (!bytes.equals(canonicalJsonBytes(value))) fail('station-output/recovery-required', `${label} is not canonical exact JSON.`);
  return { bytes, value, stat: operations.lstat(target) };
}

function validOwner(value) {
  return value && value.schema === OWNER_SCHEMA && TOKEN_RE.test(value.token || '')
    && Number.isSafeInteger(value.pid) && value.pid > 0
    && typeof value.process_start_identity === 'string' && value.process_start_identity.length > 0
    && Object.keys(value).sort().join('\0') === ['pid', 'process_start_identity', 'schema', 'token'].sort().join('\0');
}

function attestOwner(operations, owner) {
  try {
    const observed = operations.processStartIdentity(owner.pid);
    if (typeof observed !== 'string' || observed.length === 0) return 'unknown';
    return observed === owner.process_start_identity ? 'live' : 'stale';
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ESRCH') return 'stale';
    return 'unknown';
  }
}

function inspectFixedLock(operations, bundleRoot) {
  const { lock } = publicationPaths(bundleRoot);
  if (!exists(operations, lock)) return { state: 'absent' };
  let parsed;
  try { parsed = exactCanonicalObject(operations, lock, 'publication lock'); } catch (error) {
    if (error instanceof StationDiagnosticError) return { state: 'unknown', reason: 'lock-invalid' };
    return { state: 'unknown', reason: 'lock-unreadable' };
  }
  if (!validOwner(parsed.value)) return { state: 'unknown', reason: 'lock-invalid' };
  const liveness = attestOwner(operations, parsed.value);
  return { state: liveness, owner: parsed.value, bytes: parsed.bytes, stat: parsed.stat };
}

function readOptionalTransaction(operations, bundleRoot) {
  const paths = publicationPaths(bundleRoot);
  for (const [kind, target, schema] of [
    ['journal', paths.journal, JOURNAL_SCHEMA],
    ['committed', paths.committed, COMMITTED_SCHEMA],
  ]) {
    if (!exists(operations, target)) continue;
    let parsed;
    try { parsed = exactCanonicalObject(operations, target, `publication ${kind}`); } catch {
      return { kind: 'invalid', target };
    }
    const value = parsed.value;
    const valid = value?.schema === schema && TOKEN_RE.test(value.token || '')
      && (value.previous_generation_id === null || GENERATION_RE.test(value.previous_generation_id || ''))
      && GENERATION_RE.test(value.candidate_generation_id || '');
    if (!valid) return { kind: 'invalid', target };
    return { kind, target, value, ...parsed };
  }
  return null;
}

function inspectCurrentAgainstTransaction(operations, bundleRoot, transaction) {
  if (!transaction) return { state: 'none' };
  const currentPath = publicationPaths(bundleRoot).current;
  try {
    if (!exists(operations, currentPath)) {
      return transaction.value.previous_generation_id === null ? { state: 'previous' } : { state: 'different' };
    }
    regularFile(operations, currentPath, 'CURRENT');
    const generationId = parsePointer(Buffer.from(operations.readFile(currentPath)));
    if (generationId === transaction.value.candidate_generation_id) return { state: 'candidate', generationId };
    if (generationId === transaction.value.previous_generation_id) return { state: 'previous', generationId };
    return { state: 'different', generationId };
  } catch (error) {
    return { state: 'unknown', error };
  }
}

function ownerFiles(operations, bundleRoot) {
  return operations.readdir(bundleRoot).filter((name) => OWNER_NAME_RE.test(name)).sort();
}

export function inspectStationPublication(bundleRootInput, { operations: suppliedOperations } = {}) {
  const operations = suppliedOperations ? createStationOutputOperations(suppliedOperations) : createStationOutputOperations();
  const bundleRoot = canonicalAuthored(bundleRootInput, 'bundle root');
  directory(operations, bundleRoot, 'bundle root');
  const lock = inspectFixedLock(operations, bundleRoot);
  const transaction = readOptionalTransaction(operations, bundleRoot);
  const current = inspectCurrentAgainstTransaction(operations, bundleRoot, transaction);
  const orphans = ownerFiles(operations, bundleRoot);
  const recoveryToken = lock.owner?.token || transaction?.value?.token;
  if (current.state === 'unknown' || current.state === 'different') {
    return Object.freeze({ state: 'authority-indeterminate', ...(recoveryToken ? { recovery_token: recoveryToken } : {}) });
  }
  if (transaction?.kind === 'invalid' || lock.state === 'unknown') {
    return Object.freeze({ state: 'recovery-required', ...(recoveryToken ? { recovery_token: recoveryToken } : {}) });
  }
  if (current.state === 'candidate') {
    return Object.freeze({ state: 'committed-recovery-required', recovery_token: recoveryToken, generation_id: current.generationId });
  }
  if (lock.state === 'live') return Object.freeze({ state: 'busy', owner_pid: lock.owner.pid });
  if (lock.state === 'stale') return Object.freeze({ state: 'stale-lock', recovery_token: lock.owner.token });
  if (transaction || orphans.length) {
    return Object.freeze({ state: 'recovery-required', ...(recoveryToken ? { recovery_token: recoveryToken } : {}) });
  }
  return Object.freeze({ state: 'idle' });
}

function acquirePublicationLock(operations, bundleRoot, durability) {
  const token = operations.randomToken();
  if (!TOKEN_RE.test(token || '')) fail('station-output/recovery-required', 'Publication owner token source is invalid.');
  let processStartIdentity;
  try { processStartIdentity = operations.processStartIdentity(process.pid); } catch {
    fail('station-output/recovery-required', 'Publisher process-start identity could not be attested.');
  }
  if (typeof processStartIdentity !== 'string' || !processStartIdentity) {
    fail('station-output/recovery-required', 'Publisher process-start identity could not be attested.');
  }
  const paths = publicationPaths(bundleRoot, token);
  const owner = { schema: OWNER_SCHEMA, token, pid: process.pid, process_start_identity: processStartIdentity };
  strictWriteExclusive(operations, paths.owner, canonicalJsonBytes(owner));
  try {
    operations.link(paths.owner, paths.lock, 'acquire-publication-lock');
    syncDirectory(operations, bundleRoot, 'acquire-publication-lock', durability);
  } catch (error) {
    try { safeUnlink(operations, paths.owner, 'cleanup-unacquired-owner'); } catch { /* retained for inspection */ }
    if (error?.code === 'EEXIST') {
      const existing = inspectFixedLock(operations, bundleRoot);
      if (existing.state === 'live') fail('station-output/publication-busy', 'Another live publisher holds the bundle publication lock.', { lock: PUBLICATION_LOCK_NAME });
      if (existing.state === 'stale') fail('station-output/publication-lock-stale', 'A stale publication owner requires explicit token recovery.', {
        lock: PUBLICATION_LOCK_NAME, recovery_token: existing.owner.token,
      }, ['inspect the transaction and invoke explicit recovery with the exact retained token']);
      fail('station-output/recovery-required', 'Publication lock ownership cannot be safely determined.', { lock: PUBLICATION_LOCK_NAME });
    }
    throw error;
  }
  const lockStat = regularFile(operations, paths.lock, 'publication lock');
  const ownerStat = regularFile(operations, paths.owner, 'publication owner');
  if (!sameIdentity(lockStat, ownerStat)) fail('station-output/recovery-required', 'Publication owner hard-link identity is inconsistent.');
  return { token, owner, bytes: canonicalJsonBytes(owner), stat: lockStat, paths };
}

function lockStillOwned(operations, lock) {
  try {
    const parsed = exactCanonicalObject(operations, lock.paths.lock, 'publication lock');
    return sameIdentity(parsed.stat, lock.stat) && parsed.bytes.equals(lock.bytes);
  } catch { return false; }
}

function releasePublicationLock(operations, bundleRoot, lock, durability) {
  if (!lockStillOwned(operations, lock)) throw new Error('publication lock ownership changed');
  operations.unlink(lock.paths.lock, 'release-publication-lock');
  syncDirectory(operations, bundleRoot, 'release-publication-lock', durability);
  operations.unlink(lock.paths.owner, 'cleanup-publication-owner');
  syncDirectory(operations, bundleRoot, 'cleanup-publication-owner', durability);
}

function publicationResult(generationId, reused, durability, state = 'committed', reasons = []) {
  const committed = state === 'authority-indeterminate' ? null : state.startsWith('committed');
  return Object.freeze({
    state,
    committed,
    generation_id: generationId,
    reused,
    recovery_required: state !== 'committed',
    recovery_reasons: Object.freeze([...new Set(reasons)]),
    directory_fsync: durability.unsupported ? 'unsupported-on-platform' : 'complete',
    durability_claim: durability.unsupported
      ? 'atomic-rename-without-portable-directory-fsync-guarantee'
      : state === 'committed'
        ? 'atomic-rename-with-directory-fsync'
        : 'commit-observed-recovery-incomplete',
  });
}

function exactCurrentState(operations, currentPath, previous, generationId) {
  try {
    if (!exists(operations, currentPath)) return previous ? 'different' : 'previous';
    regularFile(operations, currentPath, 'CURRENT');
    const bytes = Buffer.from(operations.readFile(currentPath));
    if (previous && bytes.equals(previous.bytes)) return 'previous';
    if (bytes.equals(Buffer.from(`${generationId}\n`))) return 'candidate';
    return 'different';
  } catch { return 'unknown'; }
}

function unresolvedPublicationMaterial(operations, bundleRoot, ownToken) {
  const paths = publicationPaths(bundleRoot);
  if (exists(operations, paths.journal) || exists(operations, paths.committed)) return true;
  return ownerFiles(operations, bundleRoot).some((name) => name !== `.station-publication.owner-${ownToken}`);
}

export function publishStationGeneration(candidate, { operations: suppliedOperations, barrier = () => {} } = {}) {
  const operations = suppliedOperations ? createStationOutputOperations(suppliedOperations) : createStationOutputOperations();
  const facts = candidateFacts(candidate);
  const generationId = deriveStationGenerationId(facts.hashes);
  const bundleRoot = canonicalAuthored(candidate.bundleRoot, 'bundle root');
  const paths = publicationPaths(bundleRoot);
  const generationPath = canonicalAuthored(path.join(paths.generations, generationId), 'candidate generation');
  assertProtectedPaths(bundleRoot, [
    ['generations', paths.generations], ['candidate generation', generationPath], ['CURRENT', paths.current],
    ['publication lock', paths.lock], ['publication journal', paths.journal], ['committed marker', paths.committed],
  ], candidate.protectedPaths);
  try {
    operations.mkdir(bundleRoot, { recursive: true, mode: 0o700 });
    operations.mkdir(paths.generations, { recursive: true, mode: 0o700 });
  } catch { fail('station-output/path-invalid', 'Bundle directories could not be created as physical directories.'); }
  const bundleIdentity = directory(operations, bundleRoot, 'bundle root');
  const generationsIdentity = directory(operations, paths.generations, 'generations');
  const durability = { unsupported: false };
  let lock;
  try { lock = acquirePublicationLock(operations, bundleRoot, durability); } catch (error) {
    if (error instanceof StationDiagnosticError) throw error;
    fail('station-output/commit-failed', 'Publication lock acquisition failed before commit.');
  }

  let reused = false;
  let committedState = 'precommit';
  const recoveryReasons = [];
  let result;
  try {
    if (unresolvedPublicationMaterial(operations, bundleRoot, lock.token)) {
      fail('station-output/recovery-required', 'Bundle contains unresolved publication material requiring explicit recovery.');
    }
    if (exists(operations, generationPath)) verifyGenerationFiles(operations, generationPath, candidate);
    const previous = readPreviousPointer(operations, bundleRoot, paths.generations, paths.current);
    const stagingPath = path.join(paths.generations, `.station-stage-${generationId}-${lock.token}`);
    lock.paths.pointer = path.join(bundleRoot, `.CURRENT.candidate-${lock.token}`);
    assertProtectedPaths(bundleRoot, [['staging generation', stagingPath], ['pointer candidate', lock.paths.pointer]], candidate.protectedPaths);

    if (exists(operations, generationPath)) {
      verifyGenerationFiles(operations, generationPath, candidate);
      reused = true;
    } else {
      operations.mkdir(stagingPath, { recursive: false, mode: 0o700 });
      const stagingIdentity = directory(operations, stagingPath, 'staging generation');
      try {
        for (const [field, name] of ARTIFACT_FILES) strictWriteExclusive(operations, path.join(stagingPath, name), candidate[field]);
        barrier('after-staging-files', { generation_id: generationId });
        candidateFacts({ ...candidate, ...verifyGenerationFiles(operations, stagingPath, candidate) });
        syncDirectory(operations, stagingPath, 'staging-generation', durability);
        barrier('before-generation-rename', { generation_id: generationId });
        if (!sameIdentity(directory(operations, bundleRoot, 'bundle root'), bundleIdentity)
            || !sameIdentity(directory(operations, paths.generations, 'generations'), generationsIdentity)
            || !sameIdentity(directory(operations, stagingPath, 'staging generation'), stagingIdentity)) {
          fail('station-output/path-invalid', 'Output parent or staging identity changed before generation publication.');
        }
        if (exists(operations, generationPath)) {
          verifyGenerationFiles(operations, generationPath, candidate);
          safeRemoveTree(operations, stagingPath);
          reused = true;
        } else {
          operations.rename(stagingPath, generationPath, 'publish-generation');
          syncDirectory(operations, paths.generations, 'publish-generation', durability);
        }
      } catch (error) {
        safeRemoveTree(operations, stagingPath);
        throw error;
      }
    }
    verifyGenerationFiles(operations, generationPath, candidate);
    barrier('after-generation-published', { generation_id: generationId });
    strictWriteExclusive(operations, lock.paths.pointer, Buffer.from(`${generationId}\n`));
    const pointerIdentity = regularFile(operations, lock.paths.pointer, 'pointer candidate');
    const journal = {
      schema: JOURNAL_SCHEMA,
      token: lock.token,
      previous_generation_id: previous?.generationId ?? null,
      candidate_generation_id: generationId,
    };
    strictWriteExclusive(operations, paths.journal, canonicalJsonBytes(journal));
    syncDirectory(operations, bundleRoot, 'prepare-transaction-journal', durability);
    barrier('before-current-rename', { generation_id: generationId });
    if (!lockStillOwned(operations, lock)
        || !sameIdentity(directory(operations, bundleRoot, 'bundle root'), bundleIdentity)
        || !sameIdentity(directory(operations, paths.generations, 'generations'), generationsIdentity)
        || !sameIdentity(regularFile(operations, lock.paths.pointer, 'pointer candidate'), pointerIdentity)) {
      fail('station-output/path-invalid', 'Publication authority or output identity changed before CURRENT publication.');
    }
    const assertCurrent = () => {
      const observed = exactCurrentState(operations, paths.current, previous, generationId);
      if (observed !== 'previous') fail('station-output/path-invalid', 'CURRENT changed after publication preflight.');
    };
    assertCurrent();
    barrier('after-current-recheck', { generation_id: generationId });
    assertCurrent();
    barrier('after-final-current-check', { generation_id: generationId });
    try {
      operations.rename(lock.paths.pointer, paths.current, 'commit-current');
      committedState = 'committed';
    } catch (error) {
      const observed = exactCurrentState(operations, paths.current, previous, generationId);
      if (observed === 'candidate') {
        committedState = 'committed';
        recoveryReasons.push('rename-acknowledgement-lost');
      } else if (observed === 'unknown' || observed === 'different') {
        committedState = 'indeterminate';
        recoveryReasons.push('rename-authority-indeterminate');
      } else {
        throw error;
      }
    }
    if (committedState === 'committed') {
      barrier('after-current-rename', { generation_id: generationId });
      try { syncDirectory(operations, bundleRoot, 'commit-current', durability); } catch { recoveryReasons.push('current-directory-fsync-failed'); }
      try {
        strictWriteExclusive(operations, paths.committed, canonicalJsonBytes({
          schema: COMMITTED_SCHEMA,
          token: lock.token,
          previous_generation_id: previous?.generationId ?? null,
          candidate_generation_id: generationId,
        }));
        syncDirectory(operations, bundleRoot, 'commit-marker', durability);
      } catch { recoveryReasons.push('committed-marker-failed'); }
      if (recoveryReasons.length === 0) {
        try {
          safeUnlink(operations, paths.journal, 'cleanup-transaction-journal');
          safeUnlink(operations, paths.committed, 'cleanup-committed-marker');
          syncDirectory(operations, bundleRoot, 'cleanup-transaction', durability);
        } catch { recoveryReasons.push('transaction-cleanup-failed'); }
      }
      result = publicationResult(generationId, reused, durability,
        recoveryReasons.length ? 'committed-recovery-required' : 'committed', recoveryReasons);
    } else {
      result = publicationResult(generationId, reused, durability, 'authority-indeterminate', recoveryReasons);
    }
  } catch (error) {
    if (committedState === 'committed') {
      recoveryReasons.push('post-commit-unclassified');
      result = publicationResult(generationId, reused, durability, 'committed-recovery-required', recoveryReasons);
    } else if (committedState === 'indeterminate') {
      result = publicationResult(generationId, reused, durability, 'authority-indeterminate', recoveryReasons);
    } else {
      try { if (lock.paths.pointer) safeUnlink(operations, lock.paths.pointer, 'cleanup-pointer'); } catch { /* recovery material remains */ }
      try { safeUnlink(operations, paths.journal, 'cleanup-transaction-journal'); } catch { /* recovery material remains */ }
      try { safeUnlink(operations, paths.committed, 'cleanup-committed-marker'); } catch { /* recovery material remains */ }
      if (error instanceof StationDiagnosticError) {
        try { releasePublicationLock(operations, bundleRoot, lock, durability); } catch {
          fail('station-output/recovery-required', 'Publication lock release failed before commit.', { recovery_token: lock.token });
        }
        throw error;
      }
      try { releasePublicationLock(operations, bundleRoot, lock, durability); } catch {
        fail('station-output/recovery-required', 'Publication lock release failed before commit.', { recovery_token: lock.token });
      }
      fail('station-output/commit-failed', 'Immutable generation publication failed before CURRENT commit.');
    }
  }

  try { releasePublicationLock(operations, bundleRoot, lock, durability); } catch {
    recoveryReasons.push('publication-lock-release-failed');
    if (result.committed === true) {
      result = publicationResult(generationId, reused, durability, 'committed-recovery-required', recoveryReasons);
    } else {
      result = publicationResult(generationId, reused, durability, 'authority-indeterminate', recoveryReasons);
    }
  }
  return result;
}

function requireTrustedGeneration(expectedGenerationId) {
  if (typeof expectedGenerationId !== 'string' || !GENERATION_RE.test(expectedGenerationId)) {
    fail('station-output/trusted-generation-required', 'Reading a Station generation requires one trusted external generation ID anchor.');
  }
}

export function readStationGeneration(bundleRootInput, { expectedGenerationId, operations: suppliedOperations } = {}) {
  requireTrustedGeneration(expectedGenerationId);
  const operations = suppliedOperations ? createStationOutputOperations(suppliedOperations) : createStationOutputOperations();
  const bundleRoot = canonicalAuthored(bundleRootInput, 'bundle root');
  const paths = publicationPaths(bundleRoot);
  directory(operations, bundleRoot, 'bundle root');
  regularFile(operations, paths.current, 'CURRENT');
  const pointerBytes = Buffer.from(operations.readFile(paths.current));
  const generationId = parsePointer(pointerBytes);
  if (generationId !== expectedGenerationId) {
    fail('station-output/generation-mismatch', 'CURRENT does not match the trusted external generation anchor.', {
      expected_generation_id: expectedGenerationId, observed_generation_id: generationId,
    });
  }
  const transaction = readOptionalTransaction(operations, bundleRoot);
  const transactionState = inspectCurrentAgainstTransaction(operations, bundleRoot, transaction);
  if (transaction?.kind === 'invalid' || transactionState.state === 'candidate') {
    fail('station-output/recovery-required', 'The anchored generation has unresolved publication recovery material.');
  }
  if (transactionState.state === 'unknown' || transactionState.state === 'different') {
    fail('station-output/authority-indeterminate', 'Publication authority cannot be safely determined for the anchored generation.');
  }
  directory(operations, paths.generations, 'generations');
  const generationPath = canonicalAuthored(path.join(paths.generations, generationId), 'current generation');
  const contents = verifyGenerationFiles(operations, generationPath);
  const receipt = validateResolvedContents(contents, generationId);
  return Object.freeze({
    generation_id: generationId,
    evidenceBytes: Buffer.from(contents.evidenceBytes),
    mapBytes: Buffer.from(contents.mapBytes),
    receiptBytes: Buffer.from(contents.receiptBytes),
    receipt: Object.freeze(receipt),
  });
}

export function recoverStationPublication(bundleRootInput, {
  recoveryToken, operations: suppliedOperations, barrier = () => {},
} = {}) {
  if (!TOKEN_RE.test(recoveryToken || '')) fail('station-output/recovery-token-mismatch', 'Recovery requires the exact retained owner token.');
  const operations = suppliedOperations ? createStationOutputOperations(suppliedOperations) : createStationOutputOperations();
  const bundleRoot = canonicalAuthored(bundleRootInput, 'bundle root');
  const paths = publicationPaths(bundleRoot, recoveryToken);
  directory(operations, bundleRoot, 'bundle root');
  const first = inspectFixedLock(operations, bundleRoot);
  if (first.owner?.token !== recoveryToken) fail('station-output/recovery-token-mismatch', 'Recovery token does not match the retained owner.');
  if (first.state === 'live') fail('station-output/publication-busy', 'The publication owner is still live.');
  if (first.state !== 'stale') fail('station-output/recovery-required', 'Publication owner staleness cannot be attested.');
  const transaction = readOptionalTransaction(operations, bundleRoot);
  const current = inspectCurrentAgainstTransaction(operations, bundleRoot, transaction);
  if (current.state === 'unknown' || current.state === 'different' || transaction?.kind === 'invalid') {
    fail('station-output/authority-indeterminate', 'Recovery cannot determine CURRENT authority.');
  }
  if (current.state === 'candidate') {
    const generationPath = canonicalAuthored(path.join(paths.generations, current.generationId), 'recovery generation');
    const contents = verifyGenerationFiles(operations, generationPath);
    validateResolvedContents(contents, current.generationId);
  }
  barrier('before-recovery-reattest', { recovery_token: recoveryToken });
  const second = inspectFixedLock(operations, bundleRoot);
  if (second.state !== 'stale' || second.owner.token !== recoveryToken
      || !sameIdentity(first.stat, second.stat) || !first.bytes.equals(second.bytes)) {
    fail('station-output/recovery-required', 'Recovery owner changed during token reattestation.');
  }
  barrier('after-recovery-reattest', { recovery_token: recoveryToken });
  const durability = { unsupported: false };
  for (const [target, phase] of [
    [paths.pointer, 'recover-pointer'], [paths.journal, 'recover-transaction-journal'],
    [paths.committed, 'recover-committed-marker'], [paths.lock, 'recover-publication-lock'],
    [paths.owner, 'recover-owner-file'],
  ]) safeUnlink(operations, target, phase);
  syncDirectory(operations, bundleRoot, 'recover-publication', durability);
  return Object.freeze({
    state: 'recovered',
    committed: current.state === 'candidate',
    generation_id: current.generationId ?? null,
    directory_fsync: durability.unsupported ? 'unsupported-on-platform' : 'complete',
  });
}
