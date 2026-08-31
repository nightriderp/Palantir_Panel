/**
 * Sonde über `gamedig` (Pflichtenheft §9, Lastenheft §3.3, WORK_STATUS.md
 * Gefundener Punkt 76).
 *
 * Der Port-Connect-Test sagt nur, ob überhaupt jemand die Verbindung annimmt.
 * Ein Spieleprotokoll sagt zusätzlich, **wer** antwortet: Spielerzahl,
 * Höchstzahl und Antwortzeit. Genau daran hing der Spieler-Verlauf – ohne diese
 * Sonde blieb er dauerhaft leer.
 *
 * **Neue Laufzeit-Abhängigkeit `gamedig`** (CLAUDE.md §1): Sie kommt mit dem
 * ersten echten Spiel (Minecraft, Ausbaustufe 2) dazu, so wie es der
 * Kopfkommentar von `probe.ts` seit Phase 1 vorsieht. `gamedig` spricht die
 * Abfrageprotokolle vieler Spiele; welches gemeint ist, steht als
 * `protocol` in der Spiele-Definition und kommt über das Backend hierher – der
 * Agent kennt keine Spiele und errät nichts.
 *
 * Die Abfrage-Funktion wird hereingereicht, damit die Zuordnung
 * „gamedig-Antwort → {@link ServerProbeResult}" ohne Netz und ohne laufenden
 * Spielserver prüfbar bleibt (CLAUDE.md §4).
 */

import { GameDig, type QueryResult } from 'gamedig';
import { type ServerProbe, type ServerProbeResult, type ServerProbeTarget } from './probe.js';

/**
 * Abfrage-Funktion, wie `gamedig` sie anbietet.
 *
 * Bewusst nur die Felder, die hier gebraucht werden: Was die Sonde nicht liest,
 * muss ein Test auch nicht bauen.
 */
export type GamedigQuery = (options: {
  type: string;
  host: string;
  port: number;
  socketTimeout: number;
  attemptTimeout: number;
  maxRetries: number;
}) => Promise<QueryResult>;

const standardAbfrage: GamedigQuery = (options) => GameDig.query(options);

/** Ganze, nicht-negative Zahl oder `null` – alles andere ist keine Angabe. */
function zaehlung(wert: unknown): number | null {
  return typeof wert === 'number' && Number.isFinite(wert) && wert >= 0 ? Math.round(wert) : null;
}

/**
 * Sonde, die den Server über sein eigenes Abfrageprotokoll anspricht.
 *
 * Antwortet der Server, gilt er als erreichbar – und zwar belastbarer als beim
 * Port-Connect: Ein offener Port beweist nur, dass etwas lauscht, eine gültige
 * Protokollantwort, dass der Spielserver selbst bereit ist.
 *
 * `maxRetries: 0`: Die Abfrage läuft periodisch. Ein Wiederholen innerhalb
 * eines Durchgangs würde die Frist vervielfachen und die nächste Runde
 * verzögern – ein Fehlschlag ist hier kein Drama, der nächste Versuch kommt
 * ohnehin gleich.
 */
export function createGamedigProbe(abfragen: GamedigQuery = standardAbfrage): ServerProbe {
  return {
    async check(target: ServerProbeTarget, timeoutMs: number): Promise<ServerProbeResult> {
      if (target.query.kind !== 'gamedig') {
        return {
          reachable: false,
          pingMs: null,
          playersOnline: null,
          playersMax: null,
          reason: 'Diese Sonde beantwortet nur Abfragen der Art „gamedig".',
        };
      }

      try {
        const antwort = await abfragen({
          type: target.query.protocol,
          host: target.host,
          port: target.port,
          socketTimeout: timeoutMs,
          attemptTimeout: timeoutMs,
          maxRetries: 0,
        });

        return {
          reachable: true,
          pingMs: zaehlung(antwort.ping),
          // `numplayers` ist die gemeldete Zahl; die Liste `players` kann kürzer
          // sein, weil manche Server nur einen Auszug herausgeben.
          playersOnline: zaehlung(antwort.numplayers) ?? zaehlung(antwort.players?.length),
          playersMax: zaehlung(antwort.maxplayers),
          reason: null,
        };
      } catch (fehler: unknown) {
        // Ein Fehlschlag heißt hier „hat nicht geantwortet", nicht „kaputt":
        // Ein Spielserver im Hochlauf lehnt Abfragen ab, bis er bereit ist.
        return {
          reachable: false,
          pingMs: null,
          playersOnline: null,
          playersMax: null,
          reason: `Der Server hat auf die Abfrage nicht geantwortet (${
            fehler instanceof Error ? fehler.message : String(fehler)
          }).`,
        };
      }
    },
  };
}
