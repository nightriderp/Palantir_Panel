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
}

interface Subscriber {
  readonly socket: LiveSocket;
  /** Server-Ids, die dieser Socket abonniert hat. */
  readonly topics: Set<string>;
}

/** Handle für einen registrierten Socket. */
export interface LiveRegistration {
  subscribe(serverId: string): void;
  unsubscribe(serverId: string): void;
  /** Ist dieser Server bereits abonniert? */
  isSubscribed(serverId: string): boolean;
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

  register(socket: LiveSocket): LiveRegistration {
    const subscriber: Subscriber = { socket, topics: new Set<string>() };
    this.#subscribers.add(subscriber);

    return {
      subscribe: (serverId) => subscriber.topics.add(serverId),
      unsubscribe: (serverId) => subscriber.topics.delete(serverId),
      isSubscribed: (serverId) => subscriber.topics.has(serverId),
      close: () => this.#subscribers.delete(subscriber),
    };
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
