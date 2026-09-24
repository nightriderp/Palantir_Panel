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
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
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

/** Die Bibliotheken der Wurzel und von `base/steam`, wie im Container. */
const LIB_ORDNER = (() => {
  const ziel = mkdtempSync(join(tmpdir(), 'palantir-lib-'));
  copyFileSync(join(HIER, '..', '..', 'base', 'linux', 'palantir.sh'), join(ziel, 'palantir.sh'));
  copyFileSync(join(HIER, '..', '..', 'base', 'steam', 'steam.sh'), join(ziel, 'steam.sh'));

  return posix(ziel);
})();

const SH_VORHANDEN = spawnSync('sh', ['-c', 'exit 0']).error === undefined;
const nurMitShell = { skip: SH_VORHANDEN ? false : 'Keine POSIX-Shell (sh) im PATH.' };
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
 * Arbeitsordner mit SteamCMD-Attrappe.
 *
 * `starter: false` lässt die Binärdatei weg – so sähe ein abgebrochener
 * Download aus. Die Attrappe schreibt Arbeitsordner, Suchpfad und Argumente
 * auf; mit `TEST_SERVER_WARTET` liest sie danach die Konsole, bis `quit` kommt.
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
    'mkdir -p "$ziel/game/bin/linuxsteamrt64" "$ziel/game/csgo"',
    // Wie Valves gameinfo.gi: SteamCMD legt sie bei jedem Abgleich neu an.
    'if [ ! -f "$ziel/game/csgo/gameinfo.gi" ]; then',
    '  printf "\\t\\tSearchPaths\\n\\t\\t{\\n\\t\\t\\tGame_LowViolence\\tcsgo_lv\\n\\t\\t\\tGame\\tcsgo\\n\\t\\t}\\n" > "$ziel/game/csgo/gameinfo.gi"',
    'fi',
  ];

  if (starter) {
    zeilen.push('cp "$(dirname "$0")/cs2-attrappe" "$ziel/game/bin/linuxsteamrt64/cs2"');
    zeilen.push('chmod 0755 "$ziel/game/bin/linuxsteamrt64/cs2"');
  }

  zeilen.push('exit 0', '');
  writeFileSync(join(vorlage, 'steamcmd.sh'), zeilen.join('\n'));
  writeFileSync(
    join(vorlage, 'cs2-attrappe'),
    [
      '#!/bin/sh',
      'echo "cwd $(pwd)"',
      'echo "ld $LD_LIBRARY_PATH"',
      'echo "preload ${LD_PRELOAD:-}"',
      'echo "stdbuf ${_STDBUF_O:-}"',
      'for arg in "$@"; do printf "argv %s\\n" "$arg"; done',
      // Wie CS2 am Ende des Starts (Fundpunkt 349).
      'if [ -n "${TEST_GC:-}" ]; then echo "[STARTUP] {7.355} activated session on GC"; fi',
      'if [ -z "${TEST_SERVER_WARTET:-}" ]; then exit 0; fi',
      'while IFS= read -r zeile; do',
      '  printf "stdin %s\\n" "$zeile"',
      '  if [ "$zeile" = "quit" ]; then exit 0; fi',
      '  case "$zeile" in host_workshop_map*) exit 0;; esac',
      'done',
      'exit 0',
      '',
    ].join('\n'),
  );
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

  it('startet als dedizierter Server auf de_dust2, Port 27015', () => {
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

  it(
    'lässt CS2 zeilenweise schreiben – sonst hängen Antworten im Puffer',
    {
      skip:
        spawnSync('sh', ['-c', 'command -v stdbuf']).status === 0 && process.platform !== 'win32'
          ? false
          : 'Braucht stdbuf (coreutils unter Linux).',
    },
    () => {
      const lauf = starte(arbeitsordner());

      // stdbuf setzt _STDBUF_O und lädt libstdbuf vor, dann exec auf CS2.
      assert.ok(lauf.zeilen.includes('stdbuf L'), lauf.stdout);
      assert.match(lauf.zeilen.find((z) => z.startsWith('preload ')) ?? '', /libstdbuf/u);
    },
  );

  it('legt Valves Bibliotheksordner in den Suchpfad – sonst fehlt libv8.so', () => {
    const lauf = starte(arbeitsordner());
    const zeile = lauf.zeilen.find((z) => z.startsWith('ld '));

    assert.match(zeile ?? '', /\/daten\/server\/game\/bin\/linuxsteamrt64/u);
  });

  it('startet aus game/ heraus – wie Valves cs2.sh', () => {
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
    assert.match(lauf.stdout, /linuxsteamrt64\/cs2/u);
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

  it('startet bei „workshop“ auf de_dust2 – nicht mit +host_workshop_map (Fundpunkt 349)', () => {
    const lauf = starte(arbeitsordner(), { CS2_MAP: 'workshop', CS2_WORKSHOP_MAP: '3070284539' });

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.equal(nach(lauf.argv, '+map'), 'de_dust2');
    assert.equal(nach(lauf.argv, '+host_workshop_map'), null);
  });

  it('lädt die Workshop-Karte über die Konsole, sobald CS2 bei Steam angemeldet ist', () => {
    const lauf = starte(arbeitsordner(), {
      CS2_MAP: 'workshop',
      CS2_WORKSHOP_MAP: '3070284539',
      TEST_GC: '1',
      TEST_SERVER_WARTET: '1',
    });

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.ok(lauf.zeilen.includes('stdin host_workshop_map 3070284539'), lauf.stdout);
    // Die Ausgabe von CS2 kommt weiter an.
    assert.ok(lauf.zeilen.includes('[STARTUP] {7.355} activated session on GC'), lauf.stdout);
  });

  it('schickt ohne Workshop-Karte nichts nach', () => {
    const lauf = starte(arbeitsordner(), {
      CS2_MAP: 'de_nuke',
      CS2_WORKSHOP_MAP: '3070284539',
      TEST_GC: '1',
    });

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.ok(!lauf.stdout.includes('host_workshop_map'), lauf.stdout);
  });

  it('lässt die Workshop-ID liegen, solange eine normale Karte gewählt ist', () => {
    const lauf = starte(arbeitsordner(), { CS2_MAP: 'de_nuke', CS2_WORKSHOP_MAP: '3070284539' });

    assert.equal(nach(lauf.argv, '+map'), 'de_nuke');
    assert.equal(nach(lauf.argv, '+host_workshop_map'), null);
  });

  it('startet nicht mit „workshop“ ohne ID – und nicht mit einer ID, die keine Zahl ist', () => {
    const ohne = starte(arbeitsordner(), { CS2_MAP: 'workshop', CS2_WORKSHOP_MAP: '0' });
    const kaputt = starte(arbeitsordner(), { CS2_MAP: 'workshop', CS2_WORKSHOP_MAP: '1; quit' });

    assert.equal(ohne.status, 78);
    assert.deepEqual(ohne.argv, []);
    assert.equal(kaputt.status, 78);
    assert.deepEqual(kaputt.argv, []);
  });

  it('schaltet GOTV auf dem Port des Panels ein – vor dem ersten Kartenladen (Schritt 5.1)', () => {
    const lauf = starte(arbeitsordner(), { CS2_GOTV: 'true', CS2_TV_PORT: '25004' });

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.equal(nach(lauf.argv, '+tv_enable'), '1');
    assert.equal(nach(lauf.argv, '+tv_port'), '25004');
    assert.ok(lauf.argv.indexOf('+tv_enable') < lauf.argv.indexOf('+map'));
  });

  it('lässt GOTV ohne Schalter aus', () => {
    const lauf = starte(arbeitsordner(), { CS2_TV_PORT: '25004' });

    assert.equal(nach(lauf.argv, '+tv_enable'), null);
    assert.equal(nach(lauf.argv, '+tv_port'), null);
  });

  it('gibt GOTV dasselbe Passwort wie dem Server', () => {
    const ordner = arbeitsordner();
    starte(ordner, { CS2_GOTV: 'true', CS2_PASSWORD: 'geheim' });

    assert.match(datei(ordner, 'palantir.cfg'), /^tv_password "geheim"$/mu);
  });

  it('startet nicht mit ungültigem GOTV-Schalter oder -Port', () => {
    assert.equal(starte(arbeitsordner(), { CS2_GOTV: 'ja' }).status, 78);
    assert.equal(starte(arbeitsordner(), { CS2_GOTV: 'true', CS2_TV_PORT: '1; quit' }).status, 78);
  });

  it('schaltet den Ruhezustand ab – sonst antwortet die Konsole leer nicht', () => {
    const ordner = arbeitsordner();
    starte(ordner);

    assert.match(datei(ordner, 'palantir.cfg'), /^sv_hibernate_when_empty 0$/mu);
  });

  it('spielt auf Wunsch alle Runden – ohne Angabe wie Valve (Schritt 5)', () => {
    const an = arbeitsordner();
    const aus = arbeitsordner();
    starte(an, { CS2_ALL_ROUNDS: 'true' });
    starte(aus);

    assert.match(datei(an, 'palantir.cfg'), /^mp_match_can_clinch 0$/mu);
    assert.match(datei(aus, 'palantir.cfg'), /^mp_match_can_clinch 1$/mu);
  });

  it('lehnt einen Wert für „alle Runden“ ab, der weder true noch false ist', () => {
    const lauf = starte(arbeitsordner(), { CS2_ALL_ROUNDS: 'ja' });

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

/**
 * Schritt 7: Plugin-Grundlage. Die Archive baut der Test selbst – ein
 * `.tar.gz` für MetaMod, ein Zip für CounterStrikeSharp – und reicht sie über
 * `file://` mit ihrer echten Summe herein.
 */
const ZIP_VORHANDEN = spawnSync('sh', ['-c', 'command -v zip && command -v unzip']).status === 0;
const nurMitZip = {
  skip:
    SH_VORHANDEN && ZIP_VORHANDEN && process.platform !== 'win32'
      ? false
      : 'Braucht sh, zip und unzip.',
};

function grundlageArchive(kennung = 'alt') {
  const wurzel = mkdtempSync(join(tmpdir(), 'palantir-cs2-grundlage-'));
  aufraeumen.push(wurzel);
  const sh = (befehl) => spawnSync('sh', ['-c', befehl], { cwd: wurzel, encoding: 'utf8' });

  sh(
    'mkdir -p mm/addons/metamod css/addons/counterstrikesharp/configs && ' +
      'echo "; eigene Plugins" > mm/addons/metamod/metaplugins.ini && ' +
      `echo "${kennung}" > mm/addons/metamod/fassung.txt && ` +
      'echo "{}" > css/addons/counterstrikesharp/configs/core.example.json && ' +
      'tar -czf metamod.tar.gz -C mm addons && (cd css && zip -qr ../css.zip addons)',
  );

  const summe = (datei) =>
    createHash('sha256')
      .update(readFileSync(join(wurzel, datei)))
      .digest('hex');

  return {
    CS2_METAMOD_URL: `file://${posix(join(wurzel, 'metamod.tar.gz'))}`,
    CS2_METAMOD_SHA256: summe('metamod.tar.gz'),
    CS2_CSS_URL: `file://${posix(join(wurzel, 'css.zip'))}`,
    CS2_CSS_SHA256: summe('css.zip'),
  };
}

describe('start.sh – Schritt 7: Plugin-Grundlage', nurMitShell, () => {
  const gameinfo = (ordner) =>
    readFileSync(join(ordner.daten, 'server', 'game', 'csgo', 'gameinfo.gi'), 'utf8');

  it('lässt ohne Schalter alles, wie es ist – kein Download, keine Zeile in gameinfo.gi', () => {
    const ordner = arbeitsordner();
    const lauf = starte(ordner, { CS2_METAMOD_URL: 'file:///gibt/es/nicht' });

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.doesNotMatch(gameinfo(ordner), /metamod/u);
  });

  it('bricht mit 69 ab, wenn die Summe nicht passt – und trägt nichts ein', nurMitZip, () => {
    const ordner = arbeitsordner();
    const lauf = starte(ordner, {
      ...grundlageArchive(),
      CS2_METAMOD_SHA256: '0'.repeat(64),
      CS2_PLUGINS: 'true',
    });

    assert.equal(lauf.status, 69);
    assert.deepEqual(lauf.argv, []);
  });

  it(
    'packt die Grundlage aus und trägt MetaMod direkt hinter Game_LowViolence ein',
    nurMitZip,
    () => {
      const ordner = arbeitsordner();
      const lauf = starte(ordner, { ...grundlageArchive(), CS2_PLUGINS: 'true' });
      const csgo = join(ordner.daten, 'server', 'game', 'csgo');

      assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
      assert.match(
        gameinfo(ordner),
        /Game_LowViolence\tcsgo_lv\n\t\t\tGame\tcsgo\/addons\/metamod\n\t\t\tGame\tcsgo\n/u,
      );
      assert.ok(existsSync(join(csgo, 'addons', 'metamod', 'metaplugins.ini')));
      // core.json einmal aus der Vorlage.
      assert.ok(existsSync(join(csgo, 'addons', 'counterstrikesharp', 'configs', 'core.json')));
    },
  );

  it(
    'trägt beim zweiten Start nicht doppelt ein und lässt metaplugins.ini dem Betreiber',
    nurMitZip,
    () => {
      const ordner = arbeitsordner();
      const archive = grundlageArchive();
      starte(ordner, { ...archive, CS2_PLUGINS: 'true' });
      const ini = join(
        ordner.daten,
        'server',
        'game',
        'csgo',
        'addons',
        'metamod',
        'metaplugins.ini',
      );
      writeFileSync(ini, 'addons/meins\n');

      starte(ordner, { ...archive, CS2_PLUGINS: 'true' });

      assert.equal(gameinfo(ordner).match(/csgo\/addons\/metamod/gu)?.length, 1);
      assert.equal(readFileSync(ini, 'utf8'), 'addons/meins\n');
    },
  );

  it('räumt bei einem MetaMod-Wechsel Reste der alten Fassung weg', nurMitZip, () => {
    const ordner = arbeitsordner();
    starte(ordner, { ...grundlageArchive(), CS2_PLUGINS: 'true' });
    const metamod = join(ordner.daten, 'server', 'game', 'csgo', 'addons', 'metamod');
    writeFileSync(join(metamod, 'rest-der-alten-fassung.so'), 'alt');
    writeFileSync(join(metamod, 'metaplugins.ini'), 'addons/meins\n');

    // Andere Archive, andere Summen: eine neue Fassung.
    starte(ordner, { ...grundlageArchive('neu'), CS2_PLUGINS: 'true' });

    assert.ok(!existsSync(join(metamod, 'rest-der-alten-fassung.so')));
    assert.equal(readFileSync(join(metamod, 'metaplugins.ini'), 'utf8'), 'addons/meins\n');
  });

  it('nimmt MetaMod beim Abschalten wieder aus gameinfo.gi', nurMitZip, () => {
    const ordner = arbeitsordner();
    const archive = grundlageArchive();
    starte(ordner, { ...archive, CS2_PLUGINS: 'true' });

    const lauf = starte(ordner, { ...archive, CS2_PLUGINS: 'false' });

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.doesNotMatch(gameinfo(ordner), /metamod/u);
  });

  it('lehnt einen Plugin-Schalter ab, der weder true noch false ist', () => {
    assert.equal(starte(arbeitsordner(), { CS2_PLUGINS: 'ja' }).status, 78);
  });
});

describe('start.sh – Stoppsignal (Schritt 3.1)', nurMitSignalen, () => {
  function warteAuf(bedingung, meldung) {
    return new Promise((fertig, scheitern) => {
      const frist = setTimeout(() => {
        clearInterval(schauen);
        scheitern(new Error(meldung()));
      }, 30_000);
      const schauen = setInterval(() => {
        if (bedingung()) {
          clearTimeout(frist);
          clearInterval(schauen);
          fertig();
        }
      }, 50);
    });
  }

  it('schickt quit in die Konsole und endet mit 0, statt die Frist abzuwarten', async () => {
    // Vorher war bash (cs2.sh) Prozess 1 und SIGTERM kam nie an – jedes
    // Stoppen lief in Dockers volle Frist.
    const ordner = arbeitsordner();
    let ausgabe = '';

    const lauf = spawn('sh', [START_SH], {
      env: {
        ...process.env,
        PALANTIR_DATA_DIR: posix(ordner.daten),
        PALANTIR_LIB_DIR: LIB_ORDNER,
        PALANTIR_STEAMCMD_DIR: posix(ordner.vorlage),
        TEST_SERVER_WARTET: '1',
      },
    });
    lauf.stdout.on('data', (stueck) => {
      ausgabe += String(stueck);
    });

    await warteAuf(
      () => ausgabe.includes('argv -dedicated'),
      () => `Server kam nicht hoch: ${ausgabe}`,
    );

    const beginn = Date.now();
    lauf.kill('SIGTERM');

    const code = await new Promise((fertig) => {
      lauf.on('exit', (status) => fertig(status));
    });

    assert.match(ausgabe, /stdin quit/u);
    assert.equal(code, 0);
    // Nicht die 20 Sekunden bis zum Signal an CS2 – quit hat gereicht.
    assert.ok(Date.now() - beginn < 10_000);
  });
});

describe('start.sh – Schritt 3.2: Live-Werte', nurMitShell, () => {
  const datei = (ordner, name) =>
    readFileSync(join(ordner.daten, 'server', 'game', 'csgo', 'cfg', name), 'utf8');

  it('leert palantir_live.cfg beim Start – dann gelten wieder die Einstellungen', () => {
    const ordner = arbeitsordner();
    starte(ordner);
    writeFileSync(
      join(ordner.daten, 'server', 'game', 'csgo', 'cfg', 'palantir_live.cfg'),
      'bot_quota 7\n',
    );

    starte(ordner);

    assert.doesNotMatch(datei(ordner, 'palantir_live.cfg'), /bot_quota/u);
  });

  it('führt nach jeder Modus-Konfiguration erst palantir, dann palantir_live aus', () => {
    const ordner = arbeitsordner();
    starte(ordner);

    const inhalt = datei(ordner, 'gamemode_deathmatch_server.cfg');
    assert.ok(inhalt.indexOf('exec palantir\n') < inhalt.indexOf('exec palantir_live'), inhalt);
  });
});
