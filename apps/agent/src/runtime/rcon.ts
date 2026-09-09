/**
 * RCON-Client (Source RCON Protocol, wie Minecraft es spricht) – P2-9.
 *
 * Der bisherige Konsolenweg schreibt einen Befehl in die Standardeingabe des
 * Servers (`palantir-console`, `EXEC_CONSOLE`) und muss die Antwort im Log
 * suchen. RCON gibt sie zurück. Der Anschluss ist bewusst klein gehalten:
 *
 *   - **Kein veröffentlichter Port.** Der Agent erreicht den Container über
 *     das Spielenetz an seiner Adresse (`ContainerRuntime.networkAddress`);
 *     dorthin darf nur die feste Adresse des Agents (`egress-firewall.sh`).
 *   - **Das Passwort verlässt die Node nie.** Das Image erzeugt es bei jedem
 *     Start neu und legt es in den Datenordner; der Agent liest es von dort.
 *   - **Eine Verbindung je Befehl.** Anmelden, Befehl, Antwort, zu. Keine
 *     Sitzung, die offen bleibt und die man vergessen könnte.
 *
 * Paketformat (alles Little-Endian): Länge (ohne dieses Feld), Id, Typ,
 * Nutzlast, zwei Nullbytes. Typen: 3 Anmeldung, 2 Befehl **und** Antwort auf
 * die Anmeldung, 0 Antwort auf einen Befehl. Eine abgelehnte Anmeldung trägt
 * die Id -1. Antworten über 4096 Byte kommen in mehreren Paketen; ein Paket
 * mit voller Nutzlast heißt „es folgt noch eines".
 */

import net from 'node:net';

const TYP_ANMELDUNG = 3;
const TYP_BEFEHL = 2;
const TYP_ANMELDE_ANTWORT = 2;
const TYP_ANTWORT = 0;

/** Größte Nutzlast eines Pakets; ein volles Paket kündigt ein weiteres an. */
const NUTZLAST_MAX = 4096;
/** Länge ohne Nutzlast: Id, Typ, zwei Nullbytes. */
const RAHMEN = 4 + 4 + 2;

const ID_ANMELDUNG = 1;
const ID_BEFEHL = 2;

/** Wie lange nach einem vollen Paket auf das nächste gewartet wird. */
const NACHLAUF_MS = 250;

export type RconErrorCode = 'AUTH_FAILED' | 'TIMEOUT' | 'CONNECTION' | 'PROTOCOL';

export class RconError extends Error {
  constructor(
    message: string,
    readonly code: RconErrorCode,
  ) {
    super(message);
    this.name = 'RconError';
  }
}

export interface RconRequest {
  readonly host: string;
  readonly port: number;
  readonly password: string;
  readonly command: string;
  /** Frist für den ganzen Vorgang – Verbinden, Anmelden, Antwort. */
  readonly timeoutMs: number;
}

/** Funktion, wie {@link rconCommand} sie anbietet – zum Hereinreichen in Tests. */
export type RconClient = (request: RconRequest) => Promise<string>;

/** Ein Paket in Bytes. */
export function rconPacket(id: number, typ: number, nutzlast: string): Buffer {
  const body = Buffer.from(nutzlast, 'utf8');
  const paket = Buffer.alloc(4 + RAHMEN + body.length);
  paket.writeInt32LE(RAHMEN + body.length, 0);
  paket.writeInt32LE(id, 4);
  paket.writeInt32LE(typ, 8);
  body.copy(paket, 12);
  // Die zwei Nullbytes am Ende stehen schon da: `Buffer.alloc` füllt mit 0.
  return paket;
}

interface Paket {
  readonly id: number;
  readonly typ: number;
  readonly nutzlast: string;
  /** Zahl der Bytes der Nutzlast – für die Frage, ob noch ein Paket folgt. */
  readonly nutzlastBytes: number;
}

/**
 * Nimmt vom Anfang des Puffers so viele vollständige Pakete, wie da sind.
 *
 * Gibt die Pakete und den Rest zurück; ein angefangenes Paket bleibt im Rest,
 * bis der nächste Chunk es vervollständigt.
 */
