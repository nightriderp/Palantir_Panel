/**
 * Prüfungen für `proton.sh` – ohne Docker, ohne Steam und ohne Proton.
 *
 * Gestellt werden eine SteamCMD-Attrappe, die ihre Argumente aufschreibt, und
 * ein `proton`, das dasselbe tut. Geprüft wird die eine Stolperstelle, an der
 * jeder einmal hängenbleibt — `+@sSteamCmdForcePlatformType windows` muss
 * **vor** `+login` stehen — und dass Proton seine Schreiborte im Datenordner
 * bekommt statt in einem Zuhause, das es im Container nicht gibt.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/** Pfad in der Schreibweise, die eine POSIX-Shell versteht (Windows: `C:\…`). */
const posix = (pfad) => pfad.replace(/\\/gu, '/');

const HIER = fileURLToPath(new URL('.', import.meta.url));
const PALANTIR_SH = posix(join(HIER, '..', 'linux', 'palantir.sh'));
const STEAM_SH = posix(join(HIER, '..', 'steam', 'steam.sh'));
const PROTON_SH = posix(join(HIER, 'proton.sh'));

const SH_VORHANDEN = spawnSync('sh', ['-c', 'exit 0']).error === undefined;
const nurMitShell = { skip: SH_VORHANDEN ? false : 'Keine POSIX-Shell (sh) im PATH.' };

const aufraeumen = [];

after(() => {
  for (const pfad of aufraeumen) {
    spawnSync('sh', ['-c', 'rm -rf "$1"', '_', posix(pfad)]);
  }
});

