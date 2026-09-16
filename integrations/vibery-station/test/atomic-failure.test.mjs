import assert from 'node:assert/strict';
import test from 'node:test';

export const ATOMIC_FAILURE_MATRIX = Object.freeze([
  'generation-file-write', 'generation-file-close', 'generation-file-fsync',
  'generation-directory-rename', 'generation-directory-fsync', 'final-path-recheck',
  'temporary-pointer-write', 'temporary-pointer-fsync', 'pointer-rename', 'bundle-root-fsync',
  'pointer-restoration', 'recovery-material-handling',
  'interrupt-before-pointer-rename', 'interrupt-after-pointer-rename', 'concurrent-once-resolved-reader',
  'no-prior-pointer-failure', 'malformed-path', 'aliased-path', 'symlinked-path', 'conflicting-path',
  'rollback-failure-retention', 'prior-generations-retained',
]);

test('RED: every immutable generation and CURRENT boundary has an executable failure row', () => {
  assert.fail(`RED: implement ${ATOMIC_FAILURE_MATRIX.length} atomic publication rows`);
});
