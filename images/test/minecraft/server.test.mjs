/**
 * Tests des Test-Spielservers (Maßnahme W2-25, Fundpunkte infra-images-05,
 * -07, -20).
 *
 * **Warum gegen den echten Prozess.** Der geprüfte Punkt ist gerade, dass ein
 * kaputter Client den *Prozess* nicht mitnimmt. Ein Test gegen eine importierte
 * Funktion könnte das nicht zeigen: `server.mjs` startet beim Import sofort
 * seine Listener. Jeder Test startet deshalb `node server.mjs` als eigenen
 * Prozess auf freien Ports, redet über TCP mit ihm und prüft anschließend mit
 * einer **zweiten** Verbindung, dass er noch antwortet.
 *
 * Läuft ohne Docker – die beiden Dateien des Images sind reine Node-Programme.
 */

import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HIER, 'server.mjs');
const KONSOLE = path.join(HIER, 'console.mjs');

/** Leerlauf-Frist der Testläufe: kurz genug, dass der Test nicht wartet. */
const LEERLAUF_SEKUNDEN = 0.4;

// ---------------------------------------------------------------------------
// Hilfsmittel
// ---------------------------------------------------------------------------

/** Ein freier Port vom Betriebssystem (Port 0 binden und wieder freigeben). */
function freierPort() {
  return new Promise((fertig, fehler) => {
    const lauscher = net.createServer();
    lauscher.on('error', fehler);
    lauscher.listen(0, '127.0.0.1', () => {
      const { port } = lauscher.address();
      lauscher.close(() => fertig(port));
    });
  });
}

