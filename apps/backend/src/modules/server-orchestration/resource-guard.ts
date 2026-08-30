/**
 * Schnittstelle zur Ressourcenprüfung (Pflichtenheft §10, Arbeitspaket **B4**).
 *
 * „Vor jedem Start: harte Prüfung der tatsächlich freien Ressourcen der Ziel-VM
 * gegen die angeforderten Limits des Servers – unabhängig vom Nutzer-Kontingent."
 *
 * **B3 implementiert diese Prüfung nicht.** Die Vorgabe des Arbeitspakets ist
 * eindeutig: „Ressourcenprüfung vor jedem Start läuft über B4 – keine eigene
 * Parallelimplementierung." Hier steht deshalb ausschließlich die Schnittstelle,
 * die B3 aufruft, und der Adapter auf `assertStartCapacity()` aus B4.
 *
 * Umgekehrt liefert B3 die Belegung aus `game_servers`
 * (`usage-repository.ts`) – die Zahlen stehen in seiner Tabelle, und B4 zählt
 * ausdrücklich nicht in einer fremden.
 *
 * Die Schnittstelle ist bewusst so geschnitten, dass B4 beide Prüfungen aus §10
 * hinter einem Aufruf zusammenfassen kann (Nutzer-Kontingent **und** freie
 * Node-Kapazität) – B3 muss die Reihenfolge nicht kennen und soll sie nicht
 * kennen.
 */

import { type ServerResourceLimits } from '@palantir/contracts';
import { ServerOrchestrationError } from './errors.js';
import { type ServerRepository } from './repository.js';

export interface ResourceCheckRequest {
  /** Wer den Vorgang auslöst – für die Kontingentprüfung (`UserResourceLimit`). */
  readonly userId: string;
  /** Ziel-Node (`HostNode`), gegen deren freie Kapazität geprüft wird. */
  readonly hostId: string;
  /** Server, um den es geht; `null` beim Anlegen eines neuen Servers. */
  readonly serverId: string | null;
  readonly requested: ServerResourceLimits;
  /**
   * Anlass der Prüfung.
   *
   * `create` prüft zusätzlich `maxConcurrentServers`, `start` nur die
   * tatsächlich belegten Ressourcen – ein gestoppter Server belegt kein RAM.
   */
  readonly intent: 'create' | 'start';
}

export type ResourceCheckResult =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      /** Klartext für den Nutzer, z. B. „Es sind nur noch 2 GB RAM frei." */
      readonly message: string;
      /** Zusatzangaben fürs Log. */
      readonly details?: Readonly<Record<string, unknown>>;
    };

export interface ResourceGuard {
  check(request: ResourceCheckRequest): Promise<ResourceCheckResult>;
}

/**
 * Bindet die Prüfung aus B4 an (`assertStartCapacity()`, Pflichtenheft §10).
 *
 * B4 prüft beides in einem Aufruf – Nutzer-Kontingent und harte
 * Node-Kapazität – und wirft bei Ablehnung selbst einen Fehler mit
 * `RESOURCE_LIMIT_EXCEEDED`. Dieser Adapter reicht ihn unverändert weiter; B3
 * legt nichts drauf und nichts daneben.
 *
 * `excludeServerId` ist beim Start eines bereits angelegten Servers zwingend:
 * Sein Datenordner steckt schon in der Belegung und würde sonst doppelt zählen.
 * Beim Anlegen gibt es noch keinen Server, dann bleibt das Feld leer.
 */
export function createResourceGuardFromService(service: {
  assertStartCapacity(request: {
    readonly ownerId: string;
    readonly nodeId: string;
    readonly requested: ServerResourceLimits;
    readonly excludeServerId?: string;
  }): Promise<unknown>;
}): ResourceGuard {
  return {
    async check(request: ResourceCheckRequest): Promise<ResourceCheckResult> {
      await service.assertStartCapacity({
        ownerId: request.userId,
        nodeId: request.hostId,
        requested: request.requested,
        ...(request.serverId === null ? {} : { excludeServerId: request.serverId }),
      });

      return { allowed: true };
    },
  };
}

