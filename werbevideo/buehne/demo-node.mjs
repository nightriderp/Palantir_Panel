/**
 * Demo-Node für die Videoaufnahme.
 *
 * Sie spricht das **echte** Agent-Protokoll aus `packages/contracts`
 * (`hello` → `welcome` → `stateReport`, `command`/`commandResult`, `event`) über
 * dieselbe WebSocket-Route wie ein Agent auf einem Homeserver – und sie lauscht
 * auf den Spielports, damit der Health-Check des Backends eine **echte**
 * Minecraft-Abfrage beantwortet bekommt und der Server dadurch auf `running`
 * geht. Nichts davon wird im Panel vorgetäuscht: Jeder Zustand, jede
 * Konsolenzeile und jede Spielerzahl im Video ist auf diesem Weg entstanden.
 *
 * Was sie **nicht** ist: ein Ersatz für den Agent. Es entsteht kein Container,
 * keine Datei, kein Backup – Backups melden ihre Größe, ohne dass ein Archiv
 * existiert. Sie gehört deshalb ausschließlich auf einen Aufnahmerechner mit
 * Wegwerf-Datenbank, nie an eine Installation mit echten Daten.
 *
 * Die Aufnahme steuert sie über eine kleine Steuerschnittstelle (HTTP auf
 * `STEUER_PORT`): So fallen Konsolenzeilen und Spielerzahlen genau dann, wenn
 * der Schnitt sie braucht, statt nach einer eigenen Uhr.
 */

import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';

const BACKEND_WS = process.env.DEMO_BACKEND_WS ?? 'ws://127.0.0.1:4000/agent';
const TOKEN = process.env.AGENT_TOKEN ?? '';
const NODE_ID = process.env.DEMO_NODE_ID ?? null;
const STEUER_PORT = Number(process.env.DEMO_STEUER_PORT ?? 4500);
const PROTOKOLL_VERSION = 1;

if (TOKEN === '') {
  console.error('AGENT_TOKEN fehlt – ohne Token nimmt das Backend keine Verbindung an.');
  process.exit(1);
}

const jetzt = () => new Date().toISOString();

/** Container-Kennung in der Form, die die Engine liefert: 64 Hexzeichen. */
function containerKennung(saat) {
  return createHash('sha256').update(saat).digest('hex');
}

// ---------------------------------------------------------------------------
// Gedächtnis der Node
// ---------------------------------------------------------------------------

/**
 * Gedächtnis über Neustarts hinweg.
 *
 * Ohne diese Datei meldet eine frisch gestartete Demo-Node einen leeren
 * Ist-Zustand, und der Soll/Ist-Abgleich des Backends schließt daraus zu Recht:
 * Der Container ist weg. Jeder Server stünde dann auf „Fehler – Der Container
 * existiert auf dem Homeserver nicht mehr". Ein echter Agent liest an dieser
 * Stelle die Container-Engine; die Demo-Node liest ihre Ablage.
 */
const ABLAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), '.lauf', 'demo-node.json');

/** @type {Map<string, {containerId: string, status: string, startedAt: string|null, exitCode: number|null, ram: number}>} */
const container = new Map();

function ablageLesen() {
  try {
    const inhalt = JSON.parse(fs.readFileSync(ABLAGE, 'utf8'));
    for (const [id, eintrag] of Object.entries(inhalt.container ?? {})) container.set(id, eintrag);
    for (const [id, eintrag] of Object.entries(inhalt.spieler ?? {})) {
      spieler.set(id, eintrag);
      if (eintrag.host) {
        bespielt.set(eintrag.host, {
          serverId: id,
          motd: eintrag.motd ?? 'Palantir',
          max: 20,
          namen: eintrag.namen ?? [],
          version: 'Paper 1.21.4',
        });
      }
    }
    console.log(`Ablage gelesen: ${container.size} Container.`);
  } catch {
    /* Erster Lauf – es gibt noch nichts zu lesen. */
  }
}

function ablageSchreiben() {
  try {
    fs.mkdirSync(path.dirname(ABLAGE), { recursive: true });
    fs.writeFileSync(
      ABLAGE,
      JSON.stringify(
        {
          container: Object.fromEntries(container),
          spieler: Object.fromEntries(spieler),
        },
        null,
        2,
      ),
    );
  } catch (fehler) {
    console.error('Ablage nicht schreibbar:', fehler.message);
  }
}

