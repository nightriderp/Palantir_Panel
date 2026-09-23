/**
 * Prüfungen für `start.sh` des CS2-Images – ohne Docker, ohne SteamCMD, ohne CS2.
 *
 * Gestellt werden zwei Attrappen: ein `steamcmd.sh`, das statt eines 30 GB
 * grossen Downloads eine ausführbare Datei an die Stelle legt, an der das
 * Skript die Serverbinärdatei erwartet – und die Binärdatei selbst, die ihre
 * Argumente aufschreibt.
 *
 * Damit sind genau die Entscheidungen prüfbar, die das Skript trifft: die
 * Übersetzung der Spielmodi in Valves zwei Zahlen, die Kartenquelle, die
 * `palantir.cfg`, `steamclient.so` an der Stelle, ohne die CS2 nicht startet,
 * und die Startparameter.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
import { crc32 } from 'node:zlib';

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

/**
 * Kann `tar` hier mit Pfaden umgehen, die einen Laufwerksbuchstaben tragen?
 *
 * Unter Windows nicht: GNU tar haelt das `C:` fuer einen Rechnernamen. Im
 * Container - und damit in der CI - gibt es keine Laufwerksbuchstaben, dort
 * laufen diese Pruefungen (dasselbe Muster wie im ACC-Image).
 */
const TAR_MIT_LAUFWERK = (() => {
  if (!SH_VORHANDEN) return false;
  const ordner = mkdtempSync(join(tmpdir(), 'palantir-tar-'));
  const lauf = spawnSync('sh', [
    '-c',
    'cd "$1" && printf x > a && tar -czf "$1/t.tar.gz" a',
    '_',
    posix(ordner),
  ]);
  spawnSync('sh', ['-c', 'rm -rf "$1"', '_', posix(ordner)]);

  return lauf.status === 0;
})();
const nurMitTar = {
  skip: TAR_MIT_LAUFWERK ? false : 'tar kommt hier nicht mit Laufwerksbuchstaben zurecht.',
};

const aufraeumen = [];

after(() => {
  for (const pfad of aufraeumen) {
    spawnSync('sh', ['-c', 'rm -rf "$1"', '_', posix(pfad)]);
  }
});

function arbeitsordner() {
  const wurzel = mkdtempSync(join(tmpdir(), 'palantir-cs2-'));
  aufraeumen.push(wurzel);

  const daten = join(wurzel, 'daten');
  const vorlage = join(wurzel, 'steamcmd');
  mkdirSync(daten);
  mkdirSync(join(vorlage, 'linux64'), { recursive: true });
  writeFileSync(join(vorlage, 'linux64', 'steamclient.so'), 'so');

  // Statt 30 GB: legt die Binärdatei an der erwarteten Stelle an und schreibt
  // ihre eigenen Argumente auf.
  writeFileSync(
    join(vorlage, 'steamcmd.sh'),
    [
      '#!/bin/sh',
      'ziel=""',
      'for a in "$@"; do',
      '  case "$vorher" in +force_install_dir) ziel="$a";; esac',
      '  vorher="$a"',
      'done',
      'mkdir -p "$ziel/game/bin/linuxsteamrt64" "$ziel/game/csgo/cfg"',
      'echo x >> "$ziel/.steamcmd-aufrufe"',
      'printf "\\t\\t\\tGame_LowViolence\\tcsgo_lv\\n\\t\\t\\tGame\\tcsgo\\n" > "$ziel/game/csgo/gameinfo.gi"',
      'printf "%s\\n" "#!/bin/sh" "for arg in \\"\\$@\\"; do printf \'argv %s\\\\n\' \\"\\$arg\\"; done" > "$ziel/game/bin/linuxsteamrt64/cs2"',
      'chmod 0755 "$ziel/game/bin/linuxsteamrt64/cs2"',
      'printf "beispiel\\n" > "$ziel/game/csgo/gamemodes_server.txt.example"',
      'exit 0',
      '',
    ].join('\n'),
  );
  spawnSync('sh', ['-c', 'chmod 0755 "$1"', '_', posix(join(vorlage, 'steamcmd.sh'))]);

  // Attrappen für MariaDB. `mariadbd` schreibt auf, womit es gestartet wurde
  // und was in der Init-Datei stand, und wartet dann auf sein Signal.
  const bin = join(wurzel, 'bin');
  mkdirSync(bin);
  const attrappen = {
    'mariadb-install-db': [
      '#!/bin/sh',
      'for a in "$@"; do case "$a" in --datadir=*) mkdir -p "${a#--datadir=}/mysql";; esac; done',
      'exit 0',
    ],
    mariadbd: [
      '#!/bin/sh',
      'if [ -n "${TEST_DB_STIRBT:-}" ]; then exit 1; fi',
      'protokoll="$PALANTIR_DATA_DIR/mariadbd.args"',
      'for a in "$@"; do printf "%s\\n" "$a" >> "$protokoll"; case "$a" in --init-file=*) cat "${a#--init-file=}" > "$PALANTIR_DATA_DIR/mariadbd.init";; esac; done',
      // Erst nach der Init-Datei „bereit" – wie die echte MariaDB, die
      // `--init-file` abarbeitet, bevor sie Verbindungen annimmt.
      ': > "$PALANTIR_DATA_DIR/mariadbd.bereit"',
      'trap \'rm -f "$PALANTIR_DATA_DIR/mariadbd.bereit"; echo gestoppt > "$PALANTIR_DATA_DIR/mariadbd.ende"; exit 0\' TERM',
      'while :; do sleep 1; done',
    ],
    'mariadb-admin': ['#!/bin/sh', 'test -f "$PALANTIR_DATA_DIR/mariadbd.bereit"'],
  };
  for (const [name, zeilen] of Object.entries(attrappen)) {
    writeFileSync(join(bin, name), `${zeilen.join('\n')}\n`);
    spawnSync('sh', ['-c', 'chmod 0755 "$1"', '_', posix(join(bin, name))]);
  }

  return { wurzel, daten, vorlage, bin };
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
        PALANTIR_STARTUP_PARAMETERS: '',
        CS2_PLUGINS: 'false',
        PALANTIR_CS2_DIR: posix(HIER),
        ...extra,
      },
    },
  );

  return {
    ...ergebnis,
    argv: (ergebnis.stdout ?? '')
      .split('\n')
      .map((zeile) => zeile.replace(/\r$/u, ''))
      .filter((zeile) => zeile.startsWith('argv '))
      .map((zeile) => zeile.slice(5)),
  };
}

