import {
  STATION_CONTRACT_VERSION,
  STATION_LIMITS,
  STATION_PROFILE,
  STATION_SCHEMAS,
  validateStationExtractionReceipt,
} from './contracts.mjs';
import { canonicalJsonBytes } from './canonical-json.mjs';
import { createStationDiagnostic, StationDiagnosticError } from './diagnostics.mjs';
import { createGitObjectReader } from './git-object-reader.mjs';
import { buildStationEvidence } from './node-workspace-evidence.mjs';
import { projectStationMap } from './station-projector.mjs';
import { gateStationArtifacts } from './station-gate.mjs';

function stageError(stage, error) {
  if (error?.stationStage) return error;
  const diagnostic = error instanceof StationDiagnosticError
    ? error.diagnostic
    : createStationDiagnostic({
      code: `station-${stage}/failed`,
      severity: 'error',
      message: `Station ${stage} failed before publication.`,
      subject: { stage },
      supportedFixes: ['correct the typed failure and retry the immutable extraction'],
    });
  const staged = new StationDiagnosticError(diagnostic);
  staged.stationStage = stage;
  return staged;
}

async function atStage(stage, operation) {
  try {
    return await operation();
  } catch (error) {
    throw stageError(stage, error);
  }
}

function assertFrozenGateResult(result) {
  if (!result || !Object.isFrozen(result) || !Object.isFrozen(result.repository)
      || !Object.isFrozen(result.fallback_reason_codes)) {
    throw new TypeError('Receipt construction requires the frozen independent gate result.');
  }
}

export function buildStationReceipt(gateResult) {
  assertFrozenGateResult(gateResult);
  const evidenceBytes = gateResult.evidence_bytes;
  const mapBytes = gateResult.map_bytes;
  const value = {
    schema: STATION_SCHEMAS.receipt,
    ok: true,
    command: 'station extract',
    repository: {
      url: gateResult.repository.url,
      revision: gateResult.repository.revision,
      tree_oid: gateResult.repository.tree_oid,
      object_format: gateResult.repository.object_format,
    },
    extractor: {
      profile: STATION_PROFILE,
      contract_version: STATION_CONTRACT_VERSION,
      limits: { ...STATION_LIMITS },
    },
    artifacts: {
      evidence: {
        file: 'station-evidence.json',
        sha256: gateResult.evidence_sha256,
        bytes: evidenceBytes.length,
      },
      map: {
        file: 'station-map.json',
        sha256: gateResult.map_sha256,
        bytes: mapBytes.length,
      },
    },
    result: {
      project_id: gateResult.project_id,
      snapshot_id: gateResult.snapshot_id,
      mode: gateResult.mode,
      rooms: gateResult.room_count,
      relations: gateResult.relation_count,
      fallback: gateResult.fallback,
      fallback_reason_codes: [...gateResult.fallback_reason_codes],
    },
    diagnostics: [],
  };
  validateStationExtractionReceipt(value);
  return Object.freeze({ value: Object.freeze(value), bytes: canonicalJsonBytes(value) });
}

const DEFAULT_SEAMS = Object.freeze({
  createReader: createGitObjectReader,
  buildEvidence: buildStationEvidence,
  projectMap: projectStationMap,
  gateArtifacts: gateStationArtifacts,
  async publishGeneration(candidate) {
    const { publishStationGeneration } = await import('./station-output.mjs');
    return publishStationGeneration(candidate);
  },
});

export async function extractStationMap(options, seams = {}) {
  const runtime = { ...DEFAULT_SEAMS, ...seams };
  const readerSession = await atStage('repository', () => runtime.createReader({
    repoRoot: options.repoRoot,
    repositoryUrl: options.repositoryUrl,
    revision: options.revision,
  }));
  const evidence = await atStage('extraction', () => runtime.buildEvidence(readerSession));
  const map = await atStage('projector', () => runtime.projectMap(evidence.value, evidence.bytes));
  const gateResult = await atStage('gate', () => runtime.gateArtifacts(
    evidence.bytes,
    map.bytes,
    readerSession,
  ));
  const receipt = await atStage('gate', () => buildStationReceipt(gateResult));
  const publication = await atStage('publication', () => runtime.publishGeneration({
    bundleRoot: options.bundleRoot,
    evidenceBytes: gateResult.evidence_bytes,
    mapBytes: gateResult.map_bytes,
    receiptBytes: receipt.bytes,
    readerSession,
    protectedPaths: [options.repoRoot],
  }));
  return Object.freeze({
    receipt: receipt.value,
    receiptBytes: Buffer.from(receipt.bytes),
    publication,
  });
}
