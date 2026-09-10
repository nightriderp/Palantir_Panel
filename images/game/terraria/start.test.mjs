/**
 * Prüfungen für `start.sh` des Terraria-Images – ohne Docker und ohne Terraria.
 *
 * Gestellt werden drei Dinge: ein Datenordner, ein `TerrariaServer.bin.x86_64`
 * an der Stelle, an der das Skript ihn erwartet, und – wo der Download geprüft
 * wird – ein `curl`, das eine vorbereitete Datei ausliefert. Damit sind genau
 * die Entscheidungen prüfbar, die das Skript trifft: die verwalteten Schlüssel
 * in `serverconfig.txt`, die Trennung von Serverdateien und Welten, und das
 * Verhalten beim Stoppsignal.
 *
 * Der letzte Punkt ist der wichtigste. Terraria speichert bei SIGTERM nicht;
 * das Skript fängt das Signal deshalb ab und schickt `exit` in die Konsole. Ob
 * das wirklich passiert, lässt sich hier messen – die Attrappe schreibt jede
 * Zeile auf, die sie von der Standardeingabe bekommt.
 */

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/** Pfad in der Schreibweise, die eine POSIX-Shell versteht (Windows: `C:\…`). */
const posix = (pfad) => pfad.replace(/\\/gu, '/');

const HIER = fileURLToPath(new URL('.', import.meta.url));
const START_SH = posix(join(HIER, 'start.sh'));
const BAU = '1458';

