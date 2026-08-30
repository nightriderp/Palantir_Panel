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

import { type NotificationEvent, isNotifiableEventName } from '@palantir/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database } from '../../db/index.js';
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
 * Ereignis-Senke für die auslösenden Arbeitspakete.
 *
 * Nimmt den Ereignisnamen als schlichten String entgegen, weil B3 und B5 ihre
 * Senken so definiert haben – sie sollen für eine Meldung nicht gegen die
 * Typen der Notification-Engine übersetzen müssen. Namen außerhalb von
 * `NOTIFIABLE_EVENTS` (etwa das reine Live-Ereignis `server.statsUpdated`)
 * werden still verworfen: Der Live-Kanal aus F3 hört auf dieselbe Senke, und
 * eine Ausnahme dort würde den auslösenden Vorgang gefährden.
 */
export interface NotificationEventSink {
  emit(event: string, payload: Record<string, unknown>): void;
  /** Namensgleiche Form für `BackupEventPublisher` aus B5. */
  publish(event: string, payload: Record<string, unknown>): void;
}

export function createNotificationEventSink(service: NotificationService): NotificationEventSink {
  function forward(event: string, payload: Record<string, unknown>): void {
    if (!isNotifiableEventName(event)) {
      return;
    }

    /*
     * Die gemeinsame Basis jeder Nutzlast (`at`, `actorId`) wird hier ergänzt,
     * falls die Quelle sie weggelassen hat: Ohne `at` bekäme die Meldung keinen
     * Zeitstempel, und ein fehlender Wert soll keine Ausnahme im auslösenden
     * Vorgang erzeugen. Die ereignisspezifischen Felder liefert die Quelle;
     * ihre Typen stehen in `NotificationEventPayloads`.
     */
    const normalized: Record<string, unknown> = { ...payload };

    if (typeof normalized.at !== 'string') {
      normalized.at = new Date().toISOString();
    }

    if (typeof normalized.actorId !== 'string') {
      normalized.actorId = null;
    }

    /*
     * Die einzige Umwandlung dieser Art im Modul. Sie ist die Grenze zwischen
     * den absichtlich schmalen Senken aus B3/B5 (`emit(event: string, payload:
     * Record<string, unknown>)`) und den typisierten Nutzlasten des Vertrags.
     * Typisiert herstellen ließe sie sich nur, wenn B3 und B5 gegen die Typen
     * der Notification-Engine übersetzen müssten – genau das sollen sie nicht.
     */
    void service.publish({ event, payload: normalized } as unknown as NotificationEvent);
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

  return { service, eventSink: createNotificationEventSink(service), hub };
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
