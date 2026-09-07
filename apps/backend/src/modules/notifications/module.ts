/**
 * Zusammenbau der Notification-Engine und ihr Anschluss für andere Pakete.
 *
 * Bewusst eine eigene Datei neben `service.ts`: Der Service kennt nur seine
 * Schnittstellen aus `ports.ts`; hier werden die konkreten Umsetzungen
 * (Drizzle, Discord, WebSocket-Hub) einmal zusammengesteckt.
 *
 * Die {@link NotificationEventSink} ist die Form, in der B3 und B5 ihre
 * Ereignisse melden (`OrchestrationEventSink.emit(event, payload)` bzw.
 * `BackupEventPublisher.publish(event, payload)`). Beide Pakete kennen B6
 * nicht – sie bekommen diese Senke beim Aufbau ihres Services gereicht.
 */

import {
  type NotifiableEventName,
  type NotificationEvent,
  type NotificationEventPayloads,
  type WebSocketEventName,
  isNotifiableEventName,
} from '@palantir/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database } from '../../db/index.js';
import {
  type FireAndForgetLogger,
  consoleFireAndForgetLogger,
  fireAndForget,
} from '../../lib/fire-and-forget.js';
import { createDiscordTransport } from './discord.js';
import { createNotificationHub, registerNotificationLiveRoute } from './live.js';
import type {
  JobRunner,
  NotificationAuditSink,
  NotificationTransport,
  RecipientDirectory,
  RoleNameLookup,
} from './ports.js';
import {
  createDrizzleNotificationRepository,
  createDrizzleRecipientDirectory,
} from './repository.js';
import { registerNotificationRoutes } from './routes.js';
import {
  type NotificationLogger,
  type NotificationService,
  createNotificationService,
} from './service.js';

/**
 * Nutzlast je Ereignisname, wie die Senke sie annimmt.
 *
 * Für benachrichtigungsfähige Ereignisse ist das die Nutzlast aus dem Vertrag –
 * damit meldet der Compiler ein fehlendes Feld dort, wo das Ereignis entsteht,
 * statt es erst in der Empfängerauflösung als `undefined` auffallen zu lassen
 * (Audit W1-7, event-flow-02). Reine Live-Ereignisse (`server.statsUpdated`,
 * `server.statusChanged` …) verwirft die Senke ohnehin; für sie bleibt die
 * Nutzlast offen, weil B3 seine Roh-Ereignisse in eigener Form über dieselbe
 * Senke schickt.
 */
export type NotificationSinkPayloads = {
  [TEvent in WebSocketEventName]: TEvent extends NotifiableEventName
    ? NotificationEventPayloads[TEvent]
    : Record<string, unknown>;
};

/**
 * Ereignis-Senke für die auslösenden Arbeitspakete.
 *
 * Namen außerhalb von `NOTIFIABLE_EVENTS` (etwa das reine Live-Ereignis
 * `server.statsUpdated`) werden still verworfen: Der Live-Kanal aus F3 hört auf
 * dieselbe Senke, und eine Ausnahme dort würde den auslösenden Vorgang
 * gefährden.
 *
 * Die Senke bleibt zu den schmalen Schnittstellen der Auslöser passend
 * (`OrchestrationEventSink.emit(event: string, payload: Record<string,
 * unknown>)`): Eine Signatur mit engeren Namen ist einer mit weiteren
 * zuweisbar, B3 muss deshalb weiterhin nichts von B6 wissen.
 */
export interface NotificationEventSink {
  emit<TEvent extends WebSocketEventName>(
    event: TEvent,
    payload: NotificationSinkPayloads[TEvent],
  ): void;
  /** Namensgleiche Form für `BackupEventPublisher` aus B5. */
  publish<TEvent extends WebSocketEventName>(
    event: TEvent,
    payload: NotificationSinkPayloads[TEvent],
  ): void;
}

