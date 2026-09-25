import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { canonicalJsonBytes, sha256Hex } from '../lib/canonical-json.mjs';
import {
  STATION_FALLBACK_REASON_CODES,
  STATION_PROFILES,
  validateStationEvidence,
} from '../lib/contracts.mjs';
import { buildStationReceipt } from '../lib/extract.mjs';
import { createGitObjectReader } from '../lib/git-object-reader.mjs';
import { deriveDirectoryEvidenceId, deriveRelationId, deriveRoomId } from '../lib/identity.mjs';
import { buildStationEvidence } from '../lib/node-workspace-evidence.mjs';
import { gateStationArtifacts, verifyStationMapFromEvidence } from '../lib/station-gate.mjs';
import { projectStationMap } from '../lib/station-projector.mjs';
import {
  createDirectoryFixture,
  flatPythonFiles,
  tinySinglePackageFiles,
  unityFiles,
  viteAppFiles,
  wideDirectoryFiles,
} from './helpers/station-fixtures.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '../bin/station-map.mjs');
const PRELOAD = path.join(HERE, 'helpers/no-network.cjs');
const OTHER_64 = 'e'.repeat(64);
const DIRECTORY_PROFILE = 'directory-layout/v1';
const WORKSPACE_PROFILE = 'node-workspaces/v1';

function extract(fixture) {
  const reader = createGitObjectReader({
    repoRoot: fixture.root,
    repositoryUrl: fixture.repositoryUrl,
    revision: fixture.revision,
  });
  const evidence = buildStationEvidence(reader);
  const map = projectStationMap(evidence.value, evidence.bytes);
  const gated = gateStationArtifacts(evidence.bytes, map.bytes, reader);
  const receipt = buildStationReceipt(gated);
  return { fixture, reader, evidence, map, gated, receipt };
}

function labels(map) {
  return map.rooms.map(({ label }) => label).sort();
}

function assertDirectoryRooms(result, expectedRoots) {
  const { evidence, map, receipt } = result;
  assert.equal(evidence.value.extractor.profile, DIRECTORY_PROFILE);
  assert.equal(map.value.snapshot.profile, DIRECTORY_PROFILE);
  assert.equal(receipt.value.extractor.profile, DIRECTORY_PROFILE);
  assert.equal(map.value.snapshot.mode, 'structural');
  assert.equal(map.value.fallback.used, false);
  assert.deepEqual(map.value.relations, []);
  assert.deepEqual(labels(map.value), [...expectedRoots].sort());
  assert.deepEqual(evidence.value.directories.map(({ root }) => root), [...expectedRoots].sort());
  const directoryIds = new Map(evidence.value.directories.map((entry) => [entry.root, entry.id]));
  for (const room of map.value.rooms) {
    assert.equal(room.kind, 'component');
    assert.equal(room.confidence, 'layout');
    assert.equal(room.structural_key, `directory:${room.label}`);
    assert.equal(room.id, deriveRoomId(map.value.project.id, `directory:${room.label}`));
    assert.deepEqual(room.package_roots, [room.label]);
    assert.deepEqual(room.evidence_ids, [directoryIds.get(room.label)]);
    assert.match(room.evidence_ids[0], /^evidence-[a-f0-9]{64}$/);
  }
  assert.equal(receipt.value.result.rooms, expectedRoots.length);
  assert.equal(receipt.value.result.relations, 0);
}

test('single-package Vite app projects code directories under src/ as layout rooms', () => {
  const result = extract(createDirectoryFixture(viteAppFiles()));
  assertDirectoryRooms(result, ['src/components', 'src/lib', 'src/pages']);
  assert.deepEqual(result.evidence.value.directories.map(({ root, code_file_count: count }) => [root, count]), [
    ['src/components', 2], ['src/lib', 1], ['src/pages', 1],
  ]);
  assert.deepEqual(result.evidence.value.analysis.profile_attempts, [
    { profile: WORKSPACE_PROFILE, outcome: 'single-package', reason_code: null },
    { profile: DIRECTORY_PROFILE, outcome: 'selected', reason_code: null },
  ]);
  assert.deepEqual(result.evidence.value.packages, []);
  assert.deepEqual(result.evidence.value.files, []);
});

