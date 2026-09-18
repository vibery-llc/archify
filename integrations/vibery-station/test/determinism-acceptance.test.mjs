import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import os from 'node:os';
import test from 'node:test';
import {
  CANONICAL_ACCEPTANCE_REPOSITORY_URL,
  EQUIVALENT_REMOTE_SPELLINGS,
  captureRepositoryState,
  cloneDeterminismRepository,
  createDeterminismRepository,
  runStationAcceptance,
} from './helpers/station-fixtures.mjs';
import { runFixtureGit } from './helpers/git-fixture.mjs';

const UTF8 = new TextDecoder('utf-8', { fatal: true });
const ARTIFACT_NAMES = Object.freeze(['evidence', 'map', 'receipt']);

function assertRepositoryUnchanged(before, after) {
  assert.equal(after.head, before.head, 'HEAD commit changed');
  assert.equal(after.branch, before.branch, 'checked-out branch changed');
  assert.deepEqual(after.index, before.index, 'index bytes changed');
  assert.equal(
    createHash('sha256').update(after.index).digest('hex'),
    createHash('sha256').update(before.index).digest('hex'),
    'index checksum changed',
  );
  assert.deepEqual(after.refs, before.refs, 'fixture refs changed');
  assert.deepEqual(after.status, before.status, 'porcelain status changed');
}

function assertCanonicalArtifact(bytes) {
  const text = UTF8.decode(bytes);
  assert.equal(text.includes('\r'), false, 'artifact contains CR bytes');
  assert.equal(text.endsWith('\n'), true, 'artifact lacks its trailing LF');
  assert.equal(text.endsWith('\n\n'), false, 'artifact has more than one trailing LF');
  assert.equal(text.slice(0, -1).includes('\n'), false, 'canonical artifact is not one LF-terminated line');
  return JSON.parse(text);
}

