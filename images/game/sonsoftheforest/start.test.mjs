/**
 * Prüfungen für `start.sh` des Sons-of-the-Forest-Images – ohne Docker, ohne
 * Steam, ohne Proton, ohne Xvfb und ohne das Spiel.
 *
 * Der Schwerpunkt liegt auf `dedicatedserver.cfg` (einer JSON-Datei trotz der
 * Endung): drei Ports, die Maskierung des Servernamens, der abgeschaltete
 * Erreichbarkeitstest – und die Pfadübersetzung, ohne die der Server seine
 * Welt irgendwohin legte.
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
  const wurzel = mkdtempSync(join(tmpdir(), 'palantir-sotf-'));
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
      'printf \'exe\\n\' > "$ziel/SonsOfTheForestDS.exe"',
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
  JSON.parse(readFileSync(join(ordner.daten, 'welten', 'dedicatedserver.cfg'), 'utf8'));

describe('start.sh – dedicatedserver.cfg', nurMitShell, () => {
  it('schreibt die Felder des Panels', () => {
    const ordner = arbeitsordner();

    const lauf = starte(ordner, {
      SOTF_NAME: 'Nordheim',
      MAX_PLAYERS: '4',
      SERVER_PORT: '25010',
      SOTF_PASSWORD: 'geheim',
    });

    assert.equal(lauf.status, 0, lauf.stderr);
    const inhalt = konfig(ordner);
    assert.equal(inhalt.ServerName, 'Nordheim');
    assert.equal(inhalt.MaxPlayers, 4);
    assert.equal(inhalt.GamePort, 25_010);
    assert.equal(inhalt.Password, 'geheim');
    // Ohne `0.0.0.0` lauscht der Server auf einer Adresse, die im Container
    // niemandem gehört.
    assert.equal(inhalt.IpAddress, '0.0.0.0');
  });

  it('trägt alle drei Ports ein', () => {
    // Der dritte ist der, den man vergisst: Ohne ihn verbindet sich der
    // Spieler und bleibt im Ladebildschirm hängen.
    const ordner = arbeitsordner();

    starte(ordner, {
      SERVER_PORT: '25010',
      SOTF_QUERY_PORT: '25011',
      SOTF_BLOB_PORT: '25012',
    });

    const inhalt = konfig(ordner);
    assert.equal(inhalt.GamePort, 25_010);
    assert.equal(inhalt.QueryPort, 25_011);
    assert.equal(inhalt.BlobSyncPort, 25_012);
  });

  it('überspringt den Erreichbarkeitstest', () => {
    // Der Server prüft sonst beim Start, ob er von außen erreichbar ist, und
    // beendet sich bei Misserfolg. Hinter dem Rückwärtstunnel schlägt die
    // Prüfung immer fehl – die öffentliche Adresse ist die der VPS.
    const ordner = arbeitsordner();

    starte(ordner);

    assert.equal(konfig(ordner).SkipNetworkAccessibilityTest, true);
  });

  it('setzt fort, statt neu anzufangen', () => {
    // „New" begänne bei jedem Start von vorn – in einem Panel, das den
    // Container neu aufbauen darf, wäre das ein Weltenfresser.
    const ordner = arbeitsordner();

    starte(ordner);

    assert.equal(konfig(ordner).SaveMode, 'Continue');
  });

  it('maskiert Anführungszeichen, statt die Datei zu zerreißen', () => {
    const ordner = arbeitsordner();

    starte(ordner, { SOTF_NAME: 'Der "grosse" Server' });

    assert.equal(konfig(ordner).ServerName, 'Der "grosse" Server');
  });
});

describe('start.sh – Start unter Proton', nurMitShell, () => {
  it('übersetzt den Datenordner in einen Windows-Pfad', () => {
    const ordner = arbeitsordner();

    const lauf = starte(ordner);

    const erwartet = `Z:${posix(ordner.daten).replace(/\//gu, '\\')}\\welten`;
    assert.deepEqual(lauf.argv, [
      'run',
      `${posix(ordner.daten)}/server/SonsOfTheForestDS.exe`,
      '-userdatapath',
      erwartet,
    ]);
  });

  it('hängt eigene Startparameter hinten an', () => {
    const ordner = arbeitsordner();

    const lauf = starte(ordner, {
      PALANTIR_STARTUP_PARAMETERS: '-dedicatedserver.GameMode Peaceful',
    });

    assert.deepEqual(lauf.argv.slice(-2), ['-dedicatedserver.GameMode', 'Peaceful']);
  });
});
