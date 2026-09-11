/**
 * Prüfungen für `start.sh` des ACC-Images – ohne Docker, ohne Proton und ohne
 * das Spiel.
 *
 * Zwei Dinge entscheiden hier über Erfolg oder stilles Scheitern: Die
 * Konfigurationsdateien müssen **UTF-16 LE mit Marke** sein (UTF-8 liest ACC
 * still falsch und startet mit Vorgaben), und die Portnummern in
 * `configuration.json` müssen die öffentlichen sein – der Server meldet sie dem
 * Lobby-Dienst weiter.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/** Pfad in der Schreibweise, die eine POSIX-Shell versteht (Windows: `C:\…`). */
const posix = (pfad) => pfad.replace(/\\/gu, '/');

const HIER = fileURLToPath(new URL('.', import.meta.url));
const START_SH = posix(join(HIER, 'start.sh'));

/** Die drei Bibliotheken liegen im Container nebeneinander. */
const LIB_ORDNER = (() => {
  const ziel = mkdtempSync(join(tmpdir(), 'palantir-lib-'));
  const basis = join(HIER, '..', '..', 'base');
  copyFileSync(join(basis, 'linux', 'palantir.sh'), join(ziel, 'palantir.sh'));
  copyFileSync(join(basis, 'steam', 'steam.sh'), join(ziel, 'steam.sh'));
  copyFileSync(join(basis, 'proton', 'proton.sh'), join(ziel, 'proton.sh'));

  return posix(ziel);
})();

const SH_VORHANDEN = spawnSync('sh', ['-c', 'exit 0']).error === undefined;
/** Ohne `iconv` gibt es kein UTF-16 – dann sagt der Test nichts. */
const ICONV_DA = SH_VORHANDEN && spawnSync('sh', ['-c', 'command -v iconv']).status === 0;
const nurMitShell = { skip: SH_VORHANDEN ? false : 'Keine POSIX-Shell (sh) im PATH.' };
const nurMitIconv = { skip: ICONV_DA ? false : 'Kein iconv im PATH.' };
/**
 * Kann `tar` hier mit Pfaden umgehen, die einen Laufwerksbuchstaben tragen?
 *
 * Unter Windows nicht: GNU tar haelt das `C:` fuer einen Rechnernamen und
 * versucht, sich dorthin zu verbinden. Im Container - und damit in der CI -
 * gibt es keine Laufwerksbuchstaben, dort laufen diese Pruefungen.
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

function arbeitsordner({ mitServerdateien = true, mitSteamCmd = false, mitToken = false } = {}) {
  const wurzel = mkdtempSync(join(tmpdir(), 'palantir-acc-'));
  aufraeumen.push(wurzel);

  const daten = join(wurzel, 'daten');
  const proton = join(wurzel, 'proton');
  // ACC braucht SteamCMD nicht - `proton_vorbereiten` legt trotzdem eine Kopie
  // an, weil Proton dort seine Steam-Installation sucht.
  const vorlage = join(wurzel, 'steamcmd');
  mkdirSync(daten);
  mkdirSync(proton);
  mkdirSync(vorlage);

  if (mitServerdateien) {
    // Das, was der Betreiber hochlädt – hier nur der Name, um den es geht.
    mkdirSync(join(daten, 'server'), { recursive: true });
    writeFileSync(join(daten, 'server', 'accServer.exe'), 'exe\n');
  }

  writeFileSync(
    join(proton, 'proton'),
    ['#!/bin/sh', 'for a in "$@"; do printf \'proton %s\\n\' "$a"; done', 'exit 0', ''].join('\n'),
  );
  spawnSync('sh', ['-c', 'chmod 0755 "$1"', '_', posix(join(proton, 'proton'))]);

  // Ein SteamCMD, das seine Argumente aufschreibt und die Serverdatei anlegt –
  // so, wie der echte sie nach dem Herunterladen hinterlässt.
  const protokoll = join(wurzel, 'steam-aufrufe.txt');

  if (mitSteamCmd) {
    writeFileSync(
      join(vorlage, 'steamcmd.sh'),
      [
        '#!/bin/sh',
        `printf '%s\\n' "$*" >> "${posix(protokoll)}"`,
        'ziel=""',
        'for a in "$@"; do',
        '  case "$vorher" in +force_install_dir) ziel="$a";; esac',
        '  vorher="$a"',
        'done',
        'mkdir -p "$ziel"',
        'printf \'exe\\n\' > "$ziel/accServer.exe"',
        'exit 0',
        '',
      ].join('\n'),
    );
    spawnSync('sh', ['-c', 'chmod 0755 "$1"', '_', posix(join(vorlage, 'steamcmd.sh'))]);
  }

  // Der Anmelde-Token, so wie SteamCMD ihn auf der Node hinterlässt.
  const konto = join(wurzel, 'steam-konto');

  if (mitToken) {
    mkdirSync(join(konto, 'Steam', 'config'), { recursive: true });
    writeFileSync(join(konto, 'Steam', 'config', 'config.vdf'), 'mein-token\n');
  }

  return { wurzel, daten, proton, vorlage, protokoll, konto };
}

/**
 * Legt ein Archiv an und stellt ein `curl` daneben, das es „herunterlaedt".
 *
 * Geprueft wird der Weg drumherum - Pruefsumme, Auspacken, ein Ordner zu tief -,
 * nicht das Netz. `.tar.gz` und nicht `.zip`, weil `tar` ueberall vorhanden ist;
 * der Zweig fuer ZIP ist derselbe eine Aufruf.
 */