/** Der Wert, der einem Schalter in der Argumentliste folgt. */
function nach(argv, schalter) {
  const stelle = argv.indexOf(schalter);

  return stelle === -1 ? null : (argv[stelle + 1] ?? null);
}

const cfg = (ordner) =>
  readFileSync(join(ordner.daten, 'server', 'game', 'csgo', 'cfg', 'palantir.cfg'), 'utf8');

describe('start.sh – Spielmodus', nurMitShell, () => {
  it('übersetzt competitive in Valves zwei Zahlen', () => {
    const lauf = starte(arbeitsordner(), { CS2_GAME_MODE: 'competitive' });

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.equal(nach(lauf.argv, '+game_type'), '0');
    assert.equal(nach(lauf.argv, '+game_mode'), '1');
  });

  it('kennt auch deathmatch, wingman, armsrace und custom', () => {
    const faelle = [
      ['casual', '0', '0'],
      ['wingman', '0', '2'],
      ['armsrace', '1', '0'],
      ['deathmatch', '1', '2'],
      ['custom', '3', '0'],
    ];

    for (const [modus, typ, nummer] of faelle) {
      const lauf = starte(arbeitsordner(), { CS2_GAME_MODE: modus });

      assert.equal(lauf.status, 0, `${modus}: ${lauf.stderr}`);
      assert.equal(nach(lauf.argv, '+game_type'), typ, modus);
      assert.equal(nach(lauf.argv, '+game_mode'), nummer, modus);
    }
  });

  it('nimmt ohne Angabe competitive', () => {
    const lauf = starte(arbeitsordner());

    assert.equal(nach(lauf.argv, '+game_mode'), '1');
  });

  it('startet nicht mit einem Modus, den es nicht gibt', () => {
    const lauf = starte(arbeitsordner(), { CS2_GAME_MODE: 'battleroyale' });

    assert.equal(lauf.status, 78);
    assert.match(lauf.stdout, /Unbekannter Spielmodus/u);
    assert.deepEqual(lauf.argv, []);
  });
});

describe('start.sh – Kartenquelle', nurMitShell, () => {
  it('nimmt ohne Angabe de_dust2', () => {
    const lauf = starte(arbeitsordner());

    assert.equal(nach(lauf.argv, '+map'), 'de_dust2');
  });

  it('startet eine einzelne Workshop-Karte über ihre Nummer', () => {
    const lauf = starte(arbeitsordner(), {
      CS2_MAP_SOURCE: 'workshop-map',
      CS2_WORKSHOP_ID: '3070293560',
    });

    assert.equal(nach(lauf.argv, '+host_workshop_map'), '3070293560');
    assert.equal(nach(lauf.argv, '+map'), null);
  });

  it('startet eine Workshop-Sammlung', () => {
    const lauf = starte(arbeitsordner(), {
      CS2_MAP_SOURCE: 'workshop-collection',
      CS2_WORKSHOP_ID: '3070293560',
    });

    assert.equal(nach(lauf.argv, '+host_workshop_collection'), '3070293560');
  });

  it('startet nicht, wenn zur Workshop-Quelle die Nummer fehlt', () => {
    const lauf = starte(arbeitsordner(), { CS2_MAP_SOURCE: 'workshop-map' });

    assert.equal(lauf.status, 78);
    assert.deepEqual(lauf.argv, []);
  });
});

describe('start.sh – palantir.cfg', nurMitShell, () => {
  it('schreibt die Felder des Panels hinein', () => {
    const ordner = arbeitsordner();
    starte(ordner, { CS2_HOSTNAME: 'Unsere Runde', CS2_PASSWORD: 'geheim' });

    const inhalt = cfg(ordner);
    assert.match(inhalt, /^hostname "Unsere Runde"$/mu);
    assert.match(inhalt, /^sv_password "geheim"$/mu);
  });

  it('lässt tv_autorecord aus – es ist ausdrücklich nicht empfohlen', () => {
    const ordner = arbeitsordner();
    // So schickt es das Panel: `String(true)`.
    starte(ordner, { CS2_GOTV: 'true' });

    assert.match(cfg(ordner), /^tv_enable 1$/mu);
    assert.match(cfg(ordner), /^tv_autorecord 0$/mu);
  });

  it('nimmt Anführungszeichen aus dem Servernamen – sie zerrissen die Zeile', () => {
    const ordner = arbeitsordner();
    starte(ordner, { CS2_HOSTNAME: 'Der "beste" Server' });

    assert.match(cfg(ordner), /^hostname "Der beste Server"$/mu);
  });

  it('lässt die server.cfg des Betreibers in Ruhe', () => {
    // Sie läuft bei jedem Kartenwechsel und sticht damit unsere Datei – wer
    // dort eine Zeile hinschreibt, will sie.
    const ordner = arbeitsordner();
    starte(ordner);

    assert.throws(() =>
      readFileSync(join(ordner.daten, 'server', 'game', 'csgo', 'cfg', 'server.cfg'), 'utf8'),
    );
  });

  it('lässt die Datei ausführen', () => {
    const lauf = starte(arbeitsordner());

    assert.equal(nach(lauf.argv, '+exec'), 'palantir');
  });
});

