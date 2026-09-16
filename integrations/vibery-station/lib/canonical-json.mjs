import { createHash } from 'node:crypto';

export const compareCodePoints = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function compareField(left, right, field) {
  return compareCodePoints(String(left?.[field] ?? ''), String(right?.[field] ?? ''));
}

function compareFields(left, right, fields) {
  for (const field of fields) {
    const comparison = compareField(left, right, field);
    if (comparison) return comparison;
  }
  return 0;
}

export const compareFiles = (left, right) => compareFields(left, right, ['path', 'git_oid']);
export const comparePackages = (left, right) => compareFields(left, right, ['root', 'name']);
export const compareDeclarations = (left, right) => {
  const byName = compareField(left, right, 'name');
  if (byName) return byName;
  const leftScope = left?.scope ?? (Array.isArray(left?.scopes) ? left.scopes.join('\u0000') : '');
  const rightScope = right?.scope ?? (Array.isArray(right?.scopes) ? right.scopes.join('\u0000') : '');
  return compareCodePoints(String(leftScope), String(rightScope));
};
export const compareRooms = (left, right) => compareField(left, right, 'id');
export const compareRelations = (left, right) => compareField(left, right, 'id');
export const compareEvidenceIds = (left, right) => compareCodePoints(
  String(typeof left === 'string' ? left : left?.id ?? ''),
  String(typeof right === 'string' ? right : right?.id ?? ''),
);
export const compareScopes = compareCodePoints;
export const compareFallbackCodes = compareCodePoints;

function fail(path, reason) {
  throw new TypeError(`Canonical JSON rejected ${path}: ${reason}.`);
}

function assertDataProperties(value, path, allowedKeys, nonEnumerableKeys = new Set()) {
  const symbols = Object.getOwnPropertySymbols(value);
  if (symbols.length) fail(path, 'symbol-keyed properties are outside the JSON domain');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!allowedKeys.has(key)) fail(`${path}/${key}`, 'non-JSON property');
    if (!Object.hasOwn(descriptor, 'value') || (!descriptor.enumerable && !nonEnumerableKeys.has(key))) {
      fail(`${path}/${key}`, 'accessor or non-enumerable property');
    }
  }
}

function canonical(value, path, ancestors) {
  if (value === null) return 'null';
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return JSON.stringify(value);
  if (type === 'number') {
    if (!Number.isFinite(value)) fail(path, 'non-finite number');
    return JSON.stringify(value);
  }
  if (type !== 'object') fail(path, `${type} value is outside the JSON domain`);
  if (ancestors.has(value)) fail(path, 'cycle');

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const allowedKeys = new Set(['length']);
      const entries = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) fail(`${path}/${index}`, 'sparse array slot');
        allowedKeys.add(String(index));
        entries.push(canonical(value[index], `${path}/${index}`, ancestors));
      }
      assertDataProperties(value, path, allowedKeys, new Set(['length']));
      return `[${entries.join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail(path, 'non-plain object');
    const keys = Object.keys(value).sort(compareCodePoints);
    assertDataProperties(value, path, new Set(keys));
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key], `${path}/${key}`, ancestors)}`).join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJsonText(value) {
  return `${canonical(value, '$', new Set())}\n`;
}

export function canonicalJsonBytes(value) {
  return Buffer.from(canonicalJsonText(value), 'utf8');
}

function exactBytes(value) {
  if (!(value instanceof Uint8Array)) throw new TypeError('SHA-256 input must be exact bytes.');
  return value;
}

export function sha256Bytes(value) {
  return createHash('sha256').update(exactBytes(value)).digest();
}

export function sha256Hex(value) {
  return createHash('sha256').update(exactBytes(value)).digest('hex');
}
