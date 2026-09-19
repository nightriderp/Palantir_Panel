import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AGENT_VERSION, fassungMitStand } from './version.js';

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

/**
 * Der ausgerollte Stand an der Fassung (Fundpunkt 318).
 *
 * Die Paketfassung steht seit jeher auf 0.6.0 und aendert sich mit keinem
 * Release - von aussen war deshalb nicht zu sehen, ob eine Node nachgezogen
 * hat. `update.sh` haengt den Commit als `AGENT_COMMIT` an den Container, hier
 * wird er als SemVer-Baumetadaten angefuegt.
 *
 * Geprueft wird die Form, nicht der Inhalt: Ein Container, dem jemand Freitext
 * mitgibt, soll die Fassung nicht verlaengern.
 */
describe('fassungMitStand', () => {
  it('haengt den Commit als Baumetadaten an', () => {
    expect(fassungMitStand('0.6.0', 'dce821c772360bbe0b9123632150684d47403b3e')).toBe(
      '0.6.0+dce821c77236',
    );
  });

  it('kuerzt auf zwoelf Stellen und nimmt auch schon gekuerzte Werte', () => {
    expect(fassungMitStand('0.6.0', 'dce821c77236')).toBe('0.6.0+dce821c77236');
    expect(fassungMitStand('0.6.0', 'dce821c')).toBe('0.6.0+dce821c');
  });

  it('laesst die Paketfassung stehen, wenn nichts Brauchbares kommt', () => {
    for (const wert of [undefined, '', '   ', 'beliebiger text', 'zzzz', 'abc']) {
      expect(fassungMitStand('0.6.0', wert)).toBe('0.6.0');
    }
  });

  it('ist unempfindlich gegen Grossschreibung und Leerzeichen', () => {
    expect(fassungMitStand('0.6.0', '  DCE821C77236  ')).toBe('0.6.0+dce821c77236');
  });
});
