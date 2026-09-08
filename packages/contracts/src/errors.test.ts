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
    expect(httpStatusForErrorCode('NODE_UNAVAILABLE')).toBe(409);
    expect(httpStatusForErrorCode('SERVER_HEALTH_CHECK_FAILED')).toBe(504);
    expect(httpStatusForErrorCode('GAME_TYPE_NOT_FOUND')).toBe(404);
    expect(httpStatusForErrorCode('GAME_TYPE_NOT_AVAILABLE')).toBe(409);
    expect(httpStatusForErrorCode('SUBDOMAIN_INVALID')).toBe(400);
    expect(httpStatusForErrorCode('DNS_UPDATE_FAILED')).toBe(502);
    expect(httpStatusForErrorCode('AGENT_NOT_CONNECTED')).toBe(503);
    expect(httpStatusForErrorCode('AGENT_COMMAND_TIMEOUT')).toBe(504);
  });

  it('kennt den Datei-Upload-Konflikt des Datei-Managers (WELLE 0, P2)', () => {
    // FILE_UPLOAD ohne overwrite auf einen belegten Pfad – Konflikt, kein
    // ungültiger Pfad.
    expect(httpStatusForErrorCode('AGENT_FILE_EXISTS')).toBe(409);
  });

  it('trennt die beiden Owner-Faelle (Lastenheft §2, Pflichtenheft §12.3)', () => {
    // OWNER_PROTECTED wehrt Aktionen gegen den bestehenden Owner ab;
    // OWNER_ALREADY_EXISTS die Vergabe des Status an ein zweites Konto.
    expect(httpStatusForErrorCode('OWNER_PROTECTED')).toBe(403);
    expect(httpStatusForErrorCode('OWNER_ALREADY_EXISTS')).toBe(409);
  });

  it('kennt die Selbst-Löschung mit eigenen Servern (Audit backend-db-05)', () => {
    // Konflikt mit vorhandenem Zustand, kein roher Datenbankfehler: erst die
    // eigenen Server löschen, dann das Konto.
    expect(httpStatusForErrorCode('ACCOUNT_HAS_SERVERS')).toBe(409);
    expect(defaultMessageForErrorCode('ACCOUNT_HAS_SERVERS')).toContain('Gameserver');
  });

  it('trennt ungültigen von unerfüllbarem Cron-Ausdruck (Audit bb-14)', () => {
    // Beide 400 – der eine Ausdruck ist unlesbar, der andere lesbar, aber nie
    // erfüllbar (z. B. 30. Februar).
    expect(httpStatusForErrorCode('SCHEDULE_INVALID_CRON')).toBe(400);
    expect(httpStatusForErrorCode('SCHEDULE_UNSATISFIABLE')).toBe(400);
    expect(defaultMessageForErrorCode('SCHEDULE_UNSATISFIABLE')).not.toBe(
      defaultMessageForErrorCode('SCHEDULE_INVALID_CRON'),
    );
  });

  /**
   * Contracts-Nachzug W2-C2: Die Codes, die in den Audit-Wellen 2 und 3
   * fehlten und dort ersatzweise auf fremde Einträge abgebildet wurden.
   * Geprüft wird beides – der Status und die Abgrenzung zu dem Code, den die
   * jeweilige Stelle vorher mitbenutzt hat.
   */
  describe('Nachgezogene Codes (Audit-Wellen 2 und 3)', () => {
    it('trennt den laufenden Archivlauf vom gescheiterten (W2-16)', () => {
      // 409 statt 500: Es ist nichts kaputt, der Aufruf ist wiederholbar.
      expect(httpStatusForErrorCode('AUDIT_ARCHIVE_ALREADY_RUNNING')).toBe(409);
      expect(httpStatusForErrorCode('AUDIT_ARCHIVE_FAILED')).toBe(500);
    });

    it('trennt die mehrdeutige Kennung von der fehlenden Übersicht (W2-7)', () => {
      // Beide 409, aber mit unterschiedlichem Grund – deshalb zwei Codes und
      // zwei Meldungen.
      expect(httpStatusForErrorCode('STORAGE_ENTRY_AMBIGUOUS')).toBe(409);
      expect(defaultMessageForErrorCode('STORAGE_ENTRY_AMBIGUOUS')).not.toBe(
        defaultMessageForErrorCode('STORAGE_SCAN_MISSING'),
      );
    });

    it('trennt die Archiv-Grenze von der Datei-Grenze (W2-13)', () => {
      // Beide 413, aber der Nutzer räumt anders auf: kleinere Datei wählen
      // gegen Archiv aufteilen.
      expect(httpStatusForErrorCode('AGENT_ARCHIVE_TOO_LARGE')).toBe(413);
      expect(defaultMessageForErrorCode('AGENT_ARCHIVE_TOO_LARGE')).toContain('Archiv');
      expect(defaultMessageForErrorCode('AGENT_ARCHIVE_TOO_LARGE')).not.toBe(
        defaultMessageForErrorCode('AGENT_FILE_TOO_LARGE'),
      );
      // Nicht zu verwechseln mit dem unlesbaren Archiv (422).
      expect(httpStatusForErrorCode('AGENT_ARCHIVE_INVALID')).toBe(422);
    });

    it('trennt Sicherungen von Servern bei der Konto-Löschung (W2-11)', () => {
      expect(httpStatusForErrorCode('ACCOUNT_HAS_BACKUPS')).toBe(409);
      expect(defaultMessageForErrorCode('ACCOUNT_HAS_BACKUPS')).toContain('Sicherungen');
      expect(defaultMessageForErrorCode('ACCOUNT_HAS_BACKUPS')).not.toBe(
        defaultMessageForErrorCode('ACCOUNT_HAS_SERVERS'),
      );
    });

    it('führt die drei Protokoll-Fälle des Fehler-Handlers (W2-9)', () => {
      // Status und Code stimmen jetzt überein; vorher stand über allen dreien
      // `VALIDATION_FAILED`, dessen Katalog-Status 400 ist.
      expect(httpStatusForErrorCode('NOT_FOUND')).toBe(404);
      expect(httpStatusForErrorCode('METHOD_NOT_ALLOWED')).toBe(405);
      expect(httpStatusForErrorCode('UNSUPPORTED_MEDIA_TYPE')).toBe(415);
      expect(httpStatusForErrorCode('VALIDATION_FAILED')).toBe(400);
    });

    it('trennt die Missbrauchsgrenze des Kontos vom Anmelde-Limit (W2-3)', () => {
      // Beide 429; die Oberfläche darf `AUTH_RATE_LIMITED` als „warte vor dem
      // nächsten Anmeldeversuch" lesen, was für ein angemeldetes Konto die
      // falsche Auskunft wäre.
      expect(httpStatusForErrorCode('RATE_LIMITED')).toBe(429);
      expect(httpStatusForErrorCode('AUTH_RATE_LIMITED')).toBe(429);
      expect(defaultMessageForErrorCode('RATE_LIMITED')).not.toBe(
        defaultMessageForErrorCode('AUTH_RATE_LIMITED'),
      );
    });

    it('vergibt jeden Code genau einmal', () => {
      // Der Katalog ist ein Objekt-Literal; ein doppelter Schlüssel fiele erst
      // hier auf, weil die zweite Zuweisung die erste still überschriebe.
      expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    });
  });

  /**
   * Schriften der Oberfläche (Lastenheft §3.10). Geprüft wird je Code der
   * gedachte Status und – wo ein vorhandener Code denselben Status trägt – die
   * Abgrenzung zu ihm.
   */
  describe('Schrift-Codes (Lastenheft §3.10)', () => {
    it('ordnet jedem der sechs Fälle seinen Status zu', () => {
      expect(httpStatusForErrorCode('FONT_NOT_FOUND')).toBe(404);
      expect(httpStatusForErrorCode('FONT_FORMAT_UNSUPPORTED')).toBe(415);
      expect(httpStatusForErrorCode('FONT_FILE_TOO_LARGE')).toBe(413);
      expect(httpStatusForErrorCode('FONT_FILE_INVALID')).toBe(422);
      expect(httpStatusForErrorCode('FONT_BUNDLED_PROTECTED')).toBe(403);
      expect(httpStatusForErrorCode('FONT_IN_USE')).toBe(409);
    });

    it('trennt das Schriftformat vom Inhaltstyp der Anfrage', () => {
      // Beide 415: dort ist die Verpackung der Anfrage falsch, hier die Datei
      // darin. Verschiedene Meldungen, weil der Aufrufer Verschiedenes tut.
      expect(httpStatusForErrorCode('UNSUPPORTED_MEDIA_TYPE')).toBe(415);
      expect(defaultMessageForErrorCode('FONT_FORMAT_UNSUPPORTED')).not.toBe(
        defaultMessageForErrorCode('UNSUPPORTED_MEDIA_TYPE'),
      );
      expect(defaultMessageForErrorCode('FONT_FORMAT_UNSUPPORTED')).toContain('WOFF2');
    });

    it('trennt die Schrift-Grenze von der Upload-Grenze des Datei-Managers', () => {
      // Beide 413, aber die Schriftgrenze hängt am Format und liegt um
      // Größenordnungen niedriger (vgl. AGENT_ARCHIVE_TOO_LARGE / FILE_TOO_LARGE).
      expect(httpStatusForErrorCode('FILE_TOO_LARGE')).toBe(413);
      expect(defaultMessageForErrorCode('FONT_FILE_TOO_LARGE')).not.toBe(
        defaultMessageForErrorCode('FILE_TOO_LARGE'),
      );
    });

    it('trennt das falsche Format von der gefälschten Endung', () => {
      // 415: die Endung ist gar nicht erlaubt. 422: die Endung war erlaubt,
      // der Inhalt passt nicht dazu – wie AGENT_ARCHIVE_INVALID.
      expect(httpStatusForErrorCode('FONT_FILE_INVALID')).toBe(422);
      expect(httpStatusForErrorCode('AGENT_ARCHIVE_INVALID')).toBe(422);
      expect(defaultMessageForErrorCode('FONT_FILE_INVALID')).not.toBe(
        defaultMessageForErrorCode('FONT_FORMAT_UNSUPPORTED'),
      );
    });

    it('trennt die geschützte mitgelieferte Schrift von der benutzten', () => {
      // 403: grundsätzlich unzulässig, für jeden (wie ROLE_PROTECTED).
      // 409: zulässig, aber erst nach einer anderen Auswahl (wie
      // NOTIFICATION_CHANNEL_IN_USE).
      expect(httpStatusForErrorCode('ROLE_PROTECTED')).toBe(403);
      expect(httpStatusForErrorCode('NOTIFICATION_CHANNEL_IN_USE')).toBe(409);
      expect(defaultMessageForErrorCode('FONT_BUNDLED_PROTECTED')).not.toBe(
        defaultMessageForErrorCode('FONT_IN_USE'),
      );
    });

    it('vergibt jeden Schrift-Code genau einmal und mit eigener Meldung', () => {
      const fontCodes = ERROR_CODES.filter((code) => code.startsWith('FONT_'));

      expect(fontCodes).toHaveLength(6);
      expect(new Set(fontCodes).size).toBe(fontCodes.length);
      expect(new Set(fontCodes.map(defaultMessageForErrorCode)).size).toBe(fontCodes.length);
    });
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
