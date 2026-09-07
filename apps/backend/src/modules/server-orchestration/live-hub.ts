import {
  type LiveServerEventFrame,
  type LiveServerEventName,
  type LiveServerEventPayloads,
  type LiveTopic,
  isLiveServerEventName,
  isServerStatus,
} from '@palantir/contracts';
import { type OrchestrationEventSink } from './service.js';

/**
 * Live-Kanal Browser -> Backend (Pflichtenheft §5.3), Server-Seite.
 *
 * Gegenstück zum `LiveChannelProvider` im Frontend: genau **ein** WebSocket je
 * Browser abonniert einzelne Server, der Hub fächert die Ereignisse an die
 * jeweils passenden Sockets. Der Hub hängt sich – wie im Kommentar an
 * {@link OrchestrationEventSink} vorgesehen – an dieselbe Ereignissenke wie die
 * Notification-Engine (siehe {@link createLiveFanoutSink}) und formt die
 * Roh-Ereignisse von B3 in die Frames aus `packages/contracts/server-live.ts`.
 *
 * Nicht zu verwechseln mit dem Agent-Kanal (`/agent`): der verbindet Backend und
 * Homeserver, dieser hier Browser und Backend.
 */

/** Das Wenige, das der Hub von einem WebSocket braucht – erleichtert Tests. */
export interface LiveSocket {
  send(data: string): void;
  /**
   * Verbindung schließen – gebraucht für {@link ServerLiveHub.closeAll}.
   *
   * Optional, damit ein Testdouble weiterhin mit `{ send }` auskommt: Ein Hub
   * ohne Schließ-Anschluss kann alles außer dem Rauswurf.
   */
  close?(code: number, reason?: string): void;
}

interface Subscriber {
  readonly socket: LiveSocket;
  /** Konto hinter dieser Verbindung; `null`, wenn unbekannt (Testdoubles). */
  readonly userId: string | null;
  /** Server-Ids, die dieser Socket abonniert hat. */
  readonly topics: Set<string>;
}

/** Handle für einen registrierten Socket. */
export interface LiveRegistration {
  subscribe(serverId: string): void;
  unsubscribe(serverId: string): void;
  /** Ist dieser Server bereits abonniert? */
  isSubscribed(serverId: string): boolean;
  /**
   * Aktuell abonnierte Server-Ids.
   *
   * Für die wiederkehrende Abo-Prüfung am offenen Kanal (Audit W2-5,
   * `orchestration-core-09`): Ohne sie müsste die Route eine zweite Liste
   * neben dem Hub führen – zwei Wahrheiten über dieselben Abos.
   */
  subscribedServerIds(): readonly string[];
  /** Socket entfernen (bei Verbindungsende). */
  close(): void;
}

