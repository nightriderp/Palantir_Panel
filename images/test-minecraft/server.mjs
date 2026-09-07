/**
 * Test-Spielserver mit Minecraft-Protokoll (WORK_STATUS.md, Gefundener Punkt 113).
 *
 * **Was das ist – und was nicht.** Kein Spielserver. Dieses Programm spricht genau so viel
 * Minecraft, wie es braucht, um die Kette des Panels zu prüfen: Portvergabe, Weiterleitung
 * über frp, Subdomain, Abfrage über `gamedig`, Konsole, Live-Logs, Auto-Shutdown und den
 * Datenordner. Ein echter Spielserver kommt später als eigenes Image; die Anforderungen
 * dafür stehen in SPIEL_IMAGES.md.
 *
 * Umgesetzt sind drei Dinge aus dem Protokoll (ab 1.7):
 *
 * 1. **Server-List-Ping** – Handshake, Status-Anfrage, Ping. Das ist, was `gamedig` abfragt
 *    und was der Minecraft-Client in der Serverliste anzeigt.
 * 2. **Login-Abweisung** – wer sich verbindet, bekommt eine erklärende Meldung statt eines
 *    Verbindungsabbruchs. Damit lässt sich der Weg bis zum Client mit einem echten Spiel
 *    prüfen, ohne dass ein Spielserver dahinterstehen muss.
 * 3. **Steuerport** – nimmt die Befehle der Panel-Konsole entgegen (siehe `console.mjs`).
 *    Seine Antwort beginnt mit der Marke `OK ` oder `FEHLER `; daraus leitet
 *    `console.mjs` seinen Exit-Code ab (Fundpunkt infra-images-20).
 *
 * Der im Handshake mitgeschickte **Hostname** landet im Log. Genau daran lässt sich ablesen,
 * ob die Subdomain bis hierher durchgereicht wurde.
 */

import net from 'node:net';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = process.env.PALANTIR_DATA_DIR ?? '/data';
const LOG_FILE = path.join(DATA_DIR, 'logs', 'latest.log');

const config = {
  port: Number(process.env.SERVER_PORT ?? 25565),
  controlPort: Number(process.env.CONTROL_PORT ?? 25575),
  motd: process.env.MOTD ?? 'Palantir – Test-Server',
  maxPlayers: Number(process.env.MAX_PLAYERS ?? 20),
  versionName: process.env.VERSION_NAME ?? 'Palantir Test',
  protocolVersion: Number(process.env.PROTOCOL_VERSION ?? 767),
  // Verzögerter Start: prüft den Übergang `starting -> running` und den
  // Startup-Timeout des Panels, ohne dass ein echter Server hochfahren muss.
  startupDelaySeconds: Number(process.env.STARTUP_DELAY_SECONDS ?? 0),
  // Gemeldete Spielerzahl. Zur Laufzeit über die Konsole änderbar (`players 3`) –
  // damit lässt sich der Auto-Shutdown prüfen, der bei 0 Spielern greift.
  players: Number(process.env.FAKE_PLAYERS ?? 0),
  // Leerlauf-Frist je Verbindung in Sekunden (Fundpunkt infra-images-07).
  // 0 schaltet die Frist ab; Bruchteile sind erlaubt (die Tests setzen sie klein).
  idleTimeoutSeconds: leseNichtNegativeZahl(process.env.IDLE_TIMEOUT_SECONDS, 30),
};

/** Liest eine nicht-negative Zahl aus der Umgebung; sonst den Vorgabewert. */
function leseNichtNegativeZahl(roh, vorgabe) {
  if (roh === undefined || roh === '') return vorgabe;

  const zahl = Number(roh);

  return Number.isFinite(zahl) && zahl >= 0 ? zahl : vorgabe;
}

/** Ausgabe geht nach stdout (Live-Konsole des Panels) und in den Datenordner. */
async function log(zeile) {
  const eintrag = `[${new Date().toISOString()}] ${zeile}`;
  console.log(eintrag);

  try {
    await appendFile(LOG_FILE, `${eintrag}\n`);
  } catch {
    // Ohne Datenordner läuft der Test-Server trotzdem weiter – die Kette, die
    // hier geprüft wird, hängt nicht am Schreiben.
  }
}