describe('start.sh – steamclient.so und Start', nurMitShell, () => {
  it('legt steamclient.so nach ~/.steam/sdk64 – ohne sie startet CS2 nicht', () => {
    const ordner = arbeitsordner();
    starte(ordner);

    const ziel = join(ordner.daten, '.palantir', '.steam', 'sdk64', 'steamclient.so');
    assert.equal(readFileSync(ziel, 'utf8'), 'so');
  });

  it('legt gamemodes_server.txt aus der Vorlage an', () => {
    // Dort stehen Spielerzahl je Modus und die eigene Kartenliste; danach
    // gehört die Datei dem Betreiber.
    const ordner = arbeitsordner();
    starte(ordner);

    const ziel = join(ordner.daten, 'server', 'game', 'csgo', 'gamemodes_server.txt');
    assert.equal(readFileSync(ziel, 'utf8').trim(), 'beispiel');
  });

  it('startet als dedizierter Server auf dem gegebenen Port', () => {
    const lauf = starte(arbeitsordner(), { SERVER_PORT: '27031' });

    assert.ok(lauf.argv.includes('-dedicated'), lauf.argv.join(' '));
    assert.equal(nach(lauf.argv, '-port'), '27031');
  });

  it('gibt den GSLT nur mit, wenn es einen gibt', () => {
    const ohne = starte(arbeitsordner());
    const mit = starte(arbeitsordner(), { CS2_GSLT: 'ABC123' });

    assert.equal(nach(ohne.argv, '+sv_setsteamaccount'), null);
    assert.equal(nach(mit.argv, '+sv_setsteamaccount'), 'ABC123');
  });

  it('hängt die Startparameter des Betreibers hinten an', () => {
    const lauf = starte(arbeitsordner(), { PALANTIR_STARTUP_PARAMETERS: '-insecure' });

    assert.equal(lauf.argv[lauf.argv.length - 1], '-insecure');
  });
});

describe('start.sh – Valves Starter', nurMitShell, () => {
  /** Ein `cs2.sh`, das Suchpfad, Arbeitsordner und Argumente aufschreibt. */
  function mitStarter(ordner) {
    const game = join(ordner.daten, 'server', 'game');
    mkdirSync(game, { recursive: true });
    writeFileSync(
      join(game, 'cs2.sh'),
      [
        '#!/bin/bash',
        'echo "starter ja"',
        'echo "ld $LD_LIBRARY_PATH"',
        'echo "cwd $(pwd)"',
        'for a in "$@"; do printf "argv %s\\n" "$a"; done',
        '',
      ].join('\n'),
    );
  }

  it('startet über game/cs2.sh, wenn es ihn gibt', () => {
    // Seit dem Update vom 17.09.2025 braucht CS2 Bibliotheken aus
    // game/bin/linuxsteamrt64; der Starter setzt den Suchpfad. Direkt
    // gestartet war der Server sofort wieder weg.
    const ordner = arbeitsordner();
    mitStarter(ordner);
    const lauf = starte(ordner);

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.match(lauf.stdout, /^starter ja$/mu);
    assert.ok(lauf.argv.includes('-dedicated'), lauf.argv.join(' '));
  });

  it('startet aus game/ heraus und mit Valves Bibliotheken im Suchpfad', () => {
    const ordner = arbeitsordner();
    mitStarter(ordner);
    const lauf = starte(ordner);

    assert.match(lauf.stdout, /^cwd .*\/server\/game\r?$/mu);
    assert.match(lauf.stdout, /^ld [^\n]*\/server\/game\/bin\/linuxsteamrt64/mu);
  });

  it('startet ohne Starter die Binärdatei direkt und sagt es', () => {
    const lauf = starte(arbeitsordner());

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.match(lauf.stdout, /cs2\.sh fehlt/u);
    assert.ok(lauf.argv.includes('-dedicated'), lauf.argv.join(' '));
  });
});

describe('start.sh – Schalter aus dem Panel', nurMitShell, () => {
  it('übersetzt „Alle Runden spielen“ in mp_match_can_clinch 0', () => {
    // Umgekehrt: Der Schalter an heisst, das Spiel darf NICHT vorzeitig
    // entschieden sein.
    const ordner = arbeitsordner();
    starte(ordner, { CS2_ALL_ROUNDS: 'true' });

    assert.match(cfg(ordner), /^mp_match_can_clinch 0$/mu);
  });

  it('lässt ein Spiel ohne den Schalter vorzeitig enden', () => {
    const ordner = arbeitsordner();
    starte(ordner, { CS2_ALL_ROUNDS: 'false' });

    assert.match(cfg(ordner), /^mp_match_can_clinch 1$/mu);
  });

  it('schreibt nie ein „true“ in die Datei – CS2 versteht nur Zahlen', () => {
    // Der Fehler, den dieser Fall festhält: Das Panel schickt `String(true)`,
    // und `mp_match_can_clinch true` wäre still wirkungslos.
    const ordner = arbeitsordner();
    starte(ordner, { CS2_ALL_ROUNDS: 'true', CS2_GOTV: 'true' });

    assert.doesNotMatch(cfg(ordner), /\btrue\b|\bfalse\b/u);
  });

  it('schaltet GOTV ohne Angabe aus', () => {
    const ordner = arbeitsordner();
    starte(ordner);

    assert.match(cfg(ordner), /^tv_enable 0$/mu);
  });
});

// ---------------------------------------------------------------------------
// Plugin-Grundlage, Admins, Update-Sperre (Betreiber-Wunsch 22.09.2026)
// ---------------------------------------------------------------------------

/**
 * Ein Zip ohne Kompression – `zip` gibt es nicht auf jedem Rechner, `unzip`
 * liegt im Image und in Git für Windows.
 */
