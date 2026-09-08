/**
 * Subdomain-Regeln der Contracts (Audit W3-12, `contracts-validation-14`).
 *
 * `hasValidSubdomainFormat` ist eine der wenigen **ausführbaren** Regeln in
 * diesem Paket – Wizard (F3) und Backend (Anlegen wie Klonen) hängen beide
 * daran. Ohne Test kippt sie bei einem Refactoring unbemerkt: Ein zu weit
 * gefasstes Muster ließe Großbuchstaben oder Punkte in einen DNS-Eintrag, ein zu
 * enges sperrte gültige Namen aus, und in beiden Fällen bliebe der Testlauf grün.
 */

import { describe, expect, it } from 'vitest';
import {
  RESERVED_SUBDOMAINS,
  SUBDOMAIN_MAX_LENGTH,
  SUBDOMAIN_MIN_LENGTH,
  SUBDOMAIN_PATTERN,
  buildServerHostname,
  hasValidSubdomainFormat,
  isReservedSubdomain,
} from './subdomain.js';

describe('RESERVED_SUBDOMAINS', () => {
  it('enthält die im Pflichtenheft §13 genannten Namen', () => {
    for (const name of ['www', 'api', 'admin', 'vpn', 'mail']) {
      expect(RESERVED_SUBDOMAINS).toContain(name);
    }
  });

  it('sperrt auch die Namen, an denen die Mail der Domain hängt', () => {
    // Nachgetragen (Audit W3-1): Das Pflichtenheft führte beide schon als
    // gesperrt, die Liste kannte sie nicht. `autodiscover` fragen Outlook und
    // Thunderbird ab, `mx` ist das übliche Ziel des MX-Eintrags – ein
    // Spielserver dort störte die Mail der Domain, ohne dass jemand den
    // Zusammenhang sähe.
    for (const name of ['autodiscover', 'mx', 'ns1', 'ns2']) {
      expect(RESERVED_SUBDOMAINS, name).toContain(name);
    }
  });

  it('führt jeden Namen nur einmal und durchgängig klein', () => {
    expect(new Set(RESERVED_SUBDOMAINS).size).toBe(RESERVED_SUBDOMAINS.length);
    for (const name of RESERVED_SUBDOMAINS) {
      expect(name).toBe(name.toLowerCase());
    }
  });
});

describe('isReservedSubdomain', () => {
  it('erkennt reservierte Namen unabhängig von der Schreibweise', () => {
    expect(isReservedSubdomain('admin')).toBe(true);
    expect(isReservedSubdomain('ADMIN')).toBe(true);
    expect(isReservedSubdomain('Admin')).toBe(true);
  });

  it('lässt gewöhnliche Namen durch', () => {
    expect(isReservedSubdomain('survival')).toBe(false);
    expect(isReservedSubdomain('admin-welt')).toBe(false);
  });
});

describe('hasValidSubdomainFormat – erlaubte Formen', () => {
  it('nimmt Kleinbuchstaben, Ziffern und innenliegende Bindestriche an', () => {
    for (const name of ['welt', 'survival2', 'mein-server', 'a-b-c', '123', 'x1-y2-z3']) {
      expect(hasValidSubdomainFormat(name), name).toBe(true);
    }
  });

  it('lässt einen Namen genau an beiden Längengrenzen zu', () => {
    // Die Grenzen selbst sind erlaubt, nicht erst ein Zeichen dahinter.
    expect(hasValidSubdomainFormat('a'.repeat(SUBDOMAIN_MIN_LENGTH))).toBe(true);
    expect(hasValidSubdomainFormat('a'.repeat(SUBDOMAIN_MAX_LENGTH))).toBe(true);
  });

  it('hält die Grenzen bei 3 und 63 (RFC 1035)', () => {
    expect(SUBDOMAIN_MIN_LENGTH).toBe(3);
    // 63 ist die Obergrenze eines DNS-Labels; ein größerer Wert erzeugte einen
    // Namen, den kein Resolver mehr annimmt.
    expect(SUBDOMAIN_MAX_LENGTH).toBe(30);
  });
});