/** VarInt-Kodierung – dasselbe Format, das der Server liest. */
function varInt(wert) {
  const bytes = [];
  let rest = wert;

  do {
    let byte = rest & 0x7f;
    rest >>>= 7;
    if (rest !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (rest !== 0);

  return Buffer.from(bytes);
}

/** Paket = Länge + Inhalt, beides VarInt-längenpräfixiert. */
function paket(id, ...teile) {
  const inhalt = Buffer.concat([varInt(id), ...teile]);

  return Buffer.concat([varInt(inhalt.length), inhalt]);
}

function mcString(text) {
  const roh = Buffer.from(text, 'utf8');

  return Buffer.concat([varInt(roh.length), roh]);
}

/** Handshake (Paket 0x00) mit gewünschtem Folgezustand: 1 = Status, 2 = Login. */
function handshake(host, port, naechster) {
  return paket(
    0x00,
    varInt(767),
    mcString(host),
    Buffer.from([(port >> 8) & 0xff, port & 0xff]),
    varInt(naechster),
  );
}

/**
 * Startet den Server als eigenen Prozess und wartet auf die Bereitmeldung.
 * Liefert Ports, gesammelte Ausgabe und ein `beenden`.
 */
async function starteServer(zusatzUmgebung = {}) {
  const port = await freierPort();
  const controlPort = await freierPort();
  const datenordner = await mkdtemp(path.join(tmpdir(), 'palantir-test-mc-'));

  const prozess = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PALANTIR_DATA_DIR: datenordner,
      SERVER_PORT: String(port),
      CONTROL_PORT: String(controlPort),
      IDLE_TIMEOUT_SECONDS: String(LEERLAUF_SEKUNDEN),
      ...zusatzUmgebung,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let ausgabe = '';
  prozess.stdout.setEncoding('utf8');
  prozess.stderr.setEncoding('utf8');
  prozess.stdout.on('data', (teil) => {
    ausgabe += teil;
  });
  prozess.stderr.on('data', (teil) => {
    ausgabe += teil;
  });

  let beendetMit = null;
  prozess.on('exit', (code, signal) => {
    beendetMit = { code, signal };
  });

  await new Promise((fertig, fehler) => {
    const frist = setTimeout(() => fehler(new Error(`Server startet nicht: ${ausgabe}`)), 10_000);
    const pruefe = () => {
      if (ausgabe.includes('bereit.')) {
        clearTimeout(frist);
        fertig();

        return;
      }
      if (beendetMit !== null) {
        clearTimeout(frist);
        fehler(new Error(`Server endete beim Start: ${ausgabe}`));

        return;
      }
      setTimeout(pruefe, 20);
    };
    pruefe();
  });

  return {
    port,
    controlPort,
    datenordner,
    get ausgabe() {
      return ausgabe;
    },
    /**
     * Wartet, bis eine Zeile auf das Muster passt – statt sofort zu prüfen.
     *
     * Der Server schreibt sein Protokoll erst, nachdem er geantwortet hat, und
     * die Zeile muss danach noch durch die Pipe zum Elternprozess. Wer direkt
     * nach der Antwort auf `ausgabe` sieht, gewinnt dieses Rennen mal und
     * verliert es mal; auf einem ausgelasteten CI-Läufer eher öfter. Genau so
     * ist der Server-List-Ping-Test umgefallen (Fundpunkt 147, zweiter Fall).
     *
     * Die Frist ist eine Notbremse, keine Wartezeit: Passt das Muster, kehrt
     * die Funktion sofort zurück.
     */
    async warteAufAusgabe(muster, frist = 5_000) {
      const ende = Date.now() + frist;

      while (!muster.test(ausgabe)) {
        if (Date.now() > ende) {
          throw new Error(`Muster ${String(muster)} blieb aus. Ausgabe:\n${ausgabe}`);
        }

        await new Promise((fertig) => setTimeout(fertig, 20));
      }
    },
    get lebt() {
      return beendetMit === null;
    },
    get beendetMit() {
      return beendetMit;
    },
    async beenden() {
      if (beendetMit === null) {
        prozess.kill('SIGKILL');
        await new Promise((fertig) => prozess.once('exit', fertig));
      }
      await rm(datenordner, { recursive: true, force: true });
    },
  };
}

/**
 * Öffnet eine Verbindung, sendet `bytes` und wartet, bis der Server sie
 * schließt. Liefert die empfangenen Bytes und die Wartezeit.
 */
function sendeUndWarteAufSchluss(port, bytes, fristMs = 5_000) {
  return new Promise((fertig, fehler) => {
    const begonnen = Date.now();
    let empfangen = Buffer.alloc(0);

    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      if (bytes !== null) socket.write(bytes);
    });

    const frist = setTimeout(() => {
      socket.destroy();
      fehler(new Error('Der Server hat die Verbindung nicht geschlossen.'));
    }, fristMs);

    socket.on('data', (teil) => {
      empfangen = Buffer.concat([empfangen, teil]);
    });
    // Ein `destroy()` der Gegenseite kommt als ECONNRESET an – das ist hier
    // der Erfolgsfall, kein Fehler.
    socket.on('error', () => undefined);
    socket.on('close', () => {
      clearTimeout(frist);
      fertig({ empfangen, dauerMs: Date.now() - begonnen });
    });
  });
}

/** Führt einen vollständigen Server-List-Ping aus und liefert das Status-JSON. */
function fragStatusAb(port) {
  return new Promise((fertig, fehler) => {
    let puffer = Buffer.alloc(0);

    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.write(Buffer.concat([handshake('palantir.example', port, 1), paket(0x00)]));
    });

    const frist = setTimeout(() => {
      socket.destroy();
      fehler(new Error('Keine Statusantwort.'));
    }, 5_000);

    socket.on('error', fehler);
    socket.on('data', (teil) => {
      puffer = Buffer.concat([puffer, teil]);

      // Länge (VarInt) + Paket-Kennung (0x00) + Textlänge (VarInt) + Text.
      const laenge = leseVarInt(puffer, 0);
      if (laenge === null || puffer.length < laenge.laenge + laenge.wert) return;

      const id = leseVarInt(puffer, laenge.laenge);
      const text = leseVarInt(puffer, laenge.laenge + id.laenge);
      const start = laenge.laenge + id.laenge + text.laenge;

      clearTimeout(frist);
      socket.destroy();
      fertig(JSON.parse(puffer.subarray(start, start + text.wert).toString('utf8')));
    });
  });
}

function leseVarInt(puffer, offset) {
  let ergebnis = 0;
  let stellen = 0;

  for (let i = 0; i < 5; i += 1) {
    if (offset + i >= puffer.length) return null;

    const byte = puffer[offset + i];
    ergebnis |= (byte & 0x7f) << stellen;
    if ((byte & 0x80) === 0) return { wert: ergebnis, laenge: i + 1 };
    stellen += 7;
  }

  return null;
}

