/**
 * Prüfungen für `start.sh` des Enshrouded-Images – ohne Docker, ohne Steam,
 * ohne Proton und ohne das Spiel.
 *
 * Der Schwerpunkt liegt auf `enshrouded_server.json`: Sie wird bei jedem Start
 * neu geschrieben, und zwei Dinge daran gehen leicht schief — die Maskierung
 * (ein Anführungszeichen im Servernamen zerbräche die Datei) und die
 * Pfadübersetzung (Proton sieht den Datenordner als Windows-Laufwerk `Z:`, ein
 * Linux-Pfad liefe ins Leere).
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
const nurMitShell = { skip: SH_VORHANDEN ? false : 'Keine POSIX-Shell (sh) im PATH.' };

const aufraeumen = [];

after(() => {
  for (const pfad of aufraeumen) {
    spawnSync('sh', ['-c', 'rm -rf "$1"', '_', posix(pfad)]);
  }
});

function arbeitsordner() {
  const wurzel = mkdtempSync(join(tmpdir(), 'palantir-enshrouded-'));
  aufraeumen.push(wurzel);

  const daten = join(wurzel, 'daten');
  const vorlage = join(wurzel, 'steamcmd');
  const proton = join(wurzel, 'proton');
  mkdirSync(daten);
  mkdirSync(vorlage);
  mkdirSync(proton);

  // Die SteamCMD-Attrappe legt die Windows-Datei an, statt sie zu laden.
  writeFileSync(
    join(vorlage, 'steamcmd.sh'),
    [
      '#!/bin/sh',
      'ziel=""',
      'for a in "$@"; do',
      '  case "$vorher" in +force_install_dir) ziel="$a";; esac',
      '  vorher="$a"',
      'done',
      'mkdir -p "$ziel"',
      'printf \'exe\\n\' > "$ziel/enshrouded_server.exe"',
      'exit 0',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(proton, 'proton'),
    ['#!/bin/sh', 'for a in "$@"; do printf \'proton %s\\n\' "$a"; done', 'exit 0', ''].join('\n'),
  );
  spawnSync('sh', [
    '-c',
    'chmod 0755 "$1" "$2"',
    '_',
    posix(join(vorlage, 'steamcmd.sh')),
    posix(join(proton, 'proton')),
  ]);

  return { wurzel, daten, vorlage, proton };
}

function starte(ordner, extra = {}) {
  const ergebnis = spawnSync('sh', [START_SH], {
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      PALANTIR_DATA_DIR: posix(ordner.daten),
      PALANTIR_LIB_DIR: LIB_ORDNER,
      PALANTIR_STEAMCMD_DIR: posix(ordner.vorlage),
      PALANTIR_PROTON_DIR: posix(ordner.proton),
      PALANTIR_PROTON_VERSION: 'GE-Proton-Test',
      ...extra,
    },
  });

  return {
    ...ergebnis,
    argv: (ergebnis.stdout ?? '')
      .split('\n')
      .map((zeile) => zeile.replace(/\r$/u, ''))
      .filter((zeile) => zeile.startsWith('proton '))
      .map((zeile) => zeile.slice(7)),
  };
}

const konfig = (ordner) =>
  JSON.parse(readFileSync(join(ordner.daten, 'server', 'enshrouded_server.json'), 'utf8'));

describe('start.sh – enshrouded_server.json', nurMitShell, () => {
  it('schreibt die Felder des Panels', () => {
    const ordner = arbeitsordner();

    const lauf = starte(ordner, {
      ENSHROUDED_NAME: 'Nordheim',
      MAX_PLAYERS: '8',
      SERVER_PORT: '25010',
    });

    assert.equal(lauf.status, 0, lauf.stderr);
    const inhalt = konfig(ordner);
    assert.equal(inhalt.name, 'Nordheim');
    assert.equal(inhalt.slotCount, 8);
    assert.equal(inhalt.gamePort, 25_010);
    // Ohne `0.0.0.0` lauscht der Server auf einer Adresse, die im Container
    // niemandem gehört.
    assert.equal(inhalt.ip, '0.0.0.0');
  });

  it('übersetzt die Ordner in Windows-Pfade', () => {
    // Proton sieht den Datenordner als Laufwerk `Z:`; ein Linux-Pfad in der
    // Konfiguration liefe ins Leere, und der Server legte seine Welt
    // irgendwohin.
    const ordner = arbeitsordner();

    starte(ordner);

    const erwartet = `Z:${posix(ordner.daten).replace(/\//gu, '\\')}\\welten`;
    assert.equal(konfig(ordner).saveDirectory, erwartet);
  });

  it('maskiert Anführungszeichen, statt die Datei zu zerreißen', () => {
    const ordner = arbeitsordner();

    starte(ordner, { ENSHROUDED_NAME: 'Der "grosse" Server' });

    assert.equal(konfig(ordner).name, 'Der "grosse" Server');
  });

  it('legt die drei Rollen an, die das Spiel kennt', () => {
    const ordner = arbeitsordner();

    starte(ordner, {
      ENSHROUDED_ADMIN_PASSWORD: 'chef123',
      ENSHROUDED_PASSWORD: 'freund123',
    });

    const gruppen = konfig(ordner).userGroups;
    assert.deepEqual(
      gruppen.map((gruppe) => gruppe.name),
      ['Admin', 'Friend', 'Guest'],
    );
    assert.equal(gruppen[0].password, 'chef123');
    assert.equal(gruppen[0].canKickBan, true);
    assert.equal(gruppen[1].password, 'freund123');
    // Ein Gast darf zusehen, nicht bauen.
    assert.equal(gruppen[2].canEditBase, false);
  });
});

describe('start.sh – Start unter Proton', nurMitShell, () => {
  it('ruft die Windows-Datei über „proton run" auf', () => {
    const ordner = arbeitsordner();

    const lauf = starte(ordner);

    assert.deepEqual(lauf.argv, ['run', `${posix(ordner.daten)}/server/enshrouded_server.exe`]);
  });
});
