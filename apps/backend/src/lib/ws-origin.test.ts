/**
 * Herkunftsregel der WebSocket-Handshakes (Audit W2-5, `security-matrix-04`).
 *
 * Die Regel steht hier für sich, damit sie ohne Fastify prüfbar ist; dass die
 * drei Browser-Kanäle sie auch wirklich einhängen, prüfen deren eigene Tests
 * (`live-route.test.ts`, `chat/routes.test.ts`, `notifications/live.test.ts`).
 */

import { describe, expect, it } from 'vitest';
import { isAllowedWebSocketOrigin } from './ws-origin.js';

const PANEL = 'https://panel.example.tld';

describe('isAllowedWebSocketOrigin', () => {
  it('lässt die konfigurierte Panel-Adresse durch', () => {
    expect(isAllowedWebSocketOrigin(PANEL, PANEL)).toBe(true);
  });

  it('ignoriert Pfad und Schrägstrich in der Konfiguration', () => {
    expect(isAllowedWebSocketOrigin(PANEL, `${PANEL}/`)).toBe(true);
    expect(isAllowedWebSocketOrigin(PANEL, `${PANEL}/login`)).toBe(true);
  });

  it('vergleicht ohne Rücksicht auf Groß- und Kleinschreibung', () => {
    expect(isAllowedWebSocketOrigin('https://PANEL.example.tld', PANEL)).toBe(true);
  });

  it('weist eine fremde Seite ab', () => {
    expect(isAllowedWebSocketOrigin('https://boese.example', PANEL)).toBe(false);
  });

  /**
   * Der Kern von `security-matrix-04`: Die Spiel-Subdomains laufen unter
   * derselben Registrable Domain und gelten dem Browser als same-site – nur die
   * Herkunftsprüfung trennt sie vom Panel.
   */
  it('weist eine Subdomain derselben Domain ab', () => {
    expect(isAllowedWebSocketOrigin('https://mcserver.example.tld', PANEL)).toBe(false);
  });

  it('weist dieselbe Adresse über http ab', () => {
    expect(isAllowedWebSocketOrigin('http://panel.example.tld', PANEL)).toBe(false);
  });

  it('unterscheidet Ports', () => {
    expect(isAllowedWebSocketOrigin('http://localhost:3001', 'http://localhost:3000')).toBe(false);
    expect(isAllowedWebSocketOrigin('http://localhost:3000', 'http://localhost:3000')).toBe(true);
  });

  it('weist einen Handshake ohne Herkunft ab – ein Browser schickt immer eine', () => {
    expect(isAllowedWebSocketOrigin(undefined, PANEL)).toBe(false);
  });

  /** `Origin: null` schickt ein sandboxed iframe oder ein `data:`-Dokument. */
  it('weist die undurchsichtige Herkunft "null" ab', () => {
    expect(isAllowedWebSocketOrigin('null', PANEL)).toBe(false);
  });

  it('bleibt ohne konfigurierte Panel-Adresse aus', () => {
    expect(isAllowedWebSocketOrigin(undefined, undefined)).toBe(true);
    expect(isAllowedWebSocketOrigin('https://boese.example', undefined)).toBe(true);
  });

  /** Ein Tippfehler in der `.env` darf nicht den ganzen Live-Betrieb sperren. */
  it('sperrt bei unbrauchbar konfigurierter Panel-Adresse niemanden aus', () => {
    expect(isAllowedWebSocketOrigin('https://boese.example', 'panel.example.tld')).toBe(true);
  });
});