/** Welche Server gelten gerade als bespielt – Grundlage der Abfrageantwort. */
const spieler = new Map();

function containerVon(serverId, payload) {
  const vorhanden = container.get(serverId);
  if (vorhanden) return vorhanden;
  const neu = {
    containerId:
      (payload && typeof payload.containerId === 'string' && payload.containerId) ||
      containerKennung(serverId),
    status: 'created',
    startedAt: null,
    exitCode: null,
    ram: 4096,
  };
  container.set(serverId, neu);
  return neu;
}

// ---------------------------------------------------------------------------
// Minecraft-Abfrage (Server List Ping, Protokoll ab 1.7)
// ---------------------------------------------------------------------------

function varInt(wert) {
  const bytes = [];
  let rest = wert;
  do {
    let teil = rest & 0x7f;
    rest >>>= 7;
    if (rest !== 0) teil |= 0x80;
    bytes.push(teil);
  } while (rest !== 0);
  return Buffer.from(bytes);
}

function paket(id, nutzlast) {
  const inhalt = Buffer.concat([varInt(id), nutzlast]);
  return Buffer.concat([varInt(inhalt.length), inhalt]);
}

function zeichenkette(text) {
  const roh = Buffer.from(text, 'utf8');
  return Buffer.concat([varInt(roh.length), roh]);
}

/** Liest einen VarInt und gibt Wert samt Länge zurück. */
function varIntLesen(puffer, versatz) {
  let wert = 0;
  let schritte = 0;
  let gelesen = 0;
  while (true) {
    if (versatz + gelesen >= puffer.length) return null;
    const byte = puffer[versatz + gelesen];
    gelesen += 1;
    wert |= (byte & 0x7f) << schritte;
    if ((byte & 0x80) === 0) break;
    schritte += 7;
    if (schritte > 35) return null;
  }
  return { wert, laenge: gelesen };
}

/**
 * Hostnamen, die gerade bespielt werden.
 *
 * Der Handshake der Serverliste-Abfrage nennt die Adresse, unter der gefragt
 * wird – genau darüber unterscheidet der Hostname-Router im Betrieb die Server
 * am gemeinsamen Port. Die Demo-Node macht es ebenso: Jeder Server beantwortet
 * die Abfrage mit seiner eigenen MOTD und seinen eigenen Spielern.
 *
 * @type {Map<string, {serverId: string, motd: string, max: number, namen: string[], version: string}>}
 */
const bespielt = new Map();

/**
 * Lauscht auf einem Spielport und beantwortet die Serverliste-Abfrage.
 *
 * `gamedig` im Backend fragt genau so: Handshake (Protokollfassung, Adresse,
 * Port, Absicht „Status"), dann eine leere Status-Anfrage. Die Antwort trägt
 * Version, Spielerzahl und MOTD – dieselben Felder, die das Panel anzeigt.
 */
