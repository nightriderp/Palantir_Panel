/**
 * Prüfungen für `start.sh` des ARK-Images – ohne Docker, ohne Steam, ohne
 * Proton, ohne Xvfb und ohne das Spiel.
 *
 * Der Schwerpunkt liegt auf der **Optionskette**: Alles hinter dem Kartennamen
 * wird mit `?` getrennt, und ein `?` im Servernamen zerschnitte sie – der
 * Server startete dann mit halben Einstellungen, ohne dass etwas danach
 * aussähe. Dazu das Verwalter-Passwort, das zugleich das RCON-Passwort ist, und
 * der Umzug der Spielstände aus dem Serverordner.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
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

/**
 * Die drei Bibliotheken liegen im Container nebeneinander. `proton.sh` kommt
 * aus `base/proton` – `base/proton10` hat keine eigene, sondern übernimmt
 * dieselbe Datei beim Bauen.
 */
const LIB_ORDNER = (() => {
  const ziel = mkdtempSync(join(tmpdir(), 'palantir-lib-'));
  const basis = join(HIER, '..', '..', 'base');
  copyFileSync(join(basis, 'linux', 'palantir.sh'), join(ziel, 'palantir.sh'));
  copyFileSync(join(basis, 'steam', 'steam.sh'), join(ziel, 'steam.sh'));
  copyFileSync(join(basis, 'proton', 'proton.sh'), join(ziel, 'proton.sh'));

  return posix(ziel);
})();

const SH_VORHANDEN = spawnSync('sh', ['-c', 'exit 0']).error === undefined;
/**
 * Verweise im Dateisystem braucht dieses Image – unter Windows legt eine
 * gewöhnliche Sitzung keine an. Die Prüfung läuft dann nicht.
 */
const LINKS_MOEGLICH = (() => {
  if (!SH_VORHANDEN) return false;
  const ordner = mkdtempSync(join(tmpdir(), 'palantir-link-'));
  const lauf = spawnSync('sh', [
    '-c',
    'cd "$1" && mkdir a && ln -s a b && test -L b',
    '_',
    posix(ordner),
  ]);
  spawnSync('sh', ['-c', 'rm -rf "$1"', '_', posix(ordner)]);

  return lauf.status === 0;
})();
const nurMitShell = { skip: SH_VORHANDEN ? false : 'Keine POSIX-Shell (sh) im PATH.' };
const nurMitLinks = {
  skip: LINKS_MOEGLICH ? false : 'Diese Umgebung legt keine symbolischen Verweise an.',
};

const aufraeumen = [];

after(() => {
  for (const pfad of aufraeumen) {
    spawnSync('sh', ['-c', 'rm -rf "$1"', '_', posix(pfad)]);
  }
});