/** Die Bibliothek der Wurzel, so wie sie im Container unter `/opt/palantir/lib` liegt. */
const LIB_ORDNER = (() => {
  const ziel = mkdtempSync(join(tmpdir(), 'palantir-lib-'));
  copyFileSync(join(HIER, '..', '..', 'base', 'linux', 'palantir.sh'), join(ziel, 'palantir.sh'));

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
 * `serverDa` steuert, ob die Serverdatei schon ausgepackt ist – ohne sie geht
 * das Skript in den Download-Zweig.
 */
function arbeitsordner({ serverDa = true } = {}) {
  const wurzel = mkdtempSync(join(tmpdir(), 'palantir-terraria-'));
  aufraeumen.push(wurzel);

  const daten = join(wurzel, 'daten');
  const bin = join(wurzel, 'bin');
  mkdirSync(daten);
  mkdirSync(bin);

  if (serverDa) {
    const ordner = join(daten, '.palantir', 'server', BAU, 'Linux');
    mkdirSync(ordner, { recursive: true });

    // Die Attrappe schreibt ihre Argumente und danach jede Zeile von der
    // Standardeingabe auf. Bei `exit` endet sie – genau wie der echte Server.
    const datei = join(ordner, 'TerrariaServer.bin.x86_64');
    writeFileSync(
      datei,
      [
        '#!/bin/sh',
        'for arg in "$@"; do printf \'argv %s\\n\' "$arg"; done',
        '# Ohne TEST_SERVER_WARTET endet die Attrappe sofort. Sonst hinge jeder',
        '# Test an einem Rohr, das nie schliesst - nur der Signal-Test will das.',
        'if [ -z "${TEST_SERVER_WARTET:-}" ]; then exit 0; fi',
        'while IFS= read -r zeile; do',
        '  printf \'stdin %s\\n\' "$zeile"',
        '  if [ "$zeile" = "exit" ]; then exit 0; fi',
        'done',
        'exit 0',
        '',
      ].join('\n'),
    );
    spawnSync('sh', ['-c', 'chmod 0755 "$1"', '_', posix(datei)]);
  }

  return { wurzel, daten, bin };
}

const umgebung = (ordner, extra = {}) => ({
  ...process.env,
  PALANTIR_DATA_DIR: posix(ordner.daten),
  PALANTIR_LIB_DIR: LIB_ORDNER,
  PALANTIR_STARTUP_PARAMETERS: '',
  TERRARIA_BUILD: BAU,
  TERRARIA_URL: 'https://beispiel.invalid/terraria.zip',
  TERRARIA_SHA256: '0'.repeat(64),
  ...extra,
});

/** Führt `start.sh` aus und wartet auf sein Ende. */
function starte(ordner, extra = {}) {
  const ergebnis = spawnSync(
    'sh',
    [
      '-c',
      'PATH="$(cd "$1" && pwd):$PATH"; export PATH; exec sh "$2"',
      '_',
      posix(ordner.bin),
      START_SH,
    ],
    { encoding: 'utf8', timeout: 60_000, env: umgebung(ordner, extra) },
  );

  return {
    ...ergebnis,
    zeilen: (ergebnis.stdout ?? '')
      .split('\n')
      .map((zeile) => zeile.replace(/\r$/u, ''))
      .filter((zeile) => zeile.length > 0),
  };
}

/** Wartet, bis `bedingung()` zutrifft – oder scheitert nach 30 Sekunden. */
function warteAuf(bedingung, meldung) {
  return new Promise((fertig, scheitern) => {
    const frist = setTimeout(() => {
      clearInterval(schauen);
      scheitern(new Error(meldung()));
    }, 30_000);
    const schauen = setInterval(() => {
      if (bedingung()) {
        clearInterval(schauen);
        clearTimeout(frist);
        fertig();
      }
    }, 50);
  });
}

function einstellungen(ordner) {
  return readFileSync(join(ordner.daten, 'serverconfig.txt'), 'utf8');
}

/** Liest einen Schlüssel aus `serverconfig.txt`. */
function wert(ordner, schluessel) {
  const treffer = einstellungen(ordner)
    .split('\n')
    .find((zeile) => zeile.startsWith(`${schluessel}=`));

  return treffer === undefined ? null : treffer.slice(schluessel.length + 1);
}

describe('start.sh – Serverdateien', nurMitShell, () => {
  it('meldet eine gescheiterte Beschaffung mit 69 statt mit einem Absturz', () => {
    // Ohne `curl` im PATH einer leeren Umgebung scheitert der Download –
    // derselbe Weg, den auch eine Störung bei terraria.org nimmt.
    const lauf = starte(arbeitsordner({ serverDa: false }));

    assert.equal(lauf.status, 69);
    assert.match(lauf.stdout, /konnten nicht geholt werden|Prüfsumme|Download/u);
  });

  it('lädt nicht erneut, wenn die Serverdatei schon da ist', () => {
    const lauf = starte(arbeitsordner());

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.doesNotMatch(lauf.stdout, /Hole /u);
  });
});

describe('start.sh – serverconfig.txt', nurMitShell, () => {
  it('legt die verwalteten Schlüssel an und zeigt auf den Weltordner', () => {
    const ordner = arbeitsordner();

    const lauf = starte(ordner, { TERRARIA_WORLD: 'Nordheim', MAX_PLAYERS: '16' });

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.equal(wert(ordner, 'worldname'), 'Nordheim');
    assert.equal(wert(ordner, 'maxplayers'), '16');
    assert.equal(wert(ordner, 'worldpath'), `${posix(ordner.daten)}/welten`);
    // Die Welt liegt neben den Serverdateien, nicht darin: Eine neue
    // Spielfassung ersetzt den Serverordner vollständig.
    assert.equal(wert(ordner, 'world'), `${posix(ordner.daten)}/welten/Nordheim.wld`);
  });

  it('schaltet UPnP ab – der Weg nach draußen führt durch den Tunnel', () => {
    const ordner = arbeitsordner();

    starte(ordner);

    assert.equal(wert(ordner, 'upnp'), '0');
    assert.equal(wert(ordner, 'secure'), '1');
  });

  it('übersetzt Weltgröße und Spielart in die Zahlen, die Terraria kennt', () => {
    const ordner = arbeitsordner();

    starte(ordner, { TERRARIA_SIZE: 'groß', TERRARIA_DIFFICULTY: 'meister' });

    assert.equal(wert(ordner, 'autocreate'), '3');
    assert.equal(wert(ordner, 'difficulty'), '2');
  });

  it('startet nicht mit einer Weltgröße, die es nicht gibt', () => {
    // 78 ist EX_CONFIG. Ohne die Prüfung schriebe das Skript den Unsinn in die
    // Datei, und Terraria legte wortlos eine kleine Welt an.
    const lauf = starte(arbeitsordner(), { TERRARIA_SIZE: 'riesig' });

    assert.equal(lauf.status, 78);
    assert.match(lauf.stdout, /Unbekannte Weltgröße/u);
  });

  it('lässt fremde Schlüssel und Kommentare des Betreibers stehen', () => {
    const ordner = arbeitsordner();
    writeFileSync(
      join(ordner.daten, 'serverconfig.txt'),
      ['# von Hand gesetzt', 'npcstream=60', 'maxplayers=99', ''].join('\n'),
    );

    starte(ordner, { MAX_PLAYERS: '8' });

    const inhalt = einstellungen(ordner);
    assert.match(inhalt, /^# von Hand gesetzt$/mu);
    assert.equal(wert(ordner, 'npcstream'), '60');
    // Der verwaltete Schlüssel bekommt den neuen Wert – an derselben Stelle.
    assert.equal(wert(ordner, 'maxplayers'), '8');
  });
});

describe('start.sh – Aufruf des Servers', nurMitShell, () => {
  it('übergibt die Konfigurationsdatei und hängt die Startparameter an', () => {
    const ordner = arbeitsordner();

    const lauf = starte(ordner, { PALANTIR_STARTUP_PARAMETERS: '-noupnp -lang 1' });

    assert.equal(lauf.status, 0, lauf.stderr);
    const argv = lauf.zeilen.filter((z) => z.startsWith('argv ')).map((z) => z.slice(5));
    assert.deepEqual(argv, [
      '-config',
      `${posix(ordner.daten)}/serverconfig.txt`,
      '-noupnp',
      '-lang',
      '1',
    ]);
  });
});

/**
 * Windows kennt keine POSIX-Signale: `child.kill('SIGTERM')` ruft dort
 * `TerminateProcess` auf, der Prozess ist sofort weg und kein `trap` läuft. Der
 * Fall lässt sich hier also nicht nachstellen – in der CI (ubuntu-latest) schon,
 * und dort ist er auch echt.
 */
const nurMitSignalen = {
  skip:
    process.platform === 'win32'
      ? 'Windows kennt keine POSIX-Signale – SIGTERM beendet den Prozess sofort.'
      : nurMitShell.skip,
};

describe('start.sh – Stoppsignal', nurMitSignalen, () => {
  it('schickt "exit" in die Konsole, statt den Server umzubringen', async () => {
    const ordner = arbeitsordner();
    const kind = spawn(
      'sh',
      [
        '-c',
        'PATH="$(cd "$1" && pwd):$PATH"; export PATH; exec sh "$2"',
        '_',
        posix(ordner.bin),
        START_SH,
      ],
      { env: umgebung(ordner, { TEST_SERVER_WARTET: '1' }) },
    );

    let ausgabe = '';
    kind.stdout.setEncoding('utf8');
    kind.stdout.on('data', (stueck) => {
      ausgabe += stueck;
    });

    // Warten, bis die Attrappe läuft – erst dann hat das Rohr einen Leser.
    await warteAuf(
      () => ausgabe.includes('argv -config'),
      () => `Server kam nicht hoch: ${ausgabe}`,
    );

    kind.kill('SIGTERM');

    // Gewartet wird auf die Wirkung, nicht auf das Ende des Prozessbaums: Ob
    // die Shell danach noch eine Sekunde braucht, um abzuräumen, ist für die
    // Frage belanglos – und unter Windows-Git-Bash schwer vorherzusagen.
    await warteAuf(
      () => /stdin exit/u.test(ausgabe),
      () => `Kein "exit" angekommen: ${ausgabe}`,
    );

    kind.kill('SIGKILL');

    // Der Server hat das Wort bekommen und sich selbst beendet – kein Prozess,
    // der mitten im Schreiben der Welt abbricht.
    assert.match(ausgabe, /stdin exit/u);
  });
});
