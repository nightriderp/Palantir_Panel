/**
 * Prüfungen für `start.sh` des ACC-Images – ohne Docker, ohne Proton und ohne
 * das Spiel.
 *
 * Zwei Dinge entscheiden hier über Erfolg oder stilles Scheitern: Die
 * Konfigurationsdateien müssen **UTF-16 LE mit Marke** sein (UTF-8 liest ACC
 * still falsch und startet mit Vorgaben), und die Portnummern in
 * `configuration.json` müssen die öffentlichen sein – der Server meldet sie dem
 * Lobby-Dienst weiter.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/** Pfad in der Schreibweise, die eine POSIX-Shell versteht (Windows: `C:\…`). */
const posix = (pfad) => pfad.replace(/\\/gu, '/');

const HIER = fileURLToPath(new URL('.', import.meta.url));
const START_SH = posix(join(HIER, 'start.sh'));

/** Die drei Bibliotheken liegen im Container nebeneinander. */
const LIB_ORDNER = (() => {
  const ziel = mkdtempSync(join(tmpdir(), 'palantir-lib-'));
  const basis = join(HIER, '..', '..', 'base');
  copyFileSync(join(basis, 'linux', 'palantir.sh'), join(ziel, 'palantir.sh'));
  copyFileSync(join(basis, 'steam', 'steam.sh'), join(ziel, 'steam.sh'));
  copyFileSync(join(basis, 'proton', 'proton.sh'), join(ziel, 'proton.sh'));

  return posix(ziel);
})();

const SH_VORHANDEN = spawnSync('sh', ['-c', 'exit 0']).error === undefined;
/** Ohne `iconv` gibt es kein UTF-16 – dann sagt der Test nichts. */
const ICONV_DA = SH_VORHANDEN && spawnSync('sh', ['-c', 'command -v iconv']).status === 0;
const nurMitShell = { skip: SH_VORHANDEN ? false : 'Keine POSIX-Shell (sh) im PATH.' };
const nurMitIconv = { skip: ICONV_DA ? false : 'Kein iconv im PATH.' };

const aufraeumen = [];

after(() => {
  for (const pfad of aufraeumen) {
    spawnSync('sh', ['-c', 'rm -rf "$1"', '_', posix(pfad)]);
  }
});

function arbeitsordner({ mitServerdateien = true } = {}) {
  const wurzel = mkdtempSync(join(tmpdir(), 'palantir-acc-'));
  aufraeumen.push(wurzel);

  const daten = join(wurzel, 'daten');
  const proton = join(wurzel, 'proton');
  // ACC braucht SteamCMD nicht - `proton_vorbereiten` legt trotzdem eine Kopie
  // an, weil Proton dort seine Steam-Installation sucht.
  const vorlage = join(wurzel, 'steamcmd');
  mkdirSync(daten);
  mkdirSync(proton);
  mkdirSync(vorlage);

  if (mitServerdateien) {
    // Das, was der Betreiber hochlädt – hier nur der Name, um den es geht.
    mkdirSync(join(daten, 'server'), { recursive: true });
    writeFileSync(join(daten, 'server', 'accServer.exe'), 'exe\n');
  }

  writeFileSync(
    join(proton, 'proton'),
    ['#!/bin/sh', 'for a in "$@"; do printf \'proton %s\\n\' "$a"; done', 'exit 0', ''].join('\n'),
  );
  spawnSync('sh', ['-c', 'chmod 0755 "$1"', '_', posix(join(proton, 'proton'))]);

  return { wurzel, daten, proton, vorlage };
}

function starte(ordner, extra = {}) {
  return spawnSync('sh', [START_SH], {
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      PALANTIR_DATA_DIR: posix(ordner.daten),
      PALANTIR_LIB_DIR: LIB_ORDNER,
      PALANTIR_PROTON_DIR: posix(ordner.proton),
      PALANTIR_STEAMCMD_DIR: posix(ordner.vorlage),
      PALANTIR_PROTON_VERSION: 'GE-Proton-Test',
      ...extra,
    },
  });
}

/** Liest eine der Konfigurationsdateien und rechnet sie aus UTF-16 zurück. */
function konfig(ordner, name) {
  const roh = readFileSync(join(ordner.daten, 'server', 'cfg', name));

  assert.equal(roh[0], 0xff, `${name} beginnt nicht mit der Byte-Reihenfolge-Marke`);
  assert.equal(roh[1], 0xfe, `${name} beginnt nicht mit der Byte-Reihenfolge-Marke`);

  return JSON.parse(roh.subarray(2).toString('utf16le'));
}

