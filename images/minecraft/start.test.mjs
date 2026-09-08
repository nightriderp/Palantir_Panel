/**
 * Prüfungen für `start.sh` und `console.sh` – ohne Docker und ohne Minecraft.
 *
 * **Was hier geprüft werden kann.** Beide Dateien sind POSIX-Shell-Skripte. Sie
 * lassen sich mit `sh` ausführen, wenn zwei Dinge gestellt werden: ein
 * Datenordner (`PALANTIR_DATA_DIR`) und ein `java` im PATH, das nur seine
 * Argumente ausgibt. Damit sind genau die Entscheidungen prüfbar, die das
 * Skript trifft – EULA-Sperre, verwaltete Schlüssel in `server.properties`,
 * Heap aus dem RAM-Kontingent, temporäres Verzeichnis, Exit-Codes der Konsole.
 *
 * **Was nicht.** Ob Paper mit diesen Schaltern startet, ob die Jar zur JVM passt
 * und ob die Härtung des Agents im Zusammenspiel hält, zeigt erst ein echter
 * Lauf auf der Node. Ein Test, der das nachstellt, sähe nur so aus.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
const CONSOLE_SH = posix(join(HIER, 'console.sh'));

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

describe('start.sh – Heap aus dem RAM-Kontingent', nurMitShell, () => {
  // Kontingent (MiB) → erwarteter Heap (MiB). Rücklage: ein Viertel des
  // Kontingents, mindestens 512, höchstens 2048 MiB.
  const faelle = [
    [1024, 512],
    [2048, 1536],
    [4096, 3072],
    [8192, 6144],
    [16_384, 14_336],
  ];

  for (const [kontingent, heap] of faelle) {
    it(`rechnet ${kontingent} MiB Kontingent auf ${heap} MiB Heap`, () => {
      const ordner = arbeitsordner();
      const lauf = starteSkript(ordner, {
        EULA: 'true',
        PALANTIR_MEMORY_LIMIT_FILE: speichergrenze(ordner, kontingent * 1024 * 1024),
      });

      assert.equal(lauf.status, 0, lauf.stderr);
      assert.equal(lauf.argv[0], `-Xms${heap}M`);
      assert.equal(lauf.argv[1], `-Xmx${heap}M`);
    });
  }

  it('überlässt der JVM die Rechnung, wenn keine Grenze lesbar ist', () => {
    const ordner = arbeitsordner();
    const lauf = starteSkript(ordner, { EULA: 'true' });

    assert.equal(lauf.argv[0], '-XX:MaxRAMPercentage=70');
    assert.ok(!lauf.argv.some((arg) => arg.startsWith('-Xmx')));
  });

  it('wertet "max" (cgroup v2 ohne Grenze) nicht als Zahl', () => {
    const ordner = arbeitsordner();
    const lauf = starteSkript(ordner, {
      EULA: 'true',
      PALANTIR_MEMORY_LIMIT_FILE: speichergrenze(ordner, 'max'),
    });

    assert.equal(lauf.argv[0], '-XX:MaxRAMPercentage=70');
  });

  it('wertet die Ersatzzahl von cgroup v1 nicht als Grenze', () => {
    const ordner = arbeitsordner();
    const lauf = starteSkript(ordner, {
      EULA: 'true',
      PALANTIR_MEMORY_LIMIT_FILE: speichergrenze(ordner, '9223372036854771712'),
    });

    assert.equal(lauf.argv[0], '-XX:MaxRAMPercentage=70');
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

describe('console.sh', nurMitShell, () => {
  const starteKonsole = (ordner, argumente) =>
    spawnSync('sh', [CONSOLE_SH, ...argumente], {
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, PALANTIR_DATA_DIR: posix(ordner.daten) },
    });

  it('lehnt einen leeren Aufruf mit 2 ab', () => {
    const ordner = arbeitsordner();
    const lauf = starteKonsole(ordner, []);

    assert.equal(lauf.status, 2);
    assert.match(lauf.stderr, /Aufruf: palantir-console/u);
  });

  it('meldet mit 1, wenn der Server nicht läuft', () => {
    const ordner = arbeitsordner();
    const lauf = starteKonsole(ordner, ['list']);

    assert.equal(lauf.status, 1);
    assert.match(lauf.stderr, /nicht erreichbar/u);
  });

  it('gibt die ganze Zeile an die Standardeingabe des Servers weiter', () => {
    const ordner = arbeitsordner();
    // Legt das benannte Rohr an; die java-Attrappe endet sofort wieder.
    starteSkript(ordner, { EULA: 'true' });

    const rohr = posix(join(ordner.daten, '.palantir', 'console.in'));
    const gelesen = posix(join(ordner.wurzel, 'gelesen.txt'));

    // Ein Leser muss offen sein – im Betrieb ist das die JVM, deren
    // Standardeingabe an diesem Rohr hängt.
    const lauf = spawnSync(
      'sh',
      [
        '-c',
        'test -p "$1" || exit 9; (head -n 1 <"$1" >"$2") & sh "$3" say Hallo Welt; wait',
        '_',
        rohr,
        gelesen,
        CONSOLE_SH,
      ],
      {
        encoding: 'utf8',
        timeout: 30_000,
        env: { ...process.env, PALANTIR_DATA_DIR: posix(ordner.daten) },
      },
    );

    assert.equal(lauf.status, 0, `${lauf.stdout}${lauf.stderr}`);
    assert.equal(readFileSync(join(ordner.wurzel, 'gelesen.txt'), 'utf8').trim(), 'say Hallo Welt');
  });
});
