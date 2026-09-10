/**
 * Prüfungen für `start.sh` – ohne Docker und ohne Minecraft.
 *
 * **Was hier geprüft werden kann.** Die Datei ist ein POSIX-Shell-Skript. Sie
 * lässt sich mit `sh` ausführen, wenn zwei Dinge gestellt werden: ein
 * Datenordner (`PALANTIR_DATA_DIR`) und ein `java` im PATH, das nur seine
 * Argumente ausgibt. Damit sind genau die Entscheidungen prüfbar, die das
 * Skript trifft – EULA-Sperre, verwaltete Schlüssel in `server.properties`,
 * RCON, Übernahme des Heaps aus der Bibliothek des Basis-Images, temporäres
 * Verzeichnis.
 *
 * `palantir-console` steht seit Fassung 4 nicht mehr hier, sondern in der
 * Wurzel (`images/base/linux`) – und wird dort geprüft.
 *
 * **Was nicht.** Ob Paper mit diesen Schaltern startet, ob die Jar zur JVM passt
 * und ob die Härtung des Agents im Zusammenspiel hält, zeigt erst ein echter
 * Lauf auf der Node. Ein Test, der das nachstellt, sähe nur so aus.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
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

/**
 * Pfad in der Schreibweise, die eine POSIX-Shell versteht.
 *
 * Unter Windows kommen die Pfade als `C:\…` an; Backslashes sind für eine Shell
 * Fluchtzeichen. Unter Linux ändert der Aufruf nichts.
 */
const posix = (pfad) => pfad.replace(/\\/gu, '/');

const HIER = fileURLToPath(new URL('.', import.meta.url));
const START_SH = posix(join(HIER, 'start.sh'));

/**
 * Die Shell-Bibliotheken der Basis-Images. Im Container liegen beide unter
 * `/opt/palantir/lib`: `palantir.sh` aus der Wurzel `base/linux` und `java.sh`
 * aus `base/java`. Im Repository liegen sie in zwei Ordnern, deshalb legt der
 * Test einmal einen Ordner an, der beide enthält, und zeigt mit
 * `PALANTIR_LIB_DIR` dorthin – so bleibt das Skript ohne Image prüfbar.
 */
const LIB_ORDNER = (() => {
  const ziel = mkdtempSync(join(tmpdir(), 'palantir-lib-'));
  copyFileSync(join(HIER, '..', '..', 'base', 'linux', 'palantir.sh'), join(ziel, 'palantir.sh'));
  copyFileSync(join(HIER, '..', '..', 'base', 'java', 'java.sh'), join(ziel, 'java.sh'));

  return posix(ziel);
})();

/**
 * Steht eine POSIX-Shell zur Verfügung?
 *
 * Auf einem Windows-Arbeitsplatz ohne Git-Bash gibt es keine – dann wird
 * übersprungen statt zu scheitern. In der CI (ubuntu-latest) ist `sh` immer da,
 * die Prüfungen laufen dort also in jedem Fall.
 */
const SH_VORHANDEN = spawnSync('sh', ['-c', 'exit 0']).error === undefined;
const nurMitShell = { skip: SH_VORHANDEN ? false : 'Keine POSIX-Shell (sh) im PATH.' };

const aufraeumen = [];

after(() => {
  for (const pfad of aufraeumen) {
    spawnSync('sh', ['-c', 'rm -rf "$1"', '_', posix(pfad)]);
  }
});

/** Legt einen Arbeitsordner mit Datenordner und `java`-Attrappe an. */
function arbeitsordner() {
  const wurzel = mkdtempSync(join(tmpdir(), 'palantir-mc-'));
  aufraeumen.push(wurzel);

  const daten = join(wurzel, 'daten');
  const bin = join(wurzel, 'bin');
  mkdirSync(daten);
  mkdirSync(bin);

  // Die Attrappe gibt jedes Argument auf einer eigenen Zeile aus. Die Zeilen des
  // Skripts selbst tragen ein `[palantir]` davor und werden unten aussortiert.
  const javaAttrappe = join(bin, 'java');
  writeFileSync(
    javaAttrappe,
    ['#!/bin/sh', 'for arg in "$@"; do', '  printf \'%s\\n\' "$arg"', 'done', ''].join('\n'),
  );
  chmodSync(javaAttrappe, 0o755);

  return { wurzel, daten, bin, ohneGrenze: join(wurzel, 'keine-grenze') };
}

/**
 * Führt `start.sh` aus und gibt die Argumentliste zurück, mit der `java`
 * aufgerufen wurde.
 *
 * Der PATH wird **innerhalb** der Shell gesetzt und nicht über die Umgebung des
 * Node-Prozesses: Unter Windows steht dort ein Windows-PATH, und was eine
 * POSIX-Shell daraus macht, ist von der Installation abhängig.
 */