function mitArchiv(ordner, { imUnterordner = false } = {}) {
  const bin = join(ordner.wurzel, 'bin');
  const bau = join(ordner.wurzel, 'bau');
  const inhalt = imUnterordner ? join(bau, 'Assetto Corsa Competizione Dedicated Server') : bau;
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(inhalt, 'cfg'), { recursive: true });
  writeFileSync(join(inhalt, 'accServer.exe'), 'exe\n');
  writeFileSync(join(inhalt, 'cfg', 'entrylist.json'), 'meine Fahrer\n');

  const archiv = join(ordner.wurzel, 'acc.tar.gz');
  spawnSync('sh', ['-c', 'cd "$1" && tar -czf "$2" .', '_', posix(bau), posix(archiv)]);

  const summe = spawnSync('sh', ['-c', 'sha256sum "$1" | cut -d" " -f1', '_', posix(archiv)], {
    encoding: 'utf8',
  }).stdout.trim();

  // Der Ersatz schreibt mit, dass er gerufen wurde - daran haengt die Pruefung,
  // dass ein zweiter Start nichts mehr holt.
  const protokoll = join(ordner.wurzel, 'curl-aufrufe.txt');
  writeFileSync(
    join(bin, 'curl'),
    [
      '#!/bin/sh',
      `printf '%s\\n' "$*" >> "${posix(protokoll)}"`,
      'ziel=""',
      'for a in "$@"; do',
      '  case "$vorher" in --output) ziel="$a";; esac',
      '  vorher="$a"',
      'done',
      `cp "${posix(archiv)}" "$ziel"`,
      '',
    ].join('\n'),
  );
  spawnSync('sh', ['-c', 'chmod 0755 "$1"', '_', posix(join(bin, 'curl'))]);

  return { bin: posix(bin), summe, protokoll };
}

function starte(ordner, extra = {}, bin = null) {
  return spawnSync(
    'sh',
    bin === null
      ? [START_SH]
      : ['-c', 'PATH="$(cd "$1" && pwd):$PATH"; export PATH; exec sh "$2"', '_', bin, START_SH],
    {
      encoding: 'utf8',
      timeout: 60_000,
      env: {
        ...process.env,
        PALANTIR_DATA_DIR: posix(ordner.daten),
        PALANTIR_LIB_DIR: LIB_ORDNER,
        PALANTIR_PROTON_DIR: posix(ordner.proton),
        PALANTIR_STEAMCMD_DIR: posix(ordner.vorlage),
        PALANTIR_STEAM_KONTO_DIR: posix(ordner.konto),
        PALANTIR_PROTON_VERSION: 'GE-Proton-Test',
        ...extra,
      },
    },
  );
}

/** Liest eine der Konfigurationsdateien und rechnet sie aus UTF-16 zurück. */
function konfig(ordner, name) {
  const roh = readFileSync(join(ordner.daten, 'server', 'cfg', name));

  assert.equal(roh[0], 0xff, `${name} beginnt nicht mit der Byte-Reihenfolge-Marke`);
  assert.equal(roh[1], 0xfe, `${name} beginnt nicht mit der Byte-Reihenfolge-Marke`);

  return JSON.parse(roh.subarray(2).toString('utf16le'));
}

