/**
 * Nahtstelle zwischen der Core-Verbindung (A1) und der Container-Runtime (A2).
 *
 * A1 führt selbst nichts aus: Es nimmt Befehle vom Backend entgegen, sichert sie
 * gegen Doppelausführung ab und reicht sie hier hinein; Ergebnisse und
 * Ereignisse gehen denselben Weg zurück. Die tatsächliche Docker-Ansteuerung
 * liegt hinter `ContainerRuntime` in A2 – und die spricht ausschließlich über
 * den Docker-Socket-Proxy (Pflichtenheft §2.3, §2.5, CLAUDE.md §4).
 *
 * Dass diese Schnittstelle hier und nicht in `packages/contracts` liegt, ist
 * Absicht: Sie ist agent-intern und überschreitet keine Prozessgrenze. Die
 * Vertragsgrenze zum Backend ist allein das Agent-Protokoll in den Contracts.
 */

import type {
  AgentCommandName,
  AgentContainerState,
  AgentEventName,
  ApiResponse,
  CorrelationId,
} from '@palantir/contracts';
import { fail } from '@palantir/contracts';

/** Ein vom Backend eingegangener, bereits geprüfter und entduplizierter Befehl. */
export interface CommandExecution {
  readonly correlationId: CorrelationId;
  readonly command: AgentCommandName;
  readonly serverId: string | null;
  /** Unverändert durchgereichte Nutzdaten – A1 legt sie nicht aus. */
  readonly payload: unknown;
}

/** Ein Ereignis, das die Runtime oder ein Job (A3) ans Backend melden will. */
export interface OutboundEvent {
  readonly event: AgentEventName;
  readonly serverId: string | null;
  readonly payload?: unknown;
}

/**
 * Von A2 zu implementieren: Ausführung eines Befehls.
 *
 * Fehler werden als Fehlerantwort aus dem Katalog zurückgegeben, nicht geworfen.
 * Eine geworfene Ausnahme behandelt A1 ersatzweise als `AGENT_COMMAND_FAILED`,
 * damit das Backend nie ohne Antwort auf eine Korrelations-ID wartet.
 */
export interface CommandExecutor {
  execute(execution: CommandExecution): Promise<ApiResponse<unknown>>;
}

/**
 * Von A2 zu implementieren: vollständiger Ist-Zustand aller bekannten Container
 * (Pflichtenheft §2.2).
 *
 * Ist der Zustand nicht ermittelbar, muss die Zusage **abgelehnt** werden
 * (`reject`) statt eine leere Liste zu liefern: Eine leere Liste ist für das
 * Backend die Aussage „hier läuft nichts" und würde einen Soll/Ist-Abgleich
 * auslösen, der laufende Server anfasst.
 */
export interface ContainerStateSource {
  listContainerStates(): Promise<readonly AgentContainerState[]>;
}

/** Alles, was die Verbindung von der Runtime braucht. */
export interface AgentRuntimePort extends CommandExecutor, ContainerStateSource {}

/**
 * Platzhalter, solange A2 (Container-Runtime) noch nicht angebunden ist.
 *
 * Bewusst ehrlich statt bequem: Befehle werden mit `AGENT_COMMAND_FAILED`
 * beantwortet und die Zustandsabfrage lehnt ab. So sieht das Backend den echten
 * Stand, statt aus stillschweigenden Erfolgsmeldungen oder einer leeren
 * Container-Liste falsche Schlüsse zu ziehen.
 */
export function createUnavailableRuntimePort(): AgentRuntimePort {
  const grund = 'Die Container-Runtime (Arbeitspaket A2) ist noch nicht angebunden.';

  return {
    execute(execution: CommandExecution): Promise<ApiResponse<unknown>> {
      return Promise.resolve(fail('AGENT_COMMAND_FAILED', `${execution.command}: ${grund}`));
    },
    listContainerStates(): Promise<readonly AgentContainerState[]> {
      return Promise.reject(new Error(grund));
    },
  };
}