// ---------------------------------------------------------------------------
// Protokoll-Bausteine (VarInt, String) – Minecraft ab 1.7
// ---------------------------------------------------------------------------

/**
 * Kennzeichnet einen Protokollverstoß: Die Bytes sind nicht auswertbar, die
 * Verbindung ist verloren.
 *
 * Bis Fundpunkt infra-images-05 warf `readVarInt` an dieser Stelle. Der Wurf
 * lief aus dem `data`-Listener heraus, wurde von `socket.on('error')` **nicht**
 * gefangen und beendete als `uncaughtException` den gesamten Prozess – für das
 * Panel ein Absturz, ausgelöst durch fünf Bytes eines beliebigen Port-Scanners.
 * Ein Rückgabewert statt einer Ausnahme zwingt jeden Aufrufer, den Fall zu
 * behandeln.
 */
const UNGUELTIG = Symbol('ungültig');

/**
 * Liest einen VarInt ab `offset`.
 *
 * - `null`: noch zu wenige Bytes da – später mit mehr Bytes erneut versuchen.
 * - `UNGUELTIG`: länger als fünf Bytes, also kein VarInt mehr.
 * - sonst `{ wert, laenge }`. `wert` ist vorzeichenbehaftet (das fünfte Byte
 *   kann über `<< 28` das Vorzeichenbit setzen); wo nur nicht-negative Werte
 *   sinnvoll sind – Paketlänge, Paket-Kennung, Textlänge –, prüft das die
 *   aufrufende Stelle.
 */
function readVarInt(puffer, offset) {
  let ergebnis = 0;
  let stellen = 0;

  for (let i = 0; i < 5; i += 1) {
    if (offset + i >= puffer.length) return null;

    const byte = puffer[offset + i];
    ergebnis |= (byte & 0x7f) << stellen;

    if ((byte & 0x80) === 0) {
      return { wert: ergebnis, laenge: i + 1 };
    }

    stellen += 7;
  }

  return UNGUELTIG;
}

function writeVarInt(wert) {
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
  const inhalt = Buffer.concat([writeVarInt(id), ...teile]);

  return Buffer.concat([writeVarInt(inhalt.length), inhalt]);
}

function schreibeString(text) {
  const roh = Buffer.from(text, 'utf8');

  return Buffer.concat([writeVarInt(roh.length), roh]);
}

function leseString(puffer, offset) {
  const laenge = readVarInt(puffer, offset);
  // Unauswertbar oder negativ angekündigt: kein Text. Die Aufrufer behandeln
  // `null` bereits als "unbekannt" und laufen weiter.
  if (laenge === null || laenge === UNGUELTIG || laenge.wert < 0) return null;

  const start = offset + laenge.laenge;
  const ende = start + laenge.wert;
  if (ende > puffer.length) return null;

  return {
    wert: puffer.subarray(start, ende).toString('utf8'),
    laenge: laenge.laenge + laenge.wert,
  };
}

// ---------------------------------------------------------------------------
// Spiel-Port: Server-List-Ping und Login-Abweisung
// ---------------------------------------------------------------------------

/**
 * Größte Paketlänge, die angenommen wird – 1 MiB (Fundpunkt infra-images-07).
 *
 * Die Pakete, die dieser Server überhaupt kennt, sind wenige hundert Bytes groß
 * (Handshake mit Hostname, Statusanfrage, Ping, Login-Name). 1 MiB ist also um
 * Größenordnungen mehr als nötig – kein echter Client stößt daran – und
 * gleichzeitig so klein, dass eine angekündigte Länge von 2^28 Bytes den
 * Speicher des Containers (Vorgabe 256 MiB) nicht mehr füllen kann.
 */
const MAX_PAKETLAENGE = 1024 * 1024;