describe('start.sh – ohne Serverdateien', nurMitShell, () => {
  it('nennt beide Wege, statt wortlos zu scheitern', () => {
    // Anonym gibt Valve die Anwendung nicht heraus. Es bleiben das Steam-Konto
    // und der Datei-Manager - beide gehoeren in die Meldung.
    const lauf = starte(arbeitsordner({ mitServerdateien: false }));

    assert.equal(lauf.status, 78);
    assert.match(lauf.stdout, /Serverdateien fehlen/u);
    assert.match(lauf.stdout, /Steam-Benutzernamen/u);
    assert.match(lauf.stdout, /Assetto Corsa Competizione Dedicated Server/u);
    assert.match(lauf.stdout, /Datei-Manager/u);
  });
});

describe('start.sh – mit Steam-Konto', nurMitIconv, () => {
  it('holt die Serverdateien selbst, als Windows-Fassung und mit dem Konto', () => {
    // Die Reihenfolge ist die Stolperstelle: `+@sSteamCmdForcePlatformType`
    // muss vor `+login` stehen, sonst laedt SteamCMD wortlos die Linux-Fassung.
    const ordner = arbeitsordner({
      mitServerdateien: false,
      mitSteamCmd: true,
      mitToken: true,
    });

    const lauf = starte(ordner, { STEAM_LOGIN: 'nightrider' });

    assert.equal(lauf.status, 0, lauf.stderr);
    const aufrufe = readFileSync(ordner.protokoll, 'utf8');
    assert.match(aufrufe, /\+@sSteamCmdForcePlatformType windows/u);
    assert.match(aufrufe, /\+login nightrider/u);
    assert.match(aufrufe, /\+app_update 1430110/u);
    assert.ok(!aufrufe.includes('anonymous'));
  });

  it('sagt, was zu tun ist, wenn auf der Node keine Anmeldung liegt', () => {
    // Der haeufigste Fall beim ersten Versuch: Benutzername eingetragen, aber
    // die einmalige Anmeldung auf der Node vergessen.
    const ordner = arbeitsordner({ mitServerdateien: false, mitSteamCmd: true });

    const lauf = starte(ordner, { STEAM_LOGIN: 'nightrider' });

    assert.equal(lauf.status, 78);
    assert.match(lauf.stdout, /keine Anmeldung/u);
    assert.match(lauf.stdout, /palantir-steam-anmelden nightrider/u);
    // Ohne Token wird SteamCMD gar nicht erst gerufen - ein Login, der nach
    // einem Passwort fragt, haenge in einem Container ohne Eingabe fest.
    assert.ok(!existsSync(ordner.protokoll));
  });

  it('rührt SteamCMD nicht an, wenn kein Konto eingetragen ist', () => {
    const ordner = arbeitsordner({ mitSteamCmd: true });

    const lauf = starte(ordner);

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.ok(!existsSync(ordner.protokoll));
  });
});

