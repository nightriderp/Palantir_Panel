/**
 * Health-Check des Servers (Pflichtenheft §9, Lastenheft §3.3).
 *
 * „`starting → running` erfolgt erst nach erfolgreichem Health-Check (Query via
 * `gamedig` bzw. generischer Port-Connect-Test beim Test-Typ) – ein gestarteter
 * Prozess allein reicht nicht."
 *
 * Diese Datei liefert die Sonde. Wer sie aufruft und was aus dem Ergebnis folgt,
 * steht in `service.ts`; der Zustandswechsel selbst passiert ausschließlich über
 * die State Machine.
 *
 * **Stand der Umsetzung:** Der generische Port-Connect-Test ist gebaut – er ist
 * das, was Phase 1 braucht (Lastenheft §3.5: „spielunabhängig, funktionsfähig
 * mit einem einfachen Test-Server-Typ"). Der `gamedig`-Weg ist als
 * Sonden-Variante vorgesehen, aber noch nicht implementiert: `gamedig` wäre
 * eine neue Laufzeit-Abhängigkeit, die in Phase 1 kein einziger Spiel-Typ
 * benutzt (CLAUDE.md §1 – Abhängigkeiten werden benannt und begründet, nicht
 * auf Vorrat eingebaut). Eine Definition mit `query.kind === 'gamedig'` fällt
 * deshalb sichtbar mit einer benannten Meldung durch, statt still den
 * Port-Connect zu nehmen und eine Erreichbarkeit vorzutäuschen, die nie geprüft
 * wurde. Vermerkt in WORK_STATUS.md unter „Gefundene Punkte".
 */

import net from 'node:net';
import { type GameQuerySpec } from '@palantir/contracts';

export interface HealthCheckTarget {
  /** Adresse der Node im WireGuard-Tunnel (Pflichtenheft §2.1). */
  readonly host: string;
  /** Host-Port, auf den der primäre Container-Port abgebildet ist. */
  readonly port: number;
  readonly query: GameQuerySpec;
}

export interface HealthCheckResult {
  readonly healthy: boolean;
  /** Antwortzeit in Millisekunden; `null`, wenn nicht erreichbar. */
  readonly pingMs: number | null;
  /** Spielerzahl, wenn die Sonde sie liefert (nur `gamedig`). */
  readonly playersOnline: number | null;
  readonly playersMax: number | null;
  /** Grund des Fehlschlags; `null`, wenn erreichbar. */
  readonly reason: string | null;
}

export interface HealthProbe {
  check(target: HealthCheckTarget, timeoutMs: number): Promise<HealthCheckResult>;
}

const UNREACHABLE = (reason: string): HealthCheckResult => ({
  healthy: false,
  pingMs: null,
  playersOnline: null,
  playersMax: null,
  reason,
});

/**
 * Generischer Port-Connect-Test.
 *
 * Geprüft wird ausschließlich, ob sich eine TCP-Verbindung aufbauen lässt – das
 * ist der Nachweis, dass der Prozess im Container tatsächlich lauscht und nicht
 * nur läuft. Es werden bewusst keine Daten gesendet: Ein Spieleprotokoll
 * verträgt keinen Fremdverkehr, und ein halbes Handshake könnte im Serverlog
 * als Fehler auftauchen.
 */
export function createPortConnectProbe(): HealthProbe {
  return {
    check(target: HealthCheckTarget, timeoutMs: number): Promise<HealthCheckResult> {
      return new Promise<HealthCheckResult>((resolve) => {
        const startedAt = Date.now();
        const socket = new net.Socket();
        let settled = false;

        const finish = (result: HealthCheckResult): void => {
          if (settled) {
            return;
          }

          settled = true;
          socket.destroy();
          resolve(result);
        };

        socket.setTimeout(timeoutMs);

        socket.once('connect', () => {
          finish({
            healthy: true,
            pingMs: Date.now() - startedAt,
            playersOnline: null,
            playersMax: null,
            reason: null,
          });
        });

        socket.once('timeout', () => {
          finish(UNREACHABLE('Der Server hat innerhalb der Frist keine Verbindung angenommen.'));
        });

        socket.once('error', (error: Error) => {
          finish(UNREACHABLE(`Der Server war nicht erreichbar (${error.message}).`));
        });

        socket.connect({ host: target.host, port: target.port });
      });
    },
  };
}

/**
 * Sonde, die nach dem Abfragetyp der Spiele-Definition auswählt.
 *
 * `gamedig` fehlt bewusst (siehe Kopfkommentar) und meldet einen benannten
 * Fehlschlag, statt still auf den Port-Connect auszuweichen.
 */
export function createHealthProbe(
  portConnect: HealthProbe = createPortConnectProbe(),
): HealthProbe {
  return {
    check(target: HealthCheckTarget, timeoutMs: number): Promise<HealthCheckResult> {
      if (target.query.kind === 'portConnect') {
        return portConnect.check(target, timeoutMs);
      }

      return Promise.resolve(
        UNREACHABLE(
          `Die Abfrage über gamedig (Protokoll "${target.query.protocol}") ist in dieser Ausbaustufe noch nicht umgesetzt.`,
        ),
      );
    },
  };
}

export interface AwaitHealthyOptions {
  readonly target: HealthCheckTarget;
  /** Gesamtfrist aus `GameTypeDefinition.startupTimeoutSeconds`. */
  readonly startupTimeoutMs: number;
  /** Frist eines einzelnen Versuchs. */
  readonly attemptTimeoutMs: number;
  /** Wartezeit zwischen zwei Versuchen. */
  readonly intervalMs: number;
  readonly probe: HealthProbe;
  /** Wird hereingereicht, damit Tests ohne echte Wartezeit auskommen. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wartet, bis der Server erreichbar ist, oder bis die Startfrist abläuft.
 *
 * Ein einzelner fehlgeschlagener Versuch bedeutet nichts – ein Spiel darf sich
 * beim Hochlauf Zeit lassen. Erst das Ablaufen der Gesamtfrist macht den Start
 * zum Fehlschlag (`SERVER_HEALTH_CHECK_FAILED`).
 */
export async function awaitHealthy(options: AwaitHealthyOptions): Promise<HealthCheckResult> {
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const deadline = now() + options.startupTimeoutMs;

  let last: HealthCheckResult = UNREACHABLE('Der Health-Check wurde nicht ausgeführt.');

  for (;;) {
    last = await options.probe.check(options.target, options.attemptTimeoutMs);

    if (last.healthy) {
      return last;
    }

    if (now() + options.intervalMs >= deadline) {
      return {
        ...last,
        reason: `Der Server war innerhalb von ${String(
          Math.round(options.startupTimeoutMs / 1000),
        )} Sekunden nicht erreichbar. Letzter Versuch: ${last.reason ?? 'unbekannt'}`,
      };
    }

    await sleep(options.intervalMs);
  }
}