export class ServerLiveHub {
  readonly #subscribers = new Set<Subscriber>();
  readonly #now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.#now = now;
  }

  /** Aktuelle Zahl offener Sockets – nur für Tests/Diagnose. */
  get socketCount(): number {
    return this.#subscribers.size;
  }

  register(socket: LiveSocket, userId: string | null = null): LiveRegistration {
    const subscriber: Subscriber = { socket, userId, topics: new Set<string>() };
    this.#subscribers.add(subscriber);

    return {
      subscribe: (serverId) => subscriber.topics.add(serverId),
      unsubscribe: (serverId) => subscriber.topics.delete(serverId),
      isSubscribed: (serverId) => subscriber.topics.has(serverId),
      subscribedServerIds: () => [...subscriber.topics],
      close: () => this.#subscribers.delete(subscriber),
    };
  }

  /**
   * Schließt **alle** Verbindungen eines Kontos und meldet sie ab; liefert
   * zurück, wie viele es waren.
   *
   * Anschluss für Sperre und Sitzungswiderruf (Audit W2-2/W2-5,
   * `orchestration-core-09`) – dieselbe Aufgabe wie
   * `ChatLiveHub.closeAll()`/`NotificationHub.closeAll()`, damit ein Konto
   * nicht über den einen Kanal ausgesperrt wird und über den anderen weiter
   * Statuswechsel, Messwerte und Konsolenzeilen bekommt. Wer das auslöst,
   * entscheidet `server.ts`; der Hub kennt weder Sitzungen noch Sperren.
   */
  closeAll(userId: string, code: number, reason = 'Sitzung beendet.'): number {
    const betroffen = [...this.#subscribers].filter(
      (subscriber) => subscriber.userId === userId && subscriber.userId !== null,
    );

    // Erst abmelden, dann schließen: Das `close`-Ereignis meldet dieselbe
    // Verbindung gleich noch einmal ab – das ist idempotent, eine Zustellung
    // dazwischen darf es aber nicht mehr geben.
    for (const subscriber of betroffen) {
      this.#subscribers.delete(subscriber);
    }

    for (const subscriber of betroffen) {
      try {
        subscriber.socket.close?.(code, reason);
      } catch {
        // Verbindung ist bereits weg; mehr als schließen war nicht zu tun.
      }
    }

    return betroffen.length;
  }

  /** Ein fertiges Frame an alle Abonnenten des betroffenen Servers senden. */
  publish<TName extends LiveServerEventName>(
    event: TName,
    data: LiveServerEventPayloads[TName],
  ): void {
    const topic: LiveTopic = { resource: 'server', id: data.serverId };
    const frame: LiveServerEventFrame = {
      kind: 'event',
      event,
      topic,
      data,
      sentAt: this.#now().toISOString(),
    } as LiveServerEventFrame;
    const raw = JSON.stringify(frame);

    for (const subscriber of this.#subscribers) {
      if (!subscriber.topics.has(topic.id)) {
        continue;
      }
      try {
        subscriber.socket.send(raw);
      } catch {
        // Toter Socket: Das `close`-Ereignis räumt ihn ohnehin gleich ab. Ein
        // Sendefehler an einen Abonnenten darf die übrigen nicht abschneiden.
      }
    }
  }

  /**
   * Nimmt ein Roh-Ereignis der Orchestrierung entgegen und formt es – sofern es
   * ein Live-Ereignis ist – in ein Frame um. Fremde Ereignisse (reine
   * Notification-Anlässe) werden ignoriert.
   *
   * Bewusst defensiv: Kommt ein Ereignis in unerwarteter Form, wird es
   * verworfen statt ein kaputtes Frame zu senden.
   */
  ingest(event: string, payload: Record<string, unknown>): void {
    if (!isLiveServerEventName(event)) {
      return;
    }
    const serverId = payload.serverId;
    if (typeof serverId !== 'string') {
      return;
    }

    switch (event) {
      case 'server.statusChanged': {
        // B3 emittiert `{ serverId, from, to, statusMessage }`; der Live-Contract
        // will `{ serverId, status, statusMessage }`. `to` ist der neue Zustand.
        if (typeof payload.to !== 'string' || !isServerStatus(payload.to)) {
          return;
        }
        const statusMessage =
          typeof payload.statusMessage === 'string' ? payload.statusMessage : null;
        this.publish('server.statusChanged', { serverId, status: payload.to, statusMessage });
        return;
      }
      case 'server.statsUpdated': {
        const stats = payload.stats;
        if (stats === null || typeof stats !== 'object') {
          return;
        }
        // Die Messwerte reicht der Agent bereits im Contract-Format `ServerLiveStats`;
        // beide Seiten benutzen denselben Vertrag, deshalb ohne Umbau durchgereicht.
        this.publish('server.statsUpdated', {
          serverId,
          stats: stats as LiveServerEventPayloads['server.statsUpdated']['stats'],
        });
        return;
      }
      case 'serverClone.progressed': {
        const job = payload.job;
        if (job === null || typeof job !== 'object') {
          return;
        }
        this.publish('serverClone.progressed', {
          serverId,
          job: job as LiveServerEventPayloads['serverClone.progressed']['job'],
        });
        return;
      }
      case 'backup.progressed': {
        // Nutzlast ohne aufrufer-abhängige Felder (siehe `BackupProgress` im
        // Vertrag) – sie geht an alle Abonnenten des Server-Themas.
        const backup = payload.backup;
        if (backup === null || typeof backup !== 'object') {
          return;
        }
        this.publish('backup.progressed', {
          serverId,
          backup: backup as LiveServerEventPayloads['backup.progressed']['backup'],
        });
        return;
      }
      case 'server.consoleLineAppended': {
        // Wird von B3 derzeit nicht in dieser Form emittiert (die Live-Konsole
        // ist ein dokumentierter Folgeschritt). Sobald ein passendes `line`
        // geliefert wird, greift dieser Zweig ohne weitere Änderung.
        const line = payload.line;
        if (line === null || typeof line !== 'object') {
          return;
        }
        this.publish('server.consoleLineAppended', {
          serverId,
          line: line as LiveServerEventPayloads['server.consoleLineAppended']['line'],
        });
        return;
      }
    }
  }
}

/**
 * Verbindet zwei Ereignissenken zu einer: Jedes Ereignis geht zuerst an die
 * Notification-Engine (B6) und danach an den Live-Hub. So bleibt B3 bei genau
 * einer `events`-Senke, ohne die Empfänger zu kennen (siehe Kommentar an
 * {@link OrchestrationEventSink}).
 *
 * Reihenfolge bewusst: Ein Fehler beim Fächern an die Browser darf die
 * Notification-Zustellung nicht verhindern und umgekehrt – deshalb sind beide
 * Aufrufe voneinander entkoppelt.
 */
export function createLiveFanoutSink(
  notifications: OrchestrationEventSink,
  hub: ServerLiveHub,
): OrchestrationEventSink {
  return {
    emit(event, payload): void {
      notifications.emit(event, payload);
      hub.ingest(event, payload);
    },
  };
}
