/**
 * Notification-Engine (Pflichtenheft §14, Lastenheft §3.6).
 *
 * Der Service ist die einzige Stelle, an der ein Ereignis zu Meldungen wird.
 * Der Ablauf beim Auslösen:
 *
 * 1. aktive Regeln zum Ereignis laden,
 * 2. Titel und Text einmal bilden (`messages.ts`),
 * 3. je Regel den Empfängerkreis auflösen (`recipients.ts`) und die Inbox
 *    füllen,
 * 4. den externen Kanal **im Hintergrund** bedienen.
 *
 * **Die wichtigste Zusicherung** (Pflichtenheft §14, CLAUDE.md §5):
 * {@link NotificationService.publish} wirft nie. Weder ein nicht erreichbarer
 * Discord-Webhook noch ein Datenbankfehler beim Schreiben der Inbox darf einen
 * Serverstart, ein Backup oder eine Registrierung scheitern lassen. Alles, was
 * hier schiefgeht, landet im Log und – beim externen Kanal – zusätzlich im
 * Zustellungsprotokoll `notification_deliveries`.
 */

import {
  type AnnouncementDto,
  type NotifiableEventName,
  type NotificationDeliveryDto,
  type NotificationEvent,
  type NotificationPageDto,
  type NotificationRuleDto,
  type NotificationChannelDto,
  type NotificationSeverity,
  isNotifiableEventName,
} from '@palantir/contracts';
import type {
  CreateAnnouncementInput,
  CreateNotificationChannelInput,
  CreateNotificationRuleInput,
  MarkNotificationsReadInput,
  NotificationQuery,
  UpdateAnnouncementInput,
  UpdateNotificationChannelInput,
  UpdateNotificationRuleInput,
} from '@palantir/validation';
import type { PermissionActor } from '../rbac/index.js';
import {
  toAnnouncementDto,
  toChannelDto,
  toDeliveryDto,
  toNotificationDto,
  toRuleDto,
} from './dto.js';
import { NotificationError } from './errors.js';
import { renderNotification } from './messages.js';
import {
  type Clock,
  type JobRunner,
  type LiveNotificationPublisher,
  type NotificationAuditSink,
  type NotificationTransport,
  type OutboundMessage,
  type RecipientDirectory,
  type ResolvedChannelTarget,
  fireAndForgetJobRunner,
  isNotificationTransportError,
  noopAuditSink,
  noopLivePublisher,
  systemClock,
} from './ports.js';
import { resolveRecipients } from './recipients.js';
import type {
  CreateNotificationData,
  NotificationChannelRecord,
  NotificationRepository,
  NotificationRuleRecord,
} from './repository.js';

/** Der Ausschnitt des Fastify-Loggers, den dieses Modul braucht. */
export interface NotificationLogger {
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

const silentLogger: NotificationLogger = {
  warn() {
    // absichtlich leer
  },
  error() {
    // absichtlich leer
  },
};

export interface NotificationServiceOptions {
  readonly repository: NotificationRepository;
  readonly directory: RecipientDirectory;
  readonly transport: NotificationTransport;
  readonly live?: LiveNotificationPublisher;
  readonly audit?: NotificationAuditSink;
  /**
   * `DISCORD_WEBHOOK_URL` aus der zentralen `.env` (Pflichtenheft §12.1).
   *
   * Kanäle ohne eigene URL greifen darauf zurück. Ist der Wert nicht gesetzt,
   * sind solche Kanäle nicht versandfähig (`deliverable: false` im DTO) und
   * werden beim Auslösen übersprungen statt einen Fehler zu erzeugen.
   */
  readonly defaultWebhookUrl?: string | null;
  readonly jobs?: JobRunner;
  readonly now?: Clock;
  readonly log?: NotificationLogger;
  /**
   * Versuche je Zustellung (inklusive des ersten).
   *
   * Bewusst klein: Discord ist entweder erreichbar oder gerade nicht, und eine
   * Benachrichtigung, die eine Viertelstunde später ankommt, hat ihren Zweck
   * meist verloren. Wiederholt wird nur bei vorübergehenden Fehlern
   * (`NotificationTransportError.retryable`).
   */
  readonly deliveryAttempts?: number;
  readonly retryDelayMs?: number;
  /** Nur für Tests: Warten ohne echtes Warten. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface NotificationService {
  /** Löst ein Ereignis aus. Wirft nie – siehe Datei-Kommentar. */
  publish(input: NotificationEvent): Promise<void>;

