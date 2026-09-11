/**
 * Prüfungen für `start.sh` des Rust-Images – ohne Docker, ohne Steam und ohne
 * Rust.
 *
 * Gestellt werden eine SteamCMD-Attrappe, die ein `RustDedicated` hinterlässt,
 * und dieses selbst, das seine Argumente aufschreibt. Geprüft wird, was das
 * Skript entscheidet: das Source-RCON statt WebSocket, das frische Passwort,
 * `steamclient.so` an der Stelle, an der der Server sie sucht, und die
 * Argumentliste.
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

const LIB_ORDNER = (() => {
  const ziel = mkdtempSync(join(tmpdir(), 'palantir-lib-'));
  copyFileSync(join(HIER, '..', '..', 'base', 'linux', 'palantir.sh'), join(ziel, 'palantir.sh'));
  copyFileSync(join(HIER, '..', '..', 'base', 'steam', 'steam.sh'), join(ziel, 'steam.sh'));

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
  const wurzel = mkdtempSync(join(tmpdir(), 'palantir-rust-'));
  aufraeumen.push(wurzel);

  const daten = join(wurzel, 'daten');
  const vorlage = join(wurzel, 'steamcmd');
  mkdirSync(daten);
  mkdirSync(join(vorlage, 'linux64'), { recursive: true });

  // `steamclient.so` liegt bei SteamCMD; das Startskript soll sie neben die
  // Bibliotheken des Servers legen.
  writeFileSync(join(vorlage, 'linux64', 'steamclient.so'), 'so');

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
      'printf "%s\\n" "#!/bin/sh" "for arg in \\"\\$@\\"; do printf \'argv %s\\\\n\' \\"\\$arg\\"; done" > "$ziel/RustDedicated"',
      'chmod 0755 "$ziel/RustDedicated"',
      'exit 0',
      '',
    ].join('\n'),
  );
  spawnSync('sh', ['-c', 'chmod 0755 "$1"', '_', posix(join(vorlage, 'steamcmd.sh'))]);

  return { wurzel, daten, vorlage };
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
      PALANTIR_STARTUP_PARAMETERS: '',
      ...extra,
    },
  });

  return {
    ...ergebnis,
    argv: (ergebnis.stdout ?? '')
      .split('\n')
      .map((zeile) => zeile.replace(/\r$/u, ''))
      .filter((zeile) => zeile.startsWith('argv '))
      .map((zeile) => zeile.slice(5)),
  };
}

/** Der Wert hinter einem Schalter der Argumentliste. */
const wert = (lauf, schalter) => lauf.argv[lauf.argv.indexOf(schalter) + 1];

describe('start.sh – RCON', nurMitShell, () => {
  it('spricht das Source-Protokoll, nicht WebSocket', () => {
    // Rust kann beides und nimmt von sich aus WebSocket. Der Agent spricht nur
    // das Source-Protokoll – ohne diese Zeile bliebe die Konsole stumm.
    const lauf = starte(arbeitsordner());

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.equal(wert(lauf, '+rcon.web'), '0');
  });

  it('legt bei jedem Start ein neues Passwort dort ab, wo die Definition es erwartet', () => {
    const ordner = arbeitsordner();
    const datei = join(ordner.daten, '.palantir', 'rcon.password');

    const erster = starte(ordner);
    const erstes = readFileSync(datei, 'utf8').trim();
    starte(ordner);
    const zweites = readFileSync(datei, 'utf8').trim();

    assert.equal(erstes.length, 48);
    assert.notEqual(erstes, zweites);
    // Und es geht auch an den Server – sonst wüsste der nichts davon.
    assert.equal(wert(erster, '+rcon.password'), erstes);
  });
});

describe('start.sh – steamclient.so', nurMitShell, () => {
  it('legt sie dorthin, wo RustDedicated sie sucht', () => {
    // Die häufigste Stolperstelle bei Steam-Servern: Fehlt sie, bricht der
    // Start mit einem Ladefehler ab, der nichts über die Ursache sagt.
    const ordner = arbeitsordner();

    starte(ordner);

    assert.ok(
      existsSync(
        join(ordner.daten, 'server', 'RustDedicated_Data', 'Plugins', 'x86_64', 'steamclient.so'),
      ),
    );
  });
});

describe('start.sh – Aufruf des Servers', nurMitShell, () => {
  it('übergibt Port, Abfrage-Port und die Felder des Panels', () => {
    const lauf = starte(arbeitsordner(), {
      SERVER_PORT: '28020',
      RUST_NAME: 'Nordheim',
      MAX_PLAYERS: '80',
      RUST_WORLD_SIZE: '4000',
    });

    assert.equal(wert(lauf, '+server.port'), '28020');
    // Derselbe Port für die Abfrage: Sonst bräuchte der Server eine zweite
    // öffentliche Nummer, und das Panel fragte ins Leere.
    assert.equal(wert(lauf, '+server.queryport'), '28020');
    assert.equal(wert(lauf, '+server.hostname'), 'Nordheim');
    assert.equal(wert(lauf, '+server.maxplayers'), '80');
    assert.equal(wert(lauf, '+server.worldsize'), '4000');
  });

  it('lässt den Startwert weg, wenn keiner gesetzt ist', () => {
    // `+server.seed 0` hieße „jedes Mal eine andere Welt" – die Karte entstünde
    // bei jedem Neustart neu.
    const ohne = starte(arbeitsordner());
    const mit = starte(arbeitsordner(), { RUST_SEED: '4711' });

    assert.ok(!ohne.argv.includes('+server.seed'));
    assert.equal(wert(mit, '+server.seed'), '4711');
  });

  it('hängt die Startparameter des Betreibers hinten an', () => {
    const lauf = starte(arbeitsordner(), {
      PALANTIR_STARTUP_PARAMETERS: '+server.tickrate 30',
    });

    assert.deepEqual(lauf.argv.slice(-2), ['+server.tickrate', '30']);
  });
});