/**
 * Ebenso gedeckelt: was sich an noch nicht verarbeiteten Bytes ansammelt.
 * Ohne diese Grenze wächst der Puffer so lange, wie ein Client Bytes streamt,
 * die nie ein Paket abschließen – bis zum OOM-Kill.
 *
 * **Zweite Verteidigungslinie.** Der Hauptweg ist die Längenprüfung oben: Wer
 * 2^28 Bytes ankündigt, fliegt, bevor auch nur ein Nutzbyte im Puffer liegt.
 * Diese Grenze greift für den Rest – Bytes zu einem angekündigten Paket knapp
 * unterhalb der Höchstlänge, das nie vollständig wird.
 *
 * Beide Grenzen sind bewusst gleich groß. Weil zur Nutzlast noch das
 * Längenpräfix (bis zu fünf Bytes) im Puffer liegt, ist das größte Paket, das
 * tatsächlich durchkommt, ein paar Bytes kleiner als `MAX_PAKETLAENGE` – bei
 * Paketen von wenigen hundert Bytes ohne Belang. Ein größerer Puffer als
 * `MAX_PAKETLAENGE + 5` wäre umgekehrt nie erreichbar und damit toter Code.
 */
const MAX_PUFFER = MAX_PAKETLAENGE;

function statusAntwort() {
  return JSON.stringify({
    version: { name: config.versionName, protocol: config.protocolVersion },
    players: { max: config.maxPlayers, online: config.players, sample: [] },
    description: { text: config.motd },
  });
}

function behandleVerbindung(socket) {
  let puffer = Buffer.alloc(0);
  let zustand = 0; // 0 = Handshake, 1 = Status, 2 = Login

  socket.on('error', () => {
    // Ein abgebrochener Ping ist der Normalfall, kein Fehlerfall.
  });

  /**
   * Beendet **diese** Verbindung – und nur sie. Der Server nimmt die nächste
   * unverändert an; genau das ist der Kern von Fundpunkt infra-images-05.
   */
  const abweisen = (grund) => {
    void log(`Verbindung von ${socket.remoteAddress ?? 'unbekannt'} abgewiesen: ${grund}`);
    socket.destroy();
  };

  // Leerlauf-Frist je Verbindung (Fundpunkt infra-images-07): Wer sich
  // verbindet und nichts sendet, belegt sonst unbegrenzt einen Deskriptor.
  // Die Frist misst Ruhe in beide Richtungen und wird von jedem Byte
  // zurückgesetzt – ein Ping oder eine Anmeldung läuft nie hinein.
  if (config.idleTimeoutSeconds > 0) {
    socket.setTimeout(config.idleTimeoutSeconds * 1000, () => {
      abweisen(`Leerlauf über ${String(config.idleTimeoutSeconds)} Sekunden`);
    });
  }

  /** Arbeitet alle vollständigen Pakete im Puffer ab. */
  const verarbeitePakete = () => {
    for (;;) {
      const laenge = readVarInt(puffer, 0);

      if (laenge === UNGUELTIG) {
        abweisen('Paketlänge ist kein VarInt (länger als fünf Bytes)');

        return;
      }

      // Noch zu wenige Bytes für die Länge – auf das nächste `data` warten.
      if (laenge === null) return;

      if (laenge.wert < 0 || laenge.wert > MAX_PAKETLAENGE) {
        abweisen(`angekündigte Paketlänge ${String(laenge.wert)} Bytes`);

        return;
      }

      // Paket angekündigt, aber noch nicht vollständig da.
      if (puffer.length < laenge.laenge + laenge.wert) return;

      const inhalt = puffer.subarray(laenge.laenge, laenge.laenge + laenge.wert);
      puffer = puffer.subarray(laenge.laenge + laenge.wert);

      const id = readVarInt(inhalt, 0);
      if (id === null || id === UNGUELTIG || id.wert < 0) {
        // Ein Paket ohne verwertbare Kennung (auch: Länge 0) ist protokollwidrig.
        abweisen('Paket ohne verwertbare Kennung');

        return;
      }

      const nutzdaten = inhalt.subarray(id.laenge);

      if (zustand === 0 && id.wert === 0x00) {
        const protokoll = readVarInt(nutzdaten, 0);
        if (protokoll === null || protokoll === UNGUELTIG) {
          abweisen('Handshake ohne lesbare Protokollfassung');

          return;
        }

        const adresse = leseString(nutzdaten, protokoll.laenge);
        const naechster = nutzdaten[nutzdaten.length - 1];

        // Der Hostname aus dem Handshake ist der Beleg dafür, dass die
        // Subdomain bis hierher durchgereicht wurde.
        void log(
          `Handshake von ${socket.remoteAddress ?? 'unbekannt'} für "${adresse?.wert ?? '?'}" ` +
            `(Protokoll ${String(protokoll.wert)}, nächster Zustand ${String(naechster)})`,
        );

        zustand = naechster === 2 ? 2 : 1;
        continue;
      }

      if (zustand === 1 && id.wert === 0x00) {
        socket.write(paket(0x00, schreibeString(statusAntwort())));
        continue;
      }

      if (zustand === 1 && id.wert === 0x01) {
        // Ping: dieselben acht Bytes zurück, daraus errechnet der Client die Laufzeit.
        socket.write(paket(0x01, nutzdaten.subarray(0, 8)));
        continue;
      }

      if (zustand === 2 && id.wert === 0x00) {
        const name = leseString(nutzdaten, 0);
        void log(`Anmeldeversuch von "${name?.wert ?? 'unbekannt'}" – abgewiesen (Test-Server)`);

        socket.write(
          paket(
            0x00,
            schreibeString(
              JSON.stringify({
                text:
                  'Dies ist der Test-Server von Palantir.\n\n' +
                  'Die Verbindung steht – Adresse, Port und Weiterleitung stimmen. ' +
                  'Ein echter Spielserver kommt mit dem eigenen Image.',
              }),
            ),
          ),
        );
        socket.end();

        return;
      }
    }
  };

  socket.on('data', (teil) => {
    puffer = Buffer.concat([puffer, teil]);

    // Deckel für den Empfangspuffer (Fundpunkt infra-images-07): Bytes, die
    // nie ein Paket abschließen, dürfen nicht bis zum OOM-Kill wachsen.
    if (puffer.length > MAX_PUFFER) {
      abweisen(`Empfangspuffer über ${String(MAX_PUFFER)} Bytes`);

      return;
    }

    try {
      verarbeitePakete();
    } catch (fehler) {
      // Sicherheitsnetz (Fundpunkt infra-images-05): Was hier durchkommt, wäre
      // sonst eine `uncaughtException` aus einem `data`-Listener – der Prozess
      // endete mit Exit 1 und das Panel wertete einen Absturz. Ein kaputter
      // Client kostet höchstens seine eigene Verbindung.
      abweisen(fehler instanceof Error ? fehler.message : String(fehler));
    }
  });
}

