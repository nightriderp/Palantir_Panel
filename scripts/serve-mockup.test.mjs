/**
 * Tests des Mockup-Servers (Massnahme W3-13, Fundpunkt `infra-images-15`).
 *
 * **Warum mit eigener Wurzel statt gegen `docs/mockup`.** Der Ordner `docs/`
 * liegt laut `.gitignore` nur lokal und fehlt in der CI - ein Test, der ihn
 * braucht, waere dort entweder rot oder muesste sich ueberspringen. Jeder Test
 * legt sich deshalb einen Wegwerf-Ordner an. Der heisst absichtlich `mockups`
 * und bekommt einen Nachbarn `mockupsX`: Genau dieses Paar ist der Fehler, um
 * den es geht - `startsWith` allein haelt `mockupsX` faelschlich fuer einen Teil
 * von `mockups`.
 *
 * Der Weg dorthin fuehrt ueber `%2F`. Ein unkodiertes `/../` raeumt schon die
 * URL-Klasse weg, bevor der Server es sieht; ein kodierter Schraegstrich bleibt
 * bis zum `decodeURIComponent` stehen und wird erst danach wieder zum Trenner.
 */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { HOST, PORT, WURZEL, aufloesen, starte } from './serve-mockup.mjs';

/** Wegwerf-Ordnerpaar: `<tmp>/mockups` als Wurzel, `<tmp>/mockupsX` daneben. */
let basis;
let wurzel;
let nachbar;

before(async () => {
  basis = await mkdtemp(path.join(tmpdir(), 'palantir-mockup-'));
  wurzel = path.join(basis, 'mockups');
  nachbar = path.join(basis, 'mockupsX');
  await mkdir(wurzel, { recursive: true });
  await mkdir(nachbar, { recursive: true });
  await writeFile(path.join(wurzel, 'x'), 'erlaubt\n');
  // Existiert wirklich - sonst waere eine Ablehnung nicht von "gibt es nicht"
  // zu unterscheiden.
  await writeFile(path.join(nachbar, 'x'), 'geheim\n');
});

after(async () => {
  await rm(basis, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
describe('Praefixpruefung', () => {
  test('Pfad innerhalb der Wurzel ist erlaubt', () => {
    assert.equal(aufloesen('/x', wurzel), path.join(wurzel, 'x'));
  });

  test('Nachbarordner mit gleichem Praefix wird abgelehnt', () => {
    // `/..%2FmockupsX/x` loest zu `<basis>/mockupsX/x` auf. Ohne den Trenner im
    // Vergleich galt das als "innerhalb von <basis>/mockups".
    assert.equal(aufloesen('/..%2FmockupsX/x', wurzel), null);
  });

  test('der abgelehnte Pfad zeigt tatsaechlich auf eine vorhandene Datei', () => {
    // Belegt, dass die Ablehnung aus der Pruefung kommt und nicht daraus, dass
    // dort ohnehin nichts liegt: Mit dem Elternordner als Wurzel liefert
    // dieselbe Auflösung die Datei im Nachbarordner.
    assert.equal(aufloesen('/mockupsX/x', basis), path.join(nachbar, 'x'));
  });

  test('Wurzel ohne Pfad liefert die Startseite', () => {
    assert.equal(aufloesen('/', wurzel), path.join(wurzel, 'Palantir.dc.html'));
  });

  test('die Wurzel selbst bleibt erlaubt', () => {
    assert.equal(aufloesen('/.', wurzel), wurzel);
  });

  test('Ausbruch nach oben wird abgelehnt', () => {
    assert.equal(aufloesen('/..%2F..%2Fetc/passwd', wurzel), null);
  });

  test('kaputte Prozentkodierung wird abgelehnt statt zu werfen', () => {
    assert.equal(aufloesen('/%', wurzel), null);
  });

  test('die Vorgabewurzel ist docs/mockup', () => {
    assert.equal(path.basename(WURZEL), 'mockup');
  });
});

// ---------------------------------------------------------------------------
describe('Server', () => {
  let server;
  let anschrift;

  before(async () => {
    // Port 0: freier Port vom Betriebssystem. Der Host bleibt der Vorgabewert -
    // genau der, den auch der Kommandozeilenzweig von serve-mockup.mjs nimmt.
    server = starte(0, undefined, wurzel);
    await once(server, 'listening');
    anschrift = server.address();
  });

  after(async () => {
    server.close();
    await once(server, 'close');
  });

  test('bindet auf die Loopback-Adresse, nicht auf alle Schnittstellen', () => {
    assert.equal(HOST, '127.0.0.1');
    assert.equal(anschrift.address, '127.0.0.1');
    assert.notEqual(anschrift.address, '0.0.0.0');
    assert.notEqual(anschrift.address, '::');
  });

  test('der Vorgabeport ist unveraendert 4100', () => {
    assert.equal(PORT, 4100);
  });

  test('liefert eine Datei aus der Wurzel aus', async () => {
    const antwort = await fetch(`http://127.0.0.1:${anschrift.port}/x`);
    assert.equal(antwort.status, 200);
    assert.equal(await antwort.text(), 'erlaubt\n');
  });

  test('beantwortet den Nachbarordner mit 403, nicht mit dessen Inhalt', async () => {
    const antwort = await fetch(`http://127.0.0.1:${anschrift.port}/..%2FmockupsX/x`);
    assert.equal(antwort.status, 403);
    assert.doesNotMatch(await antwort.text(), /geheim/);
  });

  test('unbekannte Datei innerhalb der Wurzel bleibt 404', async () => {
    const antwort = await fetch(`http://127.0.0.1:${anschrift.port}/gibtesnicht`);
    assert.equal(antwort.status, 404);
  });
});
