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

  it('wirft nicht bei Werten ohne code-Feld', () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
    expect(isForeignKeyViolation({ code: 23503 })).toBe(false);
  });
});