function spielportOeffnen(port) {
  const server = net.createServer((sitzung) => {
    let puffer = Buffer.alloc(0);
    let adresse = null;

    sitzung.on('error', () => sitzung.destroy());
    sitzung.on('data', (stueck) => {
      puffer = Buffer.concat([puffer, stueck]);

      // So lange vollständige Pakete im Puffer stehen, eines nach dem anderen.
      while (puffer.length > 0) {
        const laenge = varIntLesen(puffer, 0);
        if (laenge === null) return;
        const gesamt = laenge.laenge + laenge.wert;
        if (puffer.length < gesamt) return;

        const inhalt = puffer.subarray(laenge.laenge, gesamt);
        puffer = puffer.subarray(gesamt);

        const kennung = varIntLesen(inhalt, 0);
        if (kennung === null) continue;

        // Handshake (Paket 0 mit Inhalt): die gefragte Adresse herauslesen.
        if (kennung.wert === 0 && inhalt.length > kennung.laenge) {
          let pos = kennung.laenge;
          const protokoll = varIntLesen(inhalt, pos);
          if (protokoll === null) continue;
          pos += protokoll.laenge;
          const namenslaenge = varIntLesen(inhalt, pos);
          if (namenslaenge === null) continue;
          pos += namenslaenge.laenge;
          adresse = inhalt.subarray(pos, pos + namenslaenge.wert).toString('utf8');
          continue;
        }

        // Status-Anfrage (leeres Paket 0): antworten.
        if (kennung.wert === 0) {
          const runde = bespielt.get((adresse ?? '').toLowerCase()) ?? null;
          const antwort = {
            version: { name: runde?.version ?? 'Paper 1.21.4', protocol: 769 },
            players: {
              max: runde?.max ?? 20,
              online: runde?.namen.length ?? 0,
              sample: (runde?.namen ?? []).map((name) => ({ name, id: randomUUID() })),
            },
            description: { text: runde?.motd ?? 'Palantir' },
          };
          try {
            sitzung.write(paket(0x00, zeichenkette(JSON.stringify(antwort))));
          } catch {
            /* Verbindung ist weg – der nächste Versuch zählt. */
          }
          continue;
        }

        // Ping (Paket 1): dieselbe Nutzlast zurück.
        if (kennung.wert === 1) {
          try {
            sitzung.write(paket(0x01, inhalt.subarray(kennung.laenge)));
          } catch {
            /* egal */
          }
        }
      }
    });
  });

  server.on('error', (fehler) => {
    console.error(`Spielport ${port} nicht belegbar: ${fehler.message}`);
  });
  server.listen(port, '0.0.0.0', () => console.log(`Spielport ${port} beantwortet Abfragen.`));
  return server;
}

// ---------------------------------------------------------------------------
// Befehle
// ---------------------------------------------------------------------------

const ok = (data) => ({ success: true, data: data ?? null, error: null });
const fehler = (code, message) => ({ success: false, data: null, error: { code, message } });

function befehlAusfuehren(befehl, serverId, payload) {
  const eintrag = serverId === null ? null : containerVon(serverId, payload);

  switch (befehl) {
    case 'CREATE':
      eintrag.status = 'created';
      return ok({ containerId: eintrag.containerId, name: `palantir-${serverId}`, warnings: [] });

    case 'START':
    case 'RESTART':
      eintrag.status = 'running';
      eintrag.startedAt = jetzt();
      eintrag.exitCode = null;
      starteAusgabe(serverId);
      return ok(null);

    case 'STOP':
      eintrag.status = 'exited';
      eintrag.exitCode = 0;
      eintrag.startedAt = null;
      spieler.delete(serverId);
      return ok(null);

    case 'DELETE':
      container.delete(serverId);
      spieler.delete(serverId);
      return ok(null);

    case 'UPDATE_RESOURCES':
      if (payload && typeof payload.ramMb === 'number') eintrag.ram = payload.ramMb;
      return ok(null);

    case 'GET_STATS':
      return ok(messwerte(eintrag));

    case 'GET_LOGS':
      return ok({
        containerId: eintrag.containerId,
        lines: verlauf(serverId).map((text) => ({
          stream: 'stdout',
          message: text,
          timestamp: jetzt(),
        })),
      });

    case 'EXEC_CONSOLE': {
      /*
       * `command` ist laut Vertrag eine **Liste** von Argumenten, kein String
       * (`ExecConsoleCommandPayload`). Als String gelesen fiel jeder Befehl
       * durch und die Konsole antwortete im Video mit „Unknown or incomplete
       * command" – auf ein schlichtes `list`.
       */
      const eingabe = Array.isArray(payload?.command)
        ? payload.command.join(' ')
        : typeof payload?.command === 'string'
          ? payload.command
          : '';
      return ok({ exitCode: 0, stdout: konsolenAntwort(serverId, eingabe), stderr: '' });
    }

    case 'FILE_LIST':
      return ok({
        containerId: eintrag.containerId,
        path: (payload && payload.path) || '/',
        entries: dateiliste((payload && payload.path) || '/'),
      });

    case 'FILE_READ':
      return ok({
        containerId: eintrag.containerId,
        path: (payload && payload.path) || '/server.properties',
        contentBase64: Buffer.from(dateiInhalt((payload && payload.path) || ''), 'utf8').toString(
          'base64',
        ),
      });

    case 'FILE_WRITE':
    case 'FILE_DELETE':
    case 'SET_SERVER_QUERY':
      return ok(null);

    case 'CREATE_BACKUP': {
      const start = new Date(Date.now() - 9_000).toISOString();
      const groesse = 512 * 1024 * 1024 + Math.floor(Math.random() * 48 * 1024 * 1024);
      return ok({
        backupId: (payload && payload.backupId) || randomUUID(),
        storagePath: `/var/palantir/backups/${serverId}/${Date.now()}.tar.zst`,
        sizeBytes: groesse,
        checksumSha256: createHash('sha256').update(`${serverId}${groesse}`).digest('hex'),
        containerStopped: Boolean(payload && payload.stopContainer),
        startedAt: start,
        completedAt: jetzt(),
      });
    }

    case 'RESTORE_BACKUP':
      return ok({
        backupId: (payload && payload.backupId) || randomUUID(),
        restoredBytes: 512 * 1024 * 1024,
        containerStopped: true,
        startedAt: new Date(Date.now() - 7_000).toISOString(),
        completedAt: jetzt(),
      });

    case 'DELETE_BACKUP':
      return ok(null);

    case 'GET_STORAGE_BREAKDOWN':
      return ok({
        entries: [...container.keys()].map((id) => ({
          serverId: id,
          path: `/var/palantir/daten/${id}`,
          sizeBytes: 3 * 1024 ** 3,
        })),
        totalBytes: container.size * 3 * 1024 ** 3,
        measuredAt: jetzt(),
      });

    default:
      return fehler(
        'AGENT_COMMAND_FAILED',
        `Die Demo-Node beantwortet ${befehl} nicht – dafür braucht es einen echten Agent.`,
      );
  }
}

