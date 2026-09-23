/**
 * Prüfungen für `start.sh` des CS2-Images – Schritt 1: nur Basic.
 *
 * Ohne Docker, ohne SteamCMD, ohne CS2: Eine `steamcmd.sh`-Attrappe legt statt
 * 30 GB einen Starter `game/cs2.sh` ab, der Arbeitsordner und Argumente
 * aufschreibt.
 *
 * **Was diese Tests nicht zeigen können:** ob CS2 wirklich hochkommt. Der erste
 * Anlauf hatte grüne Tests und brach auf der Node an einer fehlenden
 * Bibliothek ab. Der Beweis für Schritt 1 ist ein laufender Server auf der Node.
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

/** Die Bibliotheken der Wurzel und von `base/steam`, wie im Container. */
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

/**
 * Arbeitsordner mit SteamCMD-Attrappe.
 *
 * `starter: false` lässt `game/cs2.sh` weg – so sähe ein abgebrochener
 * Download aus.
 */
function arbeitsordner({ starter = true } = {}) {
  const wurzel = mkdtempSync(join(tmpdir(), 'palantir-cs2-'));
  aufraeumen.push(wurzel);

  const daten = join(wurzel, 'daten');
  const vorlage = join(wurzel, 'steamcmd');
  mkdirSync(daten);
  mkdirSync(join(vorlage, 'linux64'), { recursive: true });
  writeFileSync(join(vorlage, 'linux64', 'steamclient.so'), 'so');

  const zeilen = [
    '#!/bin/sh',
    'ziel=""',
    'for a in "$@"; do',
    '  case "$vorher" in +force_install_dir) ziel="$a";; esac',
    '  vorher="$a"',
    'done',
    'printf "steamcmd %s\\n" "$*"',
    'mkdir -p "$ziel/game"',
  ];

  if (starter) {
    zeilen.push(
      'printf "%s\\n" "#!/bin/sh" "echo \\"cwd \\$(pwd)\\"" "for arg in \\"\\$@\\"; do printf \'argv %s\\\\n\' \\"\\$arg\\"; done" > "$ziel/game/cs2.sh"',
    );
  }

  zeilen.push('exit 0', '');
  writeFileSync(join(vorlage, 'steamcmd.sh'), zeilen.join('\n'));
  spawnSync('sh', ['-c', 'chmod 0755 "$1"', '_', posix(join(vorlage, 'steamcmd.sh'))]);

  return { daten, vorlage };
}

function starte(ordner) {
  const ergebnis = spawnSync('sh', [START_SH], {
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      PALANTIR_DATA_DIR: posix(ordner.daten),
      PALANTIR_LIB_DIR: LIB_ORDNER,
      PALANTIR_STEAMCMD_DIR: posix(ordner.vorlage),
    },
  });
  const zeilen = (ergebnis.stdout ?? '').split('\n').map((zeile) => zeile.replace(/\r$/u, ''));

  return {
    ...ergebnis,
    zeilen,
    argv: zeilen.filter((zeile) => zeile.startsWith('argv ')).map((zeile) => zeile.slice(5)),
  };
}

describe('start.sh – Basic', nurMitShell, () => {
  it('holt Anwendung 730 anonym in den Datenordner', () => {
    const lauf = starte(arbeitsordner());

    assert.equal(lauf.status, 0, lauf.stderr);
    const aufruf = lauf.zeilen.find((zeile) => zeile.startsWith('steamcmd '));
    assert.match(aufruf, /\+login anonymous \+app_update 730/u);
    assert.match(aufruf, /\+force_install_dir \S*\/daten\/server /u);
  });

  it('startet über game/cs2.sh als dedizierter Server auf de_dust2, Port 27015', () => {
    const lauf = starte(arbeitsordner());

    assert.deepEqual(lauf.argv, ['-dedicated', '-port', '27015', '+map', 'de_dust2']);
  });

  it('startet aus game/ heraus – so erwartet es der Starter', () => {
    const lauf = starte(arbeitsordner());
    const zeile = lauf.zeilen.find((z) => z.startsWith('cwd '));

    assert.ok(zeile?.endsWith('/daten/server/game'), zeile);
  });

  it('legt steamclient.so nach ~/.steam/sdk64', () => {
    const ordner = arbeitsordner();
    starte(ordner);

    const ziel = join(ordner.daten, '.palantir', '.steam', 'sdk64', 'steamclient.so');
    assert.equal(readFileSync(ziel, 'utf8'), 'so');
  });

  it('startet nicht, wenn nach dem Holen der Starter fehlt', () => {
    const lauf = starte(arbeitsordner({ starter: false }));

    assert.equal(lauf.status, 69);
    assert.match(lauf.stdout, /cs2\.sh/u);
    assert.deepEqual(lauf.argv, []);
  });
});