/** Ruft `console.mjs` auf und liefert Exit-Code samt Ausgabe. */
function rufeKonsole(controlPort, ...argumente) {
  return new Promise((fertig, fehler) => {
    const prozess = spawn(process.execPath, [KONSOLE, ...argumente], {
      env: { ...process.env, CONTROL_PORT: String(controlPort) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    prozess.stdout.setEncoding('utf8');
    prozess.stderr.setEncoding('utf8');
    prozess.stdout.on('data', (teil) => {
      stdout += teil;
    });
    prozess.stderr.on('data', (teil) => {
      stderr += teil;
    });

    prozess.on('error', fehler);
    prozess.on('exit', (code) => fertig({ code, stdout, stderr }));
  });
}

// ---------------------------------------------------------------------------
// Spiel-Port
// ---------------------------------------------------------------------------

describe('Spiel-Port: kaputte Clients kosten nur ihre eigene Verbindung', () => {
  let server;

  before(async () => {
    server = await starteServer();
  });

  after(async () => {
    await server.beenden();
  });

  test('Bestehendes Verhalten: Server-List-Ping antwortet', async () => {
    const status = await fragStatusAb(server.port);

    assert.equal(status.players.max, 20);
    assert.equal(status.players.online, 0);
    assert.equal(status.description.text, 'Palantir – Test-Server');
    await server.warteAufAusgabe(/Handshake von .* für "palantir\.example"/u);
  });

  test('Bestehendes Verhalten: Anmeldung wird mit Meldung abgewiesen', async () => {
    const { empfangen } = await sendeUndWarteAufSchluss(
      server.port,
      Buffer.concat([
        handshake('palantir.example', server.port, 2),
        paket(0x00, mcString('Testspieler')),
      ]),
    );

    assert.match(empfangen.toString('utf8'), /Test-Server von Palantir/u);
    assert.equal(server.lebt, true);
  });

  test('Ungültiges VarInt (infra-images-05): Verbindung zu, Prozess lebt weiter', async () => {
    // Sechs Bytes mit gesetztem Fortsetzungsbit – nach fünf Bytes ist es kein
    // VarInt mehr. Früher: `throw` im `data`-Listener, Prozess endete mit 1.
    await sendeUndWarteAufSchluss(server.port, Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]));

    assert.equal(server.lebt, true);
    await server.warteAufAusgabe(/abgewiesen: Paketlänge ist kein VarInt/u);

    // Der eigentliche Nachweis: Die nächste Verbindung wird noch bedient.
    const status = await fragStatusAb(server.port);
    assert.equal(status.players.max, 20);
  });

  test('Angekündigte Paketlänge 2 MiB (infra-images-07): Verbindung zu, Prozess lebt', async () => {
    const zweiMib = 2 * 1024 * 1024;
    await sendeUndWarteAufSchluss(
      server.port,
      Buffer.concat([varInt(zweiMib), Buffer.alloc(64, 0x41)]),
    );

    assert.equal(server.lebt, true);
    await server.warteAufAusgabe(/abgewiesen: angekündigte Paketlänge 2097152 Bytes/u);

    const status = await fragStatusAb(server.port);
    assert.equal(status.players.max, 20);
  });

  test('Bytes ohne vollständiges Paket über dem Deckel: Verbindung zu, Prozess lebt', async () => {
    // Die angekündigte Länge (genau 1 MiB) passiert die Längenprüfung – hier
    // greift also nicht sie, sondern der Deckel für den Empfangspuffer. Zum
    // Abschließen des Pakets fehlen dem Puffer immer die Bytes des
    // Längenpräfixes, er läuft deshalb vorher über. Ohne den Deckel wüchse er
    // so lange, wie der Client streamt – bis zum OOM-Kill.
    const ankuendigung = varInt(1024 * 1024);
    const bytes = Buffer.concat([ankuendigung, Buffer.alloc(1024 * 1024 + 1, 0x41)]);

    await sendeUndWarteAufSchluss(server.port, bytes, 15_000);

    assert.equal(server.lebt, true);
    await server.warteAufAusgabe(/abgewiesen: Empfangspuffer über 1048576 Bytes/u);

    const status = await fragStatusAb(server.port);
    assert.equal(status.players.max, 20);
  });

  test('Negativ angekündigte Paketlänge: Verbindung zu statt hängender Puffer', async () => {
    // Fünf Bytes, deren letztes über `<< 28` das Vorzeichenbit setzt.
    await sendeUndWarteAufSchluss(server.port, Buffer.from([0xff, 0xff, 0xff, 0xff, 0x0f]));

    assert.equal(server.lebt, true);
    await server.warteAufAusgabe(/abgewiesen: angekündigte Paketlänge -\d+ Bytes/u);
  });

  test('Verbindung ohne Daten: nach der Leerlauf-Frist geschlossen', async () => {
    const { dauerMs } = await sendeUndWarteAufSchluss(server.port, null);

    assert.ok(
      dauerMs >= LEERLAUF_SEKUNDEN * 1000 - 100,
      `zu früh geschlossen (${String(dauerMs)} ms)`,
    );
    assert.equal(server.lebt, true);
    await server.warteAufAusgabe(/abgewiesen: Leerlauf über 0\.4 Sekunden/u);
  });
});

// ---------------------------------------------------------------------------
// Konsole
// ---------------------------------------------------------------------------

describe('console.mjs: Exit-Code folgt der Antwort (infra-images-20)', () => {
  let server;

  before(async () => {
    // Ohne Leerlauf-Frist: Die Konsole soll hier allein am Befehl gemessen
    // werden, nicht an einer nebenher laufenden Uhr.
    server = await starteServer({ IDLE_TIMEOUT_SECONDS: '0' });
  });

  after(async () => {
    await server.beenden();
  });

  test('Erfolgsantwort: Exit 0, Text unverändert', async () => {
    const { code, stdout } = await rufeKonsole(server.controlPort, 'players', '3');

    assert.equal(code, 0);
    assert.equal(stdout, 'Gemeldete Spielerzahl steht jetzt auf 3.\n');

    // Die Wirkung ist da: Der Status meldet die neue Spielerzahl.
    const status = await fragStatusAb(server.port);
    assert.equal(status.players.online, 3);
  });

  test('Fehlerantwort auf ungültiges Argument: Exit 1', async () => {
    const { code, stdout } = await rufeKonsole(server.controlPort, 'players', 'abc');

    assert.equal(code, 1);
    assert.equal(stdout, 'Fehler: `players <anzahl>` erwartet eine Zahl.\n');
  });

  test('Fehlerantwort auf leeren MOTD-Text: Exit 1', async () => {
    const { code, stdout } = await rufeKonsole(server.controlPort, 'motd');

    assert.equal(code, 1);
    assert.equal(stdout, 'Fehler: `motd <text>` erwartet einen Text.\n');
  });

  test('Unbekannter Befehl: Exit 1', async () => {
    const { code, stdout } = await rufeKonsole(server.controlPort, 'fliegen');

    assert.equal(code, 1);
    assert.match(stdout, /^Unbekannter Befehl: fliegen\./u);
  });

  test('Geerbte Eigenschaft ist kein Befehl: Exit 1', async () => {
    const { code, stdout } = await rufeKonsole(server.controlPort, 'constructor');

    assert.equal(code, 1);
    assert.match(stdout, /^Unbekannter Befehl: constructor\./u);
  });

  test('help und status bleiben Erfolgsantworten', async () => {
    const hilfe = await rufeKonsole(server.controlPort, 'help');
    assert.equal(hilfe.code, 0);
    assert.match(hilfe.stdout, /^Befehle: help \| players/u);

    const status = await rufeKonsole(server.controlPort, 'status');
    assert.equal(status.code, 0);
    assert.match(status.stdout, /^Port \d+, \d+\/20 Spieler/u);
  });

  test('Ohne Befehl: Exit 2, Hinweis auf stderr', async () => {
    const { code, stderr } = await rufeKonsole(server.controlPort);

    assert.equal(code, 2);
    assert.match(stderr, /Aufruf: palantir-console/u);
  });

  test('Steuerport nicht erreichbar: Exit 1', async () => {
    const zu = await freierPort();
    const { code, stderr } = await rufeKonsole(zu, 'help');

    assert.equal(code, 1);
    assert.match(stderr, /Steuerport nicht erreichbar/u);
  });
});