function arbeitsordner() {
  const wurzel = mkdtempSync(join(tmpdir(), 'palantir-ark-'));
  aufraeumen.push(wurzel);

  const daten = join(wurzel, 'daten');
  const vorlage = join(wurzel, 'steamcmd');
  const proton = join(wurzel, 'proton');
  const bin = join(wurzel, 'bin');
  const x11 = join(wurzel, 'x11');
  mkdirSync(daten);
  mkdirSync(vorlage);
  mkdirSync(proton);
  mkdirSync(bin);
  mkdirSync(x11);

  // Die SteamCMD-Attrappe legt die Windows-Dateien an, statt sie zu laden –
  // samt eines Spielstands an der Stelle, an der die Unreal Engine ihn ablegt.
  writeFileSync(
    join(vorlage, 'steamcmd.sh'),
    [
      '#!/bin/sh',
      'ziel=""',
      'for a in "$@"; do',
      '  case "$vorher" in +force_install_dir) ziel="$a";; esac',
      '  vorher="$a"',
      'done',
      'mkdir -p "$ziel/ShooterGame/Binaries/Win64"',
      'printf \'exe\\n\' > "$ziel/ShooterGame/Binaries/Win64/ArkAscendedServer.exe"',
      'if [ ! -e "$ziel/ShooterGame/Saved" ]; then',
      '  mkdir -p "$ziel/ShooterGame/Saved/SavedArks"',
      '  printf \'welt\\n\' > "$ziel/ShooterGame/Saved/SavedArks/TheIsland_WP.ark"',
      'fi',
      'exit 0',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(proton, 'proton'),
    ['#!/bin/sh', 'for a in "$@"; do printf \'proton %s\\n\' "$a"; done', 'exit 0', ''].join('\n'),
  );
  writeFileSync(
    join(bin, 'Xvfb'),
    ['#!/bin/sh', 'touch "${PALANTIR_X11_SOCKET_DIR}/X1"', 'sleep 1', ''].join('\n'),
  );
  spawnSync('sh', [
    '-c',
    'chmod 0755 "$1" "$2" "$3"',
    '_',
    posix(join(vorlage, 'steamcmd.sh')),
    posix(join(proton, 'proton')),
    posix(join(bin, 'Xvfb')),
  ]);

  return { wurzel, daten, vorlage, proton, bin, x11 };
}

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
    {
      encoding: 'utf8',
      timeout: 60_000,
      env: {
        ...process.env,
        PALANTIR_DATA_DIR: posix(ordner.daten),
        PALANTIR_LIB_DIR: LIB_ORDNER,
        PALANTIR_STEAMCMD_DIR: posix(ordner.vorlage),
        PALANTIR_PROTON_DIR: posix(ordner.proton),
        PALANTIR_PROTON_VERSION: 'GE-Proton10-Test',
        PALANTIR_X11_SOCKET_DIR: posix(ordner.x11),
        ...extra,
      },
    },
  );

  const argv = (ergebnis.stdout ?? '')
    .split('\n')
    .map((zeile) => zeile.replace(/\r$/u, ''))
    .filter((zeile) => zeile.startsWith('proton '))
    .map((zeile) => zeile.slice(7));

  return {
    ...ergebnis,
    argv,
    // Die Optionskette ist das erste Argument nach der Programmdatei.
    kette: argv[2] ?? '',
    /** Ein Wert aus der Kette, z. B. `SessionName`. */
    aus: (schluessel) => {
      const treffer = (argv[2] ?? '').split('?').find((teil) => teil.startsWith(`${schluessel}=`));

      return treffer === undefined ? null : treffer.slice(schluessel.length + 1);
    },
  };
}

describe('start.sh – die Optionskette', nurMitShell, () => {
  it('trägt die Felder des Panels ein', () => {
    const ordner = arbeitsordner();

    const lauf = starte(ordner, {
      ARK_MAP: 'Ragnarok_WP',
      ARK_NAME: 'Nordheim',
      ARK_PASSWORD: 'geheim',
      MAX_PLAYERS: '20',
      SERVER_PORT: '25010',
      ARK_QUERY_PORT: '25011',
    });

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.ok(lauf.kette.startsWith('Ragnarok_WP?listen'), lauf.kette);
    assert.equal(lauf.aus('SessionName'), 'Nordheim');
    assert.equal(lauf.aus('ServerPassword'), 'geheim');
    assert.ok(lauf.argv.includes('-WinLiveMaxPlayers=20'));
    assert.ok(lauf.argv.includes('-Port=25010'));
    assert.ok(lauf.argv.includes('-QueryPort=25011'));
  });

  it('wirft ein Fragezeichen aus dem Servernamen heraus', () => {
    // Sonst zerschnitte es die Kette, und der Server startete mit halben
    // Einstellungen – ohne Passwort zum Beispiel.
    const lauf = starte(arbeitsordner(), { ARK_NAME: 'Wo?hin' });

    assert.equal(lauf.aus('SessionName'), 'Wohin');
    assert.equal(lauf.aus('ServerPassword'), '');
  });

  it('speichert öfter, als ARK es vorgibt', () => {
    // ARK speichert beim Stoppsignal nicht. Was seit dem letzten Mal geschehen
    // ist, ist nach einem Stopp fort.
    const lauf = starte(arbeitsordner());

    assert.equal(lauf.aus('AutoSavePeriodMinutes'), '10');
  });
});