describe('start.sh – ohne Serverdateien', nurMitShell, () => {
  it('sagt, wo sie herkommen, statt wortlos zu scheitern', () => {
    // Dieses Image kann sie nicht holen: Kunos gibt den Server nur an ein Konto
    // heraus, das ACC besitzt.
    const lauf = starte(arbeitsordner({ mitServerdateien: false }));

    assert.equal(lauf.status, 78);
    assert.match(lauf.stdout, /Serverdateien fehlen/u);
    assert.match(lauf.stdout, /Assetto Corsa Competizione Dedicated Server/u);
    assert.match(lauf.stdout, /Datei-Manager/u);
  });
});

describe('start.sh – die Konfigurationsdateien', nurMitIconv, () => {
  it('schreibt sie als UTF-16 LE mit Marke', () => {
    // UTF-8 wird nicht abgelehnt, sondern still falsch gelesen: Der Server
    // startet mit Vorgaben, ohne Passwort und auf anderen Ports.
    const ordner = arbeitsordner();

    const lauf = starte(ordner, { ACC_NAME: 'Nordschleife-Liga' });

    assert.equal(lauf.status, 0, lauf.stderr);
    // `konfig` prüft die Marke selbst und scheitert sonst.
    assert.equal(konfig(ordner, 'settings.json').serverName, 'Nordschleife-Liga');
    assert.equal(konfig(ordner, 'configuration.json').configVersion, 1);
    assert.equal(konfig(ordner, 'event.json').configVersion, 1);
  });

  it('trägt die öffentlichen Portnummern ein, nicht irgendwelche', () => {
    // Der Server meldet sie dem Lobby-Dienst weiter; eine Übersetzung davor
    // zeigte auf einen Port, den es nicht gibt.
    const ordner = arbeitsordner();

    starte(ordner, { ACC_TCP_PORT: '25011', ACC_UDP_PORT: '25010' });

    const inhalt = konfig(ordner, 'configuration.json');
    assert.equal(inhalt.tcpPort, 25_011);
    assert.equal(inhalt.udpPort, 25_010);
  });

  it('lässt Platz für Zuschauer über den Fahrzeugplätzen', () => {
    const ordner = arbeitsordner();

    starte(ordner, { ACC_MAX_CAR_SLOTS: '24' });

    assert.equal(konfig(ordner, 'settings.json').maxCarSlots, 24);
    assert.equal(konfig(ordner, 'configuration.json').maxConnections, 34);
  });

  it('maskiert Anführungszeichen, statt die Datei zu zerreißen', () => {
    const ordner = arbeitsordner();

    starte(ordner, { ACC_NAME: 'Der "grosse" Server' });

    assert.equal(konfig(ordner, 'settings.json').serverName, 'Der "grosse" Server');
  });

  it('legt ein Rennwochenende aus drei Sitzungen an', () => {
    const ordner = arbeitsordner();

    starte(ordner, {
      ACC_TRACK: 'spa',
      ACC_PRACTICE_MINUTES: '10',
      ACC_QUALIFYING_MINUTES: '12',
      ACC_RACE_MINUTES: '45',
    });

    const inhalt = konfig(ordner, 'event.json');
    assert.equal(inhalt.track, 'spa');
    assert.deepEqual(
      inhalt.sessions.map((sitzung) => [sitzung.sessionType, sitzung.sessionDurationMinutes]),
      [
        ['P', 10],
        ['Q', 12],
        ['R', 45],
      ],
    );
  });

  it('fasst die Dateien des Betreibers nicht an', () => {
    // Fahrerliste, Rennregeln und erlaubte Hilfen gehören ihm; ein Startskript,
    // das sie überschriebe, räumte eine Liga-Einstellung jedes Mal weg.
    const ordner = arbeitsordner();
    const cfg = join(ordner.daten, 'server', 'cfg');
    mkdirSync(cfg, { recursive: true });
    writeFileSync(join(cfg, 'entrylist.json'), 'meine Fahrer\n');
    writeFileSync(join(cfg, 'eventRules.json'), 'meine Regeln\n');

    starte(ordner);

    assert.equal(readFileSync(join(cfg, 'entrylist.json'), 'utf8'), 'meine Fahrer\n');
    assert.equal(readFileSync(join(cfg, 'eventRules.json'), 'utf8'), 'meine Regeln\n');
  });
});

describe('start.sh – Start unter Proton', nurMitIconv, () => {
  it('ruft accServer.exe über „proton run" auf', () => {
    const ordner = arbeitsordner();

    const lauf = starte(ordner);

    const argv = (lauf.stdout ?? '')
      .split('\n')
      .map((zeile) => zeile.replace(/\r$/u, ''))
      .filter((zeile) => zeile.startsWith('proton '))
      .map((zeile) => zeile.slice(7));

    assert.deepEqual(argv, ['run', `${posix(ordner.daten)}/server/accServer.exe`]);
  });
});
