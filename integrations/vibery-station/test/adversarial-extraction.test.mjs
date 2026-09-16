import assert from 'node:assert/strict';
import test from 'node:test';

export const ADVERSARIAL_EXTRACTION_MATRIX = Object.freeze([
  'replacement-commit', 'replacement-tree', 'replacement-blob',
  'branch-revision', 'tag-revision', 'abbreviated-revision', 'blob-revision', 'tree-revision',
  'missing-commit', 'missing-tree', 'missing-blob',
  'wrong-origin', 'missing-origin', 'credentialed-origin-redaction', 'non-top-level-root',
  'unsupported-object-format',
  'malformed-tree-protocol', 'incomplete-tree-protocol', 'tree-output-over-budget',
  'manifest-symlink', 'manifest-gitlink', 'manifest-binary-nul', 'manifest-invalid-utf8',
  'control-character-path', 'invalid-path-shape', 'case-collision', 'unicode-nfc-collision',
  'unsupported-glob', 'missing-root-manifest', 'malformed-manifest', 'oversized-manifest',
  'zero-workspace-matches', 'duplicate-package-identity', 'more-than-five-groups',
  'manifest-count-512', 'manifest-count-513',
  'manifest-bytes-1mib', 'manifest-bytes-1mib-plus-one',
  'selected-bytes-8mib', 'selected-bytes-8mib-plus-one',
  'object-unavailable', 'malformed-size-probe', 'probe-read-disagreement', 'process-output-overflow',
  'nul-safe-space-tab-newline-paths',
]);

test('RED: hostile extraction matrix is executable rather than declared coverage', () => {
  assert.fail(`RED: implement ${ADVERSARIAL_EXTRACTION_MATRIX.length} adversarial extraction rows`);
});
