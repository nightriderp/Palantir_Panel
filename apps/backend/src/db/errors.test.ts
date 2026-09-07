import { describe, expect, it } from 'vitest';
import { isForeignKeyViolation, isUniqueViolation } from './errors.js';

/**
 * `pg` legt den SQLSTATE als `code`-Feld auf den geworfenen Fehler – hier
 * nachgebildet, damit die Erkennung ohne Datenbank prüfbar bleibt (CLAUDE.md §4).
 */
function pgFehler(code: string): Error {
  return Object.assign(new Error(`duplicate key value violates unique constraint`), { code });
}

describe('Erkennung von PostgreSQL-Fehlerklassen', () => {
  it('erkennt eine Unique-Verletzung (23505)', () => {
    expect(isUniqueViolation(pgFehler('23505'))).toBe(true);
    expect(isForeignKeyViolation(pgFehler('23505'))).toBe(false);
  });

  it('erkennt eine Fremdschlüssel-Verletzung (23503)', () => {
    expect(isForeignKeyViolation(pgFehler('23503'))).toBe(true);
    expect(isUniqueViolation(pgFehler('23503'))).toBe(false);
  });

  it('hält andere SQLSTATEs und fremde Fehler auseinander', () => {
    // 23514 ist eine Check-Verletzung: derselbe Zahlenraum, anderer Fall.
    expect(isUniqueViolation(pgFehler('23514'))).toBe(false);
    expect(isUniqueViolation(new Error('irgendwas'))).toBe(false);
    // Node-Fehler tragen ebenfalls ein `code`-Feld – es darf nie zutreffen.
    expect(isUniqueViolation(Object.assign(new Error('kein Zugriff'), { code: 'EACCES' }))).toBe(
      false,
    );
  });

  /*
   * Drizzle wirft nicht den Fehler von `pg`, sondern einen eigenen mit dem
   * Original an `cause`. Ohne diese Fälle war der Helfer gegen die Attrappe
   * grün und im Betrieb wirkungslos – aufgefallen erst durch die Vertrags-Suite
   * gegen das echte Repository (W3-12, test-gaps-07).
   */
  it('erkennt den SQLSTATE auch unter einer Hülle', () => {
    const eingehuellt = Object.assign(new Error('Failed query: insert into "users"'), {
      cause: pgFehler('23505'),
    });

    expect(isUniqueViolation(eingehuellt)).toBe(true);
    expect(isForeignKeyViolation(eingehuellt)).toBe(false);
  });

  it('läuft die Ursachenkette bis zum SQLSTATE ab', () => {
    const zweifach = Object.assign(new Error('äußere Hülle'), {
      cause: Object.assign(new Error('Failed query'), { cause: pgFehler('23503') }),
    });

    expect(isForeignKeyViolation(zweifach)).toBe(true);
  });

  it('bleibt bei einem Ringschluss in der Ursachenkette stehen', () => {
    const ring: { cause?: unknown } = {};
    ring.cause = ring;

    expect(isUniqueViolation(ring)).toBe(false);
  });

  it('nimmt den äußeren SQLSTATE, wenn es einen gibt', () => {
    const aussenNodeInnenPg = Object.assign(new Error('kein Zugriff'), {
      code: 'EACCES',
      cause: pgFehler('23505'),
    });

    // Der äußere Fehler ist der, den der Aufrufer bekommt - seine Aussage
    // zählt. Ein Node-Code wie EACCES ist keine Unique-Verletzung.
    expect(isUniqueViolation(aussenNodeInnenPg)).toBe(false);
  });

  it('wirft nicht bei Werten ohne code-Feld', () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
    expect(isForeignKeyViolation({ code: 23503 })).toBe(false);
  });
});
