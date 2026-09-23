/**
 * Prüfungen für `start.sh` des CS2-Images – Schritt 1: nur Basic.
 *
 * Ohne Docker, ohne SteamCMD, ohne CS2: Eine `steamcmd.sh`-Attrappe legt statt
 * 30 GB einen Starter `game/cs2.sh` ab, der Arbeitsordner und Argumente
 * aufschreibt.
 *
 * **Was diese Tests nicht zeigen können:** ob CS2 wirklich hochkommt. Der erste
 * Anlauf hatte grüne Tests und brach auf der Node an einer fehlenden
 * Bibliothek ab. Der Beweis für Schritt 1 ist ein laufender Server auf der Node.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/** Pfad in der Schreibweise, die eine POSIX-Shell versteht (Windows: `C:\…`). */
const posix = (pfad) => pfad.replace(/\\/gu, '/');

const HIER = fileURLToPath(new URL('.', import.meta.url));
const START_SH = posix(join(HIER, 'start.sh'));

/** Die Bibliotheken der Wurzel und von `base/steam`, wie im Container. */
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
 * Arbeitsordner mit SteamCMD-Attrappe.
 *
 * `starter: false` lässt `game/cs2.sh` weg – so sähe ein abgebrochener
 * Download aus.
 */
function arbeitsordner({ starter = true } = {}) {
  const wurzel = mkdtempSync(join(tmpdir(), 'palantir-cs2-'));
  aufraeumen.push(wurzel);

  const daten = join(wurzel, 'daten');
  const vorlage = join(wurzel, 'steamcmd');
  mkdirSync(daten);
  mkdirSync(join(vorlage, 'linux64'), { recursive: true });
  writeFileSync(join(vorlage, 'linux64', 'steamclient.so'), 'so');

  const zeilen = [
    '#!/bin/sh',
    'ziel=""',
    'for a in "$@"; do',
    '  case "$vorher" in +force_install_dir) ziel="$a";; esac',
    '  vorher="$a"',
    'done',
    'printf "steamcmd %s\\n" "$*"',
    'mkdir -p "$ziel/game"',
  ];

  if (starter) {
    zeilen.push(
      'printf "%s\\n" "#!/bin/sh" "echo \\"cwd \\$(pwd)\\"" "for arg in \\"\\$@\\"; do printf \'argv %s\\\\n\' \\"\\$arg\\"; done" > "$ziel/game/cs2.sh"',
    );
  }

  zeilen.push('exit 0', '');
  writeFileSync(join(vorlage, 'steamcmd.sh'), zeilen.join('\n'));
  spawnSync('sh', ['-c', 'chmod 0755 "$1"', '_', posix(join(vorlage, 'steamcmd.sh'))]);

  return { daten, vorlage };
}

function starte(ordner, extra = {}) {
  const ergebnis = spawnSync('sh', [START_SH], {
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      PALANTIR_DATA_DIR: posix(ordner.daten),
      PALANTIR_LIB_DIR: LIB_ORDNER,
      PALANTIR_STEAMCMD_DIR: posix(ordner.vorlage),
      ...extra,
    },
  });
  const zeilen = (ergebnis.stdout ?? '').split('\n').map((zeile) => zeile.replace(/\r$/u, ''));

  return {
    ...ergebnis,
    zeilen,
    argv: zeilen.filter((zeile) => zeile.startsWith('argv ')).map((zeile) => zeile.slice(5)),
  };
}

/** Der Wert, der einem Schalter in der Argumentliste folgt. */
function nach(argv, schalter) {
  const stelle = argv.indexOf(schalter);

  return stelle === -1 ? null : (argv[stelle + 1] ?? null);
}

const cfg = (ordner) =>
  readFileSync(join(ordner.daten, 'server', 'game', 'csgo', 'cfg', 'palantir.cfg'), 'utf8');

describe('start.sh – Basic', nurMitShell, () => {
  it('holt Anwendung 730 anonym in den Datenordner', () => {
    const lauf = starte(arbeitsordner());

    assert.equal(lauf.status, 0, lauf.stderr);
    const aufruf = lauf.zeilen.find((zeile) => zeile.startsWith('steamcmd '));
    assert.match(aufruf, /\+login anonymous \+app_update 730/u);
    assert.match(aufruf, /\+force_install_dir \S*\/daten\/server /u);
  });

  it('startet über game/cs2.sh als dedizierter Server auf de_dust2, Port 27015', () => {
    const lauf = starte(arbeitsordner());

    assert.deepEqual(lauf.argv, [
      '-dedicated',
      '-port',
      '27015',
      '+game_type',
      '0',
      '+game_mode',
      '1',
      '+map',
      'de_dust2',
      '+exec',
      'palantir',
    ]);
  });

  it('lauscht auf dem Port, den das Panel vorgibt – der öffentlichen Nummer', () => {
    // CS2 nennt Clients seinen eigenen Port. Lauschte er auf 27015, während er
    // draußen unter 25003 erreichbar ist, scheiterte der Verbindungsaufbau
    // still (Node, 23.09.2026).
    const lauf = starte(arbeitsordner(), { CS2_PORT: '25003' });

    assert.equal(nach(lauf.argv, '-port'), '25003');
  });

  it('startet aus game/ heraus – so erwartet es der Starter', () => {
    const lauf = starte(arbeitsordner());
    const zeile = lauf.zeilen.find((z) => z.startsWith('cwd '));

    assert.ok(zeile?.endsWith('/daten/server/game'), zeile);
  });

  it('legt steamclient.so nach ~/.steam/sdk64', () => {
    const ordner = arbeitsordner();
    starte(ordner);

    const ziel = join(ordner.daten, '.palantir', '.steam', 'sdk64', 'steamclient.so');
    assert.equal(readFileSync(ziel, 'utf8'), 'so');
  });

  it('startet nicht, wenn nach dem Holen der Starter fehlt', () => {
    const lauf = starte(arbeitsordner({ starter: false }));

    assert.equal(lauf.status, 69);
    assert.match(lauf.stdout, /cs2\.sh/u);
    assert.deepEqual(lauf.argv, []);
  });
});

