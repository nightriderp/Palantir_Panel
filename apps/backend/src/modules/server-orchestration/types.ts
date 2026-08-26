/**
 * Backend-interne Datenstrukturen der Server-Orchestrierung.
 *
 * Bewusst **nicht** in `@palantir/contracts`: Diese Formen verlassen das
 * Backend nie. Das `GameServerDto` (F3) führt die Auto-Shutdown-Einstellung als
 * `autoShutdownEnabled` plus `autoShutdownTimeoutMinutes` und die Ports als
 * schlichte Liste öffentlicher Ports – mehr braucht die Oberfläche nicht. Für
 * den Betrieb braucht das Backend jeweils etwas mehr, und dieses Mehr gehört
 * nicht in einen Vertrag, an den sich Frontend und Agent binden würden
 * (CLAUDE.md §3).
 */

import { type AgentPortProtocol } from '@palantir/contracts';

/**
 * Eine einzelne Portzuweisung (Pflichtenheft §2.4).
 *
 * Der DTO zeigt nur `assignedPorts: number[]`. Für die Weiterleitung braucht der
 * Game-Traffic-Proxy zusätzlich Protokoll und Container-Port, und der
 * Health-Check den primären Port.
 */
export interface ServerPortAssignment {
  /** Öffentlicher Port auf der VPS. */
  readonly publicPort: number;
  /** Port im Container auf dem Homeserver. */
  readonly containerPort: number;
  readonly protocol: AgentPortProtocol;
  /** Beschriftung aus der Spiele-Definition, z. B. „Spiel-Port". */
  readonly label: string;
  /** `true` beim Port, den der Spieler benutzt. */
  readonly primary: boolean;
}

/**
 * Auto-Shutdown eines Servers (Pflichtenheft §9, Lastenheft §3.3).
 *
 * Die Schonfrist steht nur hier: Sie ist eine Betriebsgröße, keine Einstellung,
 * die die Oberfläche heute anzeigt.
 */
export interface ServerAutoShutdown {
  /** Pro Server abschaltbar – etwa für ein geplantes Event. */
  readonly enabled: boolean;
  /** Inaktivitäts-Timeout in Minuten, bis abgeschaltet wird. */
  readonly idleTimeoutMinutes: number;
  /**
   * Schonfrist nach jedem Serverstart in Minuten. Solange sie läuft, wird nicht
   * abgeschaltet – ein frisch gestarteter Server hat naturgemäß keine Spieler.
   * Ein automatischer Neustart nach Absturz zählt dabei als regulärer Start.
   */
  readonly graceMinutes: number;
}