function starteSkript(ordner, env = {}) {
  const ergebnis = spawnSync(
    'sh',
    [
      '-c',
      'PATH="$(cd "$1" && pwd):$PATH"; export PATH; cd "$2" || exit 1; exec sh "$3"',
      '_',
      posix(ordner.bin),
      posix(ordner.daten),
      START_SH,
    ],
    {
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        PALANTIR_DATA_DIR: posix(ordner.daten),
        PALANTIR_PAPER_JAR: '/opt/palantir/paper.jar',
        PALANTIR_LIB_DIR: LIB_ORDNER,
        // Ohne diesen Zeiger läse das Skript die cgroup-Dateien des Rechners,
        // auf dem der Test läuft – das Ergebnis hinge dann an der Maschine.
        PALANTIR_MEMORY_LIMIT_FILE: posix(ordner.ohneGrenze),
        PALANTIR_STARTUP_PARAMETERS: '',
        EULA: '',
        ...env,
      },
    },
  );

  return {
    ...ergebnis,
    argv: (ergebnis.stdout ?? '')
      .split('\n')
      .map((zeile) => zeile.replace(/\r$/u, ''))
      .filter((zeile) => zeile.length > 0 && !zeile.startsWith('[palantir]')),
  };
}

/** Legt eine Datei mit einer RAM-Grenze an, wie sie in der cgroup stünde. */
function speichergrenze(ordner, inhalt) {
  const datei = join(ordner.wurzel, 'memory.max');
  writeFileSync(datei, `${inhalt}\n`);

  return posix(datei);
}

function eigenschaften(ordner) {
  return readFileSync(join(ordner.daten, 'server.properties'), 'utf8');
}

describe('start.sh – EULA von Mojang', nurMitShell, () => {
  it('startet nicht, solange nicht zugestimmt wurde', () => {
    const ordner = arbeitsordner();
    const lauf = starteSkript(ordner);

    // 78 ist EX_CONFIG: „die Konfiguration stimmt nicht" – unterscheidbar von
    // einem Absturz des Servers.
    assert.equal(lauf.status, 78);
    assert.match(lauf.stdout, /EULA von Mojang ist nicht angenommen/u);
    assert.match(lauf.stdout, /aka\.ms\/MinecraftEULA/u);
    // Entscheidend: Die JVM wurde nie gestartet.
    assert.deepEqual(lauf.argv, []);
  });

  it('schreibt ohne Zustimmung auch keine eula.txt', () => {
    const ordner = arbeitsordner();
    starteSkript(ordner);

    assert.throws(() => readFileSync(join(ordner.daten, 'eula.txt'), 'utf8'));
  });

  it('nimmt nur ein ausdrückliches "true" als Zustimmung', () => {
    const ordner = arbeitsordner();

    for (const wert of ['false', '1', 'ja', 'TRUE', '']) {
      assert.equal(starteSkript(ordner, { EULA: wert }).status, 78, `EULA=${wert}`);
    }
  });

  it('schreibt eula.txt erst nach der Zustimmung', () => {
    const ordner = arbeitsordner();
    const lauf = starteSkript(ordner, { EULA: 'true' });

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.match(readFileSync(join(ordner.daten, 'eula.txt'), 'utf8'), /^eula=true$/mu);
  });
});