describe('start.sh – Verwalter und RCON', nurMitShell, () => {
  it('nimmt das Passwort des Betreibers für beides', () => {
    // ARK kennt kein eigenes RCON-Passwort: Wer RCON spricht, ist Verwalter.
    const ordner = arbeitsordner();

    const lauf = starte(ordner, { ARK_ADMIN_PASSWORD: 'chef123' });

    assert.equal(lauf.aus('ServerAdminPassword'), 'chef123');
    assert.equal(lauf.aus('RCONEnabled'), 'True');
    assert.equal(
      readFileSync(join(ordner.daten, '.palantir', 'rcon.password'), 'utf8').trim(),
      'chef123',
    );
  });

  it('erzeugt ohne Angabe ein zufälliges', () => {
    // Dann hat das Panel seine Konsole, und im Spiel wird niemand Verwalter.
    const ordner = arbeitsordner();

    const lauf = starte(ordner);

    const passwort = readFileSync(join(ordner.daten, '.palantir', 'rcon.password'), 'utf8').trim();
    assert.match(passwort, /^[0-9a-f]{48}$/u);
    assert.equal(lauf.aus('ServerAdminPassword'), passwort);
  });
});

describe('start.sh – Schalter', nurMitShell, () => {
  it('schaltet BattlEye ab, solange niemand es will', () => {
    // Unter Proton ist der Dienst eine zusätzliche Fehlerquelle, und ein
    // Server, der daran nicht startet, sieht aus wie einer, der gar nicht
    // startet.
    assert.ok(starte(arbeitsordner()).argv.includes('-NoBattlEye'));
    assert.ok(!starte(arbeitsordner(), { ARK_BATTLEYE: 'true' }).argv.includes('-NoBattlEye'));
  });

  it('lässt Crossplay nur auf Wunsch zu', () => {
    assert.ok(!starte(arbeitsordner()).argv.includes('-crossplay'));
    assert.ok(starte(arbeitsordner(), { ARK_CROSSPLAY: 'true' }).argv.includes('-crossplay'));
  });

  it('gibt Mod-Kennungen weiter, aber nur wenn es welche gibt', () => {
    assert.ok(!starte(arbeitsordner()).argv.some((a) => a.startsWith('-mods=')));
    assert.ok(
      starte(arbeitsordner(), { ARK_MODS: '927131, 893657' }).argv.includes('-mods=927131,893657'),
    );
  });

  it('hängt eigene Startparameter hinten an', () => {
    const lauf = starte(arbeitsordner(), { PALANTIR_STARTUP_PARAMETERS: '-ForceAllowCaveFlyers' });

    assert.equal(lauf.argv[lauf.argv.length - 1], '-ForceAllowCaveFlyers');
  });
});

describe('start.sh – die Spielstände', nurMitLinks, () => {
  it('holt sie aus dem Serverordner heraus und verweist dorthin', () => {
    const ordner = arbeitsordner();

    starte(ordner);

    const verweis = join(ordner.daten, 'server', 'ShooterGame', 'Saved');
    assert.ok(lstatSync(verweis).isSymbolicLink());
    const welt = join(ordner.daten, 'welten', 'SavedArks', 'TheIsland_WP.ark');
    assert.ok(existsSync(welt), 'Der vorhandene Spielstand ist nicht mitgekommen');
    assert.equal(readFileSync(welt, 'utf8'), 'welt\n');
  });

  it('bleibt beim zweiten Start dabei', () => {
    const ordner = arbeitsordner();

    starte(ordner);
    writeFileSync(join(ordner.daten, 'welten', 'SavedArks', 'TheIsland_WP.ark'), 'spaeter\n');
    starte(ordner);

    assert.equal(
      readFileSync(join(ordner.daten, 'welten', 'SavedArks', 'TheIsland_WP.ark'), 'utf8'),
      'spaeter\n',
    );
  });
});