function zipOhneKompression(dateien) {
  const lokal = [];
  const zentral = [];
  let versatz = 0;

  for (const [name, inhalt] of Object.entries(dateien)) {
    const n = Buffer.from(name);
    const d = Buffer.from(inhalt);
    const pruef = crc32(d);
    const kopf = Buffer.alloc(30);
    kopf.writeUInt32LE(0x04034b50, 0);
    kopf.writeUInt16LE(10, 4);
    kopf.writeUInt32LE(pruef, 14);
    kopf.writeUInt32LE(d.length, 18);
    kopf.writeUInt32LE(d.length, 22);
    kopf.writeUInt16LE(n.length, 26);
    lokal.push(kopf, n, d);

    const eintrag = Buffer.alloc(46);
    eintrag.writeUInt32LE(0x02014b50, 0);
    eintrag.writeUInt16LE(20, 4);
    eintrag.writeUInt16LE(10, 6);
    eintrag.writeUInt32LE(pruef, 16);
    eintrag.writeUInt32LE(d.length, 20);
    eintrag.writeUInt32LE(d.length, 24);
    eintrag.writeUInt16LE(n.length, 28);
    eintrag.writeUInt32LE(versatz, 42);
    zentral.push(eintrag, n);

    versatz += kopf.length + n.length + d.length;
  }

  const verzeichnis = Buffer.concat(zentral);
  const ende = Buffer.alloc(22);
  ende.writeUInt32LE(0x06054b50, 0);
  ende.writeUInt16LE(Object.keys(dateien).length, 8);
  ende.writeUInt16LE(Object.keys(dateien).length, 10);
  ende.writeUInt32LE(verzeichnis.length, 12);
  ende.writeUInt32LE(versatz, 16);

  return Buffer.concat([...lokal, verzeichnis, ende]);
}

const summe = (pfad) => createHash('sha256').update(readFileSync(pfad)).digest('hex');

/**
 * Legt beide Archive dorthin, wo `palantir_datei_holen` sie sucht, und gibt
 * die Umgebung zurück, die das Image sonst setzt. Die Adressen zeigen ins
 * Leere: Passt die Summe, wird nichts geholt – und genau das soll so sein.
 */
function mitGrundlage(ordner, fassung = 'eins') {
  const ablage = join(ordner.daten, '.palantir', 'cs2-plugins');
  const quelle = join(ordner.wurzel, `metamod-${fassung}`);
  mkdirSync(join(quelle, 'addons', 'metamod'), { recursive: true });
  mkdirSync(ablage, { recursive: true });
  writeFileSync(join(quelle, 'addons', 'metamod.vdf'), `metamod ${fassung}`);
  writeFileSync(join(quelle, 'addons', 'metamod', 'metaplugins.ini'), 'vorlage');

  const tar = join(ablage, 'metamod.tar.gz');
  const lauf = spawnSync('sh', [
    '-c',
    'cd "$1" && tar -czf "$2" addons',
    '_',
    posix(quelle),
    posix(tar),
  ]);
  assert.equal(lauf.status, 0, String(lauf.stderr));

  const zip = join(ablage, 'counterstrikesharp.zip');
  writeFileSync(
    zip,
    zipOhneKompression({
      'addons/counterstrikesharp/configs/core.example.json': '{"vorlage":true}',
      'addons/metamod/counterstrikesharp.vdf': `css ${fassung}`,
    }),
  );

  return {
    CS2_PLUGINS: 'true',
    CS2_METAMOD_URL: 'https://beispiel.invalid/metamod.tar.gz',
    CS2_METAMOD_SHA256: summe(tar),
    CS2_CSS_URL: 'https://beispiel.invalid/css.zip',
    CS2_CSS_SHA256: summe(zip),
  };
}

const csgo = (ordner, ...teile) => join(ordner.daten, 'server', 'game', 'csgo', ...teile);

