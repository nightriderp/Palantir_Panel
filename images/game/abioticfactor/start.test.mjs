/**
 * Prüfungen für `start.sh` des Abiotic-Factor-Images – ohne Docker, ohne Steam,
 * ohne Proton, ohne Xvfb und ohne das Spiel.
 *
 * Dieses Image schreibt keine Konfigurationsdatei; alles steht auf der
 * Befehlszeile. Geprüft wird deshalb die Befehlszeile – und die eine Stelle,
 * die nicht offensichtlich ist: Die Spielstände liegen bei der Unreal Engine
 * mitten im Serverordner und müssen dort heraus, sonst löscht sie, wer die
 * Serverdateien neu holen will.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
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
/**
 * Verweise im Dateisystem braucht dieses Image – unter Windows legt eine
 * gewöhnliche Sitzung keine an. Die Prüfung läuft dann nicht.
 */
const LINKS_MOEGLICH = (() => {
  if (!SH_VORHANDEN) return false;
  const ordner = mkdtempSync(join(tmpdir(), 'palantir-link-'));
  const lauf = spawnSync('sh', [
    '-c',
    'cd "$1" && mkdir a && ln -s a b && test -L b',
    '_',
    posix(ordner),
  ]);
  spawnSync('sh', ['-c', 'rm -rf "$1"', '_', posix(ordner)]);

  return lauf.status === 0;
})();
const nurMitShell = { skip: SH_VORHANDEN ? false : 'Keine POSIX-Shell (sh) im PATH.' };
const nurMitLinks = {
  skip: LINKS_MOEGLICH ? false : 'Diese Umgebung legt keine symbolischen Verweise an.',
};

const aufraeumen = [];

after(() => {
  for (const pfad of aufraeumen) {
    spawnSync('sh', ['-c', 'rm -rf "$1"', '_', posix(pfad)]);
  }
});

function arbeitsordner() {
  const wurzel = mkdtempSync(join(tmpdir(), 'palantir-abiotic-'));
  aufraeumen.push(wurzel);

  const daten = join(wurzel, 'daten');
  const vorlage = join(wurzel, 'steamcmd');
  const proton = join(wurzel, 'proton');
  const bin = join(wurzel, 'bin');
  const x11 = join(wurzel, 'x11');
  mkdirSync(daten);
  mkdirSync(vorlage);
  mkdirSync(proton);
  mkdirSync(bin);
  mkdirSync(x11);

  // Die SteamCMD-Attrappe legt die Windows-Dateien an, statt sie zu laden –
  // samt eines Spielstands an der Stelle, an der die Unreal Engine ihn ablegt.
  writeFileSync(
    join(vorlage, 'steamcmd.sh'),
    [
      '#!/bin/sh',
      'ziel=""',
      'for a in "$@"; do',
      '  case "$vorher" in +force_install_dir) ziel="$a";; esac',
      '  vorher="$a"',
      'done',
      'mkdir -p "$ziel/AbioticFactor/Binaries/Win64"',
      'printf \'exe\\n\' > "$ziel/AbioticFactor/Binaries/Win64/AbioticFactorServer-Win64-Shipping.exe"',
      'if [ ! -e "$ziel/AbioticFactor/Saved" ]; then',
      '  mkdir -p "$ziel/AbioticFactor/Saved/SaveGames"',
      '  printf \'welt\\n\' > "$ziel/AbioticFactor/Saved/SaveGames/Cascade.sav"',
      'fi',
      'exit 0',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(proton, 'proton'),
    ['#!/bin/sh', 'for a in "$@"; do printf \'proton %s\\n\' "$a"; done', 'exit 0', ''].join('\n'),
  );
  writeFileSync(
    join(bin, 'Xvfb'),
    ['#!/bin/sh', 'touch "${PALANTIR_X11_SOCKET_DIR}/X1"', 'sleep 1', ''].join('\n'),
  );
  spawnSync('sh', [
    '-c',
    'chmod 0755 "$1" "$2" "$3"',
    '_',
    posix(join(vorlage, 'steamcmd.sh')),
    posix(join(proton, 'proton')),
    posix(join(bin, 'Xvfb')),
  ]);

  return { wurzel, daten, vorlage, proton, bin, x11 };
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
        PALANTIR_STEAMCMD_DIR: posix(ordner.vorlage),
        PALANTIR_PROTON_DIR: posix(ordner.proton),
        PALANTIR_PROTON_VERSION: 'GE-Proton-Test',
        PALANTIR_X11_SOCKET_DIR: posix(ordner.x11),
        ...extra,
      },
    },
  );

  return {
    ...ergebnis,
    argv: (ergebnis.stdout ?? '')
      .split('\n')
      .map((zeile) => zeile.replace(/\r$/u, ''))
      .filter((zeile) => zeile.startsWith('proton '))
      .map((zeile) => zeile.slice(7)),
  };
}

