/**
 * Schutz vor Doppelausführung von Befehlen (Pflichtenheft §2.2).
 *
 * Jeder Befehl trägt eine Korrelations-ID. Kommt dieselbe ID ein zweites Mal an
 * – typischerweise, weil das Backend nach einem Netzwerk-Retry nicht sicher
 * weiß, ob der erste Versuch angekommen ist –, darf der Befehl **nicht erneut
 * ausgeführt** werden. Ein doppeltes `RESTORE_BACKUP` oder `DELETE` wäre nicht
 * nur unnötig, sondern zerstörerisch.
 *
 * Der Speicher unterscheidet zwei Fälle:
 *   - **in Ausführung**: Das Ergebnis steht noch nicht fest. Das Duplikat wird
 *     verworfen; die Antwort auf den ursprünglichen Befehl folgt ohnehin.
 *   - **abgeschlossen**: Das Ergebnis wird erneut geschickt (mit
 *     `duplicate: true`), denn der Retry entsteht meist gerade deshalb, weil das
 *     erste Ergebnis das Backend nicht erreicht hat.
 *
 * **Grenze:** Der Speicher lebt nur im Prozess. Nach einem Neustart des Agents
 * ist er leer. Das ist bewusst so: Der Agent meldet nach jeder Verbindung
 * seinen vollständigen Ist-Zustand, und der Soll/Ist-Abgleich im Backend (B3)
 * ist die eigentliche Absicherung über einen Neustart hinweg. Eine persistente
 * Ablage würde eine zweite Wahrheitsquelle neben dem Backend schaffen.
 */

import type { AgentCommandName, ApiResponse, CorrelationId } from '@palantir/contracts';

/** Ergebnis eines bereits abgeschlossenen Befehls. */
export interface ProcessedCommand {
  readonly correlationId: CorrelationId;
  readonly command: AgentCommandName;
  readonly result: ApiResponse<unknown>;
  /** Zeitpunkt des Abschlusses als ISO-8601. */
  readonly completedAt: string;
}

export interface CorrelationStoreOptions {
  /**
   * Obergrenze abgelegter Ergebnisse. Bei Überschreitung fällt der älteste
   * Eintrag heraus (FIFO) – der Speicher darf nicht unbegrenzt wachsen, der
   * Agent läuft dauerhaft.
   */
  readonly maxEntries: number;
  /**
   * Lebensdauer eines Eintrags. Ein Retry nach mehr als dieser Zeit ist kein
   * Netzwerk-Retry mehr, sondern eine bewusste neue Anforderung.
   */
  readonly ttlMs: number;
}

export const DEFAULT_CORRELATION_STORE_OPTIONS: CorrelationStoreOptions = {
  maxEntries: 1_000,
  ttlMs: 6 * 60 * 60 * 1_000,
};

interface StoredEntry {
  readonly entry: ProcessedCommand;
  readonly storedAt: number;
}

export class CorrelationStore {
  private readonly options: CorrelationStoreOptions;
  private readonly now: () => number;
  /** Insertion-Order von `Map` ist die FIFO-Reihenfolge für die Verdrängung. */
  private readonly completed = new Map<CorrelationId, StoredEntry>();
  private readonly inFlight = new Set<CorrelationId>();

  constructor(options: Partial<CorrelationStoreOptions> = {}, now: () => number = Date.now) {
    this.options = { ...DEFAULT_CORRELATION_STORE_OPTIONS, ...options };
    if (this.options.maxEntries <= 0) {
      throw new Error('correlation-store: maxEntries muss größer als 0 sein.');
    }
    if (this.options.ttlMs <= 0) {
      throw new Error('correlation-store: ttlMs muss größer als 0 sein.');
    }
    this.now = now;
  }

  /** Anzahl abgelegter Ergebnisse (ohne die gerade laufenden Befehle). */
  get size(): number {
    this.prune();
    return this.completed.size;
  }

  /** Läuft ein Befehl mit dieser ID gerade? */
  isInFlight(correlationId: CorrelationId): boolean {
    return this.inFlight.has(correlationId);
  }

  /** Ergebnis eines bereits abgeschlossenen Befehls, sonst `undefined`. */
  getCompleted(correlationId: CorrelationId): ProcessedCommand | undefined {
    const stored = this.completed.get(correlationId);
    if (!stored) {
      return undefined;
    }
    if (this.isExpired(stored)) {
      this.completed.delete(correlationId);
      return undefined;
    }
    return stored.entry;
  }

  /**
   * Markiert eine ID als in Ausführung.
   *
   * @returns `false`, wenn die ID bereits läuft oder abgeschlossen ist – der
   *   Aufrufer darf den Befehl dann nicht ausführen.
   */
  markInFlight(correlationId: CorrelationId): boolean {
    if (this.inFlight.has(correlationId) || this.getCompleted(correlationId) !== undefined) {
      return false;
    }
    this.inFlight.add(correlationId);
    return true;
  }

  /** Legt das Ergebnis ab und beendet die Ausführungsmarkierung. */
  complete(entry: ProcessedCommand): void {
    this.inFlight.delete(entry.correlationId);
    // Vorhandenen Eintrag erst entfernen, damit ein erneutes Ablegen die
    // FIFO-Position auffrischt statt die alte Position zu behalten.
    this.completed.delete(entry.correlationId);
    this.completed.set(entry.correlationId, { entry, storedAt: this.now() });
    this.prune();
    this.evictOverflow();
  }

  /**
   * Hebt die Ausführungsmarkierung auf, ohne ein Ergebnis abzulegen.
   *
   * Nötig, wenn die Ausführung unerwartet abbricht (z. B. Prozessfehler in der
   * Runtime): Der Befehl darf dann erneut versucht werden, statt für immer als
   * „läuft gerade" zu gelten.
   */
  abandon(correlationId: CorrelationId): void {
    this.inFlight.delete(correlationId);
  }

  /** Entfernt abgelaufene Einträge. */
  prune(): void {
    for (const [correlationId, stored] of this.completed) {
      if (this.isExpired(stored)) {
        this.completed.delete(correlationId);
      }
    }
  }

  private evictOverflow(): void {
    while (this.completed.size > this.options.maxEntries) {
      const oldest = this.completed.keys().next();
      if (oldest.done) {
        return;
      }
      this.completed.delete(oldest.value);
    }
  }

  private isExpired(stored: StoredEntry): boolean {
    return this.now() - stored.storedAt >= this.options.ttlMs;
  }
}
