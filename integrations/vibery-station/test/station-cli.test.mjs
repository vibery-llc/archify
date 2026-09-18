import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { canonicalJsonBytes, sha256Hex } from '../lib/canonical-json.mjs';
import {
  STATION_CONTRACT_VERSION,
  STATION_LIMITS,
  STATION_PROFILE,
  validateStationExtractionReceipt,
} from '../lib/contracts.mjs';
import { createGitObjectReader } from '../lib/git-object-reader.mjs';
import { gateStationArtifacts } from '../lib/station-gate.mjs';
import { buildStationEvidence } from '../lib/node-workspace-evidence.mjs';
import { projectStationMap } from '../lib/station-projector.mjs';
import { createGitFixture } from './helpers/git-fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '../bin/station-map.mjs');

async function loadExtract() {
  try {
    return await import('../lib/extract.mjs');
  } catch (error) {
    assert.fail(`station extraction orchestrator must be importable: ${error.message}`);
  }
}

async function loadCli() {
  try {
    return await import('../bin/station-map.mjs');
  } catch (error) {
    assert.fail(`station integration CLI must be importable: ${error.message}`);
  }
}

function options(fixture, bundleRoot = path.join(os.tmpdir(), 'unused-station-bundle')) {
  return {
    command: 'extract',
    bundleRoot,
    repoRoot: fixture.root,
    repositoryUrl: fixture.repositoryUrl,
    revision: fixture.revision,
    json: true,
  };
}

function realPipelineSeams(order, publishGeneration = () => ({ generation_id: `generation-${'a'.repeat(64)}` })) {
  return {
    createReader(input) {
      order.push('reader');
      return createGitObjectReader(input);
    },
    buildEvidence(reader) {
      order.push('evidence');
      return buildStationEvidence(reader);
    },
    projectMap(value, bytes) {
      order.push('projector');
      return projectStationMap(value, bytes);
    },
    gateArtifacts(evidenceBytes, mapBytes, reader) {
      order.push('gate');
      return gateStationArtifacts(evidenceBytes, mapBytes, reader);
    },
    publishGeneration(candidate) {
      order.push('receipt');
      validateStationExtractionReceipt(JSON.parse(candidate.receiptBytes));
      order.push('publish');
      return publishGeneration(candidate);
    },
  };
}