describe('start.sh – eigenes Archiv (ohne Steam)', nurMitIconv, () => {
  it('holt es, prueft die Pruefsumme und packt es aus', nurMitTar, () => {
    const ordner = arbeitsordner({ mitServerdateien: false });
    const archiv = mitArchiv(ordner);

    const lauf = starte(
      ordner,
      { ACC_ARCHIV_URL: 'https://example.tld/acc.tar.gz', ACC_ARCHIV_SHA256: archiv.summe },
      archiv.bin,
    );

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.ok(existsSync(join(ordner.daten, 'server', 'accServer.exe')));
    // Was im Archiv lag, bleibt liegen - auch die Fahrerliste.
    assert.ok(existsSync(join(ordner.daten, 'server', 'cfg', 'entrylist.json')));
  });

  it('findet sie auch, wenn das Archiv einen Ordner traegt', nurMitTar, () => {
    // Der haeufigste Fehler beim Packen: Wer den Serverordner im Dateiexplorer
    // einpackt, hat seinen Namen mit im Archiv. Gesucht wird, nicht geraten -
    // der Fundort ist dann der Serverordner.
    const ordner = arbeitsordner({ mitServerdateien: false });
    const archiv = mitArchiv(ordner, { imUnterordner: true });

    const lauf = starte(
      ordner,
      { ACC_ARCHIV_URL: 'https://example.tld/acc.tar.gz', ACC_ARCHIV_SHA256: archiv.summe },
      archiv.bin,
    );

    assert.equal(lauf.status, 0, lauf.stderr);
    const exe = join(
      ordner.daten,
      'server',
      'Assetto Corsa Competizione Dedicated Server',
      'accServer.exe',
    );
    assert.ok(existsSync(exe));
    // Und die Konfiguration landet daneben, nicht in der Wurzel.
    assert.ok(existsSync(join(dirname(exe), 'cfg', 'configuration.json')));
  });

  it('holt ohne Pruefsumme gar nichts und sagt, wie man sie bekommt', () => {
    // Was hier ankommt, wird unter Proton ausgefuehrt.
    const ordner = arbeitsordner({ mitServerdateien: false });
    const archiv = mitArchiv(ordner);

    const lauf = starte(ordner, { ACC_ARCHIV_URL: 'https://example.tld/acc.tar.gz' }, archiv.bin);

    assert.equal(lauf.status, 78);
    assert.match(lauf.stdout, /fehlt die Pruefsumme|fehlt die Prüfsumme/u);
    assert.match(lauf.stdout, /sha256sum/u);
    assert.ok(!existsSync(archiv.protokoll));
  });

  it('holt nichts, wenn die Serverdateien schon da sind', () => {
    // Ein Archiv aktualisiert sich nicht von selbst; ein Download bei jedem
    // Start waere hundert Megabyte fuer nichts.
    const ordner = arbeitsordner();
    const archiv = mitArchiv(ordner);

    const lauf = starte(
      ordner,
      { ACC_ARCHIV_URL: 'https://example.tld/acc.tar.gz', ACC_ARCHIV_SHA256: archiv.summe },
      archiv.bin,
    );

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.ok(!existsSync(archiv.protokoll));
  });

  it('verwirft ein Archiv, dessen Pruefsumme nicht passt', () => {
    const ordner = arbeitsordner({ mitServerdateien: false });
    const archiv = mitArchiv(ordner);

    const lauf = starte(
      ordner,
      {
        ACC_ARCHIV_URL: 'https://example.tld/acc.tar.gz',
        ACC_ARCHIV_SHA256: 'a'.repeat(64),
      },
      archiv.bin,
    );

    assert.equal(lauf.status, 78);
    assert.ok(!existsSync(join(ordner.daten, 'server', 'accServer.exe')));
  });
});

describe('start.sh – wo accServer.exe liegt', nurMitIconv, () => {
  it('findet sie im Unterordner, in den SteamCMD sie legt', () => {
    // Beim ersten echten Lauf am 2026-09-11 stand im Log "Success! App
    // '1430110' fully installed" und direkt darunter "Die Serverdateien
    // fehlen": Valve legt den Server in einen Unterordner.
    const ordner = arbeitsordner({ mitServerdateien: false });
    const tief = join(ordner.daten, 'server', 'server');
    mkdirSync(tief, { recursive: true });
    writeFileSync(join(tief, 'accServer.exe'), 'exe\n');

    const lauf = starte(ordner);

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.match(lauf.stdout, /Der Server liegt in server\/server/u);
    // Die Konfiguration gehoert neben die Datei, nicht in die Wurzel.
    assert.ok(existsSync(join(tief, 'cfg', 'configuration.json')));
  });

  it('findet sie auch bei anderer Gross-/Kleinschreibung', () => {
    // Die Datei kommt aus einer Windows-Welt, in der beides erlaubt ist; unter
    // Linux waere `AccServer.exe` sonst eine fehlende Datei.
    const ordner = arbeitsordner({ mitServerdateien: false });
    const tief = join(ordner.daten, 'server', 'server');
    mkdirSync(tief, { recursive: true });
    writeFileSync(join(tief, 'AccServer.exe'), 'exe' + String.fromCharCode(10));

    const lauf = starte(ordner);

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.ok(existsSync(join(tief, 'cfg', 'configuration.json')));
  });

  it('sagt bei leerem Ordner, was dort liegt', () => {
    // Der Blick in den Ordner spart eine Runde: Ein halber Download sieht
    // anders aus als ein Archiv mit fremdem Aufbau.
    const ordner = arbeitsordner({ mitServerdateien: false });
    mkdirSync(join(ordner.daten, 'server'), { recursive: true });
    writeFileSync(join(ordner.daten, 'server', 'irgendwas.txt'), 'da\n');

    const lauf = starte(ordner);

    assert.equal(lauf.status, 78);
    assert.match(lauf.stdout, /Was im Serverordner liegt/u);
    assert.match(lauf.stdout, /irgendwas\.txt/u);
  });
});