function arbeitsordner() {
  const wurzel = mkdtempSync(join(tmpdir(), 'palantir-proton-'));
  aufraeumen.push(wurzel);

  const daten = join(wurzel, 'daten');
  const vorlage = join(wurzel, 'steamcmd');
  const proton = join(wurzel, 'proton');
  mkdirSync(daten);
  mkdirSync(vorlage);
  mkdirSync(proton);

  writeFileSync(
    join(vorlage, 'steamcmd.sh'),
    ['#!/bin/sh', 'for a in "$@"; do printf \'steam %s\\n\' "$a"; done', 'exit 0', ''].join('\n'),
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

/** Führt ein Stück Shell aus, das die drei Bibliotheken eingebunden hat. */
function mitBibliothek(ordner, rumpf) {
  return spawnSync(
    'sh',
    ['-c', `set -eu; . "$1"; . "$2"; . "$3"; ${rumpf}`, '_', PALANTIR_SH, STEAM_SH, PROTON_SH],
    {
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        PALANTIR_DATA_DIR: posix(ordner.daten),
        PALANTIR_STEAMCMD_DIR: posix(ordner.vorlage),
        PALANTIR_PROTON_DIR: posix(ordner.proton),
        PALANTIR_PROTON_VERSION: 'GE-Proton-Test',
      },
    },
  );
}

describe('proton.sh – Serverdateien holen', nurMitShell, () => {
  it('verlangt die Windows-Fassung, und zwar vor der Anmeldung', () => {
    // `+@sSteamCmdForcePlatformType windows` nach `+login` wirkt nicht mehr:
    // SteamCMD lädt dann wortlos die Linux-Fassung oder meldet, es gebe für
    // diese Anwendung nichts. Das ist die Stolperstelle dieses Images.
    const ordner = arbeitsordner();

    const lauf = mitBibliothek(ordner, 'proton_app_holen 2278520 "$PALANTIR_DATENORDNER/server"');

    assert.equal(lauf.status, 0, lauf.stderr);
    const argumente = lauf.stdout
      .split('\n')
      .filter((zeile) => zeile.startsWith('steam '))
      .map((zeile) => zeile.slice(6).replace(/\r$/u, ''));

    const plattform = argumente.indexOf('+@sSteamCmdForcePlatformType');
    const anmeldung = argumente.indexOf('+login');

    assert.notEqual(plattform, -1, 'Plattform wurde nie gesetzt');
    assert.equal(argumente[plattform + 1], 'windows');
    assert.ok(plattform < anmeldung, 'Plattform steht hinter der Anmeldung');
    assert.ok(argumente.includes('2278520'));
  });
});

describe('proton.sh – Orte, die Proton beschreiben darf', nurMitShell, () => {
  it('legt Prefix und Zwischenspeicher in den Datenordner', () => {
    // Zeigten sie ins Wurzeldateisystem, scheiterte Proton mit einer Meldung
    // über einen Pfad, den niemand gesetzt hat.
    const ordner = arbeitsordner();

    const lauf = mitBibliothek(
      ordner,
      'proton_vorbereiten; printf "prefix %s\\n" "$STEAM_COMPAT_DATA_PATH";' +
        ' printf "steam %s\\n" "$STEAM_COMPAT_CLIENT_INSTALL_PATH";' +
        ' printf "cache %s\\n" "$XDG_CACHE_HOME"',
    );

    assert.equal(lauf.status, 0, lauf.stderr);
    const daten = posix(ordner.daten);
    assert.match(lauf.stdout, new RegExp(`prefix ${daten}/\\.palantir/proton`, 'u'));
    assert.match(lauf.stdout, new RegExp(`steam ${daten}/\\.palantir/steam`, 'u'));
    assert.match(lauf.stdout, new RegExp(`cache ${daten}/\\.palantir/cache`, 'u'));
    assert.ok(existsSync(join(ordner.daten, '.palantir', 'proton')));
  });

  it('nennt die Fassung im Log – sie gehört in jede Fehlermeldung', () => {
    const lauf = mitBibliothek(arbeitsordner(), 'proton_vorbereiten');

    assert.match(lauf.stdout, /Proton GE-Proton-Test/u);
  });
});

describe('proton.sh – ein Windows-Programm aufrufen', nurMitShell, () => {
  it('ruft es über „proton run" auf', () => {
    const lauf = mitBibliothek(
      arbeitsordner(),
      'proton_vorbereiten; proton_lauf /pfad/server.exe -arg',
    );

    assert.equal(lauf.status, 0, lauf.stderr);
    const argumente = lauf.stdout
      .split('\n')
      .filter((zeile) => zeile.startsWith('proton '))
      .map((zeile) => zeile.slice(7).replace(/\r$/u, ''));

    assert.deepEqual(argumente, ['run', '/pfad/server.exe', '-arg']);
  });
});

describe('proton.sh – der Bildschirm, den es nicht gibt', nurMitShell, () => {
  /**
   * Statt eines echten Xvfb ein Skript im PATH, das den Anschluss anlegt, den
   * der echte anlegen würde, und dann liegen bleibt. Geprüft wird das
   * Drumherum – Aufruf, Warten, `DISPLAY` –, nicht der X-Server.
   */
  function mitFalschemXvfb(ordner, xvfbZeilen, rumpf) {
    const bin = join(ordner.wurzel, 'bin');
    const sockel = join(ordner.wurzel, 'x11');
    mkdirSync(bin, { recursive: true });
    mkdirSync(sockel, { recursive: true });

    writeFileSync(join(bin, 'Xvfb'), ['#!/bin/sh', ...xvfbZeilen, ''].join('\n'));
    spawnSync('sh', ['-c', 'chmod 0755 "$1"', '_', posix(join(bin, 'Xvfb'))]);

    return spawnSync(
      'sh',
      [
        '-c',
        `PATH="$(cd "$4" && pwd):$PATH"; export PATH; set -eu; . "$1"; . "$2"; . "$3"; ${rumpf}`,
        '_',
        PALANTIR_SH,
        STEAM_SH,
        PROTON_SH,
        posix(bin),
      ],
      {
        encoding: 'utf8',
        timeout: 30_000,
        env: {
          ...process.env,
          PALANTIR_DATA_DIR: posix(ordner.daten),
          PALANTIR_STEAMCMD_DIR: posix(ordner.vorlage),
          PALANTIR_PROTON_DIR: posix(ordner.proton),
          PALANTIR_X11_SOCKET_DIR: posix(sockel),
        },
      },
    );
  }

  it('startet Xvfb und setzt DISPLAY', () => {
    const ordner = arbeitsordner();

    const lauf = mitFalschemXvfb(
      ordner,
      [
        'for a in "$@"; do printf \'xvfb %s\\n\' "$a"; done',
        // Das tut der echte auch: Er öffnet einen Anschluss unter dem Namen
        // des Bildschirms.
        'touch "${PALANTIR_X11_SOCKET_DIR}/X1"',
        'sleep 1',
      ],
      'proton_bildschirm_starten; printf "display %s\\n" "$DISPLAY"',
    );

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.match(lauf.stdout, /display :1\n/u);
    assert.match(lauf.stdout, /xvfb -screen\nxvfb 0\nxvfb 1024x768x24/u);
  });

  it('gibt auf, wenn kein Anschluss entsteht – statt das Spiel ins Leere zu starten', () => {
    // Ein Xvfb, das nichts öffnet: Der Server liefe sonst an, fände keinen
    // Bildschirm und beendete sich mit einer Meldung aus Unity, die von einem
    // fehlenden Bildschirm nichts sagt.
    const lauf = mitFalschemXvfb(
      arbeitsordner(),
      ['sleep 1'],
      'proton_bildschirm_starten || printf "aufgegeben %s\\n" "$?"',
    );

    assert.match(lauf.stdout, /aufgegeben 1\n/u);
    assert.match(lauf.stdout, /keinen Anschluss/u);
  });

  it('sagt es, wenn Xvfb im Image fehlt', () => {
    const ordner = arbeitsordner();
    // Der PATH wird erst **in** der Shell geleert: Von außen fände sich auch
    // `sh` nicht mehr, und der Test prüfte gar nichts.
    const lauf = spawnSync(
      'sh',
      [
        '-c',
        'set -eu; . "$1"; . "$2"; . "$3"; PATH=/nirgendwo; export PATH;' +
          ' proton_bildschirm_starten || printf "aufgegeben %s\\n" "$?"',
        '_',
        PALANTIR_SH,
        STEAM_SH,
        PROTON_SH,
      ],
      {
        encoding: 'utf8',
        timeout: 30_000,
        env: {
          ...process.env,
          PALANTIR_DATA_DIR: posix(ordner.daten),
        },
      },
    );

    assert.match(lauf.stdout, /Xvfb fehlt im Image/u);
    assert.match(lauf.stdout, /aufgegeben 1\n/u);
  });
});