test('parses only the exact integration-local extract contract', async () => {
  const { parseStationMapArguments } = await loadCli();
  const parsed = parseStationMapArguments([
    'extract', 'bundle', '--repo-root', 'repo', '--repository-url',
    'git@github.com:Example/Station-Reader.git', '--revision', 'A'.repeat(40), '--json',
  ]);
  assert.deepEqual(parsed, {
    command: 'extract',
    bundleRoot: 'bundle',
    repoRoot: 'repo',
    repositoryUrl: 'git@github.com:Example/Station-Reader.git',
    revision: 'A'.repeat(40),
    json: true,
  });

  for (const args of [
    [],
    ['render', 'bundle'],
    ['extract'],
    ['extract', 'one', 'two', '--repo-root', 'repo', '--repository-url', 'url', '--revision', 'a'.repeat(40)],
    ['extract', 'bundle', '--repo-root', 'repo', '--repo-root', 'again', '--repository-url', 'url', '--revision', 'a'.repeat(40)],
    ['extract', 'bundle', '--repo-root=repo', '--repository-url', 'url', '--revision', 'a'.repeat(40)],
    ['extract', 'bundle', '--repo-root', 'repo', '--repository-url', 'url', '--revision', 'a'.repeat(40), '--unknown'],
    ['extract', 'bundle', '--repo-root', '--repository-url', 'url', '--revision', 'a'.repeat(40)],
  ]) {
    assert.throws(() => parseStationMapArguments(args), (error) => {
      assert.equal(error.stationStage, 'arguments');
      assert.match(error.diagnostic.code, /^station-cli\//);
      return true;
    }, args.join(' '));
  }
});

test('runs reader, evidence, projector, independent gate, receipt, then publication exactly once', async () => {
  const { extractStationMap } = await loadExtract();
  const fixture = createGitFixture({
    files: {
      'package.json': JSON.stringify({ name: 'root', workspaces: ['apps/*', 'packages/*'] }),
      'apps/api/package.json': JSON.stringify({ name: 'api', dependencies: { core: 'workspace:*' } }),
      'packages/core/package.json': JSON.stringify({ name: 'core' }),
    },
  });
  const order = [];
  let published;
  const result = await extractStationMap(options(fixture), realPipelineSeams(order, (candidate) => {
    published = candidate;
    return { generation_id: `generation-${'b'.repeat(64)}` };
  }));

  assert.deepEqual(order, ['reader', 'evidence', 'projector', 'gate', 'receipt', 'publish']);
  assert.equal(result.publication.generation_id, `generation-${'b'.repeat(64)}`);
  assert.deepEqual(result.receiptBytes, published.receiptBytes);
  assert.deepEqual(result.receipt, JSON.parse(result.receiptBytes));
  assert.equal(published.readerSession.repository.revision, fixture.revision);
});

test('builds deterministic canonical receipt bytes solely from frozen gate success', async () => {
  const { buildStationReceipt, extractStationMap } = await loadExtract();
  const fixture = createGitFixture();
  const reader = createGitObjectReader(options(fixture));
  const evidence = buildStationEvidence(reader);
  const map = projectStationMap(evidence.value, evidence.bytes);
  const gated = gateStationArtifacts(evidence.bytes, map.bytes, reader);
  assert.equal(Object.isFrozen(gated), true);

  const left = buildStationReceipt(gated);
  const right = buildStationReceipt(gated);
  assert.deepEqual(left.bytes, right.bytes);
  assert.deepEqual(left.bytes, canonicalJsonBytes(left.value));
  validateStationExtractionReceipt(left.value);
  assert.deepEqual(left.value, {
    schema: 'station-extraction-receipt/v1',
    ok: true,
    command: 'station extract',
    repository: {
      url: gated.repository.url,
      revision: gated.repository.revision,
      tree_oid: gated.repository.tree_oid,
      object_format: gated.repository.object_format,
    },
    extractor: {
      profile: STATION_PROFILE,
      contract_version: STATION_CONTRACT_VERSION,
      limits: { ...STATION_LIMITS },
    },
    artifacts: {
      evidence: { file: 'station-evidence.json', sha256: gated.evidence_sha256, bytes: gated.evidence_bytes.length },
      map: { file: 'station-map.json', sha256: gated.map_sha256, bytes: gated.map_bytes.length },
    },
    result: {
      project_id: gated.project_id,
      snapshot_id: gated.snapshot_id,
      mode: gated.mode,
      rooms: gated.room_count,
      relations: gated.relation_count,
      fallback: gated.fallback,
      fallback_reason_codes: [...gated.fallback_reason_codes],
    },
    diagnostics: [],
  });
  assert.equal(sha256Hex(gated.evidence_bytes), left.value.artifacts.evidence.sha256);
  assert.equal(sha256Hex(gated.map_bytes), left.value.artifacts.map.sha256);
  assert.equal(Object.hasOwn(left.value.artifacts, 'receipt'), false);
  assert.doesNotMatch(left.bytes.toString('utf8'), /timestamp|duration|repoRoot|absolute|branch|process|hostname|runtime|git_version|stderr/i);
  assert.doesNotMatch(left.bytes.toString('utf8'), new RegExp(fixture.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const calls = [];
  await extractStationMap(options(fixture), realPipelineSeams(calls));
  assert.deepEqual(calls, ['reader', 'evidence', 'projector', 'gate', 'receipt', 'publish']);
});

test('admits canonical HTTPS, SSH, and SCP repository identities on arbitrary hosts end to end', async () => {
  const { extractStationMap } = await loadExtract();
  for (const repositoryUrl of [
    'https://git.example.test/Org/Repo.git',
    'ssh://git@git.example.test:2222/Org/Repo.git',
    'git@git.example.test:Org/Repo.git',
  ]) {
    const fixture = createGitFixture({ origin: repositoryUrl });
    fixture.repositoryUrl = repositoryUrl;
    let published;
    const result = await extractStationMap(options(fixture), realPipelineSeams([], (candidate) => {
      published = candidate;
      return { generation_id: `generation-${'c'.repeat(64)}` };
    }));
    const evidence = JSON.parse(published.evidenceBytes);
    const map = JSON.parse(published.mapBytes);
    assert.equal(evidence.repository.url, repositoryUrl);
    assert.equal(result.receipt.repository.url, repositoryUrl);
    assert.equal(map.project.id, evidence.repository.id);
    assert.equal(result.receipt.result.project_id, evidence.repository.id);
  }
});

test('classifies every pre-publication failure stage and never calls output', async () => {
  const { extractStationMap } = await loadExtract();
  const fixture = createGitFixture();
  const stages = [
    ['repository', 'createReader'],
    ['extraction', 'buildEvidence'],
    ['projector', 'projectMap'],
    ['gate', 'gateArtifacts'],
  ];
  for (const [stage, failingSeam] of stages) {
    let outputCalls = 0;
    const seams = realPipelineSeams([], () => { outputCalls += 1; });
    seams[failingSeam] = () => { throw new Error(`synthetic ${stage} failure`); };
    await assert.rejects(
      extractStationMap(options(fixture), seams),
      (error) => {
        assert.equal(error.stationStage, stage);
        assert.equal(error.diagnostic.severity, 'error');
        assert.doesNotMatch(JSON.stringify(error.diagnostic), /synthetic .* failure/);
        return true;
      },
    );
    assert.equal(outputCalls, 0, stage);
  }
});

test('integration CLI publishes one exact receipt and resolves its immutable generation', async () => {
  const fixture = createGitFixture();
  const bundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'station-cli-bundle-'));
  fs.rmdirSync(bundleRoot);
  const result = spawnSync(process.execPath, [
    CLI, 'extract', bundleRoot,
    '--repo-root', fixture.root,
    '--repository-url', fixture.repositoryUrl,
    '--revision', fixture.revision,
    '--json',
  ], { encoding: 'utf8', shell: false });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const receipt = JSON.parse(result.stdout);
  validateStationExtractionReceipt(receipt);
  const generationId = fs.readFileSync(path.join(bundleRoot, 'CURRENT'), 'utf8').trim();
  const generation = path.join(bundleRoot, 'generations', generationId);
  assert.deepEqual(fs.readFileSync(path.join(generation, 'station-receipt.json')), Buffer.from(result.stdout));
  const evidence = fs.readFileSync(path.join(generation, receipt.artifacts.evidence.file));
  const map = fs.readFileSync(path.join(generation, receipt.artifacts.map.file));
  assert.equal(receipt.artifacts.evidence.sha256, sha256Hex(evidence));
  assert.equal(receipt.artifacts.evidence.bytes, evidence.length);
  assert.equal(receipt.artifacts.map.sha256, sha256Hex(map));
  assert.equal(receipt.artifacts.map.bytes, map.length);
});

test('CLI discriminates committed recovery from indeterminate authority without hiding a committed replacement', async () => {
  const { runStationMap } = await loadCli();
  const fixture = createGitFixture();
  const args = [
    'extract', path.join(os.tmpdir(), 'unused-publication-state'),
    '--repo-root', fixture.root,
    '--repository-url', fixture.repositoryUrl,
    '--revision', fixture.revision,
    '--json',
  ];
  const originalWrite = process.stdout.write;
  try {
    for (const [publication, expectedStatus, expectedOk] of [[{
      state: 'committed-recovery-required', committed: true,
      generation_id: `generation-${'d'.repeat(64)}`, recovery_required: true,
      recovery_reasons: ['publication-lock-release-failed'],
    }, 0, true], [{
      state: 'authority-indeterminate', committed: null,
      generation_id: `generation-${'e'.repeat(64)}`, recovery_required: true,
      recovery_reasons: ['rename-authority-indeterminate'],
    }, 1, false]]) {
      let stdout = '';
      process.stdout.write = (chunk) => { stdout += chunk; return true; };
      const status = await runStationMap(args, realPipelineSeams([], () => publication));
      const envelope = JSON.parse(stdout);
      assert.equal(status, expectedStatus);
      assert.equal(envelope.ok, expectedOk);
      assert.equal(envelope.publication.state, publication.state);
      assert.equal(envelope.publication.committed, publication.committed);
      assert.equal(envelope.publication.generation_id, publication.generation_id);
      if (expectedOk) assert.equal(envelope.receipt.ok, true);
      else assert.equal(envelope.stage, 'publication');
    }
  } finally {
    process.stdout.write = originalWrite;
  }
});

test('repository failure emits one typed JSON envelope and leaves bundle untouched', async () => {
  const fixture = createGitFixture();
  const bundleRoot = path.join(os.tmpdir(), `station-cli-failure-${process.pid}-${Date.now()}`);
  const result = spawnSync(process.execPath, [
    CLI, 'extract', bundleRoot,
    '--repo-root', fixture.root,
    '--repository-url', fixture.repositoryUrl,
    '--revision', 'f'.repeat(40),
    '--json',
  ], { encoding: 'utf8', shell: false });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.stage, 'repository');
  assert.equal(envelope.diagnostics[0].code, 'station-extract/revision-unavailable');
  assert.equal(fs.existsSync(bundleRoot), false);
});

test('emits one parseable JSON failure envelope on stdout and no default Archify route', async () => {
  await loadCli();
  const result = spawnSync(process.execPath, [CLI, 'extract', 'bundle', '--repo-root', 'repo', '--repository-url', 'url', '--revision', 'bad', '--json', '--json'], {
    encoding: 'utf8',
    shell: false,
  });
  assert.equal(result.status, 2);
  assert.equal(result.stderr, '');
  const lines = result.stdout.trim().split('\n');
  const envelope = JSON.parse(result.stdout);
  assert.ok(lines.length >= 1);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.command, 'station extract');
  assert.equal(envelope.stage, 'arguments');
  assert.equal(envelope.diagnostics.length, 1);
  assert.equal(envelope.diagnostics[0].code, 'station-cli/repeated-option');

  const defaultCli = fs.readFileSync(path.resolve(HERE, '../../../archify/bin/archify.mjs'), 'utf8');
  assert.doesNotMatch(defaultCli, /station-map|vibery-station|station extract/);
});
