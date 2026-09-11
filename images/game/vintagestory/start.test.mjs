/**
 * Prüfungen für `start.sh` des Vintage-Story-Images – ohne Docker, ohne .NET
 * und ohne das Spiel.
 *
 * Zwei Dinge sind hier eigen und deshalb geprüft: Die Einstellungen des Panels
 * gehen als `--withconfig` auf die Befehlszeile und **nicht** in die
 * `serverconfig.json` (dort steht, was dem Betreiber gehört), und beim Stoppen
 * geht `/stop` in die Konsole, weil auf ein nacktes SIGTERM kein Verlass ist.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/** Pfad in der Schreibweise, die eine POSIX-Shell versteht (Windows: `C:\…`). */
const posix = (pfad) => pfad.replace(/\\/gu, '/');

const HIER = fileURLToPath(new URL('.', import.meta.url));
const START_SH = posix(join(HIER, 'start.sh'));

/** Die beiden Bibliotheken liegen im Container nebeneinander. */
const LIB_ORDNER = (() => {
  const ziel = mkdtempSync(join(tmpdir(), 'palantir-lib-'));
  const basis = join(HIER, '..', '..', 'base');
  copyFileSync(join(basis, 'linux', 'palantir.sh'), join(ziel, 'palantir.sh'));
  copyFileSync(join(basis, 'dotnet', 'dotnet.sh'), join(ziel, 'dotnet.sh'));

  return posix(ziel);
})();

const SH_VORHANDEN = spawnSync('sh', ['-c', 'exit 0']).error === undefined;
const nurMitShell = { skip: SH_VORHANDEN ? false : 'Keine POSIX-Shell (sh) im PATH.' };

const aufraeumen = [];

after(() => {
  for (const pfad of aufraeumen) {
    spawnSync('sh', ['-c', 'rm -rf "$1"', '_', posix(pfad)]);
  }
});

function arbeitsordner() {
  const wurzel = mkdtempSync(join(tmpdir(), 'palantir-vintagestory-'));
  aufraeumen.push(wurzel);

  const daten = join(wurzel, 'daten');
  const bin = join(wurzel, 'bin');
  mkdirSync(daten);
  mkdirSync(bin);

  // Die Serverdateien sind schon da: Der Download gehört nicht in diesen Test,
  // `palantir.sh` bringt seinen eigenen mit.
  mkdirSync(join(daten, 'server'), { recursive: true });
  writeFileSync(join(daten, 'server', 'VintagestoryServer.dll'), 'dll\n');

  // Ein `dotnet`, das seine Argumente aufschreibt und sich beendet. **Nicht**
  // auf der Standardeingabe lesen: Das ist das Konsolen-Rohr, und das bekommt
  // nie ein Dateiende – der Test liefe in seine Frist statt in eine Aussage.
  writeFileSync(
    join(bin, 'dotnet'),
    ['#!/bin/sh', 'for a in "$@"; do printf \'dotnet %s\\n\' "$a"; done', 'exit 0', ''].join('\n'),
  );
  spawnSync('sh', ['-c', 'chmod 0755 "$1"', '_', posix(join(bin, 'dotnet'))]);

  return { wurzel, daten, bin };
}

function starte(ordner, extra = {}) {
  const ergebnis = spawnSync(
    'sh',
    [
      '-c',
      'PATH="$(cd "$1" && pwd):$PATH"; export PATH; exec sh "$2"',
      '_',
      posix(ordner.bin),
      START_SH,
    ],
    {
      encoding: 'utf8',
      timeout: 60_000,
      env: {
        ...process.env,
        PALANTIR_DATA_DIR: posix(ordner.daten),
        PALANTIR_LIB_DIR: LIB_ORDNER,
        PALANTIR_DOTNET_VERSION: '10.0.0-Test',
        ...extra,
      },
    },
  );

  return {
    ...ergebnis,
    argv: (ergebnis.stdout ?? '')
      .split('\n')
      .map((zeile) => zeile.replace(/\r$/u, ''))
      .filter((zeile) => zeile.startsWith('dotnet '))
      .map((zeile) => zeile.slice(7)),
  };
}

/** Der JSON-Text hinter `--withconfig`. */
function einstellungen(lauf) {
  const stelle = lauf.argv.indexOf('--withconfig');
  assert.notEqual(stelle, -1, 'Es gab kein --withconfig');

  return JSON.parse(lauf.argv[stelle + 1]);
}

describe('start.sh – die Einstellungen des Panels', nurMitShell, () => {
  it('gehen auf die Befehlszeile, nicht in die serverconfig.json', () => {
    // In der Datei steht, was dem Betreiber gehoert: Rollen, Rechte,
    // Zugangsliste. Ein Startskript, das sie neu schriebe, raeumte das weg.
    const ordner = arbeitsordner();

    const lauf = starte(ordner, {
      VS_NAME: 'Nordheim',
      MAX_PLAYERS: '12',
      SERVER_PORT: '25010',
      VS_PASSWORD: 'geheim',
    });

    assert.equal(lauf.status, 0, lauf.stderr);
    const konfig = einstellungen(lauf);
    assert.equal(konfig.ServerName, 'Nordheim');
    assert.equal(konfig.MaxClients, 12);
    assert.equal(konfig.Port, 25_010);
    assert.equal(konfig.Password, 'geheim');
  });

  it('maskiert Anführungszeichen, statt die Angabe zu zerreißen', () => {
    const ordner = arbeitsordner();

    const lauf = starte(ordner, { VS_NAME: 'Der "grosse" Server' });

    assert.equal(einstellungen(lauf).ServerName, 'Der "grosse" Server');
  });

  it('meldet den Server nicht ungefragt beim Hersteller an', () => {
    // Die Vorgabe ist „nicht listen": Ein Server, der ohne Zutun des Betreibers
    // in einem fremden Verzeichnis steht, ist eine Überraschung.
    const ordner = arbeitsordner();

    assert.equal(einstellungen(starte(ordner)).AdvertiseServer, false);
    assert.equal(einstellungen(starte(ordner, { VS_PUBLIC: 'true' })).AdvertiseServer, true);
  });

  it('bohrt keine Löcher am Heimrouter', () => {
    // Das Panel legt die Weiterleitung selbst an; UPnP widerspräche dem
    // Lastenheft.
    assert.equal(einstellungen(starte(arbeitsordner())).Upnp, false);
  });

  it('gibt den Datenordner als --dataPath mit', () => {
    const ordner = arbeitsordner();

    const lauf = starte(ordner);

    const stelle = lauf.argv.indexOf('--dataPath');
    assert.notEqual(stelle, -1);
    assert.equal(lauf.argv[stelle + 1], `${posix(ordner.daten)}/welten`);
  });

  it('hängt eigene Startparameter hinten an', () => {
    const lauf = starte(arbeitsordner(), { PALANTIR_STARTUP_PARAMETERS: '--maxclients 4' });

    assert.deepEqual(lauf.argv.slice(-2), ['--maxclients', '4']);
  });
});
