/**
 * Prüfungen für `start.sh` des Project-Zomboid-Images – ohne Docker, ohne Steam
 * und ohne Project Zomboid.
 *
 * Gestellt werden ein Datenordner, eine SteamCMD-Attrappe, die ein
 * `start-server.sh` hinterlässt, und dieses Skript selbst, das seine Argumente
 * aufschreibt. Damit sind die Entscheidungen prüfbar, die das Skript trifft:
 * die Pflicht zum Administrator-Passwort, die Grenzen des Servernamens, die
 * verwalteten Schlüssel der `.ini` und das Verhalten beim Stoppsignal.
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

/** `palantir.sh` und `steam.sh` liegen im Container nebeneinander. */
const LIB_ORDNER = (() => {
  const ziel = mkdtempSync(join(tmpdir(), 'palantir-lib-'));
  copyFileSync(join(HIER, '..', '..', 'base', 'linux', 'palantir.sh'), join(ziel, 'palantir.sh'));
  copyFileSync(join(HIER, '..', '..', 'base', 'steam', 'steam.sh'), join(ziel, 'steam.sh'));

  return posix(ziel);
})();

const SH_VORHANDEN = spawnSync('sh', ['-c', 'exit 0']).error === undefined;
const nurMitShell = { skip: SH_VORHANDEN ? false : 'Keine POSIX-Shell (sh) im PATH.' };

/**
 * Windows kennt keine POSIX-Signale: `child.kill('SIGTERM')` ruft dort
 * `TerminateProcess` auf, kein `trap` läuft. In der CI (ubuntu-latest) schon.
 */
const nurMitSignalen = {
  skip:
    process.platform === 'win32'
      ? 'Windows kennt keine POSIX-Signale – SIGTERM beendet den Prozess sofort.'
      : nurMitShell.skip,
};

const aufraeumen = [];

after(() => {
  for (const pfad of aufraeumen) {
    spawnSync('sh', ['-c', 'rm -rf "$1"', '_', posix(pfad)]);
  }
});

function arbeitsordner() {
  const wurzel = mkdtempSync(join(tmpdir(), 'palantir-zomboid-'));
  aufraeumen.push(wurzel);

  const daten = join(wurzel, 'daten');
  const vorlage = join(wurzel, 'steamcmd');
  mkdirSync(daten);
  mkdirSync(vorlage);

  // Die SteamCMD-Attrappe legt `start-server.sh` an, statt es zu laden. Jenes
  // schreibt seine Argumente auf und wartet – wie der echte Server, der von der
  // Standardeingabe liest, bis `quit` kommt.
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
      'cat > "$ziel/start-server.sh" <<\'SKRIPT\'',
      '#!/bin/sh',
      'for arg in "$@"; do printf \'argv %s\\n\' "$arg"; done',
      'if [ -z "${TEST_SERVER_WARTET:-}" ]; then exit 0; fi',
      'while IFS= read -r zeile; do',
      '  printf \'stdin %s\\n\' "$zeile"',
      '  if [ "$zeile" = "quit" ]; then exit 0; fi',
      'done',
      'exit 0',
      'SKRIPT',
      'chmod 0755 "$ziel/start-server.sh"',
      'exit 0',
      '',
    ].join('\n'),
  );
  spawnSync('sh', ['-c', 'chmod 0755 "$1"', '_', posix(join(vorlage, 'steamcmd.sh'))]);

  return { wurzel, daten, vorlage };
}

const umgebung = (ordner, extra = {}) => ({
  ...process.env,
  PALANTIR_DATA_DIR: posix(ordner.daten),
  PALANTIR_LIB_DIR: LIB_ORDNER,
  PALANTIR_STEAMCMD_DIR: posix(ordner.vorlage),
  PALANTIR_STARTUP_PARAMETERS: '',
  ZOMBOID_ADMIN_PASSWORD: 'geheim123',
  ...extra,
});

