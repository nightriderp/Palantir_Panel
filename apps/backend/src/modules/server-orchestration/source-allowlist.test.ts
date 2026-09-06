/**
 * Tests der Quelladressen-Allowlist des Agent-Kanals (Fundpunkt 121, W0-2).
 *
 * Geprüft wird die reine Logik: Was die Liste versteht, was sie ablehnt, und
 * dass eine leere Liste nichts prüft. Die Verdrahtung in den Handshake steht
 * in `agent-route.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { isSourceAllowed, parseSourceAllowlist } from './source-allowlist.js';

describe('parseSourceAllowlist()', () => {
  it('liest Adressen und CIDR-Netze, getrennt durch Kommas und Leerraum', () => {
    const liste = parseSourceAllowlist(' 10.10.0.0/24 , 127.0.0.1,, fd00::/64 ');

    expect(liste.map((eintrag) => eintrag.text)).toEqual([
      '10.10.0.0/24',
      '127.0.0.1',
      'fd00::/64',
    ]);
    expect(liste.map((eintrag) => eintrag.prefixLength)).toEqual([24, 32, 64]);
  });

  it('ergibt die leere Liste, wenn nichts gesetzt ist', () => {
    expect(parseSourceAllowlist(undefined)).toEqual([]);
    expect(parseSourceAllowlist('')).toEqual([]);
    expect(parseSourceAllowlist(' , ')).toEqual([]);
  });

  it.each([
    ['kein Netz', 'homeserver'],
    ['Oktett über 255', '10.10.0.256'],
    ['zu wenige Oktette', '10.10.0'],
    ['Präfix über 32 bei IPv4', '10.10.0.0/33'],
    ['Präfix keine Zahl', '10.10.0.0/x'],
    ['leeres Präfix', '10.10.0.0/'],
    ['Präfix über 128 bei IPv6', 'fd00::/129'],
    ['IPv6 mit zwei ::', '1::2::3'],
    ['IPv6 mit zu vielen Gruppen', '1:2:3:4:5:6:7:8:9'],
    ['IPv6 mit ungültiger Gruppe', 'fd00::zzzz'],
  ])('wirft bei ungültiger Angabe (%s)', (_beschreibung, angabe) => {
    expect(() => parseSourceAllowlist(angabe)).toThrow(angabe);
  });

  it('wirft für den ungültigen Eintrag, auch wenn die übrigen stimmen', () => {
    expect(() => parseSourceAllowlist('10.10.0.0/24,kaputt')).toThrow('kaputt');
  });
});

describe('isSourceAllowed()', () => {
  const tunnel = parseSourceAllowlist('10.10.0.0/24');

  it('trifft Adressen innerhalb des Netzes', () => {
    expect(isSourceAllowed(tunnel, '10.10.0.2')).toBe(true);
    expect(isSourceAllowed(tunnel, '10.10.0.254')).toBe(true);
  });

  it('lehnt Adressen außerhalb des Netzes ab', () => {
    expect(isSourceAllowed(tunnel, '10.10.1.2')).toBe(false);
    expect(isSourceAllowed(tunnel, '127.0.0.1')).toBe(false);
    expect(isSourceAllowed(tunnel, '203.0.113.10')).toBe(false);
  });

  it('nimmt eine einzelne Adresse nur exakt an', () => {
    const einzeln = parseSourceAllowlist('127.0.0.1');

    expect(isSourceAllowed(einzeln, '127.0.0.1')).toBe(true);
    expect(isSourceAllowed(einzeln, '127.0.0.2')).toBe(false);
  });

  it('prüft jeden Eintrag der Liste', () => {
    const liste = parseSourceAllowlist('10.10.0.0/24,127.0.0.1');

    expect(isSourceAllowed(liste, '127.0.0.1')).toBe(true);
    expect(isSourceAllowed(liste, '10.10.0.2')).toBe(true);
    expect(isSourceAllowed(liste, '172.18.0.3')).toBe(false);
  });

  it('erlaubt alles, wenn die Liste leer ist', () => {
    expect(isSourceAllowed([], '203.0.113.10')).toBe(true);
    expect(isSourceAllowed([], undefined)).toBe(true);
    expect(isSourceAllowed([], 'unsinn')).toBe(true);
  });

  it('lehnt eine fehlende oder unlesbare Adresse ab, sobald eine Liste gesetzt ist', () => {
    expect(isSourceAllowed(tunnel, undefined)).toBe(false);
    expect(isSourceAllowed(tunnel, '')).toBe(false);
    expect(isSourceAllowed(tunnel, 'unsinn')).toBe(false);
  });

  it('behandelt IPv4-mapped IPv6 wie IPv4', () => {
    expect(isSourceAllowed(tunnel, '::ffff:10.10.0.2')).toBe(true);
    expect(isSourceAllowed(tunnel, '::FFFF:10.10.0.2')).toBe(true);
    expect(isSourceAllowed(tunnel, '::ffff:10.10.1.2')).toBe(false);
    // Umgekehrt trifft ein mapped-Eintrag in der Liste die reine IPv4-Adresse.
    expect(isSourceAllowed(parseSourceAllowlist('::ffff:10.10.0.2'), '10.10.0.2')).toBe(true);
  });

  it('vergleicht IPv6 unabhängig von Schreibweise und versteht IPv6-Netze', () => {
    const einzeln = parseSourceAllowlist('fd00::1');

    expect(isSourceAllowed(einzeln, 'fd00:0:0:0:0:0:0:1')).toBe(true);
    expect(isSourceAllowed(einzeln, 'FD00::0001')).toBe(true);
    expect(isSourceAllowed(einzeln, 'fd00::2')).toBe(false);

    const netz = parseSourceAllowlist('fd00:10::/32');

    expect(isSourceAllowed(netz, 'fd00:10:ffff::1')).toBe(true);
    expect(isSourceAllowed(netz, 'fd00:11::1')).toBe(false);
  });

  it('mischt IPv4 und IPv6 nicht', () => {
    // `::/0` ist „jede IPv6-Adresse", nicht „jede Adresse".
    expect(isSourceAllowed(parseSourceAllowlist('::/0'), '10.10.0.2')).toBe(false);
    expect(isSourceAllowed(parseSourceAllowlist('0.0.0.0/0'), 'fd00::1')).toBe(false);
    expect(isSourceAllowed(parseSourceAllowlist('0.0.0.0/0'), '203.0.113.10')).toBe(true);
  });
});
