/**
 * Prüfungen für `steam.sh` – ohne Docker und ohne Steam.
 *
 * Die Bibliothek ist POSIX-Shell. Geprüft wird, was sie entscheidet, nicht was
 * Valve tut: dass SteamCMD in den Datenordner kommt (weil das Wurzeldateisystem
 * schreibgeschützt ist), dass `HOME` mitwandert, mit welchen Argumenten
 * SteamCMD aufgerufen wird und dass ein Fehlschlag dreimal wiederholt wird.
 *
 * Statt SteamCMD steht ein Skript im PATH der Vorlage, das seine Argumente
 * aufschreibt und einen einstellbaren Exit-Code liefert.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/** Pfad in der Schreibweise, die eine POSIX-Shell versteht (Windows: `C:\…`). */
const posix = (pfad) => pfad.replace(/\\/gu, '/');

const HIER = fileURLToPath(new URL('.', import.meta.url));
const STEAM_SH = posix(join(HIER, 'steam.sh'));
const PALANTIR_SH = posix(join(HIER, '..', 'linux', 'palantir.sh'));

const SH_VORHANDEN = spawnSync('sh', ['-c', 'exit 0']).error === undefined;
const nurMitShell = { skip: SH_VORHANDEN ? false : 'Keine POSIX-Shell (sh) im PATH.' };

const aufraeumen = [];

after(() => {
  for (const pfad of aufraeumen) {
    spawnSync('sh', ['-c', 'rm -rf "$1"', '_', posix(pfad)]);
  }
});

/**
 * Legt Datenordner und eine SteamCMD-Vorlage an. Das falsche `steamcmd.sh`
 * schreibt seine Argumente in eine Datei und liefert `exitCode`.
 */
function aufbau({ exitCode = 0 } = {}) {
  const wurzel = mkdtempSync(join(tmpdir(), 'palantir-steam-'));
  aufraeumen.push(wurzel);

  const daten = join(wurzel, 'daten');
  const vorlage = join(wurzel, 'vorlage');
  mkdirSync(daten);
  mkdirSync(vorlage);

  const protokoll = join(wurzel, 'aufrufe.txt');
  writeFileSync(
    join(vorlage, 'steamcmd.sh'),
    [
      '#!/bin/sh',
      `printf '%s\\n' "$*" >> "${posix(protokoll)}"`,
      `exit ${String(exitCode)}`,
      '',
    ].join('\n'),
  );
  // Eine zweite Datei, damit sich prüfen lässt, dass der ganze Ordner mitkommt.
  writeFileSync(join(vorlage, 'linux32'), 'stellvertreter');
  spawnSync('sh', ['-c', 'chmod 0755 "$1"', '_', posix(join(vorlage, 'steamcmd.sh'))]);

  return { wurzel, daten, vorlage, protokoll };
}

/** Führt Shell aus, die beide Bibliotheken eingebunden hat. */
function mitBibliothek(ordner, rumpf) {
  return spawnSync('sh', ['-c', `set -eu; . "$1"; . "$2"; ${rumpf}`, '_', PALANTIR_SH, STEAM_SH], {
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      PALANTIR_DATA_DIR: posix(ordner.daten),
      PALANTIR_STEAMCMD_DIR: posix(ordner.vorlage),
    },
  });
}

describe('steam_vorbereiten', nurMitShell, () => {
  it('kopiert SteamCMD in den Datenordner, weil dort geschrieben werden darf', () => {
    const ordner = aufbau();

    const lauf = mitBibliothek(
      ordner,
      'palantir_intern_anlegen; steam_vorbereiten; test -x "$STEAM_CMD"; test -f "$STEAM_HEIM/linux32"; printf "%s\\n" "$HOME"',
    );

    assert.equal(lauf.status, 0, lauf.stderr);
    // `HOME` zeigt in den internen Ordner - sonst legte SteamCMD seinen
    // Zwischenspeicher zwischen die Spielstände des Betreibers.
    assert.ok(lauf.stdout.includes(`${posix(ordner.daten)}/.palantir/steam`));
  });

  it('kopiert beim zweiten Aufruf nicht erneut', () => {
    const ordner = aufbau();

    const lauf = mitBibliothek(
      ordner,
      'palantir_intern_anlegen; steam_vorbereiten; printf "%s" "veraendert" > "$STEAM_HEIM/linux32"; ' +
        'steam_vorbereiten; cat "$STEAM_HEIM/linux32"',
    );

    assert.equal(lauf.status, 0, lauf.stderr);
    // Bliebe die Kopie nicht liegen, ginge bei jedem Start die
    // Selbstaktualisierung von SteamCMD verloren. Die Logzeilen des Skripts
    // tragen ein `[palantir]` davor und werden hier aussortiert.
    const ausgabe = lauf.stdout
      .split('\n')
      .map((zeile) => zeile.replace(/\r$/u, ''))
      .filter((zeile) => zeile.length > 0 && !zeile.startsWith('[palantir]'));
    assert.deepEqual(ausgabe, ['veraendert']);
  });
});

describe('steam_app_holen', nurMitShell, () => {
  it('ruft SteamCMD mit Zielordner, anonymer Anmeldung und Anwendungsnummer auf', () => {
    const ordner = aufbau();

    const lauf = mitBibliothek(
      ordner,
      'palantir_intern_anlegen; steam_app_holen 896660 "$PALANTIR_DATENORDNER/server"',
    );

    assert.equal(lauf.status, 0, lauf.stderr);
    const aufrufe = readFileSync(ordner.protokoll, 'utf8').trim().split('\n');
    assert.equal(aufrufe.length, 1);
    assert.equal(
      aufrufe[0],
      `+force_install_dir ${posix(ordner.daten)}/server +login anonymous +app_update 896660 +quit`,
    );
    // Kein `validate`: Das raeumte die Mods des Betreibers weg.
    assert.doesNotMatch(aufrufe[0], /validate/u);
  });

  it('legt den Zielordner an, wenn es ihn noch nicht gibt', () => {
    const ordner = aufbau();

    const lauf = mitBibliothek(
      ordner,
      'palantir_intern_anlegen; steam_app_holen 896660 "$PALANTIR_DATENORDNER/server"; test -d "$PALANTIR_DATENORDNER/server"',
    );

    assert.equal(lauf.status, 0, lauf.stderr);
  });

  it('versucht es dreimal und meldet danach einen Fehlschlag', () => {
    const ordner = aufbau({ exitCode: 1 });

    const lauf = mitBibliothek(
      ordner,
      'palantir_intern_anlegen; steam_app_holen 896660 "$PALANTIR_DATENORDNER/server" || printf "GESCHEITERT\\n"',
    );

    const aufrufe = readFileSync(ordner.protokoll, 'utf8').trim().split('\n');
    assert.equal(aufrufe.length, 3);
    assert.match(lauf.stdout, /GESCHEITERT/u);
    assert.match(lauf.stdout, /dreimal gescheitert/u);
  });
});
