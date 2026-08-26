/**
 * Datensatz → DTO (Pflichtenheft §5.2).
 *
 * Jede Ressource wird **vollständig** ausgeliefert, inklusive des serverseitig
 * berechneten `permissions`-Objekts – kein Zuschneiden auf einzelne Ansichten.
 *
 * Die einzige bewusste Auslassung ist die Webhook-URL: Sie ist ein Geheimnis
 * (wer sie hat, schreibt in den Discord-Kanal) und verlässt die Anwendung nie.
 * Damit ein Admin trotzdem zwei Kanäle unterscheiden kann, geht eine gekürzte,
 * nicht wiederherstellbare Kurzform mit ({@link webhookHint}).
 */

import type {
  AnnouncementDto,
  NotificationChannelDto,
  NotificationDeliveryDto,
  NotificationDto,
  NotificationRuleDto,
  NotificationSubject,
} from '@palantir/contracts';
import type { PermissionActor } from '../rbac/index.js';
import {
  computeAnnouncementPermissions,
  computeChannelPermissions,
  computeNotificationPermissions,
  computeRulePermissions,
} from './permissions.js';
import type {
  AnnouncementRecord,
  NotificationChannelRecord,
  NotificationDeliveryRecord,
  NotificationRecord,
  NotificationRuleRecord,
} from './repository.js';

/**
 * Wiedererkennbare Kurzform einer Webhook-URL.
 *
 * Zeigt den Host und die letzten Zeichen des Tokens. Das reicht, um zwei Kanäle
 * auseinanderzuhalten, und ist zu wenig, um die URL zu rekonstruieren – dieselbe
 * Überlegung wie bei `Session.ipHint` (Pflichtenheft §6).
 */
export function webhookHint(url: string | null): string | null {
  if (url === null) {
    return null;
  }

  let host: string;

  try {
    host = new URL(url).host;
  } catch {
    // Eine ungültige URL kann nur aus einem alten Datensatz stammen; sie ist
    // kein Grund, die Kanalübersicht scheitern zu lassen.
    return '…';
  }

  const tail = url.slice(-4);

  return `${host}/…/${tail}`;
}

export function toChannelDto(
  record: NotificationChannelRecord,
  options: {
    actor: PermissionActor;
    /** Anzahl Regeln, die diesen Kanal nutzen. */
    ruleCount: number;
    /** Ist `DISCORD_WEBHOOK_URL` in der zentralen `.env` gesetzt? */
    envWebhookConfigured: boolean;
  },
): NotificationChannelDto {
  const usesEnvDefault = record.webhookUrl === null;

  return {
    id: record.id,
    name: record.name,
    type: record.type,
    target: {
      hint: webhookHint(record.webhookUrl),
      usesEnvDefault,
      username: record.username,
    },
    enabled: record.enabled,
    // Ein Kanal ohne eigene URL ist nur versandfähig, wenn die `.env` eine
    // hergibt. Das steht im DTO, statt erst beim ersten Ereignis aufzufallen.
    deliverable: record.enabled && (!usesEnvDefault || options.envWebhookConfigured),
    lastDeliveryAt: record.lastDeliveryAt?.toISOString() ?? null,
    lastFailureCode: record.lastFailureCode,
    lastFailureMessage: record.lastFailureMessage,
    ruleCount: options.ruleCount,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    permissions: computeChannelPermissions(options.actor),
  };
}

export function toRuleDto(
  record: NotificationRuleRecord,
  options: {
    actor: PermissionActor;
    /** Name des Kanals; `null` bei „nur Inbox" oder wenn der Kanal verschwunden ist. */
    channelName: string | null;
    roleName: string | null;
  },
): NotificationRuleDto {
  return {
    id: record.id,
    event: record.event,
    channelId: record.channelId,
    channelName: options.channelName,
    recipientScope: record.recipientScope,
    recipientRoleId: record.recipientRoleId,
    recipientRoleName: options.roleName,
    inboxEnabled: record.inboxEnabled,
    severity: record.severity,
    enabled: record.enabled,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    permissions: computeRulePermissions(options.actor),
  };
}

function toSubject(record: NotificationRecord): NotificationSubject | null {
  if (record.subjectType === null || record.subjectId === null) {
    return null;
  }

  return { type: record.subjectType, id: record.subjectId, displayName: record.subjectName };
}

export function toNotificationDto(
  record: NotificationRecord,
  options: { viewerId: string },
): NotificationDto {
  return {
    id: record.id,
    userId: record.userId,
    event: record.event,
    severity: record.severity,
    title: record.title,
    body: record.body,
    subject: toSubject(record),
    data: record.data,
    ruleId: record.ruleId,
    readAt: record.readAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    permissions: computeNotificationPermissions(options.viewerId, record.userId),
  };
}

export function toAnnouncementDto(
  record: AnnouncementRecord,
  options: {
    actor: PermissionActor;
    publishedByDisplayName: string | null;
    /** Anzahl der erzeugten Inbox-Meldungen – die tatsächliche Reichweite. */
    recipientCount: number;
  },
): AnnouncementDto {
  return {
    id: record.id,
    title: record.title,
    body: record.body,
    severity: record.severity,
    publishedByUserId: record.publishedByUserId,
    publishedByDisplayName: options.publishedByDisplayName,
    publishedAt: record.publishedAt.toISOString(),
    expiresAt: record.expiresAt?.toISOString() ?? null,
    recipientCount: options.recipientCount,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    permissions: computeAnnouncementPermissions(options.actor),
  };
}

export function toDeliveryDto(
  record: NotificationDeliveryRecord,
  options: { channelName: string },
): NotificationDeliveryDto {
  return {
    id: record.id,
    channelId: record.channelId,
    channelName: options.channelName,
    ruleId: record.ruleId,
    event: record.event,
    status: record.status,
    attempts: record.attempts,
    failureCode: record.failureCode,
    failureMessage: record.failureMessage,
    createdAt: record.createdAt.toISOString(),
    deliveredAt: record.deliveredAt?.toISOString() ?? null,
  };
}