// ---------------------------------------------------------------------------
// Steuerport: Befehle der Panel-Konsole
// ---------------------------------------------------------------------------

/**
 * Antwort eines Befehls, der abgelehnt wurde.
 *
 * Ein Befehl gibt entweder einen Text (gelungen) oder dieses Ergebnis zurück.
 * Der Steuerport stellt der Antwort daraus die Marke `OK` bzw. `FEHLER` voran;
 * `console.mjs` schneidet sie wieder ab und leitet daraus den Exit-Code ab
 * (Fundpunkt infra-images-20).
 */
function abgelehnt(text) {
  return { fehler: true, text };
}

const BEFEHLE = {
  help: () => 'Befehle: help | players <anzahl> | motd <text> | say <text> | status | stop',
  status: () =>
    `Port ${String(config.port)}, ${String(config.players)}/${String(config.maxPlayers)} Spieler, MOTD "${config.motd}"`,
  players: (rest) => {
    const anzahl = Number.parseInt(rest, 10);
    if (Number.isNaN(anzahl) || anzahl < 0) {
      return abgelehnt('Fehler: `players <anzahl>` erwartet eine Zahl.');
    }

    config.players = anzahl;

    return `Gemeldete Spielerzahl steht jetzt auf ${String(anzahl)}.`;
  },
  motd: (rest) => {
    if (rest.length === 0) return abgelehnt('Fehler: `motd <text>` erwartet einen Text.');

    config.motd = rest;

    return `MOTD steht jetzt auf "${rest}".`;
  },
  say: (rest) => `[Server] ${rest}`,
  stop: () => {
    setTimeout(() => process.exit(0), 50);

    return 'Server wird beendet.';
  },
};

