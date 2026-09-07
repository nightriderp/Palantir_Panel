import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AGENT_VERSION } from './version.js';

/**
 * Der Agent meldet seine Fassung im `hello`-Frame; das Backend zieht sie zur
 * Fehlersuche heran (Audit W3-2, agent-conn-04). Als abgeschriebenes Literal
 * lief der Wert von der Paketdatei weg – dieser Test hält beide Seiten
 * zusammen, damit das nicht erneut passiert.
 */
describe('AGENT_VERSION', () => {
  const manifest: unknown = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );

  it('entspricht exakt dem Feld "version" aus apps/agent/package.json', () => {
    expect(manifest).toMatchObject({ version: expect.any(String) });
    expect(AGENT_VERSION).toBe((manifest as { version: string }).version);
  });

  it('ist nicht der Ersatzwert und hat die Form einer Fassungsnummer', () => {
    expect(AGENT_VERSION).not.toBe('unbekannt');
    expect(AGENT_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
