/**
 * Prüfungen für `start.sh` des tModLoader-Images – ohne Docker und ohne .NET.
 *
 * Gestellt werden drei Dinge: ein Datenordner, eine `tModLoader.dll` an der
 * Stelle, an der das Skript sie erwartet, und ein `dotnet` im PATH, das seine
 * Argumente aufschreibt. Damit sind genau die Entscheidungen prüfbar, die das
 * Skript trifft.
 *
 * **Warum eine `dotnet`-Attrappe und keine Binärdatei wie bei Terraria.**
 * tModLoader ist eine DLL; gestartet wird sie über die Laufzeit. Der Aufruf
 * selbst – welche Argumente die DLL bekommt, ob `-nosteam` dabei ist, wohin
 * `-tmlsavedirectory` zeigt – ist damit das, was hier gemessen werden kann.
 *
 * Der wichtigste Punkt ist wie bei Terraria das Stoppsignal: tModLoader
 * speichert bei SIGTERM nicht, das Skript schickt `exit` in die Konsole. Die
 * Attrappe schreibt jede Zeile auf, die sie von der Standardeingabe bekommt.
 */

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
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
const VERSION = 'v2026.07.3.0';

/** Die Bibliotheken der Wurzel und von `base/dotnet8`, wie im Container. */
const LIB_ORDNER = (() => {
  const ziel = mkdtempSync(join(tmpdir(), 'palantir-lib-'));
  copyFileSync(join(HIER, '..', '..', 'base', 'linux', 'palantir.sh'), join(ziel, 'palantir.sh'));
  copyFileSync(join(HIER, '..', '..', 'base', 'dotnet8', 'dotnet.sh'), join(ziel, 'dotnet.sh'));

  return posix(ziel);
})();

const SH_VORHANDEN = spawnSync('sh', ['-c', 'exit 0']).error === undefined;
const nurMitShell = { skip: SH_VORHANDEN ? false : 'Keine POSIX-Shell (sh) im PATH.' };
// Windows kennt kein SIGTERM für fremde Prozesse.
const nurMitSignalen = {
  skip: SH_VORHANDEN && process.platform !== 'win32' ? false : 'Braucht sh und echte Signale.',
};

const aufraeumen = [];

after(() => {
  for (const pfad of aufraeumen) {
    spawnSync('sh', ['-c', 'rm -rf "$1"', '_', posix(pfad)]);
  }
});

/**
 * Legt den Arbeitsordner an.
 *
 * `programmDa` steuert, ob die DLL schon ausgepackt ist – ohne sie geht das
 * Skript in den Download-Zweig.
 */