function walk(value, visit, trail = '$') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walk(entry, visit, `${trail}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      visit(key, `${trail}.${key}`, true);
      walk(entry, visit, `${trail}.${key}`);
    }
    return;
  }
  visit(value, trail, false);
}

function assertNoVolatileFacts(values, forbiddenValues) {
  for (const value of values) {
    walk(value, (entry, trail, isKey) => {
      if (isKey) {
        assert.doesNotMatch(entry, /^(?:timestamp|time|date|duration|cwd|repo_root|branch|pid|process|host|hostname|runtime|git_version|stderr)$/i, trail);
      } else if (typeof entry === 'string') {
        for (const forbidden of forbiddenValues) {
          assert.equal(entry.includes(forbidden), false, `${trail} leaked ${forbidden}`);
        }
      }
    });
  }
}

function sortedIds(records) {
  return records.map(({ id }) => id).sort();
}

function artifactBytes(result) {
  return ARTIFACT_NAMES.map((name) => result.artifacts[name]);
}

test('real CLI emits exact clone-independent bytes and never mutates mutable repository state', () => {
  const fixture = createDeterminismRepository();
  const variants = EQUIVALENT_REMOTE_SPELLINGS.map((remote, index) => cloneDeterminismRepository(fixture, {
    remote,
    branch: `acceptance-checkout-${index + 1}`,
    headRevision: [fixture.revisions.base, fixture.revisions.readme, fixture.revisions.renamed][index],
    dirty: index > 0,
  }));
  const rawStderrMarker = `raw-stderr-must-not-leak-${process.pid}`;
  const hostMarker = `station-host-${os.hostname()}`;
  const pidMarker = `station-pid-${process.pid}`;
  const gitVersion = runFixtureGit(fixture.root, ['--version']);
  const runs = variants.map((variant, index) => {
    const before = captureRepositoryState(variant.root);
    const run = runStationAcceptance({
      repoRoot: variant.root,
      repositoryUrl: EQUIVALENT_REMOTE_SPELLINGS[index],
      revision: fixture.revisions.base,
      cwd: [fixture.root, variant.root, os.tmpdir()][index],
      envEntries: index % 2 === 0
        ? [['TZ', 'Pacific/Honolulu'], ['LANG', 'C'], ['LC_ALL', 'C'], ['STATION_RAW_STDERR', rawStderrMarker], ['STATION_PID', pidMarker], ['STATION_HOST', hostMarker]]
        : [['STATION_HOST', hostMarker], ['STATION_PID', pidMarker], ['STATION_RAW_STDERR', rawStderrMarker], ['LC_ALL', 'C.UTF-8'], ['LANG', 'C.UTF-8'], ['TZ', 'Asia/Tokyo']],
    });
    const after = captureRepositoryState(variant.root);
    assertRepositoryUnchanged(before, after);
    assert.equal(run.result.status, 0, run.result.stderr.toString('utf8'));
    assert.deepEqual(run.artifacts.receipt, run.result.stdout, 'CLI stdout differs from published receipt bytes');
    return run;
  });

  for (const name of ARTIFACT_NAMES) {
    assert.deepEqual(runs[1].artifacts[name], runs[0].artifacts[name], `${name} differs in SSH clone`);
    assert.deepEqual(runs[2].artifacts[name], runs[0].artifacts[name], `${name} differs in SCP clone`);
  }

  const parsed = runs.map((run) => Object.fromEntries(ARTIFACT_NAMES.map((name) => [name, assertCanonicalArtifact(run.artifacts[name])])));
  for (const values of parsed) {
    const repositoryUrls = new Set();
    walk(values, (entry, _trail, isKey) => {
      if (!isKey && typeof entry === 'string' && /^https?:\/\//.test(entry)) repositoryUrls.add(entry);
    });
    assert.deepEqual([...repositoryUrls], [CANONICAL_ACCEPTANCE_REPOSITORY_URL]);
  }
  assertNoVolatileFacts(parsed, [
    ...variants.map(({ root }) => root),
    ...variants.map(({ branch }) => branch),
    fixture.root,
    hostMarker,
    pidMarker,
    process.version,
    gitVersion,
    rawStderrMarker,
  ]);

  const repeatBefore = captureRepositoryState(variants[1].root);
  const repeated = runStationAcceptance({
    repoRoot: variants[1].root,
    repositoryUrl: EQUIVALENT_REMOTE_SPELLINGS[1],
    revision: fixture.revisions.base,
    cwd: variants[0].root,
    envEntries: [['TZ', 'UTC'], ['LANG', 'C'], ['LC_ALL', 'C']],
  });
  assertRepositoryUnchanged(repeatBefore, captureRepositoryState(variants[1].root));
  for (const name of ARTIFACT_NAMES) assert.deepEqual(repeated.artifacts[name], runs[0].artifacts[name], `${name} differs on repeat`);
});

test('README-only and display-name revisions bind snapshots without destabilizing topology identities', () => {
  const fixture = createDeterminismRepository();
  const runRevision = (revision) => {
    const before = captureRepositoryState(fixture.root);
    const result = runStationAcceptance({
      repoRoot: fixture.root,
      repositoryUrl: EQUIVALENT_REMOTE_SPELLINGS[2],
      revision,
      cwd: os.tmpdir(),
      envEntries: [['TZ', 'UTC'], ['LC_ALL', 'C']],
    });
    assertRepositoryUnchanged(before, captureRepositoryState(fixture.root));
    assert.equal(result.result.status, 0, result.result.stderr.toString('utf8'));
    return {
      ...result,
      values: Object.fromEntries(ARTIFACT_NAMES.map((name) => [name, assertCanonicalArtifact(result.artifacts[name])])),
    };
  };

  const base = runRevision(fixture.revisions.base);
  const readme = runRevision(fixture.revisions.readme);
  for (let index = 0; index < ARTIFACT_NAMES.length; index += 1) {
    assert.notDeepEqual(artifactBytes(readme)[index], artifactBytes(base)[index], `${ARTIFACT_NAMES[index]} did not bind README revision`);
  }
  assert.notEqual(readme.values.map.snapshot.id, base.values.map.snapshot.id);
  assert.equal(readme.values.map.project.id, base.values.map.project.id);
  assert.deepEqual(sortedIds(readme.values.map.rooms), sortedIds(base.values.map.rooms));
  assert.deepEqual(sortedIds(readme.values.map.relations), sortedIds(base.values.map.relations));

  const renamed = runRevision(fixture.revisions.renamed);
  assert.equal(renamed.values.map.project.id, base.values.map.project.id);
  assert.deepEqual(sortedIds(renamed.values.map.rooms), sortedIds(base.values.map.rooms));
  assert.deepEqual(sortedIds(renamed.values.map.relations), sortedIds(base.values.map.relations));
  assert.notEqual(renamed.values.map.snapshot.id, base.values.map.snapshot.id);

  const topology = runRevision(fixture.revisions.topology);
  assert.equal(topology.values.map.project.id, base.values.map.project.id);
  assert.notDeepEqual(sortedIds(topology.values.map.rooms), sortedIds(base.values.map.rooms), 'path-group change retained room identities');
  assert.notDeepEqual(sortedIds(topology.values.map.relations), sortedIds(base.values.map.relations), 'endpoint change retained relation identities');
});