  // Kanäle (Permission `notification.manage`)
  listChannels(actor: PermissionActor): Promise<NotificationChannelDto[]>;
  createChannel(
    actor: PermissionActor,
    actorId: string | null,
    input: CreateNotificationChannelInput,
  ): Promise<NotificationChannelDto>;
  updateChannel(
    actor: PermissionActor,
    actorId: string | null,
    channelId: string,
    input: UpdateNotificationChannelInput,
  ): Promise<NotificationChannelDto>;
  deleteChannel(actor: PermissionActor, actorId: string | null, channelId: string): Promise<void>;
  /** Testnachricht – der einzige Weg, auf dem ein Zustellfehler den Aufrufer erreicht. */
  testChannel(channelId: string): Promise<void>;

  // Regeln (Permission `notification.manage`)
  listRules(actor: PermissionActor): Promise<NotificationRuleDto[]>;
  createRule(
    actor: PermissionActor,
    actorId: string | null,
    input: CreateNotificationRuleInput,
  ): Promise<NotificationRuleDto>;
  updateRule(
    actor: PermissionActor,
    actorId: string | null,
    ruleId: string,
    input: UpdateNotificationRuleInput,
  ): Promise<NotificationRuleDto>;
  deleteRule(actor: PermissionActor, actorId: string | null, ruleId: string): Promise<void>;

  // Inbox (gehört dem Empfänger)
  listInbox(viewerId: string, query: NotificationQuery): Promise<NotificationPageDto>;
  markRead(viewerId: string, input: MarkNotificationsReadInput): Promise<number>;
  deleteNotification(viewerId: string, notificationId: string): Promise<void>;
  countUnread(viewerId: string): Promise<number>;

  // Systemweite Ankündigungen (Permission `notification.manage`)
  listAnnouncements(actor: PermissionActor): Promise<AnnouncementDto[]>;
  publishAnnouncement(
    actor: PermissionActor,
    actorId: string | null,
    input: CreateAnnouncementInput,
  ): Promise<AnnouncementDto>;
  updateAnnouncement(
    actor: PermissionActor,
    actorId: string | null,
    announcementId: string,
    input: UpdateAnnouncementInput,
  ): Promise<AnnouncementDto>;
  deleteAnnouncement(
    actor: PermissionActor,
    actorId: string | null,
    announcementId: string,
  ): Promise<void>;

