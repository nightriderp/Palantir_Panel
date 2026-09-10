import {
  LIVE_SERVER_LIST_TOPIC,
  type LiveServerEventFrame,
  type LiveServerEventName,
  type LiveServerEventPayloads,
  type LiveServerListEventName,
  type LiveTopic,
  isLiveServerEventName,
  isLiveServerListEventName,
  isServerStatus,
} from '@palantir/contracts';
import { LIVE_CLOSE_CODE_TOO_SLOW, LIVE_MAX_BUFFERED_BYTES } from './live-frames.js';
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
   * Wie viel im Sendepuffer wartet, in Byte (Fundpunkt 229).
   *
   * Optional, damit ein Testdouble weiterhin mit `{ send }` auskommt: Fehlt die
   * Angabe, wird nichts abgeschnitten – dann kann der Hub nicht wissen, ob sich
   * etwas staut.
   */
  readonly bufferedAmount?: number;
  /**
   * Verbindung schließen – gebraucht für {@link ServerLiveHub.closeAll}.
   *
   * Optional, damit ein Testdouble weiterhin mit `{ send }` auskommt: Ein Hub
   * ohne Schließ-Anschluss kann alles außer dem Rauswurf.
   */
  close?(code: number, reason?: string): void;
}

/**
 * Abo auf die Serverliste (Fundpunkt 173).
 *
 * `seesAll` steht für `server.view.any`: Wer alle Server sehen darf, erfährt
 * von jedem; alle anderen nur von Servern, deren Besitzer oder Mitglied sie
 * sind. Die Route entscheidet das beim Abonnieren, der Hub prüft nur noch.
 */
export interface ListSubscription {
  readonly seesAll: boolean;
}

/** Wen ein Listen-Ereignis angeht – steht in der Nutzlast von B3. */
export interface ListAudience {
  readonly ownerId: string;
  readonly memberUserIds: readonly string[];
}

interface Subscriber {
  readonly socket: LiveSocket;
  /** Konto hinter dieser Verbindung; `null`, wenn unbekannt (Testdoubles). */
  readonly userId: string | null;
  /** Server-Ids, die dieser Socket abonniert hat. */
  readonly topics: Set<string>;
  /** Abo auf die Serverliste; `null`, solange nicht abonniert. */
  list: ListSubscription | null;
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
  /** Serverliste abonnieren (Fundpunkt 173); ein erneuter Aufruf ersetzt das Abo. */
  subscribeList(options: ListSubscription): void;
  unsubscribeList(): void;
  isListSubscribed(): boolean;
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
    const subscriber: Subscriber = { socket, userId, topics: new Set<string>(), list: null };
    this.#subscribers.add(subscriber);

    return {
      subscribe: (serverId) => subscriber.topics.add(serverId),
      unsubscribe: (serverId) => subscriber.topics.delete(serverId),
      isSubscribed: (serverId) => subscriber.topics.has(serverId),
      subscribedServerIds: () => [...subscriber.topics],
      subscribeList: (options) => {
        subscriber.list = { seesAll: options.seesAll };
      },
      unsubscribeList: () => {
        subscriber.list = null;
      },
      isListSubscribed: () => subscriber.list !== null,
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

      // Fundpunkt 229: Wer nicht hinterherkommt, wird abgeworfen statt
      // weitergefüttert – siehe `LIVE_MAX_BUFFERED_BYTES`.
      if (this.#zuLangsam(subscriber)) {
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
   * Kommt dieser Abonnent noch mit? (Fundpunkt 229.)
   *
   * Staut sich mehr als {@link LIVE_MAX_BUFFERED_BYTES} vor ihm, wird die
   * Verbindung geschlossen und abgemeldet. Der Browser baut sie neu auf und
   * beginnt mit einem frischen Stand; weiterzusenden hiesse, den Speicher des
   * Backends im Takt der Konsolenausgabe wachsen zu lassen.
   */
  #zuLangsam(subscriber: Subscriber): boolean {
    const gestaut = subscriber.socket.bufferedAmount;

    if (gestaut === undefined || gestaut <= LIVE_MAX_BUFFERED_BYTES) {
      return false;
    }

    this.#subscribers.delete(subscriber);

    try {
      subscriber.socket.close?.(
        LIVE_CLOSE_CODE_TOO_SLOW,
        'Die Verbindung kam mit den Meldungen nicht mehr hinterher.',
      );
    } catch {
      // Verbindung ist bereits weg; mehr als schliessen war nicht zu tun.
    }

    return true;
  }

  /**
   * Ein Listen-Ereignis (Fundpunkt 173) an alle senden, die die Liste
   * abonniert haben **und** den Server sehen dürfen: Besitzer, Mitglieder und
   * wer `server.view.any` hat. Das Frame trägt nur die Id – die Liste holt
   * sich der Browser danach über REST.
   */
  publishList(event: LiveServerListEventName, serverId: string, audience: ListAudience): void {
    const frame: LiveServerEventFrame = {
      kind: 'event',
      event,
      topic: LIVE_SERVER_LIST_TOPIC,
      data: { serverId },
      sentAt: this.#now().toISOString(),
    };
    const raw = JSON.stringify(frame);

    for (const subscriber of this.#subscribers) {
      if (subscriber.list === null) {
        continue;
      }

      const betroffen =
        subscriber.list.seesAll ||
        (subscriber.userId !== null &&
          (subscriber.userId === audience.ownerId ||
            audience.memberUserIds.includes(subscriber.userId)));

      if (!betroffen) {
        continue;
      }

      try {
        subscriber.socket.send(raw);
      } catch {
        // Toter Socket – siehe `publish()`.
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

    if (isLiveServerListEventName(event)) {
      // Angelegt, geklont, gelöscht: B3 nennt Besitzer und Mitglieder in der
      // Nutzlast (`emitServerEvent`); ohne sie ließe sich nicht sagen, wer
      // davon erfahren darf – dann lieber gar nicht.
      const ownerId = payload.ownerId;
      const memberUserIds = payload.memberUserIds;
      if (typeof ownerId !== 'string' || !Array.isArray(memberUserIds)) {
        return;
      }
      this.publishList(event, serverId, {
        ownerId,
        memberUserIds: memberUserIds.filter((id): id is string => typeof id === 'string'),
      });
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
      case 'backupRestore.progressed': {
        // Fundpunkt 225: derselbe Weg wie beim Klon-Auftrag - das Ereignis
        // traegt den vollstaendigen Auftrag, die Ansicht fragt nichts nach.
        const job = payload.job;
        if (job === null || typeof job !== 'object') {
          return;
        }
        this.publish('backupRestore.progressed', {
          serverId,
          job: job as LiveServerEventPayloads['backupRestore.progressed']['job'],
        });
        return;
      }
      case 'server.consoleLineAppended': {
        // B3 emittiert das Ereignis mit einer fertigen `ServerConsoleLine`
        // (`service.ts`, `handleLogLine`, Gefundener Punkt 101); hier wird sie
        // nur durchgereicht. Das Echo eingetippter Befehle geht nicht durch
        // `ingest`, sondern direkt über `publish` (`live-route.ts`).
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
