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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
/**
 * Laesst sich hier ein Ordner schreibgeschuetzt machen?
 *
 * Unter Windows nicht: `chmod 0555` geht durch, und geschrieben werden darf
 * trotzdem. Im Container - und damit in der CI - schon.
 */
const SCHREIBSCHUTZ_MOEGLICH = (() => {
  if (!SH_VORHANDEN) return false;
  const ordner = mkdtempSync(join(tmpdir(), 'palantir-ro-'));
  const lauf = spawnSync('sh', [
    '-c',
    'chmod 0555 "$1" && ! (printf x > "$1/probe" 2>/dev/null)',
    '_',
    posix(ordner),
  ]);
  spawnSync('sh', ['-c', 'chmod 0755 "$1"; rm -rf "$1"', '_', posix(ordner)]);

  return lauf.status === 0;
})();
const nurMitSchreibschutz = {
  skip: SCHREIBSCHUTZ_MOEGLICH ? false : 'Hier laesst sich kein Ordner schreibgeschuetzt machen.',
};

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

/**
 * Das Werkzeug fuer die einmalige Anmeldung (`palantir-steam-anmelden`).
 *
 * Es nimmt dem Betreiber die drei Feinheiten ab, an denen der Aufruf von Hand
 * scheitert - und die erste davon ist heute wirklich passiert: SteamCMD
 * aktualisiert sich in sein eigenes Verzeichnis, und /opt/steamcmd gehoert
 * root. Als Benutzer 1000 endet das in "Steamcmd needs to be online to
 * update", was von etwas ganz anderem spricht.
 */
describe('palantir-steam-anmelden', nurMitShell, () => {
  const WERKZEUG = posix(join(HIER, 'steam-anmelden.sh'));

  /**
   * Ein SteamCMD-Ersatz, der sich verhaelt wie der echte: Er schreibt in sein
   * eigenes Verzeichnis (daran scheitert der Aufruf ohne Kopie) und legt bei
   * Erfolg eine Anmeldung unter `$HOME/Steam/config` ab.
   */
  function aufbauMitAnmeldung({ gelingt = true } = {}) {
    const ordner = aufbau();
    const konto = join(ordner.wurzel, 'konto');
    mkdirSync(konto, { recursive: true });

    writeFileSync(
      join(ordner.vorlage, 'steamcmd.sh'),
      [
        '#!/bin/sh',
        `printf '%s\\n' "$*" >> "${posix(ordner.protokoll)}"`,
        '# Wie der echte: schreibt beim Start in sein eigenes Verzeichnis.',
        'printf \'aktualisiert\\n\' > "$(dirname "$0")/selbstaktualisierung"',
        ...(gelingt
          ? [
              'mkdir -p "$HOME/Steam/config"',
              'printf \'mein-token\\n\' > "$HOME/Steam/config/config.vdf"',
            ]
          : []),
        'exit 0',
        '',
      ].join('\n'),
    );
    spawnSync('sh', ['-c', 'chmod 0755 "$1"', '_', posix(join(ordner.vorlage, 'steamcmd.sh'))]);

    return { ...ordner, konto };
  }

  function anmelden(ordner, argumente = ['nightrider'], extra = {}) {
    return spawnSync('sh', [WERKZEUG, ...argumente], {
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        PALANTIR_STEAM_KONTO_DIR: posix(ordner.konto),
        PALANTIR_STEAMCMD_DIR: posix(ordner.vorlage),
        ...extra,
      },
    });
  }

  it('legt den Token dorthin, wo die Spiel-Images ihn suchen', () => {
    const ordner = aufbauMitAnmeldung();

    const lauf = anmelden(ordner);

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.equal(
      readFileSync(join(ordner.konto, 'Steam', 'config', 'config.vdf'), 'utf8'),
      'mein-token\n',
    );
  });

  it('arbeitet in einer Kopie, nicht in der Vorlage', () => {
    // Der Fehler, der heute aufgetreten ist: SteamCMD aktualisiert sich in sein
    // eigenes Verzeichnis, und das gehoert im Image root.
    const ordner = aufbauMitAnmeldung();

    anmelden(ordner);

    assert.ok(!existsSync(join(ordner.vorlage, 'selbstaktualisierung')));
  });

  it('reicht den Benutzernamen an SteamCMD durch', () => {
    const ordner = aufbauMitAnmeldung();

    anmelden(ordner, ['master7524']);

    assert.match(readFileSync(ordner.protokoll, 'utf8'), /\+login master7524/u);
  });

  it('verlangt einen Benutzernamen', () => {
    const ordner = aufbauMitAnmeldung();

    const lauf = anmelden(ordner, []);

    assert.equal(lauf.status, 64);
    assert.match(lauf.stderr, /Anmeldename/u);
  });

  it('sagt es, wenn der Ordner gar nicht eingehaengt ist', () => {
    const ordner = aufbauMitAnmeldung();

    const lauf = anmelden(ordner, ['nightrider'], {
      PALANTIR_STEAM_KONTO_DIR: posix(join(ordner.wurzel, 'gibtsnicht')),
    });

    assert.equal(lauf.status, 66);
    assert.match(lauf.stderr, /eingehängt|eingehaengt/u);
  });

  it('sagt es, wenn die Anmeldung nichts hinterlassen hat', () => {
    // Der haeufigste Fall: falscher Benutzername. SteamCMD endet dann mit 0.
    const ordner = aufbauMitAnmeldung({ gelingt: false });

    const lauf = anmelden(ordner);

    assert.equal(lauf.status, 75);
    assert.match(lauf.stderr, /keine Anmeldung hinterlassen/u);
  });
});

/**
 * Der Ablageort wird VOR der Anmeldung geprueft (2026-09-11).
 *
 * Am Ende zu erfahren, dass eine Datei nicht geschrieben werden darf, heisst:
 * Passwort noch einmal eingeben und die Anmeldung in der Steam-App noch einmal
 * bestaetigen. Genau so ist es passiert - der Unterordner `Steam/` stammte aus
 * einem frueheren Lauf als `root`.
 */
describe('palantir-steam-anmelden: Vorpruefung', nurMitSchreibschutz, () => {
  const WERKZEUG = posix(join(HIER, 'steam-anmelden.sh'));

  it('bricht ab, bevor SteamCMD ueberhaupt gerufen wird', () => {
    const ordner = aufbau();
    const konto = join(ordner.wurzel, 'konto');
    // Ein Unterordner, in den nicht geschrieben werden darf - so wie ein
    // Ueberbleibsel aus einem Lauf als `root`.
    mkdirSync(join(konto, 'Steam', 'config'), { recursive: true });
    spawnSync('sh', ['-c', 'chmod 0555 "$1"', '_', posix(join(konto, 'Steam', 'config'))]);

    const lauf = spawnSync('sh', [WERKZEUG, 'nightrider'], {
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        PALANTIR_STEAM_KONTO_DIR: posix(konto),
        PALANTIR_STEAMCMD_DIR: posix(ordner.vorlage),
      },
    });

    assert.equal(lauf.status, 77);
    assert.match(lauf.stderr, /chown -R 1000:1000/u);
    assert.match(lauf.stderr, /nichts zu verlieren/u);
    // Entscheidend: SteamCMD wurde nicht gerufen.
    assert.ok(!existsSync(ordner.protokoll));
  });
});