describe('start.sh – Plugin-Grundlage', nurMitTar, () => {
  it('packt MetaMod und CounterStrikeSharp aus', () => {
    const ordner = arbeitsordner();
    const lauf = starte(ordner, mitGrundlage(ordner));

    assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
    assert.equal(readFileSync(csgo(ordner, 'addons', 'metamod.vdf'), 'utf8'), 'metamod eins');
    assert.equal(
      readFileSync(csgo(ordner, 'addons', 'metamod', 'counterstrikesharp.vdf'), 'utf8'),
      'css eins',
    );
  });

  it('trägt MetaMod direkt hinter Game_LowViolence in gameinfo.gi ein', () => {
    const ordner = arbeitsordner();
    starte(ordner, mitGrundlage(ordner));

    const zeilen = readFileSync(csgo(ordner, 'gameinfo.gi'), 'utf8').split('\n');
    const stelle = zeilen.findIndex((zeile) => zeile.includes('Game_LowViolence'));
    assert.equal(zeilen[stelle + 1], '\t\t\tGame\tcsgo/addons/metamod');
  });

  it('trägt sie auch nach dem Update wieder ein – und nie doppelt', () => {
    // Das Update schreibt gameinfo.gi neu (die Attrappe tut es bei jedem
    // Start); die Zeile muss danach wieder da sein, aber nur einmal.
    const ordner = arbeitsordner();
    const umgebung = mitGrundlage(ordner);
    starte(ordner, umgebung);
    starte(ordner, umgebung);

    const inhalt = readFileSync(csgo(ordner, 'gameinfo.gi'), 'utf8');
    assert.equal(inhalt.split('csgo/addons/metamod').length - 1, 1);
  });

  it('legt core.json einmal aus der Vorlage an und lässt sie danach stehen', () => {
    const ordner = arbeitsordner();
    const umgebung = mitGrundlage(ordner);
    starte(ordner, umgebung);

    const core = csgo(ordner, 'addons', 'counterstrikesharp', 'configs', 'core.json');
    assert.equal(readFileSync(core, 'utf8'), '{"vorlage":true}');

    writeFileSync(core, '{"eigen":true}');
    starte(ordner, umgebung);

    assert.equal(readFileSync(core, 'utf8'), '{"eigen":true}');
  });

  it('packt eine neue Fassung aus, behält aber die metaplugins.ini des Betreibers', () => {
    const ordner = arbeitsordner();
    starte(ordner, mitGrundlage(ordner, 'eins'));

    const ini = csgo(ordner, 'addons', 'metamod', 'metaplugins.ini');
    writeFileSync(ini, 'eigenes plugin');
    starte(ordner, mitGrundlage(ordner, 'zwei'));

    assert.equal(readFileSync(csgo(ordner, 'addons', 'metamod.vdf'), 'utf8'), 'metamod zwei');
    assert.equal(readFileSync(ini, 'utf8'), 'eigenes plugin');
  });

  it('startet nicht, wenn ein Archiv nicht zur Prüfsumme passt', () => {
    const ordner = arbeitsordner();
    const lauf = starte(ordner, { ...mitGrundlage(ordner), CS2_CSS_SHA256: '0'.repeat(64) });

    assert.equal(lauf.status, 69);
    assert.match(lauf.stdout, /Plugins laden/u);
    assert.deepEqual(lauf.argv, []);
  });

  it('startet nicht, wenn das Image Adresse oder Summe nicht setzt', () => {
    const lauf = starte(arbeitsordner(), { CS2_PLUGINS: 'true' });

    assert.equal(lauf.status, 69);
  });

  it('nimmt MetaMod aus gameinfo.gi, wenn die Plugins aus sind', () => {
    // Der Notausgang nach einem CS2-Update, das MetaMod bricht.
    const ordner = arbeitsordner();
    const umgebung = mitGrundlage(ordner);
    starte(ordner, umgebung);

    // Die Attrappe schreibt gameinfo.gi bei jedem Start neu; hier soll sie
    // stehen bleiben wie nach einem Start ohne Update.
    const lauf = starte(ordner, {
      ...umgebung,
      CS2_PLUGINS: 'false',
      PALANTIR_UPDATES_HALTEN: 'true',
    });

    assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
    assert.doesNotMatch(readFileSync(csgo(ordner, 'gameinfo.gi'), 'utf8'), /metamod/u);
  });
});

describe('start.sh – Admins', nurMitTar, () => {
  const admins = (ordner) => csgo(ordner, 'addons', 'counterstrikesharp', 'configs', 'admins.json');

  it('schreibt jede gültige SteamID64 mit vollen Rechten', () => {
    const ordner = arbeitsordner();
    starte(ordner, {
      ...mitGrundlage(ordner),
      CS2_ADMINS: '76561197960287930, 76561198000000001',
    });

    const inhalt = JSON.parse(readFileSync(admins(ordner), 'utf8'));
    assert.deepEqual(Object.keys(inhalt), [
      'palantir-76561197960287930',
      'palantir-76561198000000001',
    ]);
    assert.deepEqual(inhalt['palantir-76561197960287930'], {
      identity: '76561197960287930',
      immunity: 100,
      flags: ['@css/root'],
    });
  });

  it('übergeht, was keine SteamID64 ist, und sagt es im Log', () => {
    const ordner = arbeitsordner();
    const lauf = starte(ordner, {
      ...mitGrundlage(ordner),
      CS2_ADMINS: 'STEAM_0:1:1 76561197960287930 "; rm -rf /',
    });

    assert.match(lauf.stdout, /Keine SteamID64, uebergangen: STEAM_0:1:1/u);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(admins(ordner), 'utf8'))), [
      'palantir-76561197960287930',
    ]);
  });

  it('lässt eine von Hand gepflegte admins.json in Ruhe, wenn das Feld leer ist', () => {
    const ordner = arbeitsordner();
    const umgebung = mitGrundlage(ordner);
    starte(ordner, umgebung);
    writeFileSync(admins(ordner), '{"eigen":{}}');

    starte(ordner, { ...umgebung, CS2_ADMINS: '' });

    assert.equal(readFileSync(admins(ordner), 'utf8'), '{"eigen":{}}');
  });
});

describe('start.sh – Updates zurückhalten', nurMitShell, () => {
  const aufrufe = (ordner) => {
    const datei = join(ordner.daten, 'server', '.steamcmd-aufrufe');

    return existsSync(datei) ? readFileSync(datei, 'utf8').trim().split('\n').length : 0;
  };

  it('holt beim ersten Start trotzdem – ohne Dateien gibt es nichts zurückzuhalten', () => {
    const ordner = arbeitsordner();
    const lauf = starte(ordner, { PALANTIR_UPDATES_HALTEN: 'true' });

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.equal(aufrufe(ordner), 1);
  });

  it('lässt SteamCMD danach aus', () => {
    const ordner = arbeitsordner();
    starte(ordner);
    const lauf = starte(ordner, { PALANTIR_UPDATES_HALTEN: 'true' });

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.equal(aufrufe(ordner), 1);
    assert.match(lauf.stdout, /zurueckgehalten/u);
  });

  it('holt ohne den Schalter bei jedem Start', () => {
    const ordner = arbeitsordner();
    starte(ordner);
    starte(ordner, { PALANTIR_UPDATES_HALTEN: 'false' });

    assert.equal(aufrufe(ordner), 2);
  });
});

// ---------------------------------------------------------------------------
// Einzelne Plugins, WeaponPaints mit MariaDB (Betreiber-Wunsch 22.09.2026)
// ---------------------------------------------------------------------------

