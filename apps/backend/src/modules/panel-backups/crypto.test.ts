/**
 * Das Dateiformat der verschlüsselten Panel-Sicherungen (Fundpunkt 241).
 *
 * Geprüft wird vor allem das, was im Ernstfall zählt und was man an einer
 * laufenden Instanz nie ausprobiert: Kommt derselbe Abzug wieder heraus – und
 * merkt das Öffnen, wenn unterwegs jemand daran war?
 */

import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import {
  MINDESTLAENGE_PASSPHRASE,
  SICHERUNGS_MAGIE,
  erzeugeEntschluesselungsStrom,
  erzeugeSchluesselpaar,
  erzeugeVerschluesselungsStrom,
  istVerschluesselteSicherung,
  ladeOeffentlichenSchluessel,
  ladePrivatenSchluessel,
} from './crypto.js';

const PASSPHRASE = 'vier zufaellige woerter hier';

/*
 * Ein Paar für die gesamte Datei: RSA-4096 zu erzeugen dauert Sekunden, und
 * geprüft wird das Format, nicht der Zufallsgenerator.
 */
const paar = erzeugeSchluesselpaar(PASSPHRASE);
const oeffentlich = ladeOeffentlichenSchluessel(paar.oeffentlich);
const privat = ladePrivatenSchluessel(paar.privat, PASSPHRASE);

async function verschluessele(klartext: Buffer, stueckelung?: number): Promise<Buffer> {
  const quelle =
    stueckelung === undefined
      ? Readable.from([klartext])
      : Readable.from(teile(klartext, stueckelung));

  return buffer(quelle.pipe(erzeugeVerschluesselungsStrom(oeffentlich)));
}

async function entschluessele(datei: Buffer, stueckelung?: number): Promise<Buffer> {
  const quelle =
    stueckelung === undefined ? Readable.from([datei]) : Readable.from(teile(datei, stueckelung));

  return buffer(quelle.pipe(erzeugeEntschluesselungsStrom(privat)));
}

/** Ein einzelnes Bit umlegen - so sieht Manipulation im Kleinsten aus. */
function kippeBit(daten: Buffer, stelle: number): void {
  daten.writeUInt8(daten.readUInt8(stelle) ^ 0x01, stelle);
}

function teile(daten: Buffer, groesse: number): Buffer[] {
  const stuecke: Buffer[] = [];

  for (let stelle = 0; stelle < daten.length; stelle += groesse) {
    stuecke.push(daten.subarray(stelle, stelle + groesse));
  }

  return stuecke.length === 0 ? [Buffer.alloc(0)] : stuecke;
}

describe('Format der verschlüsselten Sicherung (Fundpunkt 241)', () => {
  it('liefert denselben Abzug wieder heraus', async () => {
    const klartext = Buffer.from('-- pg_dump\nCREATE TABLE users (id uuid);\n'.repeat(200), 'utf8');

    const zurueck = await entschluessele(await verschluessele(klartext));

    expect(zurueck.equals(klartext)).toBe(true);
  });

  it('hält auch bei Abzügen, die über viele Stücke hereinkommen', async () => {
    /*
     * Der eigentliche Fall: `pg_dump` schiebt seine Ausgabe in Häppchen durch
     * die Pipe. Beim Öffnen muss das Siegel am Ende trotzdem gefunden werden,
     * obwohl es über mehrere Stücke verteilt ankommt – deshalb eine Stückelung
     * kleiner als die 16 Byte des Siegels.
     */
    const klartext = Buffer.from('Zeile für Zeile\n'.repeat(500), 'utf8');
    const datei = await verschluessele(klartext, 64);

    expect((await entschluessele(datei, 7)).equals(klartext)).toBe(true);
  });

  it('kommt mit einem leeren Abzug zurecht', async () => {
    const datei = await verschluessele(Buffer.alloc(0));

    expect(istVerschluesselteSicherung(datei)).toBe(true);
    expect((await entschluessele(datei)).length).toBe(0);
  });

  it('ist an der Magie erkennbar, ohne dass jemand den Schlüssel hat', async () => {
    const datei = await verschluessele(Buffer.from('etwas'));

    expect(datei.subarray(0, SICHERUNGS_MAGIE.length).equals(SICHERUNGS_MAGIE)).toBe(true);
    expect(datei.readUInt8(SICHERUNGS_MAGIE.length)).toBe(1);
  });

  it('trägt den Klartext nicht in der Datei', async () => {
    const klartext = Buffer.from('geheimes-totp-geheimnis-JBSWY3DPEHPK3PXP', 'utf8');

    const datei = await verschluessele(klartext);

    expect(datei.includes('JBSWY3DPEHPK3PXP')).toBe(false);
  });
});

