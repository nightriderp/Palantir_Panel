/**
 * Erreichbarkeits- und Spielerabfrage auf dem Homeserver (Arbeitspaket A3).
 *
 * Pflichtenheft §9 verlangt zweierlei, das dieselbe Sonde liefert:
 *
 *  - `starting → running` erst nach erfolgreichem Health-Check („Query via
 *    `gamedig` bzw. generischer Port-Connect-Test beim Test-Typ") – ein
 *    gestarteter Prozess allein reicht nicht.
 *  - Auto-Shutdown über eine „periodische Spielerabfrage durch den Agent".
 *
 * **Warum hier und nicht nur im Backend:** Das Backend hat für den Start bereits
 * eine eigene Sonde (`server-orchestration/health-check.ts`), die durch den
 * WireGuard-Tunnel auf den Host-Port geht. Die läuft weiter und wird hier nicht
 * ersetzt – der Lifecycle ist Sache von B3. Was das Backend nicht kann, ist die
 * **laufende** Abfrage während des Betriebs: Sie soll häufig passieren, sie
 * geht bei echten Spielen über UDP an den Query-Port, und sie liefert die
 * Spielerzahl, ohne die `decideAutoShutdown()` nur `activityUnknown` melden
 * kann. Auf dem Homeserver ist der Port ohne Umweg erreichbar.
 *
 * **Stand `gamedig`:** Wie im Backend (B3, „Gefundene Punkte" 60) bewusst noch
 * nicht umgesetzt. `gamedig` wäre eine neue Laufzeit-Abhängigkeit, die in
 * Phase 1 kein einziger Spiel-Typ benutzt (CLAUDE.md §1 – Abhängigkeiten werden
 * begründet, nicht auf Vorrat eingebaut). Eine Abfrage mit `kind: 'gamedig'`
 * fällt deshalb sichtbar mit benannter Meldung durch, statt still auf den
 * Port-Connect auszuweichen und eine nie geprüfte Erreichbarkeit vorzutäuschen.
 * Die Sonde ist als Variante eingehängt: Mit dem ersten echten Spiel kommt sie
 * als zweite `ServerProbe` dazu, ohne dass sich hier sonst etwas ändert.
 */

import net from 'node:net';
import type { AgentQuerySpec } from '@palantir/contracts';

export interface ServerProbeTarget {
  /** Adresse auf dem Homeserver – in der Regel `127.0.0.1`. */
  readonly host: string;
  /** Host-Port aus der Portvergabe, nicht der Container-Port. */
  readonly port: number;
  readonly query: AgentQuerySpec;
}

export interface ServerProbeResult {
  readonly reachable: boolean;
  /** Antwortzeit in Millisekunden; `null`, wenn nicht erreichbar. */
  readonly pingMs: number | null;
  /** Spielerzahl; `null`, wenn die Abfrageart keine liefert. */
  readonly playersOnline: number | null;
  readonly playersMax: number | null;
  /** Grund des Fehlschlags; `null`, wenn erreichbar. */
  readonly reason: string | null;
}

export interface ServerProbe {
  check(target: ServerProbeTarget, timeoutMs: number): Promise<ServerProbeResult>;
}

/** Erzeugt einen TCP-Socket – injizierbar, damit die Tests ohne offenen Port auskommen. */
export type SocketFactory = () => net.Socket;

export function unreachable(reason: string): ServerProbeResult {
  return { reachable: false, pingMs: null, playersOnline: null, playersMax: null, reason };
}

/**
 * Generischer Port-Connect-Test.
 *
 * Geprüft wird ausschließlich, ob sich eine TCP-Verbindung aufbauen lässt – das
 * ist der Nachweis, dass der Prozess im Container tatsächlich lauscht und nicht
 * nur läuft. Es werden bewusst **keine Daten gesendet**: Ein Spieleprotokoll
 * verträgt keinen Fremdverkehr, und ein halbes Handshake könnte im Serverlog
 * als Fehler auftauchen.
 *
 * Eine Spielerzahl fällt dabei nicht ab; das Ergebnis meldet sie ehrlich als
 * `null`, statt `0` zu behaupten. Der Unterschied ist für den Auto-Shutdown
 * wesentlich – `0` hieße „nachweislich leer", `null` heißt „unbekannt", und nur
 * das eine schaltet ab.
 */
export function createPortConnectProbe(
  createSocket: SocketFactory = () => new net.Socket(),
  now: () => number = Date.now,
): ServerProbe {
  return {
    check(target: ServerProbeTarget, timeoutMs: number): Promise<ServerProbeResult> {
      return new Promise<ServerProbeResult>((resolve) => {
        const begonnen = now();
        const socket = createSocket();
        let erledigt = false;

        const abschliessen = (ergebnis: ServerProbeResult): void => {
          if (erledigt) {
            return;
          }
          erledigt = true;
          socket.destroy();
          resolve(ergebnis);
        };

        socket.setTimeout(timeoutMs);

        socket.once('connect', () => {
          abschliessen({
            reachable: true,
            pingMs: now() - begonnen,
            playersOnline: null,
            playersMax: null,
            reason: null,
          });
        });

        socket.once('timeout', () => {
          abschliessen(
            unreachable('Der Server hat innerhalb der Frist keine Verbindung angenommen.'),
          );
        });

        socket.once('error', (fehler: Error) => {
          abschliessen(unreachable(`Der Server war nicht erreichbar (${fehler.message}).`));
        });

        socket.connect({ host: target.host, port: target.port });
      });
    },
  };
}

/**
 * Sonde, die nach der Abfrageart auswählt.
 *
 * `gamedig` fehlt bewusst (siehe Kopfkommentar) und meldet einen benannten
 * Fehlschlag, statt still auf den Port-Connect auszuweichen.
 */
export function createServerProbe(
  portConnect: ServerProbe = createPortConnectProbe(),
  gamedig?: ServerProbe,
): ServerProbe {
  return {
    check(target: ServerProbeTarget, timeoutMs: number): Promise<ServerProbeResult> {
      if (target.query.kind === 'portConnect') {
        return portConnect.check(target, timeoutMs);
      }

      if (gamedig !== undefined) {
        return gamedig.check(target, timeoutMs);
      }

      return Promise.resolve(
        unreachable(
          `Die Abfrage über gamedig (Protokoll "${target.query.protocol}") ist in dieser Ausbaustufe noch nicht umgesetzt.`,
        ),
      );
    },
  };
}
