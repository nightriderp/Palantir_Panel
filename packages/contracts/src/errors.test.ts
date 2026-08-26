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

  it('enthält die Codes der Server-Orchestrierung (B3, Pflichtenheft §9, §11, §13)', () => {
    expect(httpStatusForErrorCode('SERVER_NOT_FOUND')).toBe(404);
    expect(httpStatusForErrorCode('SERVER_STATE_CONFLICT')).toBe(409);
    expect(httpStatusForErrorCode('SERVER_CRASH_LOOP')).toBe(409);
    expect(httpStatusForErrorCode('SERVER_HEALTH_CHECK_FAILED')).toBe(504);
    expect(httpStatusForErrorCode('GAME_TYPE_NOT_FOUND')).toBe(404);
    expect(httpStatusForErrorCode('GAME_TYPE_NOT_AVAILABLE')).toBe(409);
    expect(httpStatusForErrorCode('SUBDOMAIN_INVALID')).toBe(400);
    expect(httpStatusForErrorCode('DNS_UPDATE_FAILED')).toBe(502);
    expect(httpStatusForErrorCode('AGENT_NOT_CONNECTED')).toBe(503);
    expect(httpStatusForErrorCode('AGENT_COMMAND_TIMEOUT')).toBe(504);
  });

  it('trennt die beiden Owner-Faelle (Lastenheft §2, Pflichtenheft §12.3)', () => {
    // OWNER_PROTECTED wehrt Aktionen gegen den bestehenden Owner ab;
    // OWNER_ALREADY_EXISTS die Vergabe des Status an ein zweites Konto.
    expect(httpStatusForErrorCode('OWNER_PROTECTED')).toBe(403);
    expect(httpStatusForErrorCode('OWNER_ALREADY_EXISTS')).toBe(409);
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