  // Zustellungsprotokoll (Permission `notification.manage`)
  listDeliveries(limit: number): Promise<NotificationDeliveryDto[]>;
}

export function createNotificationService(
  options: NotificationServiceOptions,
): NotificationService {
  const { repository, directory, transport } = options;
  const live = options.live ?? noopLivePublisher;
  const audit = options.audit ?? noopAuditSink;
  const jobs = options.jobs ?? fireAndForgetJobRunner;
  const now: Clock = options.now ?? systemClock;
  const log = options.log ?? silentLogger;
  const defaultWebhookUrl = options.defaultWebhookUrl ?? null;
  const deliveryAttempts = options.deliveryAttempts ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 2_000;
  const sleep =
    options.sleep ??
    ((ms: number): Promise<void> =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }));

  // -------------------------------------------------------------------------
  // Gemeinsame Bausteine
  // -------------------------------------------------------------------------

  /**
   * Löst das Versandziel eines Kanals auf.
   *
   * `null` bedeutet „nicht versandfähig": Der Kanal ist abgeschaltet oder er
   * greift auf `DISCORD_WEBHOOK_URL` zurück, und die Variable ist nicht gesetzt.
   */
  function resolveTarget(channel: NotificationChannelRecord): ResolvedChannelTarget | null {
    if (!channel.enabled) {
      return null;
    }

    const webhookUrl = channel.webhookUrl ?? defaultWebhookUrl;

    if (webhookUrl === null || webhookUrl.trim().length === 0) {
      return null;
    }

    return { type: channel.type, webhookUrl, username: channel.username };
  }

  async function channelNames(): Promise<ReadonlyMap<string, string>> {
    const channels = await repository.listChannels();

    return new Map(channels.map((channel) => [channel.id, channel.name]));
  }

  async function requireChannel(channelId: string): Promise<NotificationChannelRecord> {
    const channel = await repository.findChannelById(channelId);

    if (channel === null) {
      throw new NotificationError('NOTIFICATION_CHANNEL_NOT_FOUND');
    }

    return channel;
  }

  async function requireRule(ruleId: string): Promise<NotificationRuleRecord> {
    const rule = await repository.findRuleById(ruleId);

    if (rule === null) {
      throw new NotificationError('NOTIFICATION_RULE_NOT_FOUND');
    }

    return rule;
  }

  /**
   * Ein Zustellversuch samt Protokoll und Wiederholung.
   *
   * Läuft immer im Hintergrund und gibt nie einen Fehler an den Aufrufer weiter.
   * Ausnahme ist {@link NotificationService.testChannel} – dort ruft jemand den
   * Versand ausdrücklich auf und will das Ergebnis wissen.
   */
  async function deliver(
    channel: NotificationChannelRecord,
    target: ResolvedChannelTarget,
    message: OutboundMessage,
    context: { event: NotifiableEventName; ruleId: string | null },
  ): Promise<void> {
    const delivery = await repository.startDelivery({
      channelId: channel.id,
      ruleId: context.ruleId,
      event: context.event,
    });

    let attempts = 0;

    for (;;) {
      attempts += 1;

      try {
        const at = now();

        await transport.send(target, message);
        await repository.finishDelivery(delivery.id, {
          status: 'delivered',
          attempts,
          failureCode: null,
          failureMessage: null,
          deliveredAt: at,
        });
        await repository.recordChannelOutcome(channel.id, { status: 'delivered', at });

        return;
      } catch (error) {
        const transportError = isNotificationTransportError(error) ? error : null;
        const retryable = transportError?.retryable ?? false;

        if (retryable && attempts < deliveryAttempts) {
          await sleep(retryDelayMs);

          continue;
        }

        const code = transportError?.code ?? 'NOTIFICATION_DELIVERY_FAILED';
        const failureMessage =
          transportError?.message ??
          (error instanceof Error ? error.message : 'Unbekannter Fehler beim Versand.');

        await repository.finishDelivery(delivery.id, {
          status: 'failed',
          attempts,
          failureCode: code,
          failureMessage,
          deliveredAt: null,
        });
        await repository.recordChannelOutcome(channel.id, {
          status: 'failed',
          code,
          message: failureMessage,
        });

        throw error;
      }
    }
  }

  /** Zustellung im Hintergrund; Fehler landen im Log und im Protokoll, sonst nirgends. */
  function deliverInBackground(
    channel: NotificationChannelRecord,
    target: ResolvedChannelTarget,
    message: OutboundMessage,
    context: { event: NotifiableEventName; ruleId: string | null },
  ): void {
    jobs(async () => {
      try {
        await deliver(channel, target, message, context);
      } catch (error) {
        log.warn(
          {
            channelId: channel.id,
            event: context.event,
            ruleId: context.ruleId,
            reason: error instanceof Error ? error.message : String(error),
          },
          'Benachrichtigung konnte nicht an den externen Kanal zugestellt werden',
        );
      }
    });
  }

  /** Legt Inbox-Meldungen an und schiebt sie an offene Ansichten. */
  async function fillInbox(entries: readonly CreateNotificationData[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    const created = await repository.createNotifications(entries);

    for (const record of created) {
      const unreadCount = await repository.countUnread(record.userId);

      live.publish(record.userId, {
        notification: toNotificationDto(record, { viewerId: record.userId }),
        unreadCount,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Auslösen
  // -------------------------------------------------------------------------

  async function publishInternal(input: NotificationEvent): Promise<void> {
    const rules = await repository.listEnabledRulesForEvent(input.event);

    if (rules.length === 0) {
      return;
    }

    const rendered = renderNotification(input);
    const message: OutboundMessage = {
      title: rendered.title,
      body: rendered.body,
      severity: rendered.severity,
      at: input.payload.at,
    };

    for (const rule of rules) {
      /*
       * Die Regel darf die Dringlichkeit überschreiben; ohne eigene Angabe
       * (`null`) gilt die, die zum Ereignis passt. Ein fester Vorgabewert an
       * der Regel würde `backup.failed` still auf „Information" herabstufen.
       */
      const severity: NotificationSeverity = rule.severity ?? rendered.severity;

      if (rule.inboxEnabled) {
        /*
         * Eine Ankündigung erreicht jedes Konto ohnehin schon direkt
         * (`publishAnnouncement`). Eine Regel darüber trägt den externen Kanal
         * – ihre Inbox-Meldungen müssen sich mit den direkten decken, sonst
         * stünde derselbe Wartungshinweis zweimal in der Inbox. Die Zuordnung
         * hier greift den Unique-Index `notifications_announcement_user_idx`
         * auf, der die zweite Zeile dann verwirft.
         */
        const announcementId =
          input.event === 'announcement.published' ? input.payload.announcementId : null;
        const recipients = await resolveRecipients(
          input,
          rule.recipientScope,
          rule.recipientRoleId,
          directory,
        );

        await fillInbox(
          recipients.map((userId) => ({
            userId,
            event: input.event,
            severity,
            title: rendered.title,
            body: rendered.body,
            subjectType: rendered.subject?.type ?? null,
            subjectId: rendered.subject?.id ?? null,
            subjectName: rendered.subject?.displayName ?? null,
            data: { ...input.payload } as Record<string, unknown>,
            ruleId: rule.id,
            announcementId,
          })),
        );
      }

      if (rule.channelId === null) {
        continue;
      }

      const channel = await repository.findChannelById(rule.channelId);

      if (channel === null) {
        continue;
      }

      const target = resolveTarget(channel);

      if (target === null) {
        log.warn(
          { channelId: channel.id, event: input.event },
          'Benachrichtigungskanal ist nicht versandfähig und wurde übersprungen',
        );

        continue;
      }

      deliverInBackground({ ...channel }, target, { ...message, severity }, {
        event: input.event,
        ruleId: rule.id,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Öffentliche Schnittstelle
  // -------------------------------------------------------------------------

  /**
   * Die Zusicherung aus Pflichtenheft §14: Der auslösende Vorgang läuft weiter,
   * egal was hier passiert. Das schließt Datenbankfehler ein – ein Serverstart
   * soll nicht daran scheitern, dass die Inbox nicht beschreibbar war.
   */
  async function publishSafe(input: NotificationEvent): Promise<void> {
    try {
      await publishInternal(input);
    } catch (error) {
      log.error(
        { event: input.event, reason: error instanceof Error ? error.message : String(error) },
        'Benachrichtigung konnte nicht verarbeitet werden',
      );
    }
  }

  return {
    publish: publishSafe,

    async listChannels(actor) {
      const [channels, ruleCounts] = await Promise.all([
        repository.listChannels(),
        repository.countRulesPerChannel(),
      ]);

      return channels.map((channel) =>
        toChannelDto(channel, {
          actor,
          ruleCount: ruleCounts.get(channel.id) ?? 0,
          envWebhookConfigured: defaultWebhookUrl !== null,
        }),
      );
    },

    async createChannel(actor, actorId, input) {
      const existing = await repository.findChannelByName(input.name);

      if (existing !== null) {
        throw new NotificationError('NOTIFICATION_CHANNEL_NAME_TAKEN');
      }

      const channel = await repository.createChannel({
        name: input.name,
        type: input.type,
        webhookUrl: input.target.webhookUrl ?? null,
        username: input.target.username ?? null,
        enabled: input.enabled,
      });

      await audit.record({
        action: 'notification.channelChanged',
        actorId,
        targetType: 'notificationChannel',
        targetId: channel.id,
        // Die Webhook-URL steht bewusst nicht im Audit-Log – sie ist ein
        // Geheimnis, das Log ist für Admins einsehbar.
        metadata: { operation: 'created', name: channel.name, type: channel.type },
      });

      return toChannelDto(channel, {
        actor,
        ruleCount: 0,
        envWebhookConfigured: defaultWebhookUrl !== null,
      });
    },

    async updateChannel(actor, actorId, channelId, input) {
      await requireChannel(channelId);

      if (input.name !== undefined) {
        const existing = await repository.findChannelByName(input.name);

        if (existing !== null && existing.id !== channelId) {
          throw new NotificationError('NOTIFICATION_CHANNEL_NAME_TAKEN');
        }
      }

      const updated = await repository.updateChannel(channelId, {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        ...(input.target === undefined
          ? {}
          : {
              webhookUrl: input.target.webhookUrl ?? null,
              username: input.target.username ?? null,
            }),
      });

      if (updated === null) {
        throw new NotificationError('NOTIFICATION_CHANNEL_NOT_FOUND');
      }

      await audit.record({
        action: 'notification.channelChanged',
        actorId,
        targetType: 'notificationChannel',
        targetId: channelId,
        metadata: {
          operation: 'updated',
          changedFields: Object.keys(input),
        },
      });

      const ruleCounts = await repository.countRulesPerChannel();

      return toChannelDto(updated, {
        actor,
        ruleCount: ruleCounts.get(channelId) ?? 0,
        envWebhookConfigured: defaultWebhookUrl !== null,
      });
    },

    async deleteChannel(_actor, actorId, channelId) {
      const channel = await requireChannel(channelId);
      const ruleCounts = await repository.countRulesPerChannel();

      /*
       * Ein Kanal mit Regeln wird nicht gelöscht. Die Alternative – die Regeln
       * still auf „nur Inbox" fallen zu lassen – wäre die unangenehmere
       * Überraschung: Die Meldungen kämen weiter, nur nicht mehr dort an, wo
       * jemand sie erwartet.
       */
      if ((ruleCounts.get(channelId) ?? 0) > 0) {
        throw new NotificationError('NOTIFICATION_CHANNEL_IN_USE');
      }

      await repository.deleteChannel(channelId);
      await audit.record({
        action: 'notification.channelChanged',
        actorId,
        targetType: 'notificationChannel',
        targetId: channelId,
        metadata: { operation: 'deleted', name: channel.name },
      });
    },

    async testChannel(channelId) {
      const channel = await requireChannel(channelId);
      const target = resolveTarget(channel);

      if (target === null) {
        throw new NotificationError('NOTIFICATION_CHANNEL_NOT_CONFIGURED');
      }

      const at = now().toISOString();

      try {
        await deliver(
          channel,
          target,
          {
            title: 'Testnachricht aus Palantir',
            body: `Der Kanal »${channel.name}« ist richtig eingerichtet.`,
            severity: 'info',
            at,
          },
          // Ohne Regel: Die Testnachricht entsteht auf Knopfdruck, nicht aus
          // einem Ereignis. `announcement.published` steht hier nur als
          // Katalogname für das Protokoll.
          { event: 'announcement.published', ruleId: null },
        );
      } catch (error) {
        // `deliver()` hat den Fehlschlag bereits protokolliert und am Kanal
        // festgehalten; hier wird er nur noch in den Envelope übersetzt.
        throw new NotificationError(
          'NOTIFICATION_DELIVERY_FAILED',
          error instanceof Error ? error.message : undefined,
        );
      }
    },

    async listRules(actor) {
      const [rules, channels] = await Promise.all([repository.listRules(), channelNames()]);

      return rules.map((rule) =>
        toRuleDto(rule, {
          actor,
          channelName: rule.channelId === null ? null : (channels.get(rule.channelId) ?? null),
          // Rollennamen liefert B2; die Regelübersicht kommt auch ohne aus und
          // zeigt dann die Id. Angeschlossen wird das beim Verdrahten (R2).
          roleName: null,
        }),
      );
    },

    async createRule(actor, actorId, input) {
      if (!isNotifiableEventName(input.event)) {
        throw new NotificationError('NOTIFICATION_EVENT_NOT_NOTIFIABLE');
      }

      if (input.channelId !== null) {
        await requireChannel(input.channelId);
      }

      const duplicate = await repository.findMatchingRule({
        event: input.event,
        channelId: input.channelId,
        recipientScope: input.recipientScope,
        recipientRoleId: input.recipientRoleId,
      });

      if (duplicate !== null) {
        throw new NotificationError('NOTIFICATION_RULE_DUPLICATE');
      }

      const rule = await repository.createRule({
        event: input.event,
        channelId: input.channelId,
        recipientScope: input.recipientScope,
        recipientRoleId: input.recipientRoleId,
        inboxEnabled: input.inboxEnabled,
        severity: input.severity,
        enabled: input.enabled,
      });

      await audit.record({
        action: 'notification.ruleChanged',
        actorId,
        targetType: 'notificationRule',
        targetId: rule.id,
        metadata: {
          operation: 'created',
          event: rule.event,
          recipientScope: rule.recipientScope,
          channelId: rule.channelId,
        },
      });

      const channels = await channelNames();

      return toRuleDto(rule, {
        actor,
        channelName: rule.channelId === null ? null : (channels.get(rule.channelId) ?? null),
        roleName: null,
      });
    },

    async updateRule(actor, actorId, ruleId, input) {
      const rule = await requireRule(ruleId);

      if (input.channelId !== undefined && input.channelId !== null) {
        await requireChannel(input.channelId);
      }

      const next = {
        event: rule.event,
        channelId: input.channelId === undefined ? rule.channelId : input.channelId,
        recipientScope: input.recipientScope ?? rule.recipientScope,
        recipientRoleId:
          input.recipientRoleId === undefined ? rule.recipientRoleId : input.recipientRoleId,
      };

      /*
       * Dieselben zwei stillen Ausfälle, die schon die Eingabe-Schemas beim
       * Anlegen abweisen – beim Ändern entstehen sie erst aus der Verbindung
       * von altem und neuem Stand und lassen sich dort nicht prüfen.
       */
      if (next.recipientScope === 'role' && next.recipientRoleId === null) {
        throw new NotificationError(
          'VALIDATION_FAILED',
          'Für den Empfängerkreis „Rolle" muss eine Rolle gewählt werden.',
        );
      }

      if (next.recipientScope !== 'role' && next.recipientRoleId !== null) {
        throw new NotificationError(
          'VALIDATION_FAILED',
          'Eine Rolle ist nur beim Empfängerkreis „Rolle" zulässig.',
        );
      }

      const inboxEnabled = input.inboxEnabled ?? rule.inboxEnabled;

      if (!inboxEnabled && next.channelId === null) {
        throw new NotificationError(
          'VALIDATION_FAILED',
          'Eine Regel ohne Inbox und ohne Kanal würde niemanden erreichen.',
        );
      }

      const duplicate = await repository.findMatchingRule(next);

      if (duplicate !== null && duplicate.id !== ruleId) {
        throw new NotificationError('NOTIFICATION_RULE_DUPLICATE');
      }

      const updated = await repository.updateRule(ruleId, {
        channelId: next.channelId,
        recipientScope: next.recipientScope,
        recipientRoleId: next.recipientRoleId,
        inboxEnabled,
        ...(input.severity === undefined ? {} : { severity: input.severity }),
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      });

      if (updated === null) {
        throw new NotificationError('NOTIFICATION_RULE_NOT_FOUND');
      }

      await audit.record({
        action: 'notification.ruleChanged',
        actorId,
        targetType: 'notificationRule',
        targetId: ruleId,
        metadata: { operation: 'updated', changedFields: Object.keys(input) },
      });

      const channels = await channelNames();

      return toRuleDto(updated, {
        actor,
        channelName:
          updated.channelId === null ? null : (channels.get(updated.channelId) ?? null),
        roleName: null,
      });
    },

    async deleteRule(_actor, actorId, ruleId) {
      const rule = await requireRule(ruleId);

      await repository.deleteRule(ruleId);
      await audit.record({
        action: 'notification.ruleChanged',
        actorId,
        targetType: 'notificationRule',
        targetId: ruleId,
        metadata: { operation: 'deleted', event: rule.event },
      });
    },

    async listInbox(viewerId, query) {
      const page = await repository.listNotifications({
        userId: viewerId,
        unreadOnly: query.unreadOnly,
        ...(query.event === undefined ? {} : { event: query.event }),
        ...(query.severity === undefined ? {} : { severity: query.severity }),
        limit: query.limit,
        offset: query.offset,
      });

      return {
        entries: page.entries.map((record) => toNotificationDto(record, { viewerId })),
        total: page.total,
        unreadCount: page.unreadCount,
        limit: query.limit,
        offset: query.offset,
      };
    },

    async markRead(viewerId, input) {
      /*
       * Die Filterung auf das eigene Konto steckt in der Abfrage selbst
       * (`markRead` schreibt nur Zeilen mit passender `user_id`). Eine fremde
       * Id in der Liste trifft damit nichts – es braucht keinen eigenen
       * Fehlerfall dafür, und ein solcher würde nebenbei verraten, dass die
       * Meldung existiert.
       */
      return repository.markRead(viewerId, input.ids ?? null, input.read);
    },

    async deleteNotification(viewerId, notificationId) {
      const record = await repository.findNotificationById(notificationId);

      // Fremde Meldungen verhalten sich wie nicht vorhandene – der Aufrufer
      // erfährt nicht, dass es sie gibt.
      if (record === null || record.userId !== viewerId) {
        throw new NotificationError('NOTIFICATION_NOT_FOUND');
      }

      await repository.deleteNotification(notificationId);
    },

    async countUnread(viewerId) {
      return repository.countUnread(viewerId);
    },

    async listAnnouncements(actor) {
      const [records, counts] = await Promise.all([
        repository.listAnnouncements(),
        repository.countNotificationsPerAnnouncement(),
      ]);
      const publisherIds = records
        .map((record) => record.publishedByUserId)
        .filter((id): id is string => id !== null);
      const names = await directory.findDisplayNames([...new Set(publisherIds)]);

      return records.map((record) =>
        toAnnouncementDto(record, {
          actor,
          publishedByDisplayName:
            record.publishedByUserId === null
              ? null
              : (names.get(record.publishedByUserId) ?? null),
          recipientCount: counts.get(record.id) ?? 0,
        }),
      );
    },

    async publishAnnouncement(actor, actorId, input) {
      const announcement = await repository.createAnnouncement({
        title: input.title,
        body: input.body,
        severity: input.severity,
        publishedByUserId: actorId,
        expiresAt: input.expiresAt === null ? null : new Date(input.expiresAt),
      });

      /*
       * „Systemweit" heißt: alle freigeschalteten Konten – unabhängig davon, ob
       * ein Admin eine Regel für `announcement.published` angelegt hat. Eine
       * Wartungsmeldung, die niemanden erreicht, weil eine Regel fehlt, wäre
       * genau der stille Ausfall, den Lastenheft §3.6 nicht meint.
       *
       * Regeln laufen trotzdem zusätzlich (siehe unten) – sie tragen den
       * externen Kanal. Doppelte Inbox-Meldungen entstehen dabei nicht: Der
       * Unique-Index `notifications_announcement_user_idx` lässt je Konto genau
       * eine Meldung je Ankündigung zu.
       */
      const recipients = await directory.listActiveUserIds();

      await fillInbox(
        recipients.map((userId) => ({
          userId,
          event: 'announcement.published' as const,
          severity: announcement.severity,
          title: announcement.title,
          body: announcement.body,
          subjectType: 'announcement' as const,
          subjectId: announcement.id,
          subjectName: announcement.title,
          data: {},
          ruleId: null,
          announcementId: announcement.id,
        })),
      );

      await publishSafe({
        event: 'announcement.published',
        payload: {
          at: announcement.publishedAt.toISOString(),
          actorId,
          announcementId: announcement.id,
          title: announcement.title,
          body: announcement.body,
          severity: announcement.severity,
        },
      });

      await audit.record({
        action: 'notification.announcementChanged',
        actorId,
        targetType: 'announcement',
        targetId: announcement.id,
        metadata: {
          operation: 'published',
          title: announcement.title,
          recipientCount: recipients.length,
        },
      });

      return toAnnouncementDto(announcement, {
        actor,
        publishedByDisplayName: null,
        recipientCount: recipients.length,
      });
    },

    async updateAnnouncement(actor, actorId, announcementId, input) {
      const existing = await repository.findAnnouncementById(announcementId);

      if (existing === null) {
        throw new NotificationError('ANNOUNCEMENT_NOT_FOUND');
      }

      const updated = await repository.updateAnnouncement(announcementId, {
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.body === undefined ? {} : { body: input.body }),
        ...(input.severity === undefined ? {} : { severity: input.severity }),
        ...(input.expiresAt === undefined
          ? {}
          : { expiresAt: input.expiresAt === null ? null : new Date(input.expiresAt) }),
      });

      if (updated === null) {
        throw new NotificationError('ANNOUNCEMENT_NOT_FOUND');
      }

      /*
       * Bereits zugestellte Inbox-Meldungen bleiben, wie sie sind. Eine
       * Korrektur am Banner soll nicht rückwirkend ändern, was jemand gestern
       * gelesen hat – dieselbe Überlegung wie beim Speichern der Texte
       * (`messages.ts`).
       */
      await audit.record({
        action: 'notification.announcementChanged',
        actorId,
        targetType: 'announcement',
        targetId: announcementId,
        metadata: { operation: 'updated', changedFields: Object.keys(input) },
      });

      const counts = await repository.countNotificationsPerAnnouncement();

      return toAnnouncementDto(updated, {
        actor,
        publishedByDisplayName: null,
        recipientCount: counts.get(announcementId) ?? 0,
      });
    },

    async deleteAnnouncement(_actor, actorId, announcementId) {
      const existing = await repository.findAnnouncementById(announcementId);

      if (existing === null) {
        throw new NotificationError('ANNOUNCEMENT_NOT_FOUND');
      }

      // Die zugehörigen Inbox-Meldungen verschwinden mit (Fremdschlüssel
      // `on delete cascade`): Eine zurückgezogene Ankündigung soll auch aus den
      // Inboxen verschwinden, sonst bliebe ein Wartungshinweis stehen, der
      // nicht mehr gilt.
      await repository.deleteAnnouncement(announcementId);
      await audit.record({
        action: 'notification.announcementChanged',
        actorId,
        targetType: 'announcement',
        targetId: announcementId,
        metadata: { operation: 'withdrawn', title: existing.title },
      });
    },

    async listDeliveries(limit) {
      const [deliveries, channels] = await Promise.all([
        repository.listDeliveries(limit),
        channelNames(),
      ]);

      return deliveries.map((delivery) =>
        toDeliveryDto(delivery, {
          channelName: channels.get(delivery.channelId) ?? 'Entfernter Kanal',
        }),
      );
    },
  };
}
