import assert from 'node:assert/strict';
import test from 'node:test';

export const GATE_TAMPER_MATRIX = Object.freeze([
  'evidence-schema', 'profile', 'contract-version', 'unknown-property',
  'repository-url', 'repository-revision', 'repository-tree', 'repository-object-format',
  'selected-file-omission', 'selected-file-invention',
  'manifest-oid', 'manifest-sha256', 'manifest-bytes', 'manifest-path', 'manifest-root', 'manifest-reference',
  'workspace-kind', 'workspace-patterns', 'workspace-membership',
  'package-name', 'package-private', 'package-root', 'dependency-name', 'dependency-scope',
  'project-id', 'evidence-id', 'room-id', 'relation-id', 'snapshot-id',
  'evidence-order', 'package-duplication', 'analysis-count',
  'room-structural-key', 'room-label', 'room-confidence', 'room-membership', 'room-evidence-set',
  'relation-endpoint', 'relation-direction', 'relation-scope', 'relation-evidence-set',
  'relation-omission', 'relation-invention', 'relation-self-loop',
  'evidence-hash', 'fallback-false-cause', 'fallback-omitted-cause', 'fallback-unknown-cause',
  'sixth-room', 'duplicate-room', 'omitted-room',
  'invalid-utf8', 'invalid-json', 'noncanonical-json', 'noncanonical-newline',
  'coherent-evidence-map-pair', 'false-detailed-to-coarse-downgrade',
]);

test('RED: every evidence and map claim has an executable independent tamper row', () => {
  assert.fail(`RED: implement ${GATE_TAMPER_MATRIX.length} gate tamper rows`);
});