describe('start.sh – Schritt 2: Name, Passwort, Spieler', nurMitShell, () => {
  it('schreibt Servername und Passwort in palantir.cfg', () => {
    const ordner = arbeitsordner();
    starte(ordner, { CS2_HOSTNAME: 'Unsere Runde', CS2_PASSWORD: 'geheim' });

    assert.match(cfg(ordner), /^hostname "Unsere Runde"$/mu);
    assert.match(cfg(ordner), /^sv_password "geheim"$/mu);
  });

  it('führt palantir.cfg beim Start aus', () => {
    const lauf = starte(arbeitsordner());

    assert.equal(nach(lauf.argv, '+exec'), 'palantir');
  });

  it('lässt das Passwort aus der Argumentliste – es stünde sonst in der Prozessliste', () => {
    const lauf = starte(arbeitsordner(), { CS2_PASSWORD: 'geheim' });

    assert.ok(!lauf.argv.includes('geheim'), lauf.argv.join(' '));
  });

  it('setzt ohne Passwort ein leeres – jeder mit der Adresse kommt drauf', () => {
    const ordner = arbeitsordner();
    starte(ordner);

    assert.match(cfg(ordner), /^sv_password ""$/mu);
    assert.match(cfg(ordner), /^hostname "Palantir CS2"$/mu);
  });

  it('nimmt Anführungszeichen, Semikolon und Umbrüche aus dem Namen – sonst liefe der Rest als Befehl', () => {
    const ordner = arbeitsordner();
    starte(ordner, { CS2_HOSTNAME: 'Der "beste"; quit\nServer' });

    assert.match(cfg(ordner), /^hostname "Der beste quitServer"$/mu);
    assert.doesNotMatch(cfg(ordner), /^quit/mu);
  });

  it('gibt die Spieleranzahl als -maxplayers mit', () => {
    const lauf = starte(arbeitsordner(), { CS2_MAX_PLAYERS: '12' });

    assert.equal(nach(lauf.argv, '-maxplayers'), '12');
  });

  it('lässt -maxplayers ohne Angabe weg', () => {
    const lauf = starte(arbeitsordner());

    assert.equal(nach(lauf.argv, '-maxplayers'), null);
  });
});

describe('start.sh – Schritt 3: Karte, Modus, Bots', nurMitShell, () => {
  const datei = (ordner, name) =>
    readFileSync(join(ordner.daten, 'server', 'game', 'csgo', 'cfg', name), 'utf8');

  it('übersetzt jeden Modus in Valves zwei Zahlen', () => {
    const faelle = [
      ['competitive', '0', '1'],
      ['casual', '0', '0'],
      ['wingman', '0', '2'],
      ['armsrace', '1', '0'],
      ['deathmatch', '1', '2'],
    ];

    for (const [modus, typ, nummer] of faelle) {
      const lauf = starte(arbeitsordner(), { CS2_GAME_MODE: modus });

      assert.equal(lauf.status, 0, `${modus}: ${lauf.stderr}`);
      assert.equal(nach(lauf.argv, '+game_type'), typ, modus);
      assert.equal(nach(lauf.argv, '+game_mode'), nummer, modus);
    }
  });

  it('startet nicht mit einem Modus, den es nicht gibt', () => {
    const lauf = starte(arbeitsordner(), { CS2_GAME_MODE: 'battleroyale' });

    assert.equal(lauf.status, 78);
    assert.deepEqual(lauf.argv, []);
  });

  it('startet mit der gewählten Karte', () => {
    const lauf = starte(arbeitsordner(), { CS2_MAP: 'de_mirage' });

    assert.equal(nach(lauf.argv, '+map'), 'de_mirage');
  });

  it('lehnt eine Karte ab, die kein Kartenname ist', () => {
    const lauf = starte(arbeitsordner(), { CS2_MAP: 'de_dust2; quit' });

    assert.equal(lauf.status, 78);
    assert.deepEqual(lauf.argv, []);
  });

  it('setzt genau so viele Bots wie gewählt – ohne Angabe keine', () => {
    const mit = arbeitsordner();
    const ohne = arbeitsordner();
    starte(mit, { CS2_BOTS: '4' });
    starte(ohne);

    assert.match(datei(mit, 'palantir.cfg'), /^bot_quota 4$/mu);
    assert.match(datei(mit, 'palantir.cfg'), /^bot_quota_mode "normal"$/mu);
    assert.match(datei(ohne, 'palantir.cfg'), /^bot_quota 0$/mu);
  });

  it('lehnt eine Bot-Anzahl ab, die keine Zahl ist', () => {
    const lauf = starte(arbeitsordner(), { CS2_BOTS: '4; quit' });

    assert.equal(lauf.status, 78);
  });

  it('führt palantir.cfg nach jeder Modus-Konfiguration noch einmal aus', () => {
    // Sonst setzte gamemode_<modus>.cfg beim Kartenladen die Bots zurück.
    const ordner = arbeitsordner();
    starte(ordner);

    for (const modus of ['competitive', 'casual', 'competitive2v2', 'deathmatch', 'armsrace']) {
      assert.match(datei(ordner, `gamemode_${modus}_server.cfg`), /^exec palantir$/mu, modus);
    }
  });
});
