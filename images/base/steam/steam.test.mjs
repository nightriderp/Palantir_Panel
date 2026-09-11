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
function mitBibliothek(ordner, rumpf, extra = {}) {
  return spawnSync('sh', ['-c', `set -eu; . "$1"; . "$2"; ${rumpf}`, '_', PALANTIR_SH, STEAM_SH], {
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      PALANTIR_DATA_DIR: posix(ordner.daten),
      PALANTIR_STEAMCMD_DIR: posix(ordner.vorlage),
      ...extra,
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

/**
 * Der Anmelde-Token (2026-09-11).
 *
 * Ein paar Spiele geben ihren dedizierten Server nicht anonym heraus - Assetto
 * Corsa Competizione endet mit "No subscription". Fuer sie meldet sich der
 * Betreiber einmal von Hand auf der Node an; der Token wird schreibgeschuetzt
 * eingehaengt, und diese Bibliothek uebernimmt ihn.
 */
describe('steam_konto_uebernehmen', nurMitShell, () => {
  /** Legt einen Token-Ordner an, so wie SteamCMD ihn hinterlaesst. */
  function mitToken(ordner, unterordner) {
    const konto = join(ordner.wurzel, 'steam-konto');
    const ziel = unterordner === '' ? konto : join(konto, ...unterordner.split('/'));
    mkdirSync(ziel, { recursive: true });
    writeFileSync(join(ziel, 'config.vdf'), 'mein-token\n');

    return posix(konto);
  }

  it('kopiert den Token dorthin, wo SteamCMD ihn sucht', () => {
    // Kopiert und nicht direkt benutzt: SteamCMD schreibt in seine
    // Konfiguration, und die Einhaengung ist schreibgeschuetzt.
    const ordner = aufbau();
    const konto = mitToken(ordner, 'Steam/config');

    const lauf = mitBibliothek(
      ordner,
      'palantir_intern_anlegen; steam_konto_uebernehmen; cat "$STEAM_HEIM/Steam/config/config.vdf"',
      { PALANTIR_STEAM_KONTO_DIR: konto },
    );

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.match(lauf.stdout, /mein-token/u);
  });

  it('findet ihn auch, wenn nur die eine Datei dort liegt', () => {
    const ordner = aufbau();
    const konto = mitToken(ordner, '');

    const lauf = mitBibliothek(
      ordner,
      'palantir_intern_anlegen; steam_konto_uebernehmen; cat "$STEAM_HEIM/Steam/config/config.vdf"',
      { PALANTIR_STEAM_KONTO_DIR: konto },
    );

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.match(lauf.stdout, /mein-token/u);
  });

  it('meldet ohne Token einen Fehlschlag, statt still weiterzumachen', () => {
    // Der Aufrufer entscheidet, was das heisst - bei einem Spiel, das ohne
    // Konto gar nicht laedt, ist es das Ende.
    const ordner = aufbau();

    const lauf = mitBibliothek(
      ordner,
      'palantir_intern_anlegen; steam_konto_uebernehmen || printf "kein Token (%s)\n" "$?"',
      { PALANTIR_STEAM_KONTO_DIR: posix(join(ordner.wurzel, 'gibtsnicht')) },
    );

    assert.match(lauf.stdout, /kein Token \(1\)/u);
  });
});

describe('steam_app_holen mit Konto', nurMitShell, () => {
  it('meldet sich anonym an, solange niemand etwas anderes sagt', () => {
    const ordner = aufbau();

    mitBibliothek(ordner, 'palantir_intern_anlegen; steam_app_holen 730 "$PALANTIR_DATENORDNER/s"');

    assert.match(readFileSync(ordner.protokoll, 'utf8'), /\+login anonymous/u);
  });

  it('nimmt den Benutzernamen aus STEAM_LOGIN', () => {
    const ordner = aufbau();

    mitBibliothek(
      ordner,
      'palantir_intern_anlegen; steam_app_holen 1430110 "$PALANTIR_DATENORDNER/s"',
      { STEAM_LOGIN: 'nightrider' },
    );

    const protokoll = readFileSync(ordner.protokoll, 'utf8');
    assert.match(protokoll, /\+login nightrider/u);
    assert.ok(!protokoll.includes('anonymous'));
  });
});
