import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { deriveRelationId } from '../lib/identity.mjs';
import {
  createTwelveWorkspaceRepository,
  runStationAcceptance,
} from './helpers/station-fixtures.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VIBERY_GROUPS = Object.freeze([
  'vibery-backend-new',
  'vibery-ui-web',
  'vibery-games',
  'packages',
]);
const RENAMED_GROUPS = Object.freeze(['services', 'clients', 'experiences', 'libraries']);
const MEMBER_NAMES = Object.freeze(['alpha', 'beta', 'gamma']);

function parseRun(fixture) {
  const run = runStationAcceptance({
    repoRoot: fixture.root,
    repositoryUrl: fixture.repositoryUrl,
    revision: fixture.revision,
  });
  assert.equal(run.result.status, 0, run.result.stderr.toString('utf8'));
  assert.equal(run.result.stderr.length, 0);
  return {
    run,
    evidence: JSON.parse(run.artifacts.evidence),
    map: JSON.parse(run.artifacts.map),
    receipt: JSON.parse(run.artifacts.receipt),
  };
}

function roomIndex(map) {
  return new Map(map.rooms.map((room) => [room.label, room]));
}

function relationByDirection(map) {
  const labelById = new Map(map.rooms.map(({ id, label }) => [id, label]));
  return new Map(map.relations.map((relation) => [
    `${labelById.get(relation.from_room_id)} -> ${labelById.get(relation.to_room_id)}`,
    relation,
  ]));
}

function evidenceIdsForRoots(evidence, roots) {
  const packages = new Map(evidence.packages.map((record) => [record.root, record]));
  return roots.map((root) => packages.get(root).manifest_evidence_id).sort();
}

function expectedRoots(group) {
  return MEMBER_NAMES.map((member) => `${group}/${member}`).sort();
}

// Per-package declared dependency directions (by 0-based package index).
// unit-01..12 map to groups×members in order: group0 alpha..gamma (0-2),
// group1 (3-5), group2 (6-8), group3 (9-11).
const PACKAGE_DIRECTIONS = Object.freeze([
  [0, 9, ['dependencies']],
  [1, 10, ['optionalDependencies']],
  [3, 9, ['devDependencies']],
  [4, 11, ['peerDependencies']],
  [6, 10, ['dependencies']],
  [6, 9, ['peerDependencies']],
  [9, 10, ['dependencies']],
]);

function directionLabel(root) {
  const parts = root.split('/');
  return parts.length > 1 ? parts.slice(1).join('/') : root;
}

function assertTwelveWorkspaceShape(values, groups) {
  const { evidence, map, receipt } = values;
  assert.equal(evidence.workspace.package_roots.length, 12);
  assert.deepEqual(evidence.workspace.package_roots, groups.flatMap(expectedRoots).sort());
  assert.equal(map.snapshot.mode, 'structural');
  assert.equal(map.fallback.used, false);
  assert.deepEqual(map.fallback.reason_codes, []);
  assert.equal(map.rooms.length, 12);
  assert.equal(map.relations.length, 7);
  assert.equal(receipt.result.rooms, 12);
  assert.equal(receipt.result.relations, 7);

  const roomsByRoot = new Map(map.rooms.map((room) => [room.package_roots[0], room]));
  assert.deepEqual([...roomsByRoot.keys()].sort(), evidence.workspace.package_roots);
  for (const [root, room] of roomsByRoot) {
    assert.equal(room.structural_key, `workspace-package:${root}`);
    assert.deepEqual(room.package_roots, [root]);
    assert.equal(room.confidence, 'high');
  }
  assert.deepEqual(map.rooms.flatMap(({ package_roots: roots }) => roots).sort(), evidence.workspace.package_roots);

  const relationById = new Map(map.relations.map((relation) => [relation.id, relation]));
  assert.deepEqual(map.relations.map(({ id }) => id).sort(), map.relations.map(({ id }) => id).sort());
  const packagesByIndex = new Map(evidence.packages.filter(({ root }) => root !== '.')
    .map((record) => [Number(record.name.slice('unit-'.length)) - 1, record]));
  const expectedRelations = PACKAGE_DIRECTIONS.map(([fromIndex, toIndex, scopes]) => {
    const from = packagesByIndex.get(fromIndex);
    const to = packagesByIndex.get(toIndex);
    return {
      id: deriveRelationId(roomsByRoot.get(from.root).id, roomsByRoot.get(to.root).id),
      from_room_id: roomsByRoot.get(from.root).id,
      to_room_id: roomsByRoot.get(to.root).id,
      scopes: [...scopes].sort(),
      evidence_ids: [from.manifest_evidence_id],
    };
  });
  assert.equal(map.relations.length, expectedRelations.length);
  for (const expected of expectedRelations) {
    const relation = relationById.get(expected.id);
    assert.ok(relation, `missing relation ${expected.id}`);
    assert.deepEqual(relation.scopes, expected.scopes);
    assert.deepEqual(relation.evidence_ids, expected.evidence_ids);
    assert.equal(relation.id, deriveRelationId(relation.from_room_id, relation.to_room_id));
    assert.notEqual(relation.from_room_id, relation.to_room_id);
  }
  assert.equal(map.relations.some(({ from_room_id, to_room_id }) => (
    from_room_id === to_room_id
  )), false, 'same-room declaration became a topology self-loop');
  return {
    memberCounts: map.rooms.map(({ package_roots }) => package_roots.length).sort(),
    relationScopes: map.relations.map(({ scopes }) => scopes).sort((left, right) => left.join().localeCompare(right.join())),
  };
}

