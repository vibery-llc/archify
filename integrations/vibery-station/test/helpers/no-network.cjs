'use strict';

const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const moduleBuiltin = require('node:module');

const BLOCK_CODE = 'STATION_TEST_FORBIDDEN_RUNTIME_PATH';

function blocked(name) {
  return function stationForbiddenRuntimePrimitive() {
    const error = new Error(`Station isolation preload blocked ${name}`);
    error.code = BLOCK_CODE;
    error.primitive = name;
    throw error;
  };
}

function patch(object, names, prefix) {
  for (const name of names) {
    if (typeof object?.[name] === 'function') object[name] = blocked(`${prefix}.${name}`);
  }
}

for (const [specifier, names] of [
  ['node:http', ['request', 'get', 'createServer']],
  ['node:https', ['request', 'get', 'createServer']],
  ['node:http2', ['connect', 'createServer', 'createSecureServer']],
  ['node:net', ['connect', 'createConnection', 'createServer']],
  ['node:tls', ['connect', 'createServer']],
  ['node:dgram', ['createSocket']],
  ['node:dns', ['lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse']],
]) {
  try { patch(require(specifier), names, specifier); } catch { /* unavailable built-in on this Node */ }
}

try {
  const dnsPromises = require('node:dns').promises;
  patch(dnsPromises, Object.keys(dnsPromises).filter((name) => typeof dnsPromises[name] === 'function'), 'node:dns.promises');
} catch { /* no promise DNS surface */ }

for (const name of ['fetch', 'WebSocket', 'EventSource']) {
  if (typeof globalThis[name] === 'function') globalThis[name] = blocked(`globalThis.${name}`);
}

const originalSpawnSync = childProcess.spawnSync;
const originalSpawn = childProcess.spawn;
const originalExecFileSync = childProcess.execFileSync;
const originalExecFile = childProcess.execFile;

function isGit(command) {
  return typeof command === 'string' && path.basename(command).toLowerCase() === (process.platform === 'win32' ? 'git.exe' : 'git');
}

function audit(method, command, args, options) {
  if (!process.env.STATION_PRELOAD_AUDIT) return;
  fs.appendFileSync(process.env.STATION_PRELOAD_AUDIT, `${JSON.stringify({
    method,
    command,
    args: Array.isArray(args) ? args : [],
    shell: options?.shell ?? false,
  })}\n`, { encoding: 'utf8' });
}

childProcess.spawnSync = function guardedSpawnSync(command, args, options) {
  if (!isGit(command)) return blocked(`node:child_process.spawnSync:${String(command)}`)();
  audit('spawnSync', command, args, options);
  return originalSpawnSync.call(this, command, args, options);
};
childProcess.spawn = function guardedSpawn(command, args, options) {
  if (!isGit(command)) return blocked(`node:child_process.spawn:${String(command)}`)();
  audit('spawn', command, args, options);
  return originalSpawn.call(this, command, args, options);
};
childProcess.execFileSync = function guardedExecFileSync(command, args, options) {
  if (!isGit(command)) return blocked(`node:child_process.execFileSync:${String(command)}`)();
  audit('execFileSync', command, args, options);
  return originalExecFileSync.call(this, command, args, options);
};
childProcess.execFile = function guardedExecFile(command, args, options, callback) {
  if (!isGit(command)) return blocked(`node:child_process.execFile:${String(command)}`)();
  audit('execFile', command, args, options);
  return originalExecFile.call(this, command, args, options, callback);
};
patch(childProcess, ['exec', 'execSync', 'fork'], 'node:child_process');

moduleBuiltin.syncBuiltinESMExports();