/**
 * Kann `jq` hier laufen? Im Image liegt es; auf einem Arbeitsrechner nicht
 * unbedingt. Die WeaponPaints-Prüfungen schreiben JSON und brauchen es.
 */
const JQ_DA = TAR_MIT_LAUFWERK && spawnSync('sh', ['-c', 'command -v jq']).status === 0;
const nurMitJq = { skip: JQ_DA ? false : 'Kein jq (oder kein tar mit Laufwerk) im PATH.' };

/** Test-Archive je Plugin: Inhalt und Zuordnung wie beim echten Vorbild. */
const TEST_PLUGINS = {
  anybaselib: {
    dateien: { 'addons/counterstrikesharp/shared/AnyBaseLib/AnyBaseLib.dll': 'abl' },
    zuordnung: 'addons=addons',
    ordner: '-',
  },
  playersettings: {
    dateien: { 'addons/counterstrikesharp/plugins/PlayerSettings/PlayerSettings.dll': 'ps' },
    zuordnung: 'addons=addons',
    ordner: 'PlayerSettings',
  },
  menumanager: {
    dateien: { 'addons/counterstrikesharp/plugins/MenuManagerCore/MenuManagerCore.dll': 'mm' },
    zuordnung: 'addons=addons',
    ordner: 'MenuManagerCore',
  },
  matchzy: {
    dateien: { 'addons/counterstrikesharp/plugins/MatchZy/MatchZy.dll': 'mz' },
    zuordnung: 'addons=addons',
    ordner: 'MatchZy',
  },
  simpleadmin: {
    dateien: {
      'counterstrikesharp/plugins/CS2-SimpleAdmin/CS2-SimpleAdmin.dll': 'sa',
      'counterstrikesharp/plugins/CS2-SimpleAdmin_FunCommands/Fun.dll': 'fun',
    },
    zuordnung: 'counterstrikesharp=addons/counterstrikesharp',
    ordner: 'CS2-SimpleAdmin,CS2-SimpleAdmin_FunCommands',
  },
  weaponpaints: {
    dateien: {
      'WeaponPaints/WeaponPaints.dll': 'wp',
      'gamedata/weaponpaints.json': '{}',
    },
    zuordnung:
      'WeaponPaints=addons/counterstrikesharp/plugins/WeaponPaints,gamedata=addons/counterstrikesharp/gamedata',
    ordner: 'WeaponPaints',
  },
  retakes: {
    dateien: { 'addons/counterstrikesharp/plugins/RetakesPlugin/RetakesPlugin.dll': 'rt' },
    zuordnung: 'addons=addons',
    ordner: 'RetakesPlugin',
  },
  fakercon: {
    tar: true,
    dateien: {
      'addons/fake_rcon/bin/linuxsteamrt64/fake_rcon.so': 'so',
      'addons/metamod/fake_rcon.vdf': 'vdf',
    },
    zuordnung: 'addons=addons',
    ordner: '-',
  },
};

/**
 * Legt die Grundlage und alle Test-Plugins mit passender Summe ab und
 * schreibt eine Plugin-Liste dazu. Die Adressen zeigen ins Leere – passt die
 * Summe, wird nichts geholt.
 */
function mitPlugins(ordner, anpassen = {}) {
  const umgebung = mitGrundlage(ordner);
  const ablage = join(ordner.daten, '.palantir', 'cs2-plugins');
  const zeilen = [];

  for (const [name, vorbild] of Object.entries(TEST_PLUGINS)) {
    const plugin = { ...vorbild, ...(anpassen[name] ?? {}) };
    let archiv;

    if (plugin.tar) {
      const quelle = join(ordner.wurzel, `quelle-${name}`);
      for (const [pfad, inhalt] of Object.entries(plugin.dateien)) {
        mkdirSync(join(quelle, pfad, '..'), { recursive: true });
        writeFileSync(join(quelle, pfad), inhalt);
      }
      archiv = join(ablage, `${name}.tar.gz`);
      spawnSync('sh', ['-c', 'cd "$1" && tar -czf "$2" .', '_', posix(quelle), posix(archiv)]);
    } else {
      archiv = join(ablage, `${name}.zip`);
      writeFileSync(archiv, zipOhneKompression(plugin.dateien));
    }

    const endung = plugin.tar ? 'tar.gz' : 'zip';
    zeilen.push(
      `${name} 1 https://beispiel.invalid/${name}.${endung} ${summe(archiv)} ${plugin.zuordnung} ${plugin.ordner}`,
    );
  }

  const liste = join(ordner.wurzel, 'plugins.list');
  writeFileSync(liste, `# Test\n${zeilen.join('\n')}\n`);

  return { ...umgebung, PALANTIR_CS2_PLUGINLISTE: posix(liste) };
}

const pluginOrdner = (ordner, ...teile) =>
  csgo(ordner, 'addons', 'counterstrikesharp', 'plugins', ...teile);