/**
 * Platzhalter für Tests und für den Fall, dass B4 nicht eingehängt ist.
 *
 * Lässt bewusst **alles** durch und protokolliert das bei jedem Aufruf, statt
 * still zu schweigen.
 */
export function createPermissiveResourceGuard(
  log: (message: string, details: Record<string, unknown>) => void,
): ResourceGuard {
  return {
    check(request: ResourceCheckRequest): Promise<ResourceCheckResult> {
      log('Ressourcenprüfung übersprungen – B4 (Ressourcen & Kapazität) ist nicht eingehängt', {
        userId: request.userId,
        hostId: request.hostId,
        intent: request.intent,
        requested: request.requested,
      });

      return Promise.resolve({ allowed: true });
    },
  };
}

/**
 * Führt die Prüfung aus und bricht bei Ablehnung mit `RESOURCE_LIMIT_EXCEEDED`
 * ab – dem Katalog-Code aus Pflichtenheft §5.1.
 */
export async function assertResourcesAvailable(
  guard: ResourceGuard,
  request: ResourceCheckRequest,
): Promise<void> {
  const result = await guard.check(request);

  if (!result.allowed) {
    throw new ServerOrchestrationError('RESOURCE_LIMIT_EXCEEDED', result.message, {
      ...result.details,
      intent: request.intent,
    });
  }
}

/**
 * Prüfung **und** belegende Schreiboperation als eine serialisierte Einheit.
 *
 * Die reine {@link assertResourcesAvailable} liest die Belegung, der Insert bzw.
 * der Wechsel auf `starting` folgt separat – zwei gleichzeitige Starts bestehen
 * so beide die Prüfung und überbuchen die Node (TOCTOU, WORK_STATUS.md Punkt 98,
 * Pflichtenheft §10). {@link CapacityReservation} schließt das Fenster: Sie hält
 * Prüfung und Schreiben unter einer Sperre je Node/Nutzer zusammen, sodass die
 * zweite Reservierung die Belegung der ersten bereits sieht.
 *
 * Die Kapazitätslogik selbst bleibt die aus B4 – hier kommt ausschließlich der
 * transaktionale Rahmen dazu (CLAUDE.md §3/§4).
 */
export interface CapacityReservation {
  /**
   * Führt die Prüfung für `request` aus und – nur wenn sie besteht – `write`.
   * Beide laufen serialisiert gegen konkurrierende Reservierungen derselben
   * Node bzw. desselben Nutzers. Bei Ablehnung wird `write` nicht ausgeführt und
   * `RESOURCE_LIMIT_EXCEEDED` geworfen.
   *
   * `write` erhält das für die Reservierung gültige {@link ServerRepository} –
   * bei der Drizzle-Umsetzung das transaktionsgebundene, damit Prüfung und
   * Schreiben tatsächlich atomar sind.
   */
  reserve<T>(
    request: ResourceCheckRequest,
    write: (repository: ServerRepository) => Promise<T>,
  ): Promise<T>;
}

/**
 * Reservierung ohne eigene Serialisierung – Prüfung, dann Schreiben, beides auf
 * dem übergebenen Guard und Repository.
 *
 * Das ist das Verhalten vor Punkt 98 und der Rückfall für Tests und für den
 * Fall, dass keine transaktionsfähige Umsetzung eingehängt ist. Die echte
 * Serialisierung liefert die Drizzle-Umsetzung (`capacity-reservation.ts`).
 */
export function createInlineCapacityReservation(
  guard: ResourceGuard,
  repository: ServerRepository,
): CapacityReservation {
  return {
    async reserve(request, write) {
      await assertResourcesAvailable(guard, request);

      return write(repository);
    },
  };
}
