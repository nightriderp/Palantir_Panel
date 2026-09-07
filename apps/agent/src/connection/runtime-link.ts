/**
 * Verbindungsaufbau zur Container-Runtime samt Wiederholung (Audit
 * agent-conn-01).
 *
 * Bis hierher galt: Scheitert `runtime.connect()` beim Agent-Start – etwa weil
 * der Docker-Socket-Proxy in der Startreihenfolge der Compose-Datei noch nicht
 * antwortet –, wurde der Fehler geloggt und `adapter.start()` nie erreicht.
 * Damit blieb der Agent für seine gesamte Laufzeit ohne Ereignisstrom: keine
 * `STATUS_CHANGED`, keine `CRASHED`, keine Live-Kanäle. Er beantwortete Befehle
 * weiter, meldete aber nie wieder von sich aus, was auf der Node passiert.
 *
 * Der Aufbau steht als eigene Datei da und nicht in `index.ts`, damit genau
 * dieser Ablauf – Fehlschlag, Wartezeit, zweiter Versuch – prüfbar bleibt.
 */

import { consoleLogger, type ConnectionLogger } from './agent-connection.js';
import { ExponentialBackoff, type BackoffOptions } from './backoff.js';
import type { OutboundEventSink } from './runtime-adapter.js';
import type { ContainerRuntime } from '../runtime/index.js';

/**
 * Obergrenze der Wartezeit zwischen zwei Verbindungsversuchen.
 *
 * Kürzer als beim Backend (60 s): Die Engine liegt auf derselben Node, ein
 * Ausfall ist typischerweise ein Neustart des Socket-Proxys und nach Sekunden
 * vorbei. Eine halbe Minute Wartezeit reicht als Obergrenze und hält den
 * Agent nicht unnötig lange blind.
 */
export const RUNTIME_RETRY_MAX_DELAY_MS = 30_000;

export interface RuntimeLinkOptions {
  /** Nur `connect()` wird gebraucht – der Rest der Runtime läuft über den Adapter. */
  readonly runtime: Pick<ContainerRuntime, 'connect'>;
  /** Der Adapter; `start()` ist mehrfach aufrufbar und meldet sich nur einmal an. */
  readonly adapter: { start(emit: OutboundEventSink): void };
  /** Senke für die Ereignisse – in der Regel `connection.sendEvent`. */
  readonly emit: OutboundEventSink;
  readonly logger?: ConnectionLogger;
  /** Abweichungen vom Backoff (Tests). */
  readonly backoff?: Partial<BackoffOptions>;
}

export interface RuntimeLink {
  /** Bricht einen geplanten Wiederholungsversuch ab (Shutdown). */
  stop(): void;
}

/**
 * Verbindet die Runtime und hängt den Adapter an; wiederholt den Versuch mit
 * wachsender Wartezeit, bis er gelingt oder {@link RuntimeLink.stop} kommt.
 *
 * Kein Abbruch des Agents bei einem Fehlschlag: Er hält die Backend-Verbindung
 * offen und beantwortet Befehle ehrlich mit `AGENT_RUNTIME_UNAVAILABLE`, statt
 * stumm zu bleiben.
 */
export function startRuntimeLink(options: RuntimeLinkOptions): RuntimeLink {
  const log = options.logger ?? consoleLogger;
  const backoff = new ExponentialBackoff({
    maxDelayMs: RUNTIME_RETRY_MAX_DELAY_MS,
    ...options.backoff,
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  let beendet = false;

  const versuche = (): void => {
    void options.runtime.connect().then(
      () => {
        if (beendet) return;
        options.adapter.start(options.emit);
        log.info('Container-Runtime verbunden');
      },
      (fehler: unknown) => {
        if (beendet) return;
        const wartezeitMs = backoff.nextDelayMs();
        log.error('Container-Runtime nicht erreichbar – neuer Versuch', {
          fehler: fehler instanceof Error ? fehler.message : String(fehler),
          wartezeitMs,
        });
        timer = setTimeout(versuche, wartezeitMs);
        // Der Wiederholungsversuch hält den Prozess nicht am Leben.
        timer.unref?.();
      },
    );
  };

  versuche();

  return {
    stop: () => {
      beendet = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
}
