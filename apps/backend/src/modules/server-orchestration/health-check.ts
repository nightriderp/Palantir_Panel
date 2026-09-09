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
 * **Zwei Sonden:** Der generische Port-Connect-Test deckt den Test-Typ aus
 * Phase 1 ab; mit dem ersten echten Spiel (Minecraft, Ausbaustufe 2) kommt die
 * Abfrage über `gamedig` dazu (WORK_STATUS.md, Gefundener Punkt 60). Welche
 * greift, entscheidet `query.kind` der Spiele-Definition – geraten wird nichts.
 *
 * **Laufzeit-Abhängigkeit `gamedig`** (CLAUDE.md §1): bewusst erst mit dem
 * Spiel eingeführt, das sie braucht, nicht auf Vorrat. Sie spricht die
 * Abfrageprotokolle der Spiele; das Protokoll steht als `protocol` in der
 * Definition.
 *
 * Der Unterschied ist nicht kosmetisch: Ein offener Port beweist nur, dass
 * etwas lauscht. Erst eine gültige Protokollantwort beweist, dass der
 * Spielserver bereit ist – und liefert nebenbei Spielerzahl und Antwortzeit.
 */

import net from 'node:net';
import { GameDig, type QueryResult } from 'gamedig';
import { type GameQuerySpec } from '@palantir/contracts';

export interface HealthCheckTarget {
  /**
   * Öffentliche Adresse der VPS – der Weg der Spieler, hinter frps.
   *
   * Nicht die Node im Tunnel: Dort sind die Spielports nur an `127.0.0.1`
   * gebunden, und die WireGuard-Firewall der Node nimmt nichts Neues an
   * (Fundpunkt 183, Begründung in `service.ts`, `runStartupHealth`).
   */
  readonly host: string;
  /** Öffentlicher Port des Servers, den frps auf der VPS veröffentlicht. */
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
 * Abfrage-Funktion, wie `gamedig` sie anbietet.
 *
 * Bewusst nur die Felder, die hier gebraucht werden – hereingereicht, damit die
 * Zuordnung „Antwort → {@link HealthCheckResult}" ohne Netz und ohne laufenden
 * Spielserver prüfbar bleibt (CLAUDE.md §4).
 */
export type GamedigQuery = (options: {
  type: string;
  host: string;
  port: number;
  socketTimeout: number;
  attemptTimeout: number;
  maxRetries: number;
}) => Promise<QueryResult>;

/** Ganze, nicht-negative Zahl oder `null` – alles andere ist keine Angabe. */
function zaehlung(wert: unknown): number | null {
  return typeof wert === 'number' && Number.isFinite(wert) && wert >= 0 ? Math.round(wert) : null;
}

/**
 * Sonde, die den Server über sein eigenes Abfrageprotokoll anspricht.
 *
 * `maxRetries: 0`: Der Health-Check wiederholt bereits selbst in Abständen
 * (`awaitHealthy`). Ein zweiter Wiederholungsmechanismus darunter würde die
 * Frist eines Versuchs vervielfachen und den Hochlauf verschleppen.
 */
/**
 * Die zwei Fristen, die gamedig kennt, aus der einen Frist der Sonde.
 *
 * `socketTimeout` gilt je Socket, `attemptTimeout` für den ganzen Versuch – und
 * die Socket-Frist muss **deutlich unter** der Versuchs-Frist liegen. Der Typ
 * `minecraft` ist in gamedig ein Verbund aus drei Protokollen (TCP-Ping,
 * GameSpy3 per UDP, Bedrock per UDP), und der Verbund wartet auf alle drei. Die
 * beiden UDP-Abfragen beantwortet ein Java-Server nicht (`enable-query=false`
 * ist die Vorgabe), sie laufen in die Socket-Frist. Waren beide Fristen gleich,
 * war der Versuch genau dann abgelaufen, wenn der Verbund fertig wurde: Der
 * TCP-Ping hatte längst geantwortet, und trotzdem hieß es „Timed out" –
 * jeder Start endete in `error`, bei laufendem Spiel (Fundpunkt 187, gemessen
 * aus dem Backend-Container gegen den ersten Minecraft-Server am 2026-09-09:
 * 3000/3000 scheitert, 1500/3000 antwortet nach 1,5 s).
 *
 * Die Hälfte lässt dem Verbund die andere Hälfte, um nach den UDP-Fristen
 * fertig zu werden. Ein Java-Server antwortet auf den Ping in Millisekunden,
 * auch über frp; wer eine Frist von 3 s setzt, bekommt 1,5 s je Socket.
 *
 * Dieselbe Rechnung steht im Agent (`jobs/query/gamedig-probe.ts`): Beide
 * Sonden rufen gamedig gleich auf, und beide fielen gleich hinein.
 */
export function gamedigFristen(timeoutMs: number): {
  socketTimeout: number;
  attemptTimeout: number;
} {
  return { socketTimeout: Math.max(1, Math.floor(timeoutMs / 2)), attemptTimeout: timeoutMs };
}

export function createGamedigProbe(abfragen: GamedigQuery = (options) => GameDig.query(options)) {
  return {
    async check(target: HealthCheckTarget, timeoutMs: number): Promise<HealthCheckResult> {
      if (target.query.kind !== 'gamedig') {
        return UNREACHABLE('Diese Sonde beantwortet nur Abfragen der Art „gamedig".');
      }

      try {
        const antwort = await abfragen({
          type: target.query.protocol,
          host: target.host,
          port: target.port,
          ...gamedigFristen(timeoutMs),
          maxRetries: 0,
        });

        return {
          healthy: true,
          pingMs: zaehlung(antwort.ping),
          // `numplayers` ist die gemeldete Zahl; die Liste `players` kann kürzer
          // sein, weil manche Server nur einen Auszug herausgeben.
          playersOnline: zaehlung(antwort.numplayers) ?? zaehlung(antwort.players?.length),
          playersMax: zaehlung(antwort.maxplayers),
          reason: null,
        };
      } catch (fehler: unknown) {
        // „Hat nicht geantwortet", nicht „kaputt": Ein Spielserver im Hochlauf
        // lehnt Abfragen ab, bis er bereit ist – genau darauf wartet der
        // Health-Check.
        return UNREACHABLE(
          `Der Server hat auf die Abfrage nicht geantwortet (${
            fehler instanceof Error ? fehler.message : String(fehler)
          }).`,
        );
      }
    },
  } satisfies HealthProbe;
}

/**
 * Sonde, die nach dem Abfragetyp der Spiele-Definition auswählt.
 *
 * Geraten wird nichts: `portConnect` und `gamedig` sind getrennte Sonden, und
 * die Definition sagt, welche gilt.
 */
export function createHealthProbe(
  portConnect: HealthProbe = createPortConnectProbe(),
  gamedig: HealthProbe = createGamedigProbe(),
): HealthProbe {
  return {
    check(target: HealthCheckTarget, timeoutMs: number): Promise<HealthCheckResult> {
      return target.query.kind === 'portConnect'
        ? portConnect.check(target, timeoutMs)
        : gamedig.check(target, timeoutMs);
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
