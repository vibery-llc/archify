export const CANONICAL_ACCEPTANCE_REPOSITORY_URL = 'https://github.com/example/station-acceptance';

export const EQUIVALENT_REMOTE_SPELLINGS = Object.freeze([
  'https://github.com/Example/Station-Acceptance.git',
  'ssh://git@github.com/Example/Station-Acceptance.git',
  'git@github.com:Example/Station-Acceptance.git',
]);

function pending() {
  throw new Error('station acceptance fixture helper is not implemented');
}

export function createDeterminismRepository() {
  return pending();
}

export function cloneDeterminismRepository() {
  return pending();
}

export function captureRepositoryState() {
  return pending();
}

export function runStationAcceptance() {
  return pending();
}
