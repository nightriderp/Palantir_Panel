/**
 * Prüfungen für `start.sh` des Palworld-Images – ohne Docker, ohne Steam und
 * ohne Palworld.
 *
 * Der Schwerpunkt liegt auf der `PalWorldSettings.ini`: Sie ist **eine** lange
 * Zeile, und ein Anführungszeichen oder ein Komma im Servernamen zerrisse sie.
 * Palworld startete dann wortlos mit seinen Vorgaben – ohne Passwort, ohne
 * RCON, mit falschem Namen.
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
  const wurzel = mkdtempSync(join(tmpdir(), 'palantir-palworld-'));
  aufraeumen.push(wurzel);

  const daten = join(wurzel, 'daten');
  const vorlage = join(wurzel, 'steamcmd');
  mkdirSync(daten);
  mkdirSync(join(vorlage, 'linux64'), { recursive: true });
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
      'printf "%s\\n" "#!/bin/sh" "for arg in \\"\\$@\\"; do printf \'argv %s\\\\n\' \\"\\$arg\\"; done" > "$ziel/PalServer.sh"',
      'chmod 0755 "$ziel/PalServer.sh"',
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

const ini = (ordner) =>
  readFileSync(
    join(ordner.daten, 'server', 'Pal', 'Saved', 'Config', 'LinuxServer', 'PalWorldSettings.ini'),
    'utf8',
  );

describe('start.sh – PalWorldSettings.ini', nurMitShell, () => {
  it('schreibt die Felder des Panels in die eine Zeile', () => {
    const ordner = arbeitsordner();

    const lauf = starte(ordner, { PALWORLD_NAME: 'Nordheim', MAX_PLAYERS: '16' });

    assert.equal(lauf.status, 0, lauf.stderr);
    const inhalt = ini(ordner);
    assert.match(inhalt, /^\[\/Script\/Pal\.PalGameWorldSettings\]$/mu);
    assert.match(inhalt, /ServerName="Nordheim"/u);
    assert.match(inhalt, /ServerPlayerMaxNum=16/u);
    assert.match(inhalt, /RCONEnabled=True/u);
  });

  it('nimmt Zeichen heraus, die die Zeile zerrissen', () => {
    // Ohne das startete Palworld wortlos mit seinen Vorgaben – ohne Passwort,
    // ohne RCON, mit falschem Namen.
    const ordner = arbeitsordner();

    starte(ordner, { PALWORLD_NAME: 'Der "grosse", (beste) Server' });

    assert.match(ini(ordner), /ServerName="Der grosse beste Server"/u);
  });

  it('setzt das Administrator-Passwort auf das frische RCON-Passwort', () => {
    // Palworld kennt kein eigenes RCON-Passwort: Wer RCON spricht, ist
    // Administrator. Das Panel liest dieselbe Datei wie bei Minecraft.
    const ordner = arbeitsordner();

    starte(ordner);

    const passwort = readFileSync(join(ordner.daten, '.palantir', 'rcon.password'), 'utf8').trim();
    assert.equal(passwort.length, 48);
    assert.ok(ini(ordner).includes(`AdminPassword="${passwort}"`));
  });

  it('verlangt für Spieler gegen Spieler ein ausdrückliches "true"', () => {
    const ordner = arbeitsordner();

    starte(ordner, { PALWORLD_PVP: 'ja' });

    assert.match(ini(ordner), /bIsPvP=False/u);
  });
});

describe('start.sh – steamclient.so und Aufruf', nurMitShell, () => {
  it('legt steamclient.so nach ~/.steam/sdk64', () => {
    const ordner = arbeitsordner();

    starte(ordner);

    assert.ok(
      existsSync(join(ordner.daten, '.palantir', '.steam', 'sdk64', 'steamclient.so')),
      'steamclient.so fehlt',
    );
  });

  it('übergibt Port und Spielerzahl und die empfohlenen Schalter', () => {
    const lauf = starte(arbeitsordner(), { SERVER_PORT: '8215', MAX_PLAYERS: '16' });

    assert.ok(lauf.argv.includes('-port=8215'));
    assert.ok(lauf.argv.includes('-players=16'));
    assert.ok(lauf.argv.includes('-useperfthreads'));
    assert.ok(lauf.argv.includes('-UseMultithreadForDS'));
  });
});
