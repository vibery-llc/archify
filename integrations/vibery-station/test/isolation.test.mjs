import assert from 'node:assert/strict';
import test from 'node:test';

export const ISOLATION_MATRIX = Object.freeze([
  'successful-extraction-under-no-network-preload',
  'failing-extraction-under-no-network-preload',
  'runtime-import-allowlist', 'git-command-allowlist',
  'no-update-check', 'no-brand-capture', 'no-preview', 'no-visual-check',
  'no-renderer', 'no-viewer', 'no-provider-sdk', 'no-telemetry',
  'no-fetch-http-https-net-dns', 'no-shell-command', 'no-package-manager', 'no-remote-git',
  'dependency-free-package', 'no-install-hooks', 'no-host-registration', 'no-default-root-mutation',
  'default-help-has-no-station-route', 'default-cli-smoke',
  'baseline-core-tree-unchanged', 'archive-sha256-unchanged',
]);

test('RED: isolation and unchanged-default matrix is executable', () => {
  assert.fail(`RED: implement ${ISOLATION_MATRIX.length} isolation rows`);
});