/** Führt eine Konsolenzeile aus und liefert immer `{ fehler, text }`. */
function fuehreBefehlAus(zeile) {
  const [name, ...rest] = zeile.trim().split(/\s+/);

  // `Object.hasOwn` statt eines Zugriffs auf das Objekt: Sonst träfe
  // `constructor` oder `toString` eine geerbte Funktion von `Object.prototype`.
  if (name === undefined || !Object.hasOwn(BEFEHLE, name)) {
    return abgelehnt(`Unbekannter Befehl: ${name ?? ''}. "help" zeigt die Liste.`);
  }

  const ergebnis = BEFEHLE[name](rest.join(' '));

  return typeof ergebnis === 'string' ? { fehler: false, text: ergebnis } : ergebnis;
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function schreibeStartdateien() {
  await mkdir(path.dirname(LOG_FILE), { recursive: true });

  // Eine Datei im Datenordner, damit Datei-Manager, Backup und Weltdaten-Import
  // etwas zu fassen haben.
  await writeFile(
    path.join(DATA_DIR, 'server.properties'),
    [
      '# Vom Test-Server aus den Umgebungsvariablen erzeugt.',
      `server-port=${String(config.port)}`,
      `motd=${config.motd}`,
      `max-players=${String(config.maxPlayers)}`,
      `startup-parameters=${process.env.PALANTIR_STARTUP_PARAMETERS ?? ''}`,
      '',
    ].join('\n'),
  );
}

async function main() {
  await schreibeStartdateien();
  await log(`Test-Server startet. Datenordner ${DATA_DIR}, Benutzer ${String(process.getuid?.())}`);

  if (process.env.PALANTIR_STARTUP_PARAMETERS) {
    await log(`Startparameter: ${process.env.PALANTIR_STARTUP_PARAMETERS}`);
  }

  if (config.startupDelaySeconds > 0) {
    await log(`Verzögerter Start: ${String(config.startupDelaySeconds)} Sekunden.`);
    await new Promise((fertig) => setTimeout(fertig, config.startupDelaySeconds * 1000));
  }

  const spiel = net.createServer(behandleVerbindung);
  spiel.listen(config.port, '0.0.0.0', () => {
    void log(`Spiel-Port offen auf 0.0.0.0:${String(config.port)} – bereit.`);
  });

  // Der Steuerport hört ausschließlich auf dem Loopback: Erreichbar ist er nur
  // über `docker exec`, also über die Konsole des Panels.
  const steuerung = net.createServer((socket) => {
    socket.on('error', () => undefined);

    // Auch hier eine Leerlauf-Frist: Eine Konsolenverbindung, die keinen Befehl
    // schickt, hielte sonst den `docker exec` des Agenten offen.
    if (config.idleTimeoutSeconds > 0) {
      socket.setTimeout(config.idleTimeoutSeconds * 1000, () => socket.destroy());
    }

    socket.once('data', (teil) => {
      const zeile = teil.toString('utf8').trim();
      void log(`Konsole: ${zeile}`);

      let ergebnis;
      try {
        ergebnis = fuehreBefehlAus(zeile);
      } catch (fehler) {
        // Wie am Spiel-Port: kein Befehl darf den Prozess mitnehmen.
        ergebnis = abgelehnt(
          `Fehler beim Ausführen: ${fehler instanceof Error ? fehler.message : String(fehler)}`,
        );
      }

      void log(ergebnis.text);
      // Marke `OK`/`FEHLER` vorweg – `console.mjs` macht daraus den Exit-Code.
      socket.end(`${ergebnis.fehler ? 'FEHLER' : 'OK'} ${ergebnis.text}\n`);
    });
  });
  steuerung.listen(config.controlPort, '127.0.0.1');

  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      // Sauberes Beenden innerhalb von `stopTimeoutSeconds` – sonst käme SIGKILL.
      void log(`${signal} empfangen, fahre herunter.`);
      spiel.close();
      steuerung.close();
      setTimeout(() => process.exit(0), 100);
    });
  }
}

await main();
