/**
 * B6 – Notification-Engine (Lastenheft §3.6 und §3.7, Pflichtenheft §14,
 * STRUKTUR.md).
 *
 * Umfang:
 * - internes Event-System über den Katalog aus Pflichtenheft §14
 *   (`NOTIFIABLE_EVENTS` in `@palantir/contracts`)
 * - `NotificationChannel` (Version 1: Discord-Webhook), getrennt von
 *   `NotificationRule` (Ereignis → Kanal → Empfängerkreis)
 * - Zustellung in die Inbox im Panel (REST + eigener WebSocket-Kanal) und an
 *   den externen Kanal
 * - systemweite Ankündigungen durch den Admin (Wartungshinweise)
 *
 * **Die Zusicherung des Moduls:** `publish()` wirft nie. Ein nicht erreichbarer
 * Discord-Webhook oder ein Datenbankfehler beim Schreiben der Inbox darf den
 * auslösenden Vorgang – Serverstart, Backup, Registrierung – nicht scheitern
 * lassen (Pflichtenheft §14). Gescheiterte Zustellungen nach außen stehen
 * stattdessen im Protokoll `notification_deliveries` und am Kanal.
 *
 * **Anschluss durch andere Arbeitspakete:** `createNotificationModule()` liefert
 * mit `eventSink` eine Senke im Format, das B3 (`OrchestrationEventSink`) und
 * B5 (`BackupEventPublisher`) erwarten. Beide Pakete hängen sie beim Aufbau
 * ihres Services ein – siehe WORK_STATUS.md, Gefundene Punkte 22, 34 und 62.
 */

export { NotificationError, isNotificationError } from './errors.js';

export {
  type Clock,
  type JobRunner,
  type LiveNotificationPayload,
  type LiveNotificationPublisher,
  type NotificationAuditSink,
  type NotificationTransport,
  type OutboundMessage,
  type RecipientDirectory,
  type ResolvedChannelTarget,
  NotificationTransportError,
  fireAndForgetJobRunner,
  isNotificationTransportError,
  noopAuditSink,
  noopLivePublisher,
  systemClock,
} from './ports.js';

export { type RenderedNotification, renderNotification } from './messages.js';

export { directRecipientsOf, resolveRecipients } from './recipients.js';

export {
  type DiscordTransportOptions,
  buildDiscordPayload,
  createDiscordTransport,
  isRetryableStatus,
} from './discord.js';

export {
  type AnnouncementRecord,
  type CreateAnnouncementData,
  type CreateChannelData,
  type CreateNotificationData,
  type CreateRuleData,
  type DeliveryOutcome,
  type NotificationChannelRecord,
  type NotificationDeliveryRecord,
  type NotificationFilter,
  type NotificationPage,
  type NotificationRecord,
  type NotificationRepository,
  type NotificationRuleRecord,
  type UpdateAnnouncementData,
  type UpdateChannelData,
  type UpdateRuleData,
  createDrizzleNotificationRepository,
  createDrizzleRecipientDirectory,
} from './repository.js';

export {
  computeAnnouncementPermissions,
  computeChannelPermissions,
  computeNotificationPermissions,
  computeRulePermissions,
} from './permissions.js';

export {
  toAnnouncementDto,
  toChannelDto,
  toDeliveryDto,
  toNotificationDto,
  toRuleDto,
  webhookHint,
} from './dto.js';

export {
  type NotificationLogger,
  type NotificationService,
  type NotificationServiceOptions,
  createNotificationService,
} from './service.js';

export {
  type LiveSocket,
  type NotificationHub,
  type NotificationHubOptions,
  type NotificationLiveRouteOptions,
  CLOSE_CODE_UNAUTHORIZED,
  createNotificationHub,
  registerNotificationLiveRoute,
} from './live.js';

export { type NotificationRoutesOptions, registerNotificationRoutes } from './routes.js';

export {
  type NotificationEventSink,
  type NotificationModule,
  type NotificationModuleOptions,
  type RegisterNotificationsOptions,
  createNotificationEventSink,
  createNotificationModule,
  registerNotifications,
} from './module.js';
