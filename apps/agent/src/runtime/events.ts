/**
 * Ausgehende Events der Container-Runtime (Pflichtenheft §5.3).
 *
 * Die vier Event-Typen `STATUS_CHANGED`, `STATS_UPDATE`, `LOG_LINE` und
 * `CRASHED` sind exakt die im Pflichtenheft genannten Agent-Events. Die Runtime
 * erzeugt sie; die Protokollschicht (A1) verpackt sie in das Wire-Format zum
 * Backend. Die Namen bleiben deshalb SCREAMING_SNAKE_CASE wie im Pflichtenheft
 * und folgen bewusst **nicht** dem `<domaene>.<vorgang>`-Schema der
 * WebSocket-Events aus Pflichtenheft §14 - das gilt fuer die Events
 * Backend zu Frontend, nicht fuer Agent zu Backend.
 */

import { type ContainerStats, type ContainerStatus, type LogLine } from './types.js';

export const CONTAINER_RUNTIME_EVENTS = [
  'STATUS_CHANGED',
  'STATS_UPDATE',
  'LOG_LINE',
  'CRASHED',
] as const;

export type ContainerRuntimeEventType = (typeof CONTAINER_RUNTIME_EVENTS)[number];

interface RuntimeEventBase {
  readonly containerId: string;
  /** Zeitpunkt des Ereignisses als ISO-8601-String. */
  readonly at: string;
}

/** Container-Zustand hat sich geaendert. */
export interface StatusChangedEvent extends RuntimeEventBase {
  readonly type: 'STATUS_CHANGED';
  readonly status: ContainerStatus;
  /** Zuletzt gemeldeter Zustand, `null` wenn die Runtime den Container neu sieht. */
  readonly previousStatus: ContainerStatus | null;
  /** Exit-Code, sofern der neue Zustand ein Ende des Prozesses beschreibt. */
  readonly exitCode: number | null;
}

/** Neue Messwerte aus dem Statistik-Stream. */
export interface StatsUpdateEvent extends RuntimeEventBase {
  readonly type: 'STATS_UPDATE';
  readonly stats: ContainerStats;
}

/** Eine Zeile aus dem Container-Log (Live-Konsole). */
export interface LogLineEvent extends RuntimeEventBase {
  readonly type: 'LOG_LINE';
  readonly line: LogLine;
}

/**
 * Container ist unerwartet beendet worden: Exit-Code ungleich 0 oder vom Kernel
 * wegen Speicherueberschreitung beendet. Der Neustart-Versuch mit
 * Crash-Loop-Schutz (Pflichtenheft §9) ist Sache von A3/B3, nicht der Runtime.
 */
export interface CrashedEvent extends RuntimeEventBase {
  readonly type: 'CRASHED';
  readonly exitCode: number;
  readonly oomKilled: boolean;
}

export type ContainerRuntimeEvent =
  StatusChangedEvent | StatsUpdateEvent | LogLineEvent | CrashedEvent;

export type ContainerRuntimeEventListener = (event: ContainerRuntimeEvent) => void;

/** Abmelden eines Listeners bzw. Beenden eines `watch()`-Abonnements. */
export type Unsubscribe = () => void;

/**
 * Minimaler typisierter Emitter.
 *
 * Bewusst kein `node:events`-EventEmitter: dessen Signatur ist stringbasiert
 * und verliert die Typinformation des Event-Objekts.
 */
export class RuntimeEventEmitter {
  readonly #listeners = new Set<ContainerRuntimeEventListener>();

  on(listener: ContainerRuntimeEventListener): Unsubscribe {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  emit(event: ContainerRuntimeEvent): void {
    for (const listener of [...this.#listeners]) {
      listener(event);
    }
  }

  removeAll(): void {
    this.#listeners.clear();
  }

  get listenerCount(): number {
    return this.#listeners.size;
  }
}