function messwerte(eintrag) {
  const takt = Date.now() / 1000;
  const last = eintrag.status === 'running' ? 22 + Math.sin(takt / 19) * 9 : 0;
  return {
    containerId: eintrag.containerId,
    cpuPercent: Math.max(0, Math.round(last * 10) / 10),
    memoryUsedBytes: Math.round(
      (eintrag.status === 'running' ? 1.9 + Math.sin(takt / 37) * 0.35 : 0.02) * 1024 ** 3,
    ),
    memoryLimitBytes: eintrag.ram * 1024 ** 2,
    networkRxBytes: Math.round(takt * 1_450),
    networkTxBytes: Math.round(takt * 3_900),
    blockReadBytes: 64 * 1024 ** 2,
    blockWriteBytes: 180 * 1024 ** 2,
    pids: eintrag.status === 'running' ? 48 : 0,
    diskUsedBytes: 3 * 1024 ** 3,
  };
}

// ---------------------------------------------------------------------------
// Konsolenausgabe
// ---------------------------------------------------------------------------

/** Was beim Start eines Paper-Servers Zeile für Zeile erscheint. */
const STARTAUSGABE = [
  'Starting minecraft server version 1.21.4',
  'Loading properties',
  'Default game type: SURVIVAL',
  'Generating keypair',
  'Starting Minecraft server on 0.0.0.0:25565',
  'Using epoll channel type',
  'Preparing level "world"',
  'Preparing start region for dimension minecraft:overworld',
  'Preparing spawn area: 12%',
  'Preparing spawn area: 57%',
  'Preparing spawn area: 91%',
  'Time elapsed: 4128 ms',
  'Done (6.913s)! For help, type "help"',
];

const ausgabeVerlauf = new Map();

function verlauf(serverId) {
  return ausgabeVerlauf.get(serverId) ?? [];
}

function merken(serverId, text) {
  const bisher = ausgabeVerlauf.get(serverId) ?? [];
  bisher.push(text);
  ausgabeVerlauf.set(serverId, bisher.slice(-300));
}

/** Nach dem Start die Startausgabe schicken – im Takt, den die Aufnahme setzt. */
function starteAusgabe(serverId) {
  ausgabeVerlauf.set(serverId, []);
  offeneAusgabe.set(serverId, [...STARTAUSGABE]);
}

/** Zeilen, die noch ausstehen; die Steuerung gibt sie frei. */
const offeneAusgabe = new Map();

