function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

export function createStationDiagnostic(diagnostic = {}) {
  return {
    code: String(diagnostic.code || 'station-internal/unclassified'),
    severity: diagnostic.severity === 'warning' ? 'warning' : 'error',
    message: String(diagnostic.message || 'Station could not classify this failure.').trim(),
    subject: plainObject(diagnostic.subject),
    evidence: plainObject(diagnostic.evidence),
    supportedFixes: Array.isArray(diagnostic.supportedFixes)
      ? [...new Set(diagnostic.supportedFixes.map((fix) => String(fix).trim()).filter(Boolean))]
      : [],
  };
}

export class StationDiagnosticError extends Error {
  constructor(diagnostic) {
    const normalized = createStationDiagnostic(diagnostic);
    super(normalized.message);
    this.name = 'StationDiagnosticError';
    this.code = normalized.code;
    this.diagnostic = normalized;
  }
}

export function throwStationDiagnostic(diagnostic) {
  throw new StationDiagnosticError(diagnostic);
}
