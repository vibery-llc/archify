#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { createStationDiagnostic, StationDiagnosticError } from '../lib/diagnostics.mjs';
import { extractStationMap } from '../lib/extract.mjs';

const VALUE_OPTIONS = new Map([
  ['--repo-root', 'repoRoot'],
  ['--repository-url', 'repositoryUrl'],
  ['--revision', 'revision'],
]);

function argumentFailure(code, message, subject = {}) {
  const error = new StationDiagnosticError(createStationDiagnostic({
    code,
    severity: 'error',
    message,
    subject,
    supportedFixes: [
      'use: station-map extract <bundle-root> --repo-root <path> --repository-url <url> --revision <40-hex> --json',
    ],
  }));
  error.stationStage = 'arguments';
  throw error;
}

export function parseStationMapArguments(argv) {
  if (!Array.isArray(argv) || argv[0] !== 'extract') {
    argumentFailure('station-cli/usage', 'The integration CLI supports only the extract command.');
  }
  const positional = [];
  const values = {};
  const seen = new Set();
  let json = false;
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      if (seen.has(argument)) argumentFailure('station-cli/repeated-option', 'Option --json may be supplied only once.', { option: argument });
      seen.add(argument);
      json = true;
      continue;
    }
    if (argument.startsWith('--')) {
      if (!VALUE_OPTIONS.has(argument)) {
        argumentFailure('station-cli/unknown-option', `Unknown Station extraction option ${argument}.`, { option: argument });
      }
      if (seen.has(argument)) argumentFailure('station-cli/repeated-option', `Option ${argument} may be supplied only once.`, { option: argument });
      seen.add(argument);
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        argumentFailure('station-cli/missing-option-value', `Option ${argument} requires one value.`, { option: argument });
      }
      values[VALUE_OPTIONS.get(argument)] = value;
      index += 1;
      continue;
    }
    positional.push(argument);
  }
  if (positional.length !== 1) {
    argumentFailure('station-cli/positionals', 'Extract requires exactly one bundle root.', { count: positional.length });
  }
  for (const [option, field] of VALUE_OPTIONS) {
    if (!Object.hasOwn(values, field)) {
      argumentFailure('station-cli/missing-option', `Required option ${option} is missing.`, { option });
    }
  }
  return {
    command: 'extract',
    bundleRoot: positional[0],
    repoRoot: values.repoRoot,
    repositoryUrl: values.repositoryUrl,
    revision: values.revision,
    json,
  };
}

function failureEnvelope(error) {
  const diagnostic = error?.diagnostic || createStationDiagnostic({
    code: 'station-internal/unclassified',
    severity: 'error',
    message: 'Station extraction failed without a typed diagnostic.',
    subject: { stage: 'internal' },
    supportedFixes: ['retry after correcting the integration failure'],
  });
  return {
    ok: false,
    command: 'station extract',
    stage: error?.stationStage || 'internal',
    diagnostics: [diagnostic],
  };
}

export async function runStationMap(argv = process.argv.slice(2), seams) {
  const jsonRequested = argv.includes('--json');
  try {
    const options = parseStationMapArguments(argv);
    const result = await extractStationMap(options, seams);
    if (options.json) process.stdout.write(result.receiptBytes);
    else process.stderr.write(`station extract committed ${result.publication.generation_id}\n`);
    return 0;
  } catch (error) {
    const envelope = failureEnvelope(error);
    if (jsonRequested) process.stdout.write(`${JSON.stringify(envelope)}\n`);
    else process.stderr.write(`[${envelope.diagnostics[0].code}] ${envelope.diagnostics[0].message}\n`);
    return error?.stationStage === 'arguments' ? 2 : 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) {
  process.exitCode = await runStationMap();
}