describe('start.sh – die Befehlszeile', nurMitShell, () => {
  it('trägt die Felder des Panels ein', () => {
    const ordner = arbeitsordner();

    const lauf = starte(ordner, {
      ABIOTIC_NAME: 'Nordheim',
      MAX_PLAYERS: '4',
      SERVER_PORT: '25010',
      ABIOTIC_QUERY_PORT: '25011',
      ABIOTIC_PASSWORD: 'geheim',
    });

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.ok(lauf.argv.includes('-PORT=25010'));
    assert.ok(lauf.argv.includes('-QueryPort=25011'));
    assert.ok(lauf.argv.includes('-MaxServerPlayers=4'));
    assert.ok(lauf.argv.includes('-SteamServerName=Nordheim'));
    assert.ok(lauf.argv.includes('-ServerPassword=geheim'));
  });

  it('lässt das Passwort weg, wenn keines gesetzt ist', () => {
    // `-ServerPassword=` hieße bei manchen Fassungen: Das Passwort ist der
    // leere Text – und dann kommt niemand mehr herein.
    const lauf = starte(arbeitsordner());

    assert.ok(!lauf.argv.some((argument) => argument.startsWith('-ServerPassword')));
  });

  it('ruft die Windows-Datei über „proton run" auf', () => {
    const ordner = arbeitsordner();

    const lauf = starte(ordner);

    assert.equal(lauf.argv[0], 'run');
    assert.equal(
      lauf.argv[1],
      `${posix(ordner.daten)}/server/AbioticFactor/Binaries/Win64/AbioticFactorServer-Win64-Shipping.exe`,
    );
  });

  it('hängt eigene Startparameter hinten an', () => {
    const lauf = starte(arbeitsordner(), { PALANTIR_STARTUP_PARAMETERS: '-tcp' });

    assert.equal(lauf.argv[lauf.argv.length - 1], '-tcp');
  });
});

describe('start.sh – die Spielstände', nurMitLinks, () => {
  it('holt sie aus dem Serverordner heraus und verweist dorthin', () => {
    // Die Unreal Engine legt sie unter `AbioticFactor/Saved` ab – mitten in
    // dem, was SteamCMD verwaltet. Wer den Serverordner löscht, um die Dateien
    // neu zu holen, löschte damit die Welt.
    const ordner = arbeitsordner();

    starte(ordner);

    const verweis = join(ordner.daten, 'server', 'AbioticFactor', 'Saved');
    assert.ok(lstatSync(verweis).isSymbolicLink());
    const welt = join(ordner.daten, 'welten', 'SaveGames', 'Cascade.sav');
    assert.ok(existsSync(welt), 'Der vorhandene Spielstand ist nicht mitgekommen');
    assert.equal(readFileSync(welt, 'utf8'), 'welt\n');
  });

  it('bleibt beim zweiten Start dabei', () => {
    const ordner = arbeitsordner();

    starte(ordner);
    writeFileSync(join(ordner.daten, 'welten', 'SaveGames', 'Cascade.sav'), 'spaeter\n');
    starte(ordner);

    assert.equal(
      readFileSync(join(ordner.daten, 'welten', 'SaveGames', 'Cascade.sav'), 'utf8'),
      'spaeter\n',
    );
  });
});
