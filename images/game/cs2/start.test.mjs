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
      'printf "%s\\n" "#!/bin/sh" "for arg in \\"\\$@\\"; do printf \'argv %s\\\\n\' \\"\\$arg\\"; done" > "$ziel/game/bin/linuxsteamrt64/cs2"',
      'chmod 0755 "$ziel/game/bin/linuxsteamrt64/cs2"',
      'printf "beispiel\\n" > "$ziel/game/csgo/gamemodes_server.txt.example"',
      'exit 0',
      '',
    ].join('\n'),
  );
  spawnSync('sh', ['-c', 'chmod 0755 "$1"', '_', posix(join(vorlage, 'steamcmd.sh'))]);

  return { wurzel, daten, vorlage };
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
      PALANTIR_STARTUP_PARAMETERS: '',
      ...extra,
    },
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