describe('Was beim Öffnen schiefgehen kann', () => {
  it('merkt, wenn am Chiffrat gedreht wurde', async () => {
    const datei = await verschluessele(Buffer.from('x'.repeat(1_000), 'utf8'));

    // Ein einzelnes Bit mitten im Chiffrat.
    kippeBit(datei, datei.length - 40);

    await expect(entschluessele(datei)).rejects.toThrow(/Siegel passt nicht/u);
  });

  it('merkt, wenn am Kopf gedreht wurde', async () => {
    /*
     * Der Kopf geht als AAD in das Siegel ein. Ohne ihn ließe sich der
     * verpackte Schlüssel gegen einen eigenen tauschen – die Datei sähe heil
     * aus und enthielte, was der Angreifer hineingeschrieben hat.
     */
    const datei = await verschluessele(Buffer.from('x'.repeat(1_000), 'utf8'));

    kippeBit(datei, SICHERUNGS_MAGIE.length + 10);

    await expect(entschluessele(datei)).rejects.toThrow();
  });

  it('merkt, wenn die Datei abgeschnitten ist', async () => {
    const datei = await verschluessele(Buffer.from('y'.repeat(1_000), 'utf8'));

    await expect(entschluessele(datei.subarray(0, datei.length - 30))).rejects.toThrow(
      /Siegel passt nicht|abgeschnitten/u,
    );
  });

  it('weist eine Datei ab, die gar nicht von uns stammt', async () => {
    const fremd = Buffer.from('-- irgendein SQL-Abzug ohne Kopf\n'.repeat(20), 'utf8');

    expect(istVerschluesselteSicherung(fremd)).toBe(false);
    await expect(entschluessele(fremd)).rejects.toThrow(/nicht mit dem Kopf/u);
  });

  it('weist eine unbekannte Format-Fassung benannt ab', async () => {
    const datei = await verschluessele(Buffer.from('z', 'utf8'));

    datei.writeUInt8(99, SICHERUNGS_MAGIE.length);

    await expect(entschluessele(datei)).rejects.toThrow(/Fassung 99/u);
  });

  it('weist das falsche Schlüsselpaar ab', { timeout: 30_000 }, async () => {
    const anderes = erzeugeSchluesselpaar(PASSPHRASE);
    const datei = await verschluessele(Buffer.from('geheim', 'utf8'));
    const fremderStrom = erzeugeEntschluesselungsStrom(
      ladePrivatenSchluessel(anderes.privat, PASSPHRASE),
    );

    await expect(buffer(Readable.from([datei]).pipe(fremderStrom))).rejects.toThrow(
      /anderen Schlüsselpaar/u,
    );
  });

  it('endet die Datei mitten im Kopf, sagt es das auch', async () => {
    const datei = await verschluessele(Buffer.from('kurz', 'utf8'));

    await expect(entschluessele(datei.subarray(0, 12))).rejects.toThrow(/mitten im Kopf/u);
  });
});

describe('Schlüssel und Passphrase', () => {
  it('öffnet den privaten Schlüssel nur mit der richtigen Passphrase', () => {
    expect(() => ladePrivatenSchluessel(paar.privat, 'falsch aber lang genug')).toThrow(
      /Passphrase falsch/u,
    );
  });

  it('legt den privaten Schlüssel verschlüsselt ab', () => {
    // Ohne Passphrase-Schutz stünde der Schlüssel im Klartext auf der Platte.
    expect(paar.privat).toContain('BEGIN ENCRYPTED PRIVATE KEY');
    expect(paar.oeffentlich).toContain('BEGIN PUBLIC KEY');
  });

  it('lehnt eine zu kurze Passphrase ab, statt sie stillschweigend zu nehmen', () => {
    expect(() => erzeugeSchluesselpaar('kurz')).toThrow(
      new RegExp(String(MINDESTLAENGE_PASSPHRASE), 'u'),
    );
  });

  it('lehnt einen privaten Schlüssel dort ab, wo der öffentliche hingehört', () => {
    // Der Griff ins falsche Regal beim Einrichten – er soll benannt scheitern,
    // nicht erst beim nächtlichen Lauf.
    expect(() => ladeOeffentlichenSchluessel('-- kein Schlüssel --')).toThrow(/ließ sich nicht/u);
  });
});