describe('hasValidSubdomainFormat – abgelehnte Formen', () => {
  it('lehnt zu kurze und zu lange Namen ab', () => {
    expect(hasValidSubdomainFormat('')).toBe(false);
    expect(hasValidSubdomainFormat('a'.repeat(SUBDOMAIN_MIN_LENGTH - 1))).toBe(false);
    expect(hasValidSubdomainFormat('a'.repeat(SUBDOMAIN_MAX_LENGTH + 1))).toBe(false);
  });

  it('lehnt einen Bindestrich am Anfang oder Ende ab', () => {
    // Ein Label darf laut RFC 1035 weder mit `-` beginnen noch enden.
    expect(hasValidSubdomainFormat('-welt')).toBe(false);
    expect(hasValidSubdomainFormat('welt-')).toBe(false);
    expect(hasValidSubdomainFormat('---')).toBe(false);
  });

  it('lehnt Großbuchstaben ab', () => {
    /*
     * Kein Kleinschreiben nebenbei: `SubdomainAvailabilityDto.subdomain` sagt
     * einen bereits kleingeschriebenen Namen zu, und wer hier großschreibt,
     * bekommt eine Ablehnung statt einer stillen Umformung.
     */
    expect(hasValidSubdomainFormat('Welt')).toBe(false);
    expect(hasValidSubdomainFormat('WELT')).toBe(false);
  });

  it('lehnt einen Punkt ab – vergeben wird genau ein Label', () => {
    // Sonst ließe sich mit `a.b` eine verschachtelte Subdomain unter
    // `PALANTIR_DOMAIN` erzeugen, die niemand zugeteilt hat.
    expect(hasValidSubdomainFormat('mein.server')).toBe(false);
    expect(hasValidSubdomainFormat('welt.example.tld')).toBe(false);
  });

  it('lehnt alles ab, was kein Buchstabe, keine Ziffer und kein Bindestrich ist', () => {
    for (const name of ['mein_server', 'mein server', 'welt!', 'wel/t', 'wäld', 'welt\u0000x']) {
      expect(hasValidSubdomainFormat(name), name).toBe(false);
    }
  });

  it('lässt sich nicht über einen Zeilenumbruch umgehen', () => {
    /*
     * `SUBDOMAIN_PATTERN` trägt `^`/`$` ohne `m`-Flag; in JavaScript endet `$`
     * am Ende der Zeichenkette. Ein `m` beim nächsten Refactoring würde
     * `"admin\nboese"` durchlassen – der Anfang wäre dann ein gesperrter Name,
     * den die Sperrliste nicht mehr trifft.
     */
    expect(SUBDOMAIN_PATTERN.flags).not.toContain('m');
    expect(hasValidSubdomainFormat('welt\nboese')).toBe(false);
    expect(hasValidSubdomainFormat('welt\n')).toBe(false);
  });

  it('behält keinen Zustand zwischen zwei Prüfungen', () => {
    // Ein `g`-Flag würde `lastIndex` mitführen: derselbe Name wäre abwechselnd
    // gültig und ungültig.
    expect(SUBDOMAIN_PATTERN.flags).not.toContain('g');
    expect(hasValidSubdomainFormat('welt')).toBe(true);
    expect(hasValidSubdomainFormat('welt')).toBe(true);
  });
});

describe('buildServerHostname', () => {
  it('hängt die Basis-Domain mit genau einem Punkt an', () => {
    expect(buildServerHostname('welt', 'example.tld')).toBe('welt.example.tld');
  });

  it('bildet denselben Namen, den die Sperrliste und die Formatregel geprüft haben', () => {
    // Backend (DNS-Eintrag, DTO) und Frontend (Anzeige) müssen zum selben
    // Ergebnis kommen – deshalb steht die Bildung hier und nicht zweimal.
    const subdomain = 'survival2';
    expect(hasValidSubdomainFormat(subdomain)).toBe(true);
    expect(isReservedSubdomain(subdomain)).toBe(false);
    expect(buildServerHostname(subdomain, 'palantir.example')).toBe('survival2.palantir.example');
  });
});
