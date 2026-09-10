/**
 * Prüfungen für `palantir.sh` und `console.sh` – ohne Docker.
 *
 * Beide sind POSIX-Shell und lassen sich mit `sh` ausführen, wenn ein
 * Datenordner gestellt wird (`PALANTIR_DATA_DIR`). Geprüft wird genau das, was
 * jedes Spiel-Image von der Wurzel erbt: die Orte im Datenordner, das
 * Konsolen-Rohr samt Exit-Codes, und das Holen einer Datei mit Prüfsumme.
 *
 * Die Bibliothek wird dabei unter `set -eu` eingebunden, wie in jedem
 * Startskript: Eine Funktion, die dort eine ungesetzte Variable liest oder still
 * scheitert, risse den Serverstart mit – und das soll hier auffallen, nicht auf
 * der Node.
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
const PALANTIR_SH = posix(join(HIER, 'palantir.sh'));
const CONSOLE_SH = posix(join(HIER, 'console.sh'));

/**
 * Steht eine POSIX-Shell zur Verfügung?
 *
 * Auf einem Windows-Arbeitsplatz ohne Git-Bash gibt es keine – dann wird
 * übersprungen statt zu scheitern. In der CI (ubuntu-latest) ist `sh` immer da.
 */
const SH_VORHANDEN = spawnSync('sh', ['-c', 'exit 0']).error === undefined;
const nurMitShell = { skip: SH_VORHANDEN ? false : 'Keine POSIX-Shell (sh) im PATH.' };

const aufraeumen = [];

after(() => {
  for (const pfad of aufraeumen) {
    spawnSync('sh', ['-c', 'rm -rf "$1"', '_', posix(pfad)]);
  }
});

/** Legt einen Datenordner an. */
function datenordner() {
  const wurzel = mkdtempSync(join(tmpdir(), 'palantir-linux-'));
  aufraeumen.push(wurzel);
  const daten = join(wurzel, 'daten');
  mkdirSync(daten);

  return { wurzel, daten };
}

/** Führt ein Stück Shell aus, das die Bibliothek eingebunden hat. */
function mitBibliothek(ordner, rumpf, umgebung = {}) {
  return spawnSync('sh', ['-c', `set -eu; . "$1"; ${rumpf}`, '_', PALANTIR_SH], {
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, PALANTIR_DATA_DIR: posix(ordner.daten), ...umgebung },
  });
}

describe('palantir.sh – Orte im Datenordner', nurMitShell, () => {
  it('leitet den internen Ordner und das Rohr aus dem Datenordner ab', () => {
    const ordner = datenordner();

    const lauf = mitBibliothek(
      ordner,
      'printf "%s|%s|%s\\n" "$PALANTIR_DATENORDNER" "$PALANTIR_INTERN" "$PALANTIR_KONSOLE"',
    );

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.equal(
      lauf.stdout.trim(),
      `${posix(ordner.daten)}|${posix(ordner.daten)}/.palantir|${posix(ordner.daten)}/.palantir/console.in`,
    );
  });

  it('legt den internen Ordner an, ohne über einen zweiten Aufruf zu stolpern', () => {
    const ordner = datenordner();

    const lauf = mitBibliothek(
      ordner,
      'palantir_intern_anlegen; palantir_intern_anlegen; test -d "$PALANTIR_INTERN"',
    );

    assert.equal(lauf.status, 0, lauf.stderr);
  });

  it('schreibt Logzeilen mit dem gemeinsamen Präfix', () => {
    const ordner = datenordner();

    const lauf = mitBibliothek(ordner, 'palantir_log "Hallo Welt"');

    assert.equal(lauf.stdout.trim(), '[palantir] Hallo Welt');
  });
});

