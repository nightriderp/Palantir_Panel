import { describe, expect, it } from 'vitest';
import {
  ERROR_CATALOG,
  ERROR_CODES,
  defaultMessageForErrorCode,
  httpStatusForErrorCode,
  isErrorCode,
} from './errors.js';

describe('Fehlercode-Katalog (Pflichtenheft §5.1)', () => {
  it('enthält den Startsatz aus dem Pflichtenheft', () => {
    expect(ERROR_CODES).toEqual(
      expect.arrayContaining([
        'AUTH_INVALID_CREDENTIALS',
        'RESOURCE_LIMIT_EXCEEDED',
        'SUBDOMAIN_TAKEN',
      ]),
    );
  });

  it('ordnet jedem Code einen gültigen HTTP-Status und eine Meldung zu', () => {
    for (const code of ERROR_CODES) {
      const status = httpStatusForErrorCode(code);
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
      expect(defaultMessageForErrorCode(code).length).toBeGreaterThan(0);
    }
  });

  it('hält die im Pflichtenheft genannten Codes auf ihrer Status-Zuordnung fest', () => {
    expect(httpStatusForErrorCode('AUTH_INVALID_CREDENTIALS')).toBe(401);
    expect(httpStatusForErrorCode('RESOURCE_LIMIT_EXCEEDED')).toBe(403);
    expect(httpStatusForErrorCode('SUBDOMAIN_TAKEN')).toBe(409);
  });

  it('nutzt durchgehend SCREAMING_SNAKE_CASE als Namensschema', () => {
    for (const code of ERROR_CODES) {
      expect(code).toMatch(/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/);
    }
  });

  it('enthält die Codes des Agent-Protokolls (Pflichtenheft §2.2)', () => {
    expect(httpStatusForErrorCode('AGENT_UNAUTHORIZED')).toBe(401);
    expect(httpStatusForErrorCode('AGENT_PROTOCOL_VERSION_MISMATCH')).toBe(400);
    expect(httpStatusForErrorCode('AGENT_COMMAND_INVALID')).toBe(400);
    expect(httpStatusForErrorCode('AGENT_COMMAND_FAILED')).toBe(500);
  });

  it('isErrorCode() erkennt unbekannte Codes', () => {
    expect(isErrorCode('SUBDOMAIN_TAKEN')).toBe(true);
    expect(isErrorCode('NICHT_IM_KATALOG')).toBe(false);
    expect(isErrorCode('toString')).toBe(false);
  });

  it('Katalog und Code-Liste bleiben deckungsgleich', () => {
    expect(ERROR_CODES.length).toBe(Object.keys(ERROR_CATALOG).length);
  });
});
