/**
 * Fehler des Ressourcen-Moduls.
 *
 * Jeder Fehler trägt einen benannten Code aus dem Katalog in
 * `@palantir/contracts` – kein Freitext (CLAUDE.md §5). Aufbau bewusst identisch
 * zu `RbacError` (B2), damit Routen beide gleich behandeln können.
 */

import {
  type CapacityViolation,
  type ErrorCode,
  type ResourceUnit,
  defaultMessageForErrorCode,
} from '@palantir/contracts';

/** Einheit für die Meldung ausschreiben. */
function formatAmount(value: number, unit: ResourceUnit): string {
  switch (unit) {
    case 'mb':
      return `${value} MiB`;
    case 'cores':
      return `${value} CPU-Kerne`;
    case 'count':
      return `${value}`;
  }
}

function describeViolation(violation: CapacityViolation): string {
  const { limit, requested, unit, used } = violation;
  const subject =
    violation.scope === 'user'
      ? {
          ram: 'Das RAM-Kontingent des Nutzers',
          cpu: 'Das CPU-Kontingent des Nutzers',
          disk: 'Das Speicher-Kontingent des Nutzers',
          servers: 'Die zulässige Anzahl gleichzeitig laufender Server',
        }[violation.resource]
      : {
          ram: 'Der freie Arbeitsspeicher der Node',
          cpu: 'Die freie CPU-Kapazität der Node',
          disk: 'Der freie Speicherplatz der Node',
          servers: 'Die Serverkapazität der Node',
        }[violation.resource];

  return (
    `${subject} reicht nicht: belegt ${formatAmount(used, unit)} ` +
    `+ angefordert ${formatAmount(requested, unit)} ` +
    `> Grenze ${formatAmount(limit, unit)}.`
  );
}

/**
 * Meldung zu einer Menge überschrittener Grenzen.
 *
 * Es werden bewusst **alle** Verletzungen genannt und nicht nur die erste: wer
 * ein Kontingent anpasst, soll nicht nach jeder Änderung erneut in dieselbe
 * Ablehnung laufen.
 */
export function describeViolations(violations: readonly CapacityViolation[]): string {
  if (violations.length === 0) {
    return defaultMessageForErrorCode('RESOURCE_LIMIT_EXCEEDED');
  }

  return violations.map(describeViolation).join(' ');
}

export class ResourceError extends Error {
  readonly code: ErrorCode;
  /** Bei `RESOURCE_LIMIT_EXCEEDED` die überschrittenen Grenzen, sonst leer. */
  readonly violations: readonly CapacityViolation[];

  constructor(code: ErrorCode, message?: string, violations: readonly CapacityViolation[] = []) {
    super(message ?? defaultMessageForErrorCode(code));
    this.name = 'ResourceError';
    this.code = code;
    this.violations = violations;
  }

  /** Ablehnung wegen überschrittener Grenzen (Pflichtenheft §10). */
  static limitExceeded(violations: readonly CapacityViolation[]): ResourceError {
    return new ResourceError('RESOURCE_LIMIT_EXCEEDED', describeViolations(violations), violations);
  }
}

export function isResourceError(error: unknown): error is ResourceError {
  return error instanceof ResourceError;
}