function starte(ordner, extra = {}) {
  const ergebnis = spawnSync('sh', [START_SH], {
    encoding: 'utf8',
    timeout: 60_000,
    env: umgebung(ordner, extra),
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

/** Liest einen Schlüssel aus der `.ini` des Servers. */
function wert(ordner, name, schluessel) {
  const datei = join(ordner.daten, 'welt', 'Server', `${name}.ini`);
  const treffer = readFileSync(datei, 'utf8')
    .split('\n')
    .find((zeile) => zeile.startsWith(`${schluessel}=`));

  return treffer === undefined ? null : treffer.replace(/\r$/u, '').slice(schluessel.length + 1);
}

describe('start.sh – Einstellungen, die vor dem Start geprüft werden', nurMitShell, () => {
  it('startet nicht ohne Administrator-Passwort', () => {
    // Ohne `-adminpassword` fragt der Server interaktiv danach und wartet – im
    // Container sieht das aus wie ein Hänger ohne Grund.
    const lauf = starte(arbeitsordner(), { ZOMBOID_ADMIN_PASSWORD: '' });

    assert.equal(lauf.status, 78);
    assert.match(lauf.stdout, /Administrator-Passwort/u);
    assert.deepEqual(lauf.argv, []);
  });

  it('lehnt einen Servernamen ab, der zu keinem Dateinamen taugt', () => {
    const lauf = starte(arbeitsordner(), { ZOMBOID_NAME: 'mein server/welt' });

    assert.equal(lauf.status, 78);
    assert.match(lauf.stdout, /nur Buchstaben, Ziffern/u);
  });
});

describe('start.sh – die .ini des Servers', nurMitShell, () => {
  it('schreibt die verwalteten Schlüssel', () => {
    const ordner = arbeitsordner();

    const lauf = starte(ordner, {
      ZOMBOID_NAME: 'nordheim',
      MAX_PLAYERS: '24',
      ZOMBOID_PUBLIC_NAME: 'Nordheim',
    });

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.equal(wert(ordner, 'nordheim', 'MaxPlayers'), '24');
    assert.equal(wert(ordner, 'nordheim', 'PublicName'), 'Nordheim');
    assert.equal(wert(ordner, 'nordheim', 'DefaultPort'), '16261');
    // Ein leerer Server soll die Uhr anhalten.
    assert.equal(wert(ordner, 'nordheim', 'PauseEmpty'), 'true');
  });

  it('lässt fremde Schlüssel des Betreibers stehen', () => {
    const ordner = arbeitsordner();
    mkdirSync(join(ordner.daten, 'welt', 'Server'), { recursive: true });
    writeFileSync(
      join(ordner.daten, 'welt', 'Server', 'palantir.ini'),
      ['# von Hand', 'Mods=Superb_Survivors', 'MaxPlayers=99', ''].join('\n'),
    );

    starte(ordner, { MAX_PLAYERS: '8' });

    assert.equal(wert(ordner, 'palantir', 'Mods'), 'Superb_Survivors');
    assert.equal(wert(ordner, 'palantir', 'MaxPlayers'), '8');
  });

  it('verlangt für die öffentliche Liste ein ausdrückliches "true"', () => {
    const ordner = arbeitsordner();

    starte(ordner, { ZOMBOID_PUBLIC: 'vielleicht' });

    assert.equal(wert(ordner, 'palantir', 'Public'), 'false');
  });
});

describe('start.sh – Aufruf des Servers', nurMitShell, () => {
  it('übergibt Namen, Passwort und den Ordner für alles Eigene', () => {
    const ordner = arbeitsordner();

    const lauf = starte(ordner, { ZOMBOID_NAME: 'nordheim' });

    assert.deepEqual(lauf.argv, [
      '-servername',
      'nordheim',
      '-adminpassword',
      'geheim123',
      `-cachedir=${posix(ordner.daten)}/welt`,
    ]);
  });
});

describe('start.sh – Stoppsignal', nurMitSignalen, () => {
  it('schickt "quit" in die Konsole, statt den Server umzubringen', async () => {
    const ordner = arbeitsordner();
    const kind = spawn('sh', [START_SH], {
      env: umgebung(ordner, { TEST_SERVER_WARTET: '1' }),
    });

    let ausgabe = '';
    kind.stdout.setEncoding('utf8');
    kind.stdout.on('data', (stueck) => {
      ausgabe += stueck;
    });

    const warteAuf = (bedingung, meldung) =>
      new Promise((fertig, scheitern) => {
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

    await warteAuf(
      () => ausgabe.includes('argv -servername'),
      () => `Server kam nicht hoch: ${ausgabe}`,
    );

    kind.kill('SIGTERM');

    await warteAuf(
      () => /stdin quit/u.test(ausgabe),
      () => `Kein "quit" angekommen: ${ausgabe}`,
    );

    kind.kill('SIGKILL');

    assert.match(ausgabe, /stdin quit/u);
  });
});