export function createNotificationEventSink(
  service: NotificationService,
  log: FireAndForgetLogger = consoleFireAndForgetLogger,
): NotificationEventSink {
  function forward<TEvent extends WebSocketEventName>(
    event: TEvent,
    payload: NotificationSinkPayloads[TEvent],
  ): void {
    if (!isNotifiableEventName(event)) {
      return;
    }

    /*
     * Die gemeinsame Basis jeder Nutzlast (`at`, `actorId`) wird hier ergänzt,
     * falls die Quelle sie weggelassen hat: Ohne `at` bekäme die Meldung keinen
     * Zeitstempel, und ein fehlender Wert soll keine Ausnahme im auslösenden
     * Vorgang erzeugen. Nötig bleibt das für die Auslöser mit schmaler Senke
     * (B3): Wer gegen {@link NotificationSinkPayloads} meldet, liefert beide
     * Felder ohnehin.
     */
    const gemeldet = { ...payload } as Record<string, unknown>;
    const normalized = {
      ...gemeldet,
      at: typeof gemeldet.at === 'string' ? gemeldet.at : new Date().toISOString(),
      actorId: typeof gemeldet.actorId === 'string' ? gemeldet.actorId : null,
    } as NotificationEventPayloads[typeof event];

    /*
     * Name und Nutzlast sind zwei Werte; dass sie zusammenpassen, weiß der
     * Compiler in einer generischen Funktion nicht – geprüft ist es beim
     * Auslöser (siehe {@link NotificationSinkPayloads}). Deshalb hier eine
     * einfache Zusicherung statt der früheren Umdeutung über `unknown`.
     */
    fireAndForget(service.publish({ event, payload: normalized } as NotificationEvent), log, {
      vorgang: 'Benachrichtigung veröffentlichen',
      event,
    });
  }

  return { emit: forward, publish: forward };
}

export interface NotificationModuleOptions {
  readonly db: Database;
  /** `DISCORD_WEBHOOK_URL` aus der zentralen `.env` (Pflichtenheft §12.1). */
  readonly defaultWebhookUrl?: string | null;
  /** Frist eines einzelnen Versandversuchs. */
  readonly deliveryTimeoutMs?: number;
  readonly audit?: NotificationAuditSink;
  readonly log?: NotificationLogger;
  /**
   * Nachschlag „Rollen-Id → Name" für die Regelübersicht (F10).
   *
   * Wird in `server.ts` mit B2 hinterlegt; fehlt der Wert, zeigt die Übersicht
   * die Rollen-Id statt des Namens (siehe {@link RoleNameLookup}).
   */
  readonly roles?: RoleNameLookup;
  /** Nur für Tests: eigene Umsetzungen statt Discord bzw. Drizzle. */
  readonly transport?: NotificationTransport;
  readonly directory?: RecipientDirectory;
  readonly jobs?: JobRunner;
}

export interface NotificationModule {
  readonly service: NotificationService;
  /** Senke für B3 (`OrchestrationEventSink`) und B5 (`BackupEventPublisher`). */
  readonly eventSink: NotificationEventSink;
  readonly hub: ReturnType<typeof createNotificationHub>;
}

export function createNotificationModule(options: NotificationModuleOptions): NotificationModule {
  const hub = createNotificationHub();
  const service = createNotificationService({
    repository: createDrizzleNotificationRepository(options.db),
    directory: options.directory ?? createDrizzleRecipientDirectory(options.db),
    transport:
      options.transport ??
      createDiscordTransport(
        options.deliveryTimeoutMs === undefined ? {} : { timeoutMs: options.deliveryTimeoutMs },
      ),
    live: hub,
    ...(options.roles === undefined ? {} : { roles: options.roles }),
    ...(options.audit === undefined ? {} : { audit: options.audit }),
    ...(options.jobs === undefined ? {} : { jobs: options.jobs }),
    ...(options.log === undefined ? {} : { log: options.log }),
    defaultWebhookUrl: options.defaultWebhookUrl ?? null,
  });

  return { service, eventSink: createNotificationEventSink(service, options.log), hub };
}

export interface RegisterNotificationsOptions extends NotificationModuleOptions {
  /** Konto-Id des Aufrufers aus der Sitzung (B1); `null` = nicht angemeldet. */
  resolveUserId(request: FastifyRequest): string | null;
}

/**
 * Registriert REST-Routen und den Live-Kanal und liefert das Modul zurück.
 *
 * Setzt voraus, dass `@fastify/websocket` bereits registriert ist – das
 * geschieht in `server.ts` einmal für alle Kanäle.
 */
export async function registerNotifications(
  app: FastifyInstance,
  options: RegisterNotificationsOptions,
): Promise<NotificationModule> {
  const module = createNotificationModule(options);

  await app.register(
    registerNotificationRoutes({
      notifications: module.service,
      resolveUserId: options.resolveUserId,
    }),
  );

  registerNotificationLiveRoute(app, {
    hub: module.hub,
    notifications: module.service,
    resolveUserId: options.resolveUserId,
  });

  return module;
}