describe('start.sh – einzelne Plugins', nurMitTar, () => {
  it('packt ein eingeschaltetes Plugin aus', () => {
    const ordner = arbeitsordner();
    const lauf = starte(ordner, { ...mitPlugins(ordner), CS2_PLUGIN_MATCHZY: 'true' });

    assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
    assert.equal(readFileSync(pluginOrdner(ordner, 'MatchZy', 'MatchZy.dll'), 'utf8'), 'mz');
  });

  it('lässt ausgeschaltete Plugins weg', () => {
    const ordner = arbeitsordner();
    starte(ordner, { ...mitPlugins(ordner), CS2_PLUGIN_MATCHZY: 'true' });

    assert.equal(existsSync(pluginOrdner(ordner, 'RetakesPlugin')), false);
    assert.equal(existsSync(pluginOrdner(ordner, 'WeaponPaints')), false);
  });

  it('schiebt ein abgeschaltetes Plugin nach disabled und holt es samt eigener Dateien zurück', () => {
    const ordner = arbeitsordner();
    const umgebung = mitPlugins(ordner);
    starte(ordner, { ...umgebung, CS2_PLUGIN_MATCHZY: 'true' });
    writeFileSync(pluginOrdner(ordner, 'MatchZy', 'eigen.txt'), 'meins');

    starte(ordner, { ...umgebung, CS2_PLUGIN_MATCHZY: 'false' });

    assert.equal(existsSync(pluginOrdner(ordner, 'MatchZy')), false);
    assert.equal(
      readFileSync(pluginOrdner(ordner, 'disabled', 'MatchZy', 'eigen.txt'), 'utf8'),
      'meins',
    );

    starte(ordner, { ...umgebung, CS2_PLUGIN_MATCHZY: 'true' });

    assert.equal(readFileSync(pluginOrdner(ordner, 'MatchZy', 'eigen.txt'), 'utf8'), 'meins');
    assert.equal(existsSync(pluginOrdner(ordner, 'disabled', 'MatchZy')), false);
  });

  it('zieht für SimpleAdmin MenuManager, PlayerSettings und AnyBaseLib nach', () => {
    const ordner = arbeitsordner();
    const lauf = starte(ordner, { ...mitPlugins(ordner), CS2_PLUGIN_SIMPLEADMIN: 'true' });

    assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
    assert.ok(existsSync(pluginOrdner(ordner, 'CS2-SimpleAdmin', 'CS2-SimpleAdmin.dll')));
    assert.ok(existsSync(pluginOrdner(ordner, 'CS2-SimpleAdmin_FunCommands', 'Fun.dll')));
    assert.ok(existsSync(pluginOrdner(ordner, 'MenuManagerCore', 'MenuManagerCore.dll')));
    assert.ok(existsSync(pluginOrdner(ordner, 'PlayerSettings', 'PlayerSettings.dll')));
    assert.ok(
      existsSync(
        csgo(ordner, 'addons', 'counterstrikesharp', 'shared', 'AnyBaseLib', 'AnyBaseLib.dll'),
      ),
    );
  });

  it('schaltet die Abhängigkeiten mit ab, wenn sie keiner mehr braucht', () => {
    const ordner = arbeitsordner();
    const umgebung = mitPlugins(ordner);
    starte(ordner, { ...umgebung, CS2_PLUGIN_SIMPLEADMIN: 'true' });
    starte(ordner, umgebung);

    assert.equal(existsSync(pluginOrdner(ordner, 'MenuManagerCore')), false);
    assert.equal(existsSync(pluginOrdner(ordner, 'CS2-SimpleAdmin_FunCommands')), false);
    assert.ok(existsSync(pluginOrdner(ordner, 'disabled', 'MenuManagerCore')));
  });

  it('startet nicht, wenn ein Archiv anders gepackt ist als eingetragen', () => {
    const ordner = arbeitsordner();
    const lauf = starte(ordner, {
      ...mitPlugins(ordner, { matchzy: { zuordnung: 'gibtesnicht=addons' } }),
      CS2_PLUGIN_MATCHZY: 'true',
    });

    assert.equal(lauf.status, 69);
    assert.match(lauf.stdout, /fehlt gibtesnicht/u);
    assert.deepEqual(lauf.argv, []);
  });

  it('warnt, wenn MatchZy und Retakes gleichzeitig laufen sollen', () => {
    const ordner = arbeitsordner();
    const lauf = starte(ordner, {
      ...mitPlugins(ordner),
      CS2_PLUGIN_MATCHZY: 'true',
      CS2_PLUGIN_RETAKES: 'true',
    });

    assert.match(lauf.stdout, /MatchZy und Retakes/u);
  });
});

describe('start.sh – Fake RCON', nurMitTar, () => {
  const vdf = (ordner) => csgo(ordner, 'addons', 'metamod', 'fake_rcon.vdf');

  it('legt das MetaMod-Plugin ab und gibt das Passwort als Startparameter mit', () => {
    const ordner = arbeitsordner();
    const lauf = starte(ordner, {
      ...mitPlugins(ordner),
      CS2_PLUGIN_FAKERCON: 'true',
      CS2_FAKERCON_PASSWORD: 'geheim',
    });

    assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
    assert.ok(existsSync(vdf(ordner)));
    assert.equal(nach(lauf.argv, '-fakercon'), 'geheim');
  });

  it('lässt ein zu kurzes Passwort weg und sagt es', () => {
    const ordner = arbeitsordner();
    const lauf = starte(ordner, {
      ...mitPlugins(ordner),
      CS2_PLUGIN_FAKERCON: 'true',
      CS2_FAKERCON_PASSWORD: 'abc',
    });

    assert.equal(nach(lauf.argv, '-fakercon'), null);
    assert.match(lauf.stdout, /weniger als 4 Zeichen/u);
  });

  it('nimmt die .vdf beim Abschalten aus dem MetaMod-Ordner', () => {
    const ordner = arbeitsordner();
    const umgebung = mitPlugins(ordner);
    starte(ordner, { ...umgebung, CS2_PLUGIN_FAKERCON: 'true', CS2_FAKERCON_PASSWORD: 'geheim' });
    const lauf = starte(ordner, umgebung);

    assert.equal(existsSync(vdf(ordner)), false);
    assert.equal(nach(lauf.argv, '-fakercon'), null);
  });
});