describe('start.sh – die Konfigurationsdateien', nurMitIconv, () => {
  it('schreibt sie als UTF-16 LE mit Marke', () => {
    // UTF-8 wird nicht abgelehnt, sondern still falsch gelesen: Der Server
    // startet mit Vorgaben, ohne Passwort und auf anderen Ports.
    const ordner = arbeitsordner();

    const lauf = starte(ordner, { ACC_NAME: 'Nordschleife-Liga' });

    assert.equal(lauf.status, 0, lauf.stderr);
    // `konfig` prüft die Marke selbst und scheitert sonst.
    assert.equal(konfig(ordner, 'settings.json').serverName, 'Nordschleife-Liga');
    assert.equal(konfig(ordner, 'configuration.json').configVersion, 1);
    assert.equal(konfig(ordner, 'event.json').configVersion, 1);
  });

  it('trägt die öffentlichen Portnummern ein, nicht irgendwelche', () => {
    // Der Server meldet sie dem Lobby-Dienst weiter; eine Übersetzung davor
    // zeigte auf einen Port, den es nicht gibt.
    const ordner = arbeitsordner();

    starte(ordner, { ACC_TCP_PORT: '25011', ACC_UDP_PORT: '25010' });

    const inhalt = konfig(ordner, 'configuration.json');
    assert.equal(inhalt.tcpPort, 25_011);
    assert.equal(inhalt.udpPort, 25_010);
  });

  it('lässt Platz für Zuschauer über den Fahrzeugplätzen', () => {
    const ordner = arbeitsordner();

    starte(ordner, { ACC_MAX_CAR_SLOTS: '24' });

    assert.equal(konfig(ordner, 'settings.json').maxCarSlots, 24);
    assert.equal(konfig(ordner, 'configuration.json').maxConnections, 34);
  });

  it('maskiert Anführungszeichen, statt die Datei zu zerreißen', () => {
    const ordner = arbeitsordner();

    starte(ordner, { ACC_NAME: 'Der "grosse" Server' });

    assert.equal(konfig(ordner, 'settings.json').serverName, 'Der "grosse" Server');
  });

  it('legt ein Rennwochenende aus drei Sitzungen an', () => {
    const ordner = arbeitsordner();

    starte(ordner, {
      ACC_TRACK: 'spa',
      ACC_PRACTICE_MINUTES: '10',
      ACC_QUALIFYING_MINUTES: '12',
      ACC_RACE_MINUTES: '45',
    });

    const inhalt = konfig(ordner, 'event.json');
    assert.equal(inhalt.track, 'spa');
    assert.deepEqual(
      inhalt.sessions.map((sitzung) => [sitzung.sessionType, sitzung.sessionDurationMinutes]),
      [
        ['P', 10],
        ['Q', 12],
        ['R', 45],
      ],
    );
  });

  it('fasst die Dateien des Betreibers nicht an', () => {
    // Fahrerliste, Rennregeln und erlaubte Hilfen gehören ihm; ein Startskript,
    // das sie überschriebe, räumte eine Liga-Einstellung jedes Mal weg.
    const ordner = arbeitsordner();
    const cfg = join(ordner.daten, 'server', 'cfg');
    mkdirSync(cfg, { recursive: true });
    writeFileSync(join(cfg, 'entrylist.json'), 'meine Fahrer\n');
    writeFileSync(join(cfg, 'eventRules.json'), 'meine Regeln\n');

    starte(ordner);

    assert.equal(readFileSync(join(cfg, 'entrylist.json'), 'utf8'), 'meine Fahrer\n');
    assert.equal(readFileSync(join(cfg, 'eventRules.json'), 'utf8'), 'meine Regeln\n');
  });
});

describe('start.sh – Start unter Proton', nurMitIconv, () => {
  it('ruft accServer.exe über „proton run" auf', () => {
    const ordner = arbeitsordner();

    const lauf = starte(ordner);

    const argv = (lauf.stdout ?? '')
      .split('\n')
      .map((zeile) => zeile.replace(/\r$/u, ''))
      .filter((zeile) => zeile.startsWith('proton '))
      .map((zeile) => zeile.slice(7));

    assert.deepEqual(argv, ['run', `${posix(ordner.daten)}/server/accServer.exe`]);
  });
});