describe('palantir.sh – Konsolen-Rohr', nurMitShell, () => {
  it('legt ein Rohr an, das offen bleibt, wenn niemand schreibt', () => {
    const ordner = datenordner();

    // Genau der Ablauf eines Startskripts: Rohr oeffnen, dann den Server per
    // `exec` daran haengen. `cat` steht hier fuer den Server; ohne den offenen
    // Schreib-Deskriptor bekaeme es sofort EOF und endete.
    const lauf = mitBibliothek(
      ordner,
      'palantir_intern_anlegen; palantir_konsole_oeffnen; test -p "$PALANTIR_KONSOLE"; ' +
        '(printf "%s\\n" "hallo" > "$PALANTIR_KONSOLE") & exec timeout 5 head -n 1 <&3',
    );

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.equal(lauf.stdout.trim(), 'hallo');
  });

  it('ersetzt ein Rohr aus einem früheren Lauf', () => {
    const ordner = datenordner();
    mkdirSync(join(ordner.daten, '.palantir'));
    writeFileSync(join(ordner.daten, '.palantir', 'console.in'), 'kein Rohr, sondern eine Datei');

    const lauf = mitBibliothek(ordner, 'palantir_konsole_oeffnen; test -p "$PALANTIR_KONSOLE"');

    assert.equal(lauf.status, 0, lauf.stderr);
  });
});

describe('console.sh – Anschluss von aussen', nurMitShell, () => {
  /** Ruft `console.sh` mit den übergebenen Argumenten auf. */
  function konsole(ordner, ...argumente) {
    return spawnSync('sh', [CONSOLE_SH, ...argumente], {
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, PALANTIR_DATA_DIR: posix(ordner.daten) },
    });
  }

  it('meldet Code 2, wenn gar kein Befehl kommt', () => {
    const ordner = datenordner();

    const lauf = konsole(ordner);

    assert.equal(lauf.status, 2);
    assert.match(lauf.stderr, /Aufruf: palantir-console/u);
  });

  it('meldet Code 1, solange kein Server lauscht', () => {
    const ordner = datenordner();

    const lauf = konsole(ordner, 'list');

    assert.equal(lauf.status, 1);
    assert.match(lauf.stderr, /nicht erreichbar/u);
  });

  it('übergibt den ganzen Befehl mit Leerzeichen an das Rohr', () => {
    const ordner = datenordner();
    const gelesen = posix(join(ordner.wurzel, 'gelesen.txt'));

    // Ein Leser muss offen sein - im Betrieb ist das der Server, dessen
    // Standardeingabe am Rohr haengt.
    const lauf = spawnSync(
      'sh',
      [
        '-c',
        'mkdir -p "$1/.palantir"; mkfifo -m 600 "$1/.palantir/console.in"; ' +
          '(head -n 1 <"$1/.palantir/console.in" >"$2") & ' +
          'PALANTIR_DATA_DIR="$1" sh "$3" say Wartungsarbeiten in 5 Minuten; wait',
        '_',
        posix(ordner.daten),
        gelesen,
        CONSOLE_SH,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );

    assert.equal(lauf.status, 0, `${lauf.stdout}${lauf.stderr}`);
    assert.equal(
      readFileSync(join(ordner.wurzel, 'gelesen.txt'), 'utf8').trim(),
      'say Wartungsarbeiten in 5 Minuten',
    );
  });
});