export function rconPaketeLesen(puffer: Buffer): { pakete: Paket[]; rest: Buffer } {
  const pakete: Paket[] = [];
  let rest = puffer;

  for (;;) {
    if (rest.length < 4) {
      break;
    }

    const laenge = rest.readInt32LE(0);

    if (laenge < RAHMEN || laenge > RAHMEN + NUTZLAST_MAX) {
      throw new RconError(`Unerwartete Paketlänge ${String(laenge)}.`, 'PROTOCOL');
    }

    if (rest.length < 4 + laenge) {
      break;
    }

    const nutzlastBytes = laenge - RAHMEN;
    pakete.push({
      id: rest.readInt32LE(4),
      typ: rest.readInt32LE(8),
      nutzlast: rest.subarray(12, 12 + nutzlastBytes).toString('utf8'),
      nutzlastBytes,
    });
    rest = rest.subarray(4 + laenge);
  }

  return { pakete, rest };
}

/**
 * Meldet sich an, schickt einen Befehl und liefert die Antwort des Servers.
 *
 * Scheitert mit {@link RconError}: `AUTH_FAILED`, wenn der Server die Anmeldung
 * ablehnt; `TIMEOUT`, wenn die Frist abläuft; `CONNECTION`, wenn keine
 * Verbindung zustande kommt oder der Server sie vorzeitig schließt;
 * `PROTOCOL`, wenn die Antwort keine RCON-Antwort ist.
 */
export function rconCommand(request: RconRequest): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const socket = net.connect({ host: request.host, port: request.port });
    const antworten: string[] = [];
    let puffer: Buffer = Buffer.alloc(0);
    let phase: 'anmeldung' | 'befehl' | 'fertig' = 'anmeldung';
    let nachlauf: NodeJS.Timeout | undefined;

    const abschliessen = (ergebnis: () => void): void => {
      if (phase === 'fertig') {
        return;
      }

      phase = 'fertig';
      clearTimeout(frist);

      if (nachlauf !== undefined) {
        clearTimeout(nachlauf);
      }

      socket.destroy();
      ergebnis();
    };

    const frist = setTimeout(() => {
      abschliessen(() =>
        reject(
          new RconError(
            `Der Server hat innerhalb von ${String(request.timeoutMs)} ms nicht geantwortet.`,
            'TIMEOUT',
          ),
        ),
      );
    }, request.timeoutMs);

    socket.on('connect', () => {
      socket.write(rconPacket(ID_ANMELDUNG, TYP_ANMELDUNG, request.password));
    });

    socket.on('error', (fehler: Error) => {
      abschliessen(() =>
        reject(new RconError(`Keine Verbindung: ${fehler.message}`, 'CONNECTION')),
      );
    });

    socket.on('close', () => {
      // Manche Server schließen nach der Antwort von sich aus – dann ist sie
      // trotzdem vollständig angekommen.
      if (phase === 'befehl' && antworten.length > 0) {
        abschliessen(() => resolve(antworten.join('')));

        return;
      }

      abschliessen(() =>
        reject(new RconError('Der Server hat die Verbindung geschlossen.', 'CONNECTION')),
      );
    });

    socket.on('data', (chunk: Buffer) => {
      let gelesen: { pakete: Paket[]; rest: Buffer };

      try {
        gelesen = rconPaketeLesen(Buffer.concat([puffer, chunk]));
      } catch (fehler: unknown) {
        abschliessen(() =>
          reject(
            fehler instanceof RconError
              ? fehler
              : new RconError('Unlesbare Antwort des Servers.', 'PROTOCOL'),
          ),
        );

        return;
      }

      puffer = gelesen.rest;

      for (const paket of gelesen.pakete) {
        if (phase === 'anmeldung') {
          // Source schickt vor der Anmelde-Antwort ein leeres Antwortpaket,
          // Minecraft nicht – beides ist erlaubt, gezählt wird nur Typ 2.
          if (paket.typ !== TYP_ANMELDE_ANTWORT) {
            continue;
          }

          if (paket.id === -1) {
            abschliessen(() =>
              reject(new RconError('Der Server hat die Anmeldung abgelehnt.', 'AUTH_FAILED')),
            );

            return;
          }

          phase = 'befehl';
          socket.write(rconPacket(ID_BEFEHL, TYP_BEFEHL, request.command));
          continue;
        }

        if (phase === 'befehl' && paket.typ === TYP_ANTWORT && paket.id === ID_BEFEHL) {
          antworten.push(paket.nutzlast);

          // Ein volles Paket heißt „es folgt noch eines" – dann kurz warten.
          // Ein kürzeres ist das letzte.
          if (paket.nutzlastBytes < NUTZLAST_MAX) {
            abschliessen(() => resolve(antworten.join('')));

            return;
          }

          if (nachlauf !== undefined) {
            clearTimeout(nachlauf);
          }

          nachlauf = setTimeout(() => {
            abschliessen(() => resolve(antworten.join('')));
          }, NACHLAUF_MS);
        }
      }
    });
  });
}