describe('start.sh – server.properties', nurMitShell, () => {
  it('legt die verwalteten Schlüssel an, wenn es die Datei noch nicht gibt', () => {
    const ordner = arbeitsordner();
    starteSkript(ordner, {
      EULA: 'true',
      MOTD: 'Palantir – Testwelt',
      MAX_PLAYERS: '42',
      GAMEMODE: 'creative',
      DIFFICULTY: 'hard',
      VIEW_DISTANCE: '16',
      WHITELIST: 'true',
    });

    const inhalt = eigenschaften(ordner);

    assert.match(inhalt, /^server-port=25565$/mu);
    assert.match(inhalt, /^motd=Palantir – Testwelt$/mu);
    assert.match(inhalt, /^max-players=42$/mu);
    assert.match(inhalt, /^gamemode=creative$/mu);
    assert.match(inhalt, /^difficulty=hard$/mu);
    assert.match(inhalt, /^view-distance=16$/mu);
    assert.match(inhalt, /^white-list=true$/mu);
    // Ohne enforce-whitelist dürften bereits verbundene Spieler weiterspielen.
    assert.match(inhalt, /^enforce-whitelist=true$/mu);
  });

  it('lässt fremde Schlüssel und Kommentare des Betreibers stehen', () => {
    const ordner = arbeitsordner();
    writeFileSync(
      join(ordner.daten, 'server.properties'),
      [
        '#Minecraft server properties',
        'online-mode=false',
        'level-seed=12345',
        'motd=Alter Text',
        'spawn-protection=0',
        '',
      ].join('\n'),
    );

    starteSkript(ordner, { EULA: 'true', MOTD: 'Neuer Text' });

    const inhalt = eigenschaften(ordner);

    assert.match(inhalt, /^#Minecraft server properties$/mu);
    assert.match(inhalt, /^online-mode=false$/mu);
    assert.match(inhalt, /^level-seed=12345$/mu);
    assert.match(inhalt, /^spawn-protection=0$/mu);
    assert.match(inhalt, /^motd=Neuer Text$/mu);
    assert.doesNotMatch(inhalt, /^motd=Alter Text$/mu);
  });

  it('ersetzt einen doppelt vorhandenen Schlüssel genau einmal', () => {
    const ordner = arbeitsordner();
    writeFileSync(
      join(ordner.daten, 'server.properties'),
      ['max-players=5', 'online-mode=true', 'max-players=9', ''].join('\n'),
    );

    starteSkript(ordner, { EULA: 'true', MAX_PLAYERS: '20' });

    const zeilen = eigenschaften(ordner)
      .split('\n')
      .map((zeile) => zeile.replace(/\r$/u, ''))
      .filter((zeile) => zeile.startsWith('max-players='));

    // Java nähme sonst den letzten Wert – also die alte Dublette.
    assert.deepEqual(zeilen, ['max-players=20']);
  });

  it('macht aus einer mehrzeiligen Serverbeschreibung keine zweite Zeile', () => {
    const ordner = arbeitsordner();
    starteSkript(ordner, { EULA: 'true', MOTD: 'Erste\nZweite' });

    const inhalt = eigenschaften(ordner);

    assert.match(inhalt, /^motd=ErsteZweite$/mu);
    assert.doesNotMatch(inhalt, /^Zweite$/mu);
  });
});

describe('start.sh – RCON (P2-9)', nurMitShell, () => {
  const passwortDatei = (ordner) => join(ordner.daten, '.palantir', 'rcon.password');

  it('schaltet RCON ein und legt das Passwort dort ab, wo die Spiele-Definition es erwartet', () => {
    const ordner = arbeitsordner();
    starteSkript(ordner, { EULA: 'true' });

    const passwort = readFileSync(passwortDatei(ordner), 'utf8').trim();
    const inhalt = eigenschaften(ordner);

    // 24 Zufallsbytes als Hex – lang genug, ohne Zeichen, die in
    // `server.properties` Sonderbedeutung hätten.
    assert.match(passwort, /^[0-9a-f]{48}$/u);
    assert.match(inhalt, /^enable-rcon=true$/mu);
    assert.match(inhalt, /^rcon\.port=25575$/mu);
    assert.match(inhalt, new RegExp(`^rcon\\.password=${passwort}$`, 'mu'));
    // Sonst sähe jeder Op im Spiel jeden Befehl aus dem Panel.
    assert.match(inhalt, /^broadcast-rcon-to-ops=false$/mu);
  });

  it('erzeugt bei jedem Start ein neues Passwort und trägt es nach', () => {
    const ordner = arbeitsordner();
    starteSkript(ordner, { EULA: 'true' });
    const erstes = readFileSync(passwortDatei(ordner), 'utf8').trim();

    starteSkript(ordner, { EULA: 'true' });
    const zweites = readFileSync(passwortDatei(ordner), 'utf8').trim();

    assert.notEqual(zweites, erstes);
    const zeilen = eigenschaften(ordner)
      .split('\n')
      .map((zeile) => zeile.replace(/\r$/u, ''))
      .filter((zeile) => zeile.startsWith('rcon.password='));
    assert.deepEqual(zeilen, [`rcon.password=${zweites}`]);
  });

  it(
    'macht die Passwortdatei nur für den Besitzer lesbar',
    // Unter Windows kennt das Dateisystem diese Rechte nicht; die CI (Linux) prüft es.
    { skip: process.platform === 'win32' ? 'Keine POSIX-Dateirechte unter Windows.' : false },
    () => {
      const ordner = arbeitsordner();
      starteSkript(ordner, { EULA: 'true' });

      assert.equal(statSync(passwortDatei(ordner)).mode & 0o777, 0o600);
    },
  );
});

describe('start.sh – Heap aus dem RAM-Kontingent', nurMitShell, () => {
  /*
   * Die Rechnung selbst – Rücklage, Grenzfälle, cgroup v1 und v2, Fundpunkt
   * 178 – prüft `images/base/java/java.test.mjs`. Hier zählt nur, dass das
   * Skript die Bibliothek einbindet und ihr Ergebnis wirklich an die JVM gibt:
   * Ein Startskript, das die Funktion aufruft und `set --` vergisst, bestünde
   * jeden Test der Bibliothek und liefe trotzdem mit dem JVM-Standard.
   */
  it('gibt den errechneten Heap als erste Schalter an die JVM', () => {
    const ordner = arbeitsordner();
    const lauf = starteSkript(ordner, {
      EULA: 'true',
      PALANTIR_MEMORY_LIMIT_FILE: speichergrenze(ordner, 4096 * 1024 * 1024),
    });

    assert.equal(lauf.status, 0, lauf.stderr);
    // 4096 MiB Kontingent, Rücklage ein Viertel (1024) → 3072 MiB Heap.
    assert.equal(lauf.argv[0], '-Xms3072M');
    assert.equal(lauf.argv[1], '-Xmx3072M');
    // Und das Log nennt die Zahlen, die die Bibliothek gesetzt hat.
    assert.match(
      lauf.stdout,
      /RAM-Kontingent 4096 MiB, davon 3072 MiB Heap \(1024 MiB Rücklage\)/u,
    );
  });

  it('überlässt der JVM die Rechnung, wenn keine Grenze lesbar ist', () => {
    const ordner = arbeitsordner();
    const lauf = starteSkript(ordner, { EULA: 'true' });

    assert.equal(lauf.argv[0], '-XX:MaxRAMPercentage=70');
    assert.ok(!lauf.argv.some((arg) => arg.startsWith('-Xmx')));
    assert.match(lauf.stdout, /die JVM rechnet selbst/u);
  });
});

describe('start.sh – Aufruf der JVM', nurMitShell, () => {
  it('legt das temporäre Verzeichnis in den Datenordner, nicht ins tmpfs', () => {
    /*
     * `/tmp` ist im Container ein noexec-tmpfs; Netty und Jansi entpacken dort
     * ihre nativen Bibliotheken und führen sie aus. Beides muss deshalb in den
     * Datenordner zeigen, der ohne `noexec` eingehängt wird.
     *
     * Geprüft wird, dass der Pfad **im Datenordner liegt** – nicht, dass er
     * nicht mit `/tmp` beginnt. Der Arbeitsordner dieses Tests ist selbst ein
     * temporäres Verzeichnis, und auf Linux liegt das unter `/tmp`: Die
     * Präfix-Prüfung schlug dort an, obwohl der Pfad richtig war, und ging
     * unter Windows durch, weil das Temp-Verzeichnis dort anders heißt. Ein
     * Test, der je nach Betriebssystem etwas anderes prüft, belegt nichts.
     */
    const ordner = arbeitsordner();
    const lauf = starteSkript(ordner, { EULA: 'true' });
    const tmpSchalter = lauf.argv.find((arg) => arg.startsWith('-Djava.io.tmpdir='));
    const nettySchalter = lauf.argv.find((arg) => arg.startsWith('-Dio.netty.native.workdir='));

    assert.ok(tmpSchalter !== undefined, 'kein -Djava.io.tmpdir gesetzt');
    assert.ok(nettySchalter !== undefined, 'kein -Dio.netty.native.workdir gesetzt');

    const tmpPfad = tmpSchalter.slice('-Djava.io.tmpdir='.length);
    const nettyPfad = nettySchalter.slice('-Dio.netty.native.workdir='.length);
    const datenordner = posix(ordner.daten);

    assert.equal(tmpPfad, `${datenordner}/.palantir/tmp`);
    assert.ok(nettyPfad.startsWith(`${datenordner}/`), nettyPfad);
  });

  it('endet mit der Paper-Jar und --nogui', () => {
    const ordner = arbeitsordner();
    const lauf = starteSkript(ordner, { EULA: 'true' });

    assert.deepEqual(lauf.argv.slice(-3), ['-jar', '/opt/palantir/paper.jar', '--nogui']);
  });

  it('übernimmt die empfohlenen Schalter von PaperMC', () => {
    const ordner = arbeitsordner();
    const lauf = starteSkript(ordner, { EULA: 'true' });

    for (const schalter of ['-XX:+UseG1GC', '-XX:+AlwaysPreTouch', '-XX:+PerfDisableSharedMem']) {
      assert.ok(lauf.argv.includes(schalter), `${schalter} fehlt`);
    }
  });

  it('setzt die Startparameter des Betreibers vor die Jar', () => {
    const ordner = arbeitsordner();
    const lauf = starteSkript(ordner, {
      EULA: 'true',
      PALANTIR_STARTUP_PARAMETERS: '-Dpalantir.test=1 -XX:+UseStringDeduplication',
    });

    assert.ok(lauf.argv.includes('-Dpalantir.test=1'));
    assert.ok(lauf.argv.indexOf('-XX:+UseStringDeduplication') < lauf.argv.indexOf('-jar'));
  });
});
