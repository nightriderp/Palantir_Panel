/**
 * Prüfungen für `start.sh` des Satisfactory-Images – ohne Docker, ohne Steam
 * und ohne das Spiel.
 *
 * Es gibt wenig zu entscheiden: Satisfactory kennt keine Konfigurationsdatei,
 * die von außen gesetzt würde. Geprüft wird deshalb das, was trotzdem
 * schiefgehen kann – der Ort der Spielstände, `steamclient.so` und die
 * Argumentliste.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
  const wurzel = mkdtempSync(join(tmpdir(), 'palantir-satisfactory-'));
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
      'printf "%s\\n" "#!/bin/sh" "for arg in \\"\\$@\\"; do printf \'argv %s\\\\n\' \\"\\$arg\\"; done" > "$ziel/FactoryServer.sh"',
      'chmod 0755 "$ziel/FactoryServer.sh"',
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

describe('start.sh – Spielstände und Steam', nurMitShell, () => {
  it('legt das Zuhause des Servers in den Datenordner', () => {
    // Zeigte `HOME` ins schreibgeschützte Wurzeldateisystem, verlöre der Server
    // jeden Spielstand beim Neuaufbau des Containers – und das fiele erst auf,
    // wenn es zu spät ist.
    const ordner = arbeitsordner();

    const lauf = starte(ordner);

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.ok(existsSync(join(ordner.daten, 'spielstaende')), 'Ordner fehlt');
  });

  it('legt steamclient.so nach ~/.steam/sdk64', () => {
    const ordner = arbeitsordner();

    starte(ordner);

    assert.ok(
      existsSync(join(ordner.daten, 'spielstaende', '.steam', 'sdk64', 'steamclient.so')),
      'steamclient.so fehlt',
    );
  });
});

describe('start.sh – Aufruf des Servers', nurMitShell, () => {
  it('lauscht auf allen Adressen und auf dem vergebenen Port', () => {
    // Ohne `-multihome` lauscht der Server auf einer Adresse, die im Container
    // niemandem gehört.
    const lauf = starte(arbeitsordner(), { SERVER_PORT: '25004' });

    assert.ok(lauf.argv.includes('-multihome=0.0.0.0'));
    assert.ok(lauf.argv.includes('-Port=25004'));
  });

  it('hängt die Startparameter des Betreibers hinten an', () => {
    const lauf = starte(arbeitsordner(), { PALANTIR_STARTUP_PARAMETERS: '-log -NoSteamClient' });

    assert.deepEqual(lauf.argv.slice(-2), ['-log', '-NoSteamClient']);
  });
});
