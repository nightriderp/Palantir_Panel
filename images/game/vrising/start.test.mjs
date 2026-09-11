/**
 * Prüfungen für `start.sh` des V-Rising-Images – ohne Docker, ohne Steam, ohne
 * Proton, ohne Xvfb und ohne das Spiel.
 *
 * Der Schwerpunkt liegt auf `ServerHostSettings.json`: Sie wird bei jedem Start
 * neu geschrieben und entscheidet über Ports, Passwort, Sichtbarkeit und RCON.
 * Dazu zwei Stellen, die leicht schiefgehen — die Maskierung (ein
 * Anführungszeichen im Servernamen zerbräche die Datei) und die
 * Pfadübersetzung (`-persistentDataPath` will einen Windows-Pfad, Proton sieht
 * den Datenordner als Laufwerk `Z:`).
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
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
const nurMitShell = { skip: SH_VORHANDEN ? false : 'Keine POSIX-Shell (sh) im PATH.' };

const aufraeumen = [];

after(() => {
  for (const pfad of aufraeumen) {
    spawnSync('sh', ['-c', 'rm -rf "$1"', '_', posix(pfad)]);
  }
});

function arbeitsordner() {
  const wurzel = mkdtempSync(join(tmpdir(), 'palantir-vrising-'));
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
      'printf \'exe\\n\' > "$ziel/VRisingServer.exe"',
      'exit 0',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(proton, 'proton'),
    ['#!/bin/sh', 'for a in "$@"; do printf \'proton %s\\n\' "$a"; done', 'exit 0', ''].join('\n'),
  );
  // Ein Xvfb, das den Anschluss anlegt und liegen bleibt – wie der echte.
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

const konfig = (ordner) =>
  JSON.parse(
    readFileSync(join(ordner.daten, 'welten', 'Settings', 'ServerHostSettings.json'), 'utf8'),
  );

describe('start.sh – ServerHostSettings.json', nurMitShell, () => {
  it('schreibt die Felder des Panels', () => {
    const ordner = arbeitsordner();

    const lauf = starte(ordner, {
      VRISING_NAME: 'Nordheim',
      MAX_PLAYERS: '20',
      SERVER_PORT: '25010',
      VRISING_QUERY_PORT: '25011',
      VRISING_PASSWORD: 'geheim',
      VRISING_SAVE_NAME: 'kampagne',
    });

    assert.equal(lauf.status, 0, lauf.stderr);
    const inhalt = konfig(ordner);
    assert.equal(inhalt.Name, 'Nordheim');
    assert.equal(inhalt.MaxConnectedUsers, 20);
    assert.equal(inhalt.Port, 25_010);
    assert.equal(inhalt.QueryPort, 25_011);
    assert.equal(inhalt.Password, 'geheim');
    assert.equal(inhalt.SaveName, 'kampagne');
  });

  it('maskiert Anführungszeichen, statt die Datei zu zerreißen', () => {
    const ordner = arbeitsordner();

    starte(ordner, { VRISING_NAME: 'Der "grosse" Server' });

    assert.equal(konfig(ordner).Name, 'Der "grosse" Server');
  });

  it('hängt beide Verzeichnisse an einen Schalter', () => {
    // Das Steam-Verzeichnis trägt die Abfrage, über die das Panel Spielerzahl
    // und Ping erfährt; das EOS-Verzeichnis ist die Liste, in der der Spieler
    // sucht. Wer „nicht listen" wählt, meint beide.
    const ordner = arbeitsordner();

    starte(ordner, { VRISING_PUBLIC: 'false' });

    assert.equal(konfig(ordner).ListOnSteam, false);
    assert.equal(konfig(ordner).ListOnEOS, false);
  });

  it('listet ohne Angabe – sonst bliebe die Kachel ohne Spielerzahl', () => {
    const ordner = arbeitsordner();

    starte(ordner);

    assert.equal(konfig(ordner).ListOnSteam, true);
  });
});

describe('start.sh – RCON', nurMitShell, () => {
  it('erzeugt bei jedem Start ein neues Passwort und legt es in den Datenordner', () => {
    const ordner = arbeitsordner();

    starte(ordner);
    const ersteRunde = readFileSync(
      join(ordner.daten, '.palantir', 'rcon.password'),
      'utf8',
    ).trim();

    assert.match(ersteRunde, /^[0-9a-f]{48}$/u);
    // Genau dieses Passwort steht in der Konfiguration – sonst käme der Agent
    // nicht an die Konsole.
    assert.equal(konfig(ordner).Rcon.Password, ersteRunde);
    assert.equal(konfig(ordner).Rcon.Enabled, true);

    starte(ordner);
    const zweiteRunde = readFileSync(
      join(ordner.daten, '.palantir', 'rcon.password'),
      'utf8',
    ).trim();

    assert.notEqual(ersteRunde, zweiteRunde);
  });
});

describe('start.sh – Start unter Proton', nurMitShell, () => {
  it('übersetzt den Datenordner in einen Windows-Pfad', () => {
    // Ein Linux-Pfad als `-persistentDataPath` liefe ins Leere, und der Server
    // legte Einstellungen und Spielstände irgendwohin.
    const ordner = arbeitsordner();

    const lauf = starte(ordner);

    const erwartet = `Z:${posix(ordner.daten).replace(/\//gu, '\\')}\\welten`;
    assert.deepEqual(lauf.argv, [
      'run',
      `${posix(ordner.daten)}/server/VRisingServer.exe`,
      '-persistentDataPath',
      erwartet,
    ]);
  });

  it('hängt eigene Startparameter hinten an', () => {
    const ordner = arbeitsordner();

    const lauf = starte(ordner, { PALANTIR_STARTUP_PARAMETERS: '-logFile Z:\\log.txt' });

    assert.deepEqual(lauf.argv.slice(-2), ['-logFile', 'Z:\\log.txt']);
  });

  it('legt adminlist.txt an, überschreibt sie aber nicht', () => {
    // Wer dort seine Steam-Kennung einträgt, ist im Spiel Administrator. Ein
    // Neustart darf das nicht wegräumen.
    const ordner = arbeitsordner();

    starte(ordner);
    const liste = join(ordner.daten, 'welten', 'Settings', 'adminlist.txt');
    assert.ok(existsSync(liste));

    writeFileSync(liste, '76561198000000000\n');
    starte(ordner);

    assert.equal(readFileSync(liste, 'utf8'), '76561198000000000\n');
  });
});