function konsolenAntwort(serverId, eingabe) {
  const namen = spieler.get(serverId)?.namen ?? [];
  const befehl = eingabe.trim().replace(/^\//, '');

  if (befehl === 'list') {
    return `There are ${namen.length} of a max of 20 players online: ${namen.join(', ')}`;
  }
  if (befehl.startsWith('say ')) {
    return `[Server] ${befehl.slice(4)}`;
  }
  if (befehl === 'tps') {
    return 'TPS from last 1m, 5m, 15m: 20.0, 20.0, 19.98';
  }
  if (befehl === 'save-all' || befehl === 'save-all flush') {
    return 'Saved the game';
  }
  if (befehl.startsWith('whitelist')) {
    const teile = befehl.split(/\s+/);
    if (teile[1] === 'list')
      return `There are ${namen.length} whitelisted players: ${namen.join(', ')}`;
    if (teile[1] === 'add') return `Added ${teile[2] ?? 'Spieler'} to the whitelist`;
    return 'Whitelist is turned on';
  }
  if (befehl === 'stop') {
    return 'Stopping the server';
  }
  return 'Unknown or incomplete command, see below for error';
}

function dateiliste(pfad) {
  const zeit = jetzt();
  const e = (name, type, sizeBytes) => ({
    name,
    path: `${pfad.replace(/\/$/, '')}/${name}`,
    type,
    sizeBytes,
    modifiedAt: zeit,
    mode: type === 'directory' ? 'drwxr-xr-x' : '-rw-r--r--',
  });
  if (pfad === '/' || pfad === '') {
    return [
      e('world', 'directory', 0),
      e('plugins', 'directory', 0),
      e('logs', 'directory', 0),
      e('server.properties', 'file', 1_284),
      e('ops.json', 'file', 214),
      e('whitelist.json', 'file', 486),
      e('paper.yml', 'file', 3_972),
    ];
  }
  return [e('README.txt', 'file', 128)];
}

function dateiInhalt(pfad) {
  if (pfad.endsWith('server.properties')) {
    return [
      '#Minecraft server properties',
      'motd=Freundeskreis SMP',
      'max-players=20',
      'difficulty=normal',
      'view-distance=10',
      'white-list=true',
      'spawn-protection=0',
    ].join('\n');
  }
  return 'Demo-Bühne: Diese Datei liegt auf keiner Platte.\n';
}

// ---------------------------------------------------------------------------
// Verbindung zum Backend
// ---------------------------------------------------------------------------

let steckplatz = null;

/**
 * Hat das Backend den Handshake bestätigt?
 *
 * Ohne diese Schranke schickte die Node ihre Messwerte auch dann weiter, wenn
 * die Begrüßung nie ankam: Die Verbindung stand, das Backend verwarf jedes
 * Frame („Agent-Frame vor dem Handshake verworfen"), und im Panel blieb die
 * Node auf dem Stand von vorhin – Konsole leer, Messwerte eingefroren. Im
 * Video fällt das erst auf, wenn der Clip fertig ist.
 */
let begruesst = false;

function senden(frame) {
  if (steckplatz && steckplatz.readyState === 1) {
    steckplatz.send(JSON.stringify(frame));
  }
}

function zustandsbericht(grund) {
  senden({
    kind: 'stateReport',
    reason: grund,
    containers: [...container.entries()].map(([serverId, eintrag]) => ({
      serverId,
      containerId: eintrag.containerId,
      status: eintrag.status,
      exitCode: eintrag.exitCode,
      startedAt: eintrag.startedAt,
      observedAt: jetzt(),
    })),
    nodeStats: {
      cpuCores: 8,
      cpuLoad1m: 0.9,
      ramTotalMb: 28_672,
      ramAvailableMb: 28_672 - container.size * 4_096,
      diskTotalMb: 2_048_000,
      diskAvailableMb: 1_612_000,
      observedAt: jetzt(),
    },
    reportedAt: jetzt(),
  });
}

function ereignis(event, serverId, payload) {
  senden({ kind: 'event', event, serverId, payload, emittedAt: jetzt() });
}

/** Offener Wiederverbindungs-Versuch, damit nicht mehrere nebeneinander laufen. */
let neuerVersuch = null;

function spaeterVerbinden() {
  if (neuerVersuch !== null) return;
  neuerVersuch = setTimeout(() => {
    neuerVersuch = null;
    verbinden();
  }, 2_000);
}

/**
 * Verbindung zum Backend aufbauen.
 *
 * Jeder Rückruf prüft zuerst, ob er noch zur **aktuellen** Verbindung gehört.
 * Ohne diese Prüfung kam es beim Neuaufbau zu einem stillen Fehlschlag: Fällt
 * das Backend weg, können sich zwei Steckplätze überlappen. Der `hello`-Rahmen
 * des älteren ging dann über `senden()` an den neueren, der noch gar nicht
 * offen war – und verschwand. Das Backend wartete auf eine Begrüßung, die nie
 * kam, verwarf alles Weitere („Agent-Frame vor dem Handshake verworfen"), und
 * im Panel stand die Node als nicht verbunden: keine Konsole, eingefrorene
 * Messwerte. Im Video sieht man das erst, wenn der Clip fertig ist.
 */
function verbinden() {
  const steck = new WebSocket(BACKEND_WS, { headers: { Authorization: `Bearer ${TOKEN}` } });
  steckplatz = steck;
  begruesst = false;

  /** Gehört dieser Rückruf noch zur aktuellen Verbindung? */
  const aktuell = () => steckplatz === steck;

  steck.onopen = () => {
    if (!aktuell()) {
      try {
        steck.close();
      } catch {
        /* schon zu */
      }
      return;
    }

    // Ausdrücklich über **diesen** Steckplatz, nicht über `senden()`.
    steck.send(
      JSON.stringify({
        kind: 'hello',
        protocolVersion: PROTOKOLL_VERSION,
        agentVersion: '0.0.0-demo-buehne',
        ...(NODE_ID === null ? {} : { nodeId: NODE_ID }),
        sentAt: jetzt(),
      }),
    );

    // Kommt keine Begrüßung, ist die Verbindung wertlos – dann lieber neu
    // aufbauen, als stumm daran hängen zu bleiben.
    setTimeout(() => {
      if (!begruesst && aktuell()) {
        console.error('Keine Begrüßung vom Backend – Verbindung wird neu aufgebaut.');
        try {
          steck.close();
        } catch {
          /* schon zu */
        }
      }
    }, 5_000);
  };

  steck.onmessage = (nachricht) => {
    if (!aktuell()) return;

    let frame;
    try {
      frame = JSON.parse(String(nachricht.data));
    } catch {
      return;
    }

    if (frame.kind === 'welcome') {
      begruesst = true;
      console.log('Demo-Node verbunden.');
      zustandsbericht('connected');
      return;
    }

    if (frame.kind === 'stateRequest') {
      zustandsbericht('requested');
      return;
    }

    if (frame.kind === 'command') {
      const ergebnis = befehlAusfuehren(frame.command, frame.serverId, frame.payload);
      ablageSchreiben();
      senden({
        kind: 'commandResult',
        correlationId: frame.correlationId,
        command: frame.command,
        result: ergebnis,
        duplicate: false,
        completedAt: jetzt(),
      });
      if (frame.command === 'START' || frame.command === 'RESTART') {
        ereignis('STATUS_CHANGED', frame.serverId, {
          containerId: containerVon(frame.serverId).containerId,
          status: 'running',
        });
      }
      if (frame.command === 'STOP') {
        ereignis('STATUS_CHANGED', frame.serverId, {
          containerId: containerVon(frame.serverId).containerId,
          status: 'exited',
        });
      }
    }
  };

  steck.onclose = () => {
    if (!aktuell()) return;
    begruesst = false;
    console.log('Verbindung getrennt – neuer Versuch in 2 s.');
    spaeterVerbinden();
  };

  steck.onerror = () => {
    /* onclose räumt auf. */
  };
}

// Messwerte und Abfrageergebnisse im festen Takt – das hält die Ringe und die
// Spielerzahl im Panel lebendig, auch wenn die Aufnahme gerade nichts steuert.
setInterval(() => {
  if (!begruesst) return;
  for (const [serverId, eintrag] of container) {
    if (eintrag.status !== 'running') continue;
    ereignis('STATS_UPDATE', serverId, messwerte(eintrag));
    const runde = spieler.get(serverId);
    if (runde) {
      ereignis('STATS_UPDATE', serverId, {
        source: 'serverQuery',
        containerId: eintrag.containerId,
        reachable: true,
        playersOnline: runde.namen.length,
        playersMax: 20,
        players: runde.namen.map((name) => ({ name })),
        pingMs: 12 + Math.round(Math.random() * 6),
        reason: null,
        at: jetzt(),
      });
    }
  }
}, 4_000);

// ---------------------------------------------------------------------------
// Steuerschnittstelle für die Aufnahme
// ---------------------------------------------------------------------------

const steuerung = http.createServer((anfrage, antwort) => {
  const adresse = new URL(anfrage.url, 'http://127.0.0.1');
  const fertig = (nutzlast) => {
    antwort.writeHead(200, { 'Content-Type': 'application/json' });
    antwort.end(JSON.stringify(nutzlast ?? { ok: true }));
  };

  // Nächste Zeilen der Startausgabe freigeben (Vorgabe: eine).
  if (adresse.pathname === '/ausgabe') {
    const serverId = adresse.searchParams.get('server');
    const anzahl = Number(adresse.searchParams.get('anzahl') ?? 1);
    const offen = offeneAusgabe.get(serverId) ?? [];
    const gesendet = [];
    for (let i = 0; i < anzahl && offen.length > 0; i += 1) {
      const text = offen.shift();
      const eintrag = containerVon(serverId);
      merken(serverId, text);
      gesendet.push(text);
      ereignis('LOG_LINE', serverId, {
        containerId: eintrag.containerId,
        stream: 'stdout',
        message: `[${new Date().toTimeString().slice(0, 8)} INFO]: ${text}`,
        timestamp: jetzt(),
      });
    }
    offeneAusgabe.set(serverId, offen);
    return fertig({ gesendet, offen: offen.length });
  }

  // Eine beliebige Zeile in die Konsole schieben (Spielerbeitritt, Chat, ...).
  if (adresse.pathname === '/zeile') {
    const serverId = adresse.searchParams.get('server');
    const text = adresse.searchParams.get('text') ?? '';
    const eintrag = containerVon(serverId);
    merken(serverId, text);
    ereignis('LOG_LINE', serverId, {
      containerId: eintrag.containerId,
      stream: 'stdout',
      message: `[${new Date().toTimeString().slice(0, 8)} INFO]: ${text}`,
      timestamp: jetzt(),
    });
    return fertig();
  }

  // Wer gerade auf dem Server ist – bestimmt Abfrageantwort und `list`.
  if (adresse.pathname === '/spieler') {
    const serverId = adresse.searchParams.get('server');
    const namen = (adresse.searchParams.get('namen') ?? '').split(',').filter((n) => n !== '');
    const host = (adresse.searchParams.get('host') ?? '').toLowerCase();
    const motd = adresse.searchParams.get('motd') ?? 'Palantir';
    spieler.set(serverId, { namen, host, motd });
    if (host !== '') {
      bespielt.set(host, { serverId, motd, max: 20, namen, version: 'Paper 1.21.4' });
    }
    ablageSchreiben();
    return fertig({ namen, host });
  }

  if (adresse.pathname === '/zustand') {
    return fertig({
      container: [...container.entries()].map(([id, e]) => ({ id, status: e.status })),
      spieler: [...spieler.entries()].map(([id, s]) => ({ id, namen: s.namen })),
    });
  }

  antwort.writeHead(404).end();
});

// Der Router-Port für Minecraft und die Portspanne der übrigen Spiele.
const PORTS = (process.env.DEMO_SPIELPORTS ?? '25565')
  .split(',')
  .map((p) => Number(p.trim()))
  .filter((p) => Number.isInteger(p) && p > 0);

for (const port of PORTS) {
  spielportOeffnen(port);
}

steuerung.listen(STEUER_PORT, '127.0.0.1', () =>
  console.log(`Steuerung der Demo-Node auf 127.0.0.1:${STEUER_PORT}`),
);

ablageLesen();
verbinden();