function implementationSource() {
  const roots = [path.resolve(HERE, '../lib'), path.resolve(HERE, '../bin')];
  const files = roots.flatMap((root) => fs.readdirSync(root)
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => path.join(root, name)));
  return files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
}

function assertNoNonmechanicalParticipation(values) {
  const source = implementationSource();
  assert.equal(source.includes('https://github.com/example/vibery-shape-acceptance'), false);
  assert.equal(source.includes('@vibery/'), false);
  assert.doesNotMatch(source, /(?:workspace(?:s|Count)?\.length|package(?:s|Count)?\.length|count)\s*={2,3}\s*12|\btwelve\b/i);
  for (const label of VIBERY_GROUPS) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.doesNotMatch(source, new RegExp(`(?:={2,3}|!==|case\\s+)\\s*['\"]${escaped}['\"]`));
  }
  const imports = [...source.matchAll(/\bfrom\s+['\"]([^'\"]+)['\"]/g)].map((match) => match[1]);
  assert.equal(imports.some((specifier) => /(?:^|[/_-])(?:llm|openai|anthropic|deepseek|provider)(?:[/_.-]|$)/i.test(specifier)), false);
  const serialized = JSON.stringify(values);
  assert.doesNotMatch(serialized, /"(?:llm|model|prompt|completion|provider_result|provider_response)"\s*:/i);
}

test('real CLI projects the generic twelve-workspace fixture into twelve rooms and seven exact directions', () => {
  const fixture = createTwelveWorkspaceRepository({
    groups: VIBERY_GROUPS,
    repositoryName: 'vibery-shape-acceptance',
  });
  const values = parseRun(fixture);
  assertTwelveWorkspaceShape(values, VIBERY_GROUPS);
  assertNoNonmechanicalParticipation(values);
});

test('renaming every first-segment label preserves generic structural behavior', () => {
  const original = parseRun(createTwelveWorkspaceRepository({
    groups: VIBERY_GROUPS,
    repositoryName: 'vibery-shape-original',
  }));
  const renamed = parseRun(createTwelveWorkspaceRepository({
    groups: RENAMED_GROUPS,
    repositoryName: 'renamed-shape-copy',
  }));
  const originalShape = assertTwelveWorkspaceShape(original, VIBERY_GROUPS);
  const renamedShape = assertTwelveWorkspaceShape(renamed, RENAMED_GROUPS);
  assert.deepEqual(renamedShape, originalShape);
  assert.deepEqual(
    renamed.map.rooms.map(({ label }) => label).sort(),
    RENAMED_GROUPS.flatMap(expectedRoots).sort(),
  );
  assert.equal(renamed.map.rooms.some(({ label }) => VIBERY_GROUPS.includes(label)), false);
});