describe('start.sh – WeaponPaints und MariaDB', nurMitJq, () => {
  const core = (ordner) => csgo(ordner, 'addons', 'counterstrikesharp', 'configs', 'core.json');
  const wpConfig = (ordner) =>
    csgo(
      ordner,
      'addons',
      'counterstrikesharp',
      'configs',
      'plugins',
      'WeaponPaints',
      'WeaponPaints.json',
    );
  const passwort = (ordner) =>
    readFileSync(join(ordner.daten, '.palantir', 'mariadb-passwort'), 'utf8');

  it('startet MariaDB nur auf 127.0.0.1 und fährt sie nach CS2 wieder herunter', () => {
    const ordner = arbeitsordner();
    const lauf = starte(ordner, { ...mitPlugins(ordner), CS2_PLUGIN_WEAPONPAINTS: 'true' });

    assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
    const argumente = readFileSync(join(ordner.daten, 'mariadbd.args'), 'utf8').split('\n');
    assert.ok(argumente.includes('--bind-address=127.0.0.1'), argumente.join(' '));
    assert.equal(readFileSync(join(ordner.daten, 'mariadbd.ende'), 'utf8').trim(), 'gestoppt');
    // CS2 lief trotzdem – im Hintergrund statt per exec.
    assert.ok(lauf.argv.includes('-dedicated'));
  });

  it('legt Benutzer und Datenbank mit dem erzeugten Passwort an und räumt die Init-Datei weg', () => {
    const ordner = arbeitsordner();
    starte(ordner, { ...mitPlugins(ordner), CS2_PLUGIN_WEAPONPAINTS: 'true' });

    const pw = passwort(ordner);
    assert.match(pw, /^[0-9a-f]{48}$/u);
    const init = readFileSync(join(ordner.daten, 'mariadbd.init'), 'utf8');
    assert.match(init, /CREATE DATABASE IF NOT EXISTS `weaponpaints`/u);
    assert.ok(init.includes(`IDENTIFIED BY '${pw}'`));

    const argumente = readFileSync(join(ordner.daten, 'mariadbd.args'), 'utf8').split('\n');
    const initDatei = argumente
      .find((a) => a.startsWith('--init-file='))
      ?.slice('--init-file='.length);
    assert.equal(existsSync(initDatei), false);
  });

  it('behält das Passwort über Neustarts', () => {
    const ordner = arbeitsordner();
    const umgebung = { ...mitPlugins(ordner), CS2_PLUGIN_WEAPONPAINTS: 'true' };
    starte(ordner, umgebung);
    const erstes = passwort(ordner);
    starte(ordner, umgebung);

    assert.equal(passwort(ordner), erstes);
  });

  it('trägt die Datenbank in die Einstellungen ein und lässt den Rest stehen', () => {
    const ordner = arbeitsordner();
    const umgebung = { ...mitPlugins(ordner), CS2_PLUGIN_WEAPONPAINTS: 'true' };
    starte(ordner, umgebung);
    const datei = wpConfig(ordner);
    writeFileSync(datei, JSON.stringify({ SkinsLanguage: 'de', DatabaseHost: 'falsch' }));

    starte(ordner, umgebung);

    const inhalt = JSON.parse(readFileSync(datei, 'utf8'));
    assert.equal(inhalt.SkinsLanguage, 'de');
    assert.equal(inhalt.DatabaseHost, '127.0.0.1');
    assert.equal(inhalt.DatabasePort, 3306);
    assert.equal(inhalt.DatabaseName, 'weaponpaints');
    assert.equal(inhalt.DatabasePassword, passwort(ordner));
  });

  it('legt die gamedata von WeaponPaints dorthin, wo CounterStrikeSharp sie sucht', () => {
    const ordner = arbeitsordner();
    starte(ordner, { ...mitPlugins(ordner), CS2_PLUGIN_WEAPONPAINTS: 'true' });

    assert.ok(
      existsSync(csgo(ordner, 'addons', 'counterstrikesharp', 'gamedata', 'weaponpaints.json')),
    );
  });

  it('schaltet FollowCS2ServerGuidelines aus – und mit WeaponPaints wieder an', () => {
    const ordner = arbeitsordner();
    const umgebung = mitPlugins(ordner);
    starte(ordner, umgebung);
    writeFileSync(
      core(ordner),
      JSON.stringify({ FollowCS2ServerGuidelines: true, ServerLanguage: 'de' }),
    );

    starte(ordner, { ...umgebung, CS2_PLUGIN_WEAPONPAINTS: 'true' });
    assert.equal(JSON.parse(readFileSync(core(ordner), 'utf8')).FollowCS2ServerGuidelines, false);

    starte(ordner, umgebung);
    const danach = JSON.parse(readFileSync(core(ordner), 'utf8'));
    assert.equal(danach.FollowCS2ServerGuidelines, true);
    assert.equal(danach.ServerLanguage, 'de');
  });

  it('lässt ein von Hand gesetztes false stehen', () => {
    const ordner = arbeitsordner();
    const umgebung = mitPlugins(ordner);
    starte(ordner, umgebung);
    writeFileSync(core(ordner), JSON.stringify({ FollowCS2ServerGuidelines: false }));

    starte(ordner, umgebung);

    assert.equal(JSON.parse(readFileSync(core(ordner), 'utf8')).FollowCS2ServerGuidelines, false);
  });

  it('startet ohne WeaponPaints keine Datenbank', () => {
    const ordner = arbeitsordner();
    starte(ordner, { ...mitPlugins(ordner), CS2_PLUGIN_MATCHZY: 'true' });

    assert.equal(existsSync(join(ordner.daten, 'mariadbd.args')), false);
  });

  it('startet CS2 nicht, wenn MariaDB nicht hochkommt', () => {
    const ordner = arbeitsordner();
    const lauf = starte(ordner, {
      ...mitPlugins(ordner),
      CS2_PLUGIN_WEAPONPAINTS: 'true',
      TEST_DB_STIRBT: '1',
    });

    assert.equal(lauf.status, 69);
    assert.match(lauf.stdout, /MariaDB kommt nicht hoch/u);
    assert.deepEqual(lauf.argv, []);
  });
});
