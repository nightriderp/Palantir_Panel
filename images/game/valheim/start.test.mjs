/**
 * Prüfungen für `start.sh` des Valheim-Images – ohne Docker, ohne Steam und
 * ohne Valheim.
 *
 * Gestellt werden drei Dinge: ein Datenordner, eine SteamCMD-Vorlage, die nur
 * so tut, und ein `valheim_server.x86_64`, das seine Argumente ausgibt. Damit
 * sind genau die Entscheidungen prüfbar, die das Skript trifft – die
 * Passwortregeln von Valheim, die Trennung von Serverdateien und Welten, die
 * Umgebung und die Argumentliste.
 *
 * Ob der echte Server damit startet, zeigt erst ein Lauf auf der Node.
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

/**
 * Die Bibliotheken der Basis-Images liegen im Repository in zwei Ordnern, im
 * Container nebeneinander unter `/opt/palantir/lib`. Der Test legt einmal einen
 * Ordner an, der beide enthält.
 */
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
 * Legt den Arbeitsordner an.
 *
 * `serverDa` steuert, ob die SteamCMD-Attrappe eine ausführbare Serverdatei
 * hinterlässt – so lässt sich auch der Fall prüfen, dass sie fehlt.
 */
function arbeitsordner({ serverDa = true } = {}) {
  const wurzel = mkdtempSync(join(tmpdir(), 'palantir-valheim-'));
  aufraeumen.push(wurzel);

  const daten = join(wurzel, 'daten');
  const vorlage = join(wurzel, 'steamcmd');
  mkdirSync(daten);
  mkdirSync(vorlage);

  // Die Attrappe legt die Serverdatei an, statt sie zu laden. Sie gibt jedes
  // Argument auf einer eigenen Zeile aus; die Zeilen des Startskripts tragen
  // ein `[palantir]` davor und werden unten aussortiert.
  const serverZeilen = serverDa
    ? [
        'ziel=""',
        'for a in "$@"; do',
        '  case "$vorher" in +force_install_dir) ziel="$a";; esac',
        '  vorher="$a"',
        'done',
        'mkdir -p "$ziel"',
        'printf "%s\\n" "#!/bin/sh" "for arg in \\"\\$@\\"; do printf \'%s\\\\n\' \\"\\$arg\\"; done" > "$ziel/valheim_server.x86_64"',
        'chmod 0755 "$ziel/valheim_server.x86_64"',
      ]
    : ['true'];

  writeFileSync(
    join(vorlage, 'steamcmd.sh'),
    ['#!/bin/sh', ...serverZeilen, 'exit 0', ''].join('\n'),
  );
  spawnSync('sh', ['-c', 'chmod 0755 "$1"', '_', posix(join(vorlage, 'steamcmd.sh'))]);

  return { wurzel, daten, vorlage };
}

/** Führt `start.sh` aus und gibt Ergebnis samt Argumentliste des Servers zurück. */
function starte(ordner, env = {}) {
  const ergebnis = spawnSync('sh', [START_SH], {
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      PALANTIR_DATA_DIR: posix(ordner.daten),
      PALANTIR_LIB_DIR: LIB_ORDNER,
      PALANTIR_STEAMCMD_DIR: posix(ordner.vorlage),
      PALANTIR_STARTUP_PARAMETERS: '',
      VALHEIM_PASSWORD: 'geheim123',
      ...env,
    },
  });

  return {
    ...ergebnis,
    argv: (ergebnis.stdout ?? '')
      .split('\n')
      .map((zeile) => zeile.replace(/\r$/u, ''))
      .filter((zeile) => zeile.length > 0 && !zeile.startsWith('[palantir]')),
  };
}

describe('start.sh – Passwortregeln von Valheim', nurMitShell, () => {
  it('startet nicht ohne Passwort', () => {
    const lauf = starte(arbeitsordner(), { VALHEIM_PASSWORD: '' });

    assert.equal(lauf.status, 78);
    assert.match(lauf.stdout, /verlangt ein Passwort/u);
  });

  it('startet nicht mit einem zu kurzen Passwort', () => {
    const lauf = starte(arbeitsordner(), { VALHEIM_PASSWORD: 'abcd' });

    assert.equal(lauf.status, 78);
    assert.match(lauf.stdout, /mindestens fünf Zeichen/u);
  });

  it('startet nicht, wenn das Passwort im Servernamen steht', () => {
    const lauf = starte(arbeitsordner(), {
      VALHEIM_PASSWORD: 'geheim',
      VALHEIM_NAME: 'Servergeheim',
    });

    assert.equal(lauf.status, 78);
    assert.match(lauf.stdout, /steht im Servernamen/u);
  });

  it('startet nicht, wenn das Passwort im Weltnamen steht', () => {
    const lauf = starte(arbeitsordner(), {
      VALHEIM_PASSWORD: 'geheim',
      VALHEIM_WORLD: 'geheimeWelt',
    });

    assert.equal(lauf.status, 78);
    assert.match(lauf.stdout, /steht im Weltnamen/u);
  });
});

describe('start.sh – Serverdateien', nurMitShell, () => {
  it('meldet eine fehlende Serverdatei mit einem Hinweis statt eines Absturzes', () => {
    const lauf = starte(arbeitsordner({ serverDa: false }));

    assert.equal(lauf.status, 78);
    assert.match(lauf.stdout, /Der Server fehlt/u);
  });

  it('legt Welten neben die Serverdateien, nicht hinein', () => {
    const ordner = arbeitsordner();

    const lauf = starte(ordner);

    assert.equal(lauf.status, 0, lauf.stderr);
    // SteamCMD raeumt in seinem Ordner auf - die Welten duerfen dort nicht liegen.
    assert.ok(lauf.argv.includes(`${posix(ordner.daten)}/welten`));
    assert.ok(!lauf.argv.includes(`${posix(ordner.daten)}/server/welten`));
  });
});

describe('start.sh – Aufruf des Servers', nurMitShell, () => {
  it('übergibt Name, Port, Welt, Passwort und Ablage', () => {
    const ordner = arbeitsordner();

    const lauf = starte(ordner, { VALHEIM_NAME: 'Palantir-Welt', VALHEIM_WORLD: 'Nordheim' });

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.deepEqual(lauf.argv, [
      '-nographics',
      '-batchmode',
      '-name',
      'Palantir-Welt',
      '-port',
      '2456',
      '-world',
      'Nordheim',
      '-password',
      'geheim123',
      '-savedir',
      `${posix(ordner.daten)}/welten`,
      '-public',
      '0',
    ]);
  });

  it('schaltet die Serverliste nur bei ausdrücklichem Wunsch frei', () => {
    const lauf = starte(arbeitsordner(), { VALHEIM_PUBLIC: 'true' });

    assert.equal(lauf.status, 0, lauf.stderr);
    const stelle = lauf.argv.indexOf('-public');
    assert.equal(lauf.argv[stelle + 1], '1');
  });

  it('hängt die Startparameter des Betreibers hinten an', () => {
    const lauf = starte(arbeitsordner(), {
      PALANTIR_STARTUP_PARAMETERS: '-crossplay -saveinterval 900',
    });

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.deepEqual(lauf.argv.slice(-3), ['-crossplay', '-saveinterval', '900']);
  });
});
