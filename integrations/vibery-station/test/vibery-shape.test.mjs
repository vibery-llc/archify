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

function assertTwelveWorkspaceShape(values, groups) {
  const { evidence, map, receipt } = values;
  assert.equal(evidence.workspace.package_roots.length, 12);
  assert.deepEqual(evidence.workspace.package_roots, groups.flatMap(expectedRoots).sort());
  assert.equal(map.snapshot.mode, 'structural');
  assert.equal(map.fallback.used, false);
  assert.deepEqual(map.fallback.reason_codes, []);
  assert.equal(map.rooms.length, 4);
  assert.equal(map.relations.length, 3);
  assert.equal(receipt.result.rooms, 4);
  assert.equal(receipt.result.relations, 3);

  const rooms = roomIndex(map);
  assert.deepEqual([...rooms.keys()].sort(), [...groups].sort());
  for (const group of groups) {
    const room = rooms.get(group);
    assert.equal(room.structural_key, `workspace-path-group:${group}`);
    assert.deepEqual(room.package_roots, expectedRoots(group));
    assert.equal(room.confidence, 'high');
  }
  assert.deepEqual(map.rooms.flatMap(({ package_roots: roots }) => roots).sort(), evidence.workspace.package_roots);

  const directions = relationByDirection(map);
  const expectedDirections = groups.slice(0, 3).map((group) => `${group} -> ${groups[3]}`).sort();
  assert.deepEqual([...directions.keys()].sort(), expectedDirections);
  const expectedRelations = [
    {
      direction: expectedDirections.find((value) => value.startsWith(`${groups[0]} ->`)),
      scopes: ['dependencies', 'optionalDependencies'],
      evidenceRoots: [`${groups[0]}/alpha`, `${groups[0]}/beta`],
    },
    {
      direction: expectedDirections.find((value) => value.startsWith(`${groups[1]} ->`)),
      scopes: ['devDependencies', 'peerDependencies'],
      evidenceRoots: [`${groups[1]}/alpha`, `${groups[1]}/beta`],
    },
    {
      direction: expectedDirections.find((value) => value.startsWith(`${groups[2]} ->`)),
      scopes: ['dependencies', 'peerDependencies'],
      evidenceRoots: [`${groups[2]}/alpha`],
    },
  ];
  for (const expected of expectedRelations) {
    const relation = directions.get(expected.direction);
    assert.ok(relation, expected.direction);
    assert.deepEqual(relation.scopes, expected.scopes);
    assert.deepEqual(relation.evidence_ids, evidenceIdsForRoots(evidence, expected.evidenceRoots));
    assert.equal(relation.id, deriveRelationId(relation.from_room_id, relation.to_room_id));
    assert.notEqual(relation.from_room_id, relation.to_room_id);
  }
  const packageRoom = rooms.get(groups[3]);
  assert.equal(map.relations.some(({ from_room_id, to_room_id }) => (
    from_room_id === packageRoom.id && to_room_id === packageRoom.id
  )), false, 'same-room declaration became a topology self-loop');
  return {
    memberCounts: map.rooms.map(({ package_roots }) => package_roots.length).sort(),
    relationScopes: [...directions.values()].map(({ scopes }) => scopes).sort((left, right) => left.join().localeCompare(right.join())),
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

test('real CLI projects the generic twelve-workspace fixture into four rooms and three exact directions', () => {
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
  assert.deepEqual(renamed.map.rooms.map(({ label }) => label).sort(), [...RENAMED_GROUPS].sort());
  assert.equal(renamed.map.rooms.some(({ label }) => VIBERY_GROUPS.includes(label)), false);
});