describe('palantir.sh – Dateien holen', nurMitShell, () => {
  /**
   * Statt eines echten Downloads ein `curl` im PATH, das eine vorbereitete
   * Datei kopiert. Geprüft wird die Logik drumherum – Prüfsumme, Zwischenname,
   * zweiter Lauf –, nicht das Netz.
   */
  function mitFalschemCurl(ordner, inhalt, rumpf) {
    const bin = join(ordner.wurzel, 'bin');
    mkdirSync(bin, { recursive: true });
    const quelle = join(ordner.wurzel, 'quelle.bin');
    writeFileSync(quelle, inhalt);
    writeFileSync(
      join(bin, 'curl'),
      [
        '#!/bin/sh',
        'ziel=""',
        'for a in "$@"; do',
        '  case "$vorher" in --output) ziel="$a";; esac',
        '  vorher="$a"',
        'done',
        `cp "${posix(quelle)}" "$ziel"`,
        '',
      ].join('\n'),
    );
    spawnSync('sh', ['-c', 'chmod 0755 "$1"', '_', posix(join(bin, 'curl'))]);

    return spawnSync(
      'sh',
      [
        '-c',
        `PATH="$(cd "$1" && pwd):$PATH"; export PATH; set -eu; . "$2"; ${rumpf}`,
        '_',
        posix(bin),
        PALANTIR_SH,
      ],
      {
        encoding: 'utf8',
        timeout: 30_000,
        env: { ...process.env, PALANTIR_DATA_DIR: posix(ordner.daten) },
      },
    );
  }

  // sha256 von "hallo\n" - fest eingetragen, damit der Test die Summe nicht
  // selbst ausrechnet und damit denselben Fehler machen koennte wie der Code.
  const INHALT = 'hallo\n';
  const SUMME = 'b0f7d8f0f1e4b0d7b0e4d3e4e6f8e3a1c1a1f4d3e0e0b8a7c9d5e2f1a3b4c5d6';

  it('verwirft eine Datei, deren Prüfsumme nicht passt', () => {
    const ordner = datenordner();

    const lauf = mitFalschemCurl(
      ordner,
      INHALT,
      `palantir_datei_holen "https://beispiel.invalid/x" "${SUMME}" "$PALANTIR_DATENORDNER/x.bin" || echo VERWORFEN`,
    );

    assert.match(lauf.stdout, /Die Prüfsumme passt nicht/u);
    assert.match(lauf.stdout, /VERWORFEN/u);
    // Weder die fertige Datei noch der Zwischenname bleiben liegen.
    const rest = spawnSync('sh', ['-c', 'ls "$1"', '_', posix(ordner.daten)], { encoding: 'utf8' });
    assert.doesNotMatch(rest.stdout, /x\.bin/u);
  });

  it('holt die Datei, wenn die Prüfsumme stimmt, und lässt sie beim zweiten Lauf liegen', () => {
    const ordner = datenordner();
    // Die Summe kommt aus der Datei selbst, nicht aus einer Zeichenkette im
    // Test: Ein Argument mit Zeilenumbruch ueberlebt den Weg durch die Windows-
    // Prozessgrenze nicht zuverlaessig.
    const quellePfad = join(ordner.wurzel, 'summe-quelle.bin');
    writeFileSync(quellePfad, INHALT);
    const echteSumme = spawnSync(
      'sh',
      ['-c', 'sha256sum "$1" | cut -d" " -f1', '_', posix(quellePfad)],
      {
        encoding: 'utf8',
      },
    ).stdout.trim();

    const lauf = mitFalschemCurl(
      ordner,
      INHALT,
      `palantir_datei_holen "https://beispiel.invalid/x" "${echteSumme}" "$PALANTIR_DATENORDNER/x.bin"; ` +
        `palantir_datei_holen "https://beispiel.invalid/x" "${echteSumme}" "$PALANTIR_DATENORDNER/x.bin"`,
    );

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.match(lauf.stdout, /Geholt und geprüft/u);
    // Der zweite Aufruf laedt nicht erneut.
    assert.match(lauf.stdout, /Vorhanden und unverändert/u);
    assert.equal(readFileSync(join(ordner.daten, 'x.bin'), 'utf8'), INHALT);
  });
});

/**
 * Einstellungen verschmelzen (seit Fassung 2).
 *
 * Die Funktion stand bis dahin im Startskript von Minecraft und gilt für jede
 * Konfigurationsdatei aus `schlüssel=wert`-Zeilen. Geprüft wird das
 * Versprechen, das sie gibt: Was das Panel verwaltet, bekommt den neuen Wert –
 * alles andere bleibt, wie der Betreiber es hinterlassen hat.
 */
