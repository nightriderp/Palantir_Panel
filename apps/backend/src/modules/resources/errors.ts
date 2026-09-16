/**
 * Fehler des Ressourcen-Moduls.
 *
 * Jeder Fehler trägt einen benannten Code aus dem Katalog in
 * `@palantir/contracts` – kein Freitext (Entwicklungsregeln §5). Aufbau bewusst identisch
 * zu `RbacError` (B2), damit Routen beide gleich behandeln können.
 */

import {
  type CapacityViolation,
  type ErrorCode,
  type ResourceUnit,
  defaultMessageForErrorCode,
} from '@palantir/contracts';
import { AppError } from '../../lib/app-error.js';

/** Einheit für die Meldung ausschreiben. */
function formatAmount(value: number, unit: ResourceUnit): string {
  switch (unit) {
    case 'mb':
      return `${value} MiB`;
    case 'count':
      return `${value}`;
  }
}

/**
 * Betreff einer Feststellung – je Herkunft (`scope`) eine eigene Sprache.
 *
 * `node` und `nodeMeasured` auseinanderzuhalten ist keine Wortklauberei: Die
 * eine Zahl ist gebucht, die andere gemessen. Wer liest „der freie
 * Arbeitsspeicher der Node reicht nicht", während `htop` 8 GiB frei zeigt,
 * sucht den Fehler an der falschen Stelle.
 */
function describeSubject(violation: CapacityViolation): string {
  switch (violation.scope) {
    case 'user':
      return {
        ram: 'Das RAM-Kontingent des Nutzers',
        disk: 'Das Speicher-Kontingent des Nutzers',
        servers: 'Die zulässige Anzahl gleichzeitig laufender Server',
      }[violation.resource];
    case 'node':
      return {
        ram: 'Der zugewiesene Arbeitsspeicher der Node',
        disk: 'Der zugewiesene Speicherplatz der Node',
        servers: 'Die Serverkapazität der Node',
      }[violation.resource];
    case 'nodeMeasured':
      return {
        ram: 'Der gemessene freie Arbeitsspeicher der Node',
        disk: 'Der gemessene freie Speicherplatz der Node',
        servers: 'Die gemessene Serverkapazität der Node',
      }[violation.resource];
  }
}

function describeViolation(violation: CapacityViolation): string {
  const { limit, requested, unit, used } = violation;

  return (
    `${describeSubject(violation)} reicht nicht: belegt ${formatAmount(used, unit)} ` +
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

export class ResourceError extends AppError {
  /** Bei `RESOURCE_LIMIT_EXCEEDED` die überschrittenen Grenzen, sonst leer. */
  readonly violations: readonly CapacityViolation[];

  constructor(code: ErrorCode, message?: string, violations: readonly CapacityViolation[] = []) {
    super(code, message);
    this.name = 'ResourceError';
    this.violations = violations;
  }

  /** Ablehnung wegen überschrittener Grenzen (Pflichtenheft §10). */
  static limitExceeded(violations: readonly CapacityViolation[]): ResourceError {
    return new ResourceError('RESOURCE_LIMIT_EXCEEDED', describeViolations(violations), violations);
  }

  /**
   * Rückfrage statt Ablehnung: Die Node hat wenig frei, verboten ist der Start
   * aber nicht (siehe `RESOURCE_CONFIRMATION_REQUIRED`).
   *
   * Die Meldung nennt die Zahlen – sie geht ins Log und in die Antwort; die
   * Oberfläche übersetzt wie überall über den **Code**, nicht über diesen
   * Freitext (Pflichtenheft §5.1).
   */
  static confirmationRequired(concerns: readonly CapacityViolation[]): ResourceError {
    return new ResourceError(
      'RESOURCE_CONFIRMATION_REQUIRED',
      describeViolations(concerns),
      concerns,
    );
  }
}

export function isResourceError(error: unknown): error is ResourceError {
  return error instanceof ResourceError;
}