function arbeitsordner({ programmDa = true } = {}) {
  const wurzel = mkdtempSync(join(tmpdir(), 'palantir-tml-'));
  aufraeumen.push(wurzel);

  const daten = join(wurzel, 'daten');
  const bin = join(wurzel, 'bin');
  mkdirSync(daten);
  mkdirSync(bin);

  // Die Attrappe schreibt ihre Argumente und danach jede Zeile von der
  // Standardeingabe auf. Bei `exit` endet sie – genau wie der echte Server.
  const dotnet = join(bin, 'dotnet');
  writeFileSync(
    dotnet,
    [
      '#!/bin/sh',
      'for arg in "$@"; do printf \'argv %s\\n\' "$arg"; done',
      'printf \'cwd %s\\n\' "$(pwd)"',
      'printf \'env SDL_VIDEODRIVER=%s\\n\' "${SDL_VIDEODRIVER:-}"',
      'printf \'env FNA3D_FORCE_DRIVER=%s\\n\' "${FNA3D_FORCE_DRIVER:-}"',
      'printf \'env LD_LIBRARY_PATH=%s\\n\' "${LD_LIBRARY_PATH:-}"',
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
  spawnSync('sh', ['-c', 'chmod 0755 "$1"', '_', posix(dotnet)]);

  if (programmDa) {
    const ordner = join(daten, '.palantir', 'tmodloader');
    mkdirSync(join(ordner, 'Libraries', 'Native', 'Linux'), { recursive: true });
    writeFileSync(join(ordner, 'tModLoader.dll'), 'keine echte DLL');
  }

  return { wurzel, daten, bin };
}

const umgebung = (ordner, extra = {}) => ({
  ...process.env,
  PALANTIR_DATA_DIR: posix(ordner.daten),
  PALANTIR_LIB_DIR: LIB_ORDNER,
  PALANTIR_STARTUP_PARAMETERS: '',
  TMODLOADER_VERSION: VERSION,
  TMODLOADER_URL: 'https://beispiel.invalid/tModLoader.zip',
  TMODLOADER_SHA256: '0'.repeat(64),
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

describe('start.sh – das Programm holen', nurMitShell, () => {
  it('meldet eine gescheiterte Beschaffung mit 69 statt mit einem Absturz', () => {
    const lauf = starte(arbeitsordner({ programmDa: false }));

    assert.equal(lauf.status, 69);
    assert.match(lauf.stdout, /konnte nicht geholt werden|Prüfsumme|Download/u);
  });

  it('lädt nicht erneut, wenn die DLL schon da ist', () => {
    const lauf = starte(arbeitsordner());

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.doesNotMatch(lauf.stdout, /Hole /u);
  });
});

describe('start.sh – serverconfig.txt', nurMitShell, () => {
  it('legt die verwalteten Schlüssel an und zeigt auf Welt- und Mod-Ordner', () => {
    const ordner = arbeitsordner();
    starte(ordner, { TERRARIA_WORLD: 'Runde', MAX_PLAYERS: '12' });

    assert.equal(wert(ordner, 'worldname'), 'Runde');
    assert.equal(wert(ordner, 'maxplayers'), '12');
    assert.equal(wert(ordner, 'worldpath'), posix(join(ordner.daten, 'welten')));
    assert.equal(wert(ordner, 'modpath'), posix(join(ordner.daten, 'mods')));
  });

  it('legt den Mod-Ordner an, damit ihn niemand suchen muss', () => {
    // Ein Mod im falschen Ordner ist der häufigste Grund, warum „der Server
    // die Mods nicht lädt".
    const ordner = arbeitsordner();
    starte(ordner);

    assert.ok(statSync(join(ordner.daten, 'mods')).isDirectory());
  });

  it('übersetzt Weltgröße und Spielart in die Zahlen, die Terraria kennt', () => {
    const ordner = arbeitsordner();
    starte(ordner, { TERRARIA_SIZE: 'groß', TERRARIA_DIFFICULTY: 'meister' });

    assert.equal(wert(ordner, 'autocreate'), '3');
    assert.equal(wert(ordner, 'difficulty'), '2');
  });

  it('startet nicht mit einer Weltgröße, die es nicht gibt', () => {
    const lauf = starte(arbeitsordner(), { TERRARIA_SIZE: 'riesig' });

    assert.equal(lauf.status, 78);
    assert.match(lauf.stdout, /Unbekannte Weltgröße/u);
  });

  it('schaltet UPnP ab – der Weg nach draußen führt durch den Tunnel', () => {
    const ordner = arbeitsordner();
    starte(ordner);

    assert.equal(wert(ordner, 'upnp'), '0');
  });
});

describe('start.sh – Aufruf über die Laufzeit', nurMitShell, () => {
  it('startet die DLL mit -server und ohne Steam-Rückfrage', () => {
    // `start-tModLoaderServer.sh` fragt „Use steam server (y/n)" und wartet auf
    // eine Antwort. Hier tippt niemand mit – deshalb die DLL direkt und
    // `-nosteam`.
    const ordner = arbeitsordner();
    const lauf = starte(ordner);
    const argv = lauf.zeilen.filter((z) => z.startsWith('argv ')).map((z) => z.slice(5));

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.equal(argv[0], posix(join(ordner.daten, '.palantir', 'tmodloader', 'tModLoader.dll')));
    assert.ok(argv.includes('-server'), argv.join(' '));
    assert.ok(argv.includes('-nosteam'), argv.join(' '));
  });

  it('zeigt mit -tmlsavedirectory in den Datenordner', () => {
    // Ohne die Angabe legt tModLoader Logs und `enabled.json` unter
    // `~/.local/share` ab – ausserhalb des Datenordners und damit ausserhalb
    // jeder Sicherung.
    const ordner = arbeitsordner();
    const lauf = starte(ordner);
    const argv = lauf.zeilen.filter((z) => z.startsWith('argv ')).map((z) => z.slice(5));
    const stelle = argv.indexOf('-tmlsavedirectory');

    assert.notEqual(stelle, -1, argv.join(' '));
    assert.ok(
      argv[stelle + 1]?.startsWith(posix(join(ordner.daten, '.palantir'))),
      argv[stelle + 1],
    );
  });

  it('hängt die Startparameter des Betreibers hinten an', () => {
    const lauf = starte(arbeitsordner(), { PALANTIR_STARTUP_PARAMETERS: '-lang 2' });
    const argv = lauf.zeilen.filter((z) => z.startsWith('argv ')).map((z) => z.slice(5));

    assert.deepEqual(argv.slice(-2), ['-lang', '2']);
  });

  it('gibt SDL und FNA Attrappen statt eines Bildschirms', () => {
    // tModLoader ist dasselbe Programm wie der Client und lädt SDL2 und FNA3D
    // auch headless.
    const lauf = starte(arbeitsordner());

    assert.ok(lauf.zeilen.includes('env SDL_VIDEODRIVER=dummy'), lauf.stdout);
    assert.ok(lauf.zeilen.includes('env FNA3D_FORCE_DRIVER=null'), lauf.stdout);
  });

  it('lässt eine vom Betreiber gesetzte Anzeige stehen', () => {
    // `:=` statt fester Zuweisung: Wer weiß, was er tut, soll es setzen können.
    const lauf = starte(arbeitsordner(), { SDL_VIDEODRIVER: 'x11' });

    assert.ok(lauf.zeilen.includes('env SDL_VIDEODRIVER=x11'), lauf.stdout);
  });

  it('nimmt die nativen Bibliotheken aus dem Programmordner in den Suchpfad', () => {
    const ordner = arbeitsordner();
    const lauf = starte(ordner);
    const zeile = lauf.zeilen.find((z) => z.startsWith('env LD_LIBRARY_PATH='));

    assert.ok(
      zeile?.includes(posix(join(ordner.daten, '.palantir', 'tmodloader', 'Libraries'))),
      zeile,
    );
  });

  it('startet im Programmordner – die DLL sucht ihre Dateien relativ dazu', () => {
    const ordner = arbeitsordner();
    const lauf = starte(ordner);
    const zeile = lauf.zeilen.find((z) => z.startsWith('cwd '));

    // Verglichen wird das Ende, nicht der ganze Pfad: Die Shell meldet ihn in
    // ihrer eigenen Schreibweise (`/tmp/...`), Node in der von Windows.
    assert.ok(zeile?.endsWith('/daten/.palantir/tmodloader'), zeile);
  });
});

describe('start.sh – Stoppsignal', nurMitSignalen, () => {
  it('schickt "exit" in die Konsole, statt den Server umzubringen', async () => {
    const ordner = arbeitsordner();
    let ausgabe = '';

    const lauf = spawn(
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

    lauf.stdout.on('data', (stueck) => {
      ausgabe += String(stueck);
    });

    await warteAuf(
      () => ausgabe.includes('argv -server'),
      () => `Server kam nicht hoch: ${ausgabe}`,
    );

    lauf.kill('SIGTERM');

    const code = await new Promise((fertig) => {
      lauf.on('exit', (status) => fertig(status));
    });

    // Der Beweis: Die Attrappe hat `exit` gelesen, also ist es durch das Rohr
    // gegangen – der Server wurde nicht einfach abgeräumt.
    assert.match(ausgabe, /stdin exit/u);
    assert.equal(code, 0);
  });
});
