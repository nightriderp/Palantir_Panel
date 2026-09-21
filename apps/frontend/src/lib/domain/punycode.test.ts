import { describe, expect, it } from 'vitest';
import { hostnameAnzeigen } from './punycode';

/**
 * Die erwarteten ASCII-Formen stammen nicht aus dieser Datei, sondern aus der
 * Laufzeit: `new URL('https://müf-it.de').hostname` ergibt
 * `xn--mf-it-kva.de`. Geprüft wird also die Gegenrichtung gegen die einzige
 * Umrechnung, die im Betrieb tatsächlich zählt.
 */
describe('hostnameAnzeigen', () => {
  it('macht aus der ASCII-Form die Schreibweise mit Umlaut', () => {
    expect(hostnameAnzeigen('xn--mf-it-kva.de')).toBe('müf-it.de');
  });

  it('lässt die Subdomain unangetastet', () => {
    expect(hostnameAnzeigen('welt.xn--mf-it-kva.de')).toBe('welt.müf-it.de');
  });

  it.each([
    ['xn--bcher-kva.de', 'bücher.de'],
    ['xn--mller-kva.example', 'müller.example'],
    ['xn--grn-wei-6va9w.de', 'grün-weiß.de'],
    ['xn--nxasmm1c.gr', 'βόλος.gr'],
    ['xn--wgv71a.jp', '日本.jp'],
  ])('%s ergibt %s', (ascii, lesbar) => {
    expect(hostnameAnzeigen(ascii)).toBe(lesbar);
  });

  it('rechnet in beide Richtungen zusammen zum Ausgangswert', () => {
    for (const name of ['müf-it.de', 'bücher.de', 'grün-weiß.de', 'βόλος.gr']) {
      const ascii = new URL(`https://${name}`).hostname;
      expect(hostnameAnzeigen(ascii)).toBe(name);
    }
  });

  it('lässt einen gewöhnlichen Namen unverändert', () => {
    expect(hostnameAnzeigen('beispiel.tld')).toBe('beispiel.tld');
    expect(hostnameAnzeigen('welt.beispiel.tld')).toBe('welt.beispiel.tld');
    expect(hostnameAnzeigen('localhost')).toBe('localhost');
  });

  /*
   * Die Gegenprobe in `hostnameAnzeigen` ist der Grund, warum diese Fälle
   * nicht als Kauderwelsch in der Oberfläche landen: Was sich nicht wieder auf
   * das ursprüngliche Label zurückrechnen lässt, bleibt stehen, wie es war.
   */
  it('behält die ASCII-Form, wo die Umrechnung nicht aufgeht', () => {
    expect(hostnameAnzeigen('xn--.de')).toBe('xn--.de');
    expect(hostnameAnzeigen('xn--!!!.de')).toBe('xn--!!!.de');
    expect(hostnameAnzeigen('xn--zzzzzzzzzzzz.de')).toBe('xn--zzzzzzzzzzzz.de');
  });

  it('fasst ein `xn--` mitten im Namen nicht an', () => {
    expect(hostnameAnzeigen('meinxn--server.beispiel.tld')).toBe('meinxn--server.beispiel.tld');
  });

  it('kommt mit einem leeren Wert zurecht', () => {
    expect(hostnameAnzeigen('')).toBe('');
  });
});