describe('palantir.sh – Einstellungen verschmelzen', nurMitShell, () => {
  /** Schreibt die verwalteten Schlüssel und verschmilzt sie in die Zieldatei. */
  function verschmelzen(ordner, paare, vorhanden = null) {
    const verwaltet = join(ordner.wurzel, 'verwaltet.txt');
    const ziel = join(ordner.daten, 'config.txt');

    writeFileSync(verwaltet, '');
    if (vorhanden !== null) writeFileSync(ziel, vorhanden);

    const zeilen = paare
      .map(([schluessel, wert]) => `palantir_eigenschaft "$1" '${schluessel}' '${wert}'`)
      .join('; ');

    const lauf = spawnSync(
      'sh',
      [
        '-c',
        `set -eu; . "$3"; ${zeilen}; palantir_schluessel_verschmelzen "$1" "$2"`,
        '_',
        posix(verwaltet),
        posix(ziel),
        PALANTIR_SH,
      ],
      { encoding: 'utf8', timeout: 30_000, env: { ...process.env } },
    );

    return { lauf, inhalt: lauf.status === 0 ? readFileSync(ziel, 'utf8') : '' };
  }

  it('legt die verwalteten Schlüssel an, wenn es die Datei noch nicht gibt', () => {
    const { lauf, inhalt } = verschmelzen(datenordner(), [
      ['port', '7777'],
      ['motd', 'Ein Palantir-Server'],
    ]);

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.match(inhalt, /^port=7777$/mu);
    assert.match(inhalt, /^motd=Ein Palantir-Server$/mu);
  });

  it('lässt Kommentare und fremde Schlüssel des Betreibers stehen', () => {
    const { inhalt } = verschmelzen(
      datenordner(),
      [['port', '7777']],
      ['# von Hand', 'npcstream=60', 'port=1234', ''].join('\n'),
    );

    assert.match(inhalt, /^# von Hand$/mu);
    assert.match(inhalt, /^npcstream=60$/mu);
    // Derselbe Platz, neuer Wert.
    assert.match(inhalt, /^port=7777$/mu);
    assert.doesNotMatch(inhalt, /^port=1234$/mu);
  });

  it('ersetzt einen doppelt vorhandenen Schlüssel genau einmal', () => {
    // Die meisten Leser nehmen den letzten Treffer: Bliebe die zweite Zeile
    // stehen, überschriebe eine alte Dublette die frische Einstellung.
    const { inhalt } = verschmelzen(
      datenordner(),
      [['port', '7777']],
      ['port=1234', 'motd=hallo', 'port=4321', ''].join('\n'),
    );

    assert.deepEqual(
      inhalt.split('\n').filter((zeile) => zeile.startsWith('port=')),
      ['port=7777'],
    );
    assert.match(inhalt, /^motd=hallo$/mu);
  });

  it('macht aus einem mehrzeiligen Wert keine zweite Zeile', () => {
    const { inhalt } = verschmelzen(datenordner(), [['motd', 'erste\nzweite']]);

    assert.match(inhalt, /^motd=erstezweite$/mu);
  });
});

/**
 * Auspacken (seit Fassung 2).
 *
 * Ein Zip lässt sich mit Bordmitteln einer POSIX-Shell nicht öffnen; deshalb
 * liegt `unzip` seit dieser Fassung im Image. Der Test baut sich sein Archiv
 * selbst – ohne `zip` im PATH wird übersprungen.
 */
describe('palantir.sh – Archiv auspacken', nurMitShell, () => {
  const werkzeugeDa = spawnSync('sh', ['-c', 'command -v zip && command -v unzip']).status === 0;
  const nurMitZip = { skip: werkzeugeDa ? false : 'zip/unzip nicht im PATH.' };

  it('packt in den Zielordner aus und legt ihn an', nurMitZip, () => {
    const ordner = datenordner();
    const quelle = join(ordner.wurzel, 'inhalt.txt');
    writeFileSync(quelle, 'hallo');
    const archiv = join(ordner.wurzel, 'archiv.zip');
    spawnSync('sh', [
      '-c',
      'cd "$(dirname "$1")" && zip -q "$2" "$(basename "$1")"',
      '_',
      posix(quelle),
      posix(archiv),
    ]);

    const lauf = mitBibliothek(
      ordner,
      `palantir_zip_auspacken "${posix(archiv)}" "$PALANTIR_DATENORDNER/entpackt"`,
    );

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.equal(readFileSync(join(ordner.daten, 'entpackt', 'inhalt.txt'), 'utf8'), 'hallo');
  });

  it('meldet ein kaputtes Archiv, statt still weiterzumachen', nurMitZip, () => {
    const ordner = datenordner();
    const archiv = join(ordner.wurzel, 'kaputt.zip');
    writeFileSync(archiv, 'das ist kein Archiv');

    const lauf = mitBibliothek(
      ordner,
      `palantir_zip_auspacken "${posix(archiv)}" "$PALANTIR_DATENORDNER/entpackt" || echo GESCHEITERT`,
    );

    assert.match(lauf.stdout, /GESCHEITERT/u);
    assert.match(lauf.stdout, /liess sich nicht auspacken/u);
  });
});