test('flat Python repository without package.json projects top-level code directories', () => {
  const result = extract(createDirectoryFixture(flatPythonFiles()));
  assertDirectoryRooms(result, ['app', 'scripts', 'tests']);
  assert.deepEqual(result.evidence.value.analysis.profile_attempts, [
    { profile: WORKSPACE_PROFILE, outcome: 'fallback', reason_code: 'station-fallback/root-manifest-missing' },
    { profile: DIRECTORY_PROFILE, outcome: 'selected', reason_code: null },
  ]);
  assert.deepEqual(result.evidence.value.analysis.fallback_reason_codes, []);
});

test('Unity repository projects Assets/Scripts children and ignores art, plugins, and engine folders', () => {
  const result = extract(createDirectoryFixture(unityFiles()));
  assertDirectoryRooms(result, ['Assets/Scripts/Player', 'Assets/Scripts/UI']);
});

// Fixed commit dates make the fixture revision, and so every artifact digest,
// reproducible across runs.
function fixedDateFixture(files) {
  const previous = { author: process.env.GIT_AUTHOR_DATE, committer: process.env.GIT_COMMITTER_DATE };
  process.env.GIT_AUTHOR_DATE = '2026-01-01T00:00:00Z';
  process.env.GIT_COMMITTER_DATE = '2026-01-01T00:00:00Z';
  try {
    return createDirectoryFixture(files);
  } finally {
    for (const [key, value] of [['GIT_AUTHOR_DATE', previous.author], ['GIT_COMMITTER_DATE', previous.committer]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('npm workspace repository keeps the exact pre-ladder evidence, map, and receipt bytes', () => {
  const json = (value) => `${JSON.stringify(value)}\n`;
  const fixture = fixedDateFixture({
    'package.json': json({ name: 'ws-root', private: true, workspaces: ['apps/*', 'packages/*'] }),
    'apps/web/package.json': json({ name: 'ws-web', private: true, dependencies: { 'ws-core': 'workspace:*' } }),
    'apps/web/src/index.ts': 'export {};\n',
    'packages/core/package.json': json({ name: 'ws-core', private: true }),
    'packages/core/index.ts': 'export {};\n',
    'scripts/build.sh': '#!/bin/sh\n',
    'src/one/a.ts': 'export {};\n',
    'src/two/b.ts': 'export {};\n',
  });
  assert.equal(fixture.revision, '3aeb5e8d8313aa498b2c1b069859f3a1d8c37d6c');
  const result = extract(fixture);
  // Captured from main ce70b8a before the profile ladder existed.
  assert.equal(sha256Hex(result.evidence.bytes), 'ec94546ca6f167988e8c97dad59ff90c8f8eec921b86bb5a08ee3d23964983a4');
  assert.equal(sha256Hex(result.map.bytes), '1d46820066555bfbac5e0f35e6e45f621b42ae2651f1b0821f82cb2841b9f90b');
  assert.equal(sha256Hex(result.receipt.bytes), '64f4af9097c2da2bbd8fab8b4d80d8480425e2e9275506888e3813870c0cdf85');
  assert.deepEqual(labels(result.map.value), ['apps/web', 'packages/core']);
  assert.equal(result.map.value.relations.length, 1);
});

test('vendor, build, and hidden directories are ignored at every depth', () => {
  const result = extract(createDirectoryFixture({
    'README.md': '# go service\n',
    'go.mod': 'module example.test/svc\n',
    '.github/scripts/ci.sh': '#!/bin/sh\n',
    'vendor/dep/a.go': 'package dep\n',
    'node_modules/x/index.js': 'module.exports = 1;\n',
    'dist/bundle.js': 'var a;\n',
    'build/gen.py': 'print(1)\n',
    'api/server.go': 'package api\n',
    'api/build/generated.go': 'package build\n',
    'api/.hidden/x.go': 'package hidden\n',
    'pkg/util.go': 'package pkg\n',
    'docs/guide.md': '# guide\n',
  }));
  assertDirectoryRooms(result, ['api', 'pkg']);
  assert.deepEqual(result.evidence.value.directories.map(({ root, code_file_count: count }) => [root, count]), [
    ['api', 1], ['pkg', 1],
  ]);
});

test('tiny single-package repository keeps the exact pre-ladder single root room bytes', () => {
  const fixture = fixedDateFixture(tinySinglePackageFiles());
  assert.equal(fixture.revision, 'ba16849f1f47a9ae0d162150d2c7fe723a259f76');
  const result = extract(fixture);
  // Captured from main ce70b8a before the profile ladder existed.
  assert.equal(sha256Hex(result.evidence.bytes), '88c97ad31b276669252a17db561f4b9f207b4608fda866930a1379a360fbfbf9');
  assert.equal(sha256Hex(result.map.bytes), 'b3cc2812c6ddae272210e607d2b5d95b1ff28f03f195f38b098828456b6797fd');
  assert.equal(sha256Hex(result.receipt.bytes), 'f28241352ac2b70f8fde5f0b70d08984a18f2eed64d78d64d6e15bb41a235b76');
  assert.equal(result.map.value.rooms.length, 1);
  assert.deepEqual(result.map.value.rooms[0].package_roots, ['.']);
  assert.equal(result.map.value.snapshot.profile, WORKSPACE_PROFILE);
});

test('more than 64 expanded candidates fall back to unexpanded top-level directories', () => {
  const result = extract(createDirectoryFixture(wideDirectoryFiles({ conventionalChildren: 70, topLevel: 1 })));
  assertDirectoryRooms(result, ['d000', 'src']);
});

test('collapsing over 64 Unity candidates keeps the Unity exclusions', () => {
  const files = { 'Assets/Plugins/vendor.cs': 'public class Vendor {}\n', 'tools/a.py': 'print(1)\n' };
  for (let index = 0; index < 65; index += 1) {
    files[`Assets/Scripts/C${String(index).padStart(3, '0')}/a.cs`] = `public class C${index} {}\n`;
  }
  const result = extract(createDirectoryFixture(files));
  assertDirectoryRooms(result, ['Assets/Scripts', 'tools']);
  const scripts = result.evidence.value.directories.find(({ root }) => root === 'Assets/Scripts');
  assert.equal(scripts.code_file_count, 65);
});

test('directory evidence IDs hash very large file lists without overflowing the stack', () => {
  const oid = 'a'.repeat(40);
  const codeFiles = Array.from({ length: 130000 }, (_, index) => ({ path: `src/a${String(index).padStart(6, '0')}.ts`, oid }));
  const expected = `evidence-${sha256Hex(Buffer.from(
    ['station-evidence/v1', 'git-directory', 'src', ...codeFiles.slice(0, 3).map(({ path }) => `${path}\0${oid}`)].join('\0'),
    'utf8',
  ))}`;
  assert.equal(deriveDirectoryEvidenceId('src', codeFiles.slice(0, 3)), expected);
  assert.match(deriveDirectoryEvidenceId('src', codeFiles), /^evidence-[a-f0-9]{64}$/);
});

test('more than 64 top-level candidates without a manifest are coarse with directory-candidates-exceeded', () => {
  const result = extract(createDirectoryFixture(wideDirectoryFiles({ topLevel: 65 })));
  assert.equal(result.map.value.snapshot.mode, 'coarse');
  assert.equal(result.map.value.snapshot.profile, WORKSPACE_PROFILE);
  assert.deepEqual(result.map.value.fallback.reason_codes, [
    'station-fallback/directory-candidates-exceeded',
    'station-fallback/root-manifest-missing',
  ]);
  assert.deepEqual(result.evidence.value.analysis.profile_attempts, [
    { profile: WORKSPACE_PROFILE, outcome: 'fallback', reason_code: 'station-fallback/root-manifest-missing' },
    { profile: DIRECTORY_PROFILE, outcome: 'fallback', reason_code: 'station-fallback/directory-candidates-exceeded' },
  ]);
  assert.deepEqual(result.receipt.value.result.fallback_reason_codes, result.map.value.fallback.reason_codes);
});

test('a root package with more than 64 top-level candidates keeps its single root room', () => {
  const result = extract(createDirectoryFixture(wideDirectoryFiles({ topLevel: 65, manifest: true })));
  assert.equal(result.map.value.snapshot.profile, WORKSPACE_PROFILE);
  assert.equal(result.map.value.snapshot.mode, 'structural');
  assert.deepEqual(result.map.value.rooms.map(({ package_roots: roots }) => roots), [['.']]);
  assert.equal(Object.hasOwn(result.evidence.value.analysis, 'profile_attempts'), false);
});

test('a manifest-free repository with fewer than two code directories stays coarse and records the attempt', () => {
  const result = extract(createDirectoryFixture({ 'README.md': '# one\n', 'tool/run.py': 'print(1)\n', 'docs/a.md': 'a\n' }));
  assert.equal(result.map.value.snapshot.mode, 'coarse');
  assert.deepEqual(result.map.value.fallback.reason_codes, ['station-fallback/root-manifest-missing']);
  assert.deepEqual(result.evidence.value.analysis.profile_attempts, [
    { profile: WORKSPACE_PROFILE, outcome: 'fallback', reason_code: 'station-fallback/root-manifest-missing' },
    { profile: DIRECTORY_PROFILE, outcome: 'fallback', reason_code: 'station-fallback/directory-rooms-insufficient' },
  ]);
});

test('npm workspace repositories never reach the directory profile', () => {
  const result = extract(createDirectoryFixture({
    'package.json': JSON.stringify({ name: 'root', workspaces: ['packages/*'] }),
    'packages/a/package.json': JSON.stringify({ name: 'a' }),
    'packages/a/index.ts': 'export {};\n',
    'src/one/x.ts': 'export {};\n',
    'src/two/y.ts': 'export {};\n',
  }));
  assert.equal(result.map.value.snapshot.profile, WORKSPACE_PROFILE);
  assert.deepEqual(labels(result.map.value), ['packages/a']);
  assert.equal(result.map.value.rooms[0].confidence, 'high');
  assert.equal(Object.hasOwn(result.evidence.value, 'directories'), false);
});

test('two independent directory extractions are byte-identical', () => {
  const fixture = createDirectoryFixture(viteAppFiles());
  const left = extract(fixture);
  const right = extract(fixture);
  assert.deepEqual(left.evidence.bytes, right.evidence.bytes);
  assert.deepEqual(left.map.bytes, right.map.bytes);
  assert.deepEqual(left.receipt.bytes, right.receipt.bytes);
});

function tamper(base, target, mutate) {
  const evidence = structuredClone(base.evidence.value);
  const map = structuredClone(base.map.value);
  mutate(target === 'evidence' ? evidence : map, { evidence, map });
  return { evidenceBytes: canonicalJsonBytes(evidence), mapBytes: canonicalJsonBytes(map) };
}

function assertGateRejects(base, name, { evidenceBytes, mapBytes }, code) {
  assert.throws(() => gateStationArtifacts(evidenceBytes, mapBytes, base.reader), (error) => {
    assert.equal(error?.diagnostic?.code, code, `${name}: ${JSON.stringify(error?.diagnostic)}`);
    return true;
  }, name);
}

test('gate independently reconstructs directory maps and rejects every applicable tamper', () => {
  const base = extract(createDirectoryFixture(viteAppFiles()));
  const room = (value) => value.rooms[0];
  const rows = [
    ['map-schema', 'map', (value) => { value.schema = 'station-map/v2'; }, 'station-gate/schema-invalid'],
    ['map-profile', 'map', (value) => { value.snapshot.profile = WORKSPACE_PROFILE; }, 'station-gate/schema-invalid'],
    ['evidence-profile', 'evidence', (value) => { value.extractor.profile = WORKSPACE_PROFILE; }, 'station-gate/schema-invalid'],
    ['unknown-profile', 'evidence', (value) => { value.extractor.profile = 'directory-layout/v2'; }, 'station-gate/schema-invalid'],
    // A directory room's label must equal its single root, so a one-sided edit is a contract violation.
    ['room-label', 'map', (value) => { room(value).label = 'src/invented'; }, 'station-gate/schema-invalid'],
    ['room-roots', 'map', (value) => { room(value).package_roots = ['src/invented']; }, 'station-gate/schema-invalid'],
    ['room-roots-dot', 'map', (value) => { room(value).package_roots = ['.']; room(value).label = '.'; }, 'station-gate/schema-invalid'],
    ['room-label-and-roots', 'map', (value) => { room(value).label = 'src/invented'; room(value).package_roots = ['src/invented']; }, 'station-gate/unsupported-claim'],
    ['room-second-root', 'map', (value) => { room(value).package_roots.push('src/zz'); }, 'station-gate/schema-invalid'],
    ['room-confidence-high', 'map', (value) => { room(value).confidence = 'high'; }, 'station-gate/schema-invalid'],
    ['room-confidence-coarse', 'map', (value) => { room(value).confidence = 'coarse'; }, 'station-gate/schema-invalid'],
    ['room-evidence-id', 'map', (value) => { room(value).evidence_ids = [`evidence-${OTHER_64}`]; }, 'station-gate/unsupported-claim'],
    ['room-structural-key', 'map', (value) => { room(value).structural_key = 'directory:src/invented'; }, 'station-gate/unsupported-claim'],
    ['room-id', 'map', (value) => { room(value).id = `room-${OTHER_64}`; }, 'station-gate/topology-identity-mismatch'],
    ['room-order', 'map', (value) => { value.rooms.reverse(); }, 'station-gate/order-mismatch'],
    ['duplicate-room', 'map', (value) => { value.rooms.push(structuredClone(value.rooms[0])); }, 'station-gate/unsupported-claim'],
    ['omitted-room', 'map', (value) => { value.rooms.pop(); }, 'station-gate/unsupported-claim'],
    ['sixty-fifth-room', 'map', (value) => {
      while (value.rooms.length < 65) value.rooms.push({ ...structuredClone(value.rooms[0]), id: `room-${String(value.rooms.length).padStart(64, '0')}` });
    }, 'station-gate/schema-invalid'],
    ['relation-invention', 'map', (value) => {
      value.relations.push({
        id: deriveRelationId(value.rooms[0].id, value.rooms[1].id),
        kind: 'declared-package-dependency',
        from_room_id: value.rooms[0].id,
        to_room_id: value.rooms[1].id,
        scopes: ['dependencies'],
        evidence_ids: [value.rooms[0].evidence_ids[0]],
      });
    }, 'station-gate/schema-invalid'],
    ['evidence-hash', 'map', (value) => { value.snapshot.evidence_sha256 = OTHER_64; }, 'station-gate/topology-identity-mismatch'],
    ['snapshot-id', 'map', (value) => { value.snapshot.id = `snapshot-${OTHER_64}`; }, 'station-gate/topology-identity-mismatch'],
    ['fallback-invention', 'map', (value) => { value.fallback = { used: true, reason_codes: ['station-fallback/directory-rooms-insufficient'] }; }, 'station-gate/schema-invalid'],
    ['directory-root', 'evidence', (value) => { value.directories[0].root = 'src/invented'; }, 'station-gate/evidence-identity-mismatch'],
    ['directory-count', 'evidence', (value) => { value.directories[0].code_file_count += 1; }, 'station-gate/evidence-identity-mismatch'],
    ['directory-id', 'evidence', (value) => { value.directories[0].id = `evidence-${OTHER_64}`; }, 'station-gate/evidence-identity-mismatch'],
    ['directory-omission', 'evidence', (value) => { value.directories.pop(); }, 'station-gate/evidence-identity-mismatch'],
    ['directory-invention', 'evidence', (value) => { value.directories.push({ ...value.directories[0], root: 'zz' }); }, 'station-gate/evidence-identity-mismatch'],
    ['directory-order', 'evidence', (value) => { value.directories.reverse(); }, 'station-gate/order-mismatch'],
    ['directory-unknown-property', 'evidence', (value) => { value.directories[0].tree = 'x'; }, 'station-gate/schema-invalid'],
    ['attempt-outcome', 'evidence', (value) => { value.analysis.profile_attempts[0].outcome = 'fallback'; }, 'station-gate/schema-invalid'],
    ['attempt-reason', 'evidence', (value) => {
      value.analysis.profile_attempts[0] = { profile: WORKSPACE_PROFILE, outcome: 'fallback', reason_code: 'station-fallback/root-manifest-missing' };
    }, 'station-gate/unsupported-claim'],
    ['analysis-count', 'evidence', (value) => { value.analysis.selected_manifest_count += 1; }, 'station-gate/unsupported-claim'],
    ['file-invention', 'evidence', (value) => {
      value.files.push({ id: `evidence-${OTHER_64}`, kind: 'git-blob', path: 'package.json', git_oid: 'f'.repeat(40), sha256: OTHER_64, bytes: 1 });
    }, 'station-gate/schema-invalid'],
  ];
  for (const [name, target, mutate, code] of rows) {
    assertGateRejects(base, name, tamper(base, target, mutate), code);
  }

  // A coherent pair (evidence edited, map re-projected from it) still fails reader reconstruction.
  const coherent = structuredClone(base.evidence.value);
  coherent.directories[0].root = 'src/renamed';
  const coherentBytes = canonicalJsonBytes(coherent);
  const coherentMap = projectStationMap(coherent, coherentBytes);
  assertGateRejects(base, 'coherent-pair', { evidenceBytes: coherentBytes, mapBytes: coherentMap.bytes }, 'station-gate/evidence-identity-mismatch');

  // Evidence-only verification (used by published-generation reads) rejects map claims too.
  for (const [name, mutate] of [
    ['label-and-roots', (value) => { room(value).label = 'src/invented'; room(value).package_roots = ['src/invented']; }],
    ['evidence-id', (value) => { room(value).evidence_ids = [`evidence-${OTHER_64}`]; }],
  ]) {
    const { mapBytes } = tamper(base, 'map', mutate);
    assert.throws(() => verifyStationMapFromEvidence(base.evidence.bytes, mapBytes), /independent immutable recomputation/, name);
  }
  assert.doesNotThrow(() => verifyStationMapFromEvidence(base.evidence.bytes, base.map.bytes));
});

test('directory extraction runs under the no-network preload through the real CLI', () => {
  const fixture = createDirectoryFixture(viteAppFiles());
  const bundleRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'station-directory-bundle-')), 'bundle');
  const auditPath = path.join(os.tmpdir(), `station-directory-audit-${process.pid}-${Date.now()}.jsonl`);
  const result = spawnSync(process.execPath, [
    '--require', PRELOAD,
    CLI, 'extract', bundleRoot,
    '--repo-root', fixture.root,
    '--repository-url', fixture.repositoryUrl,
    '--revision', fixture.revision,
    '--json',
  ], {
    encoding: 'utf8',
    shell: false,
    env: { ...process.env, STATION_PRELOAD_AUDIT: auditPath, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stderr, '');
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.extractor.profile, DIRECTORY_PROFILE);
  assert.equal(receipt.result.rooms, 3);
  const pointer = fs.readFileSync(path.join(bundleRoot, 'CURRENT'), 'utf8').trim();
  const map = JSON.parse(fs.readFileSync(path.join(bundleRoot, 'generations', pointer, 'station-map.json'), 'utf8'));
  assert.deepEqual(labels(map), ['src/components', 'src/lib', 'src/pages']);
  const audit = fs.readFileSync(auditPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.ok(audit.length > 0);
  assert.ok(audit.every((call) => path.basename(call.command) === 'git' && call.shell === false));
});

test('published JSON schemas carry the ladder profiles, layout confidence, and every fallback cause', () => {
  const schema = (name) => JSON.parse(fs.readFileSync(path.resolve(HERE, `../schemas/${name}.schema.json`), 'utf8'));
  const evidence = schema('station-evidence');
  const map = schema('station-map');
  const receipt = schema('station-extraction-receipt');
  assert.deepEqual(evidence.properties.extractor.properties.profile.enum, [...STATION_PROFILES]);
  assert.deepEqual(map.properties.snapshot.properties.profile.enum, [...STATION_PROFILES]);
  assert.deepEqual(receipt.properties.extractor.properties.profile.enum, [...STATION_PROFILES]);
  assert.deepEqual(map.properties.rooms.items.properties.confidence.enum, ['high', 'coarse', 'layout']);
  assert.deepEqual(
    evidence.properties.analysis.properties.fallback_reason_codes.items.enum,
    [...STATION_FALLBACK_REASON_CODES],
  );
});

test('contracts tie directories and profile attempts to the profile that produced them', () => {
  const base = extract(createDirectoryFixture(viteAppFiles()));
  const rejects = (mutate) => {
    const value = structuredClone(base.evidence.value);
    mutate(value);
    assert.throws(() => validateStationEvidence(value), (error) => error?.diagnostic?.code === 'station-gate/schema-invalid');
  };
  rejects((value) => { delete value.directories; });
  rejects((value) => { value.directories = [value.directories[0]]; });
  rejects((value) => { value.directories[1].root = `${value.directories[0].root}/nested`; });
  rejects((value) => { value.directories[0].code_file_count = 0; });
  rejects((value) => { delete value.analysis.profile_attempts; });
  rejects((value) => { value.analysis.profile_attempts.reverse(); });
  rejects((value) => { value.analysis.profile_attempts[1].reason_code = 'station-fallback/directory-rooms-insufficient'; });
  const tiny = extract(createDirectoryFixture(tinySinglePackageFiles()));
  const withAttempts = structuredClone(tiny.evidence.value);
  withAttempts.analysis.profile_attempts = [
    { profile: WORKSPACE_PROFILE, outcome: 'single-package', reason_code: null },
    { profile: DIRECTORY_PROFILE, outcome: 'fallback', reason_code: 'station-fallback/directory-rooms-insufficient' },
  ];
  assert.throws(() => validateStationEvidence(withAttempts), (error) => error?.diagnostic?.code === 'station-gate/schema-invalid');
});
