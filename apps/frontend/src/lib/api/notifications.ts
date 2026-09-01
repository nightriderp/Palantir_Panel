import { type NotificationPageDto, type NotificationPreferencesDto } from '@palantir/contracts';
import {
  type MarkNotificationsReadInput,
  type NotificationPreferencesInput,
  type NotificationQuery,
} from '@palantir/validation';
import { type ApiResult, apiRequest } from './client';

/**
 * REST-Endpunkte der Inbox (Arbeitspaket B6, Pflichtenheft §14).
 *
 * Nur die drei Routen, die dem angemeldeten Konto selbst gehören. Die
 * Verwaltung der Kanäle, Regeln und Ankündigungen liegt unter
 * `/admin/notification-*` und gehört zu F10 – sie hat hier bewusst nichts zu
 * suchen.
 *
 * Ergebnisse sind immer der Response-Envelope aus Pflichtenheft §5.1; hier wird
 * nichts ausgepackt und nichts geworfen.
 */

const NOTIFICATIONS = '/notifications';

/** Filter der Inbox als Query-Parameter; unbelegte Felder entfallen. */
export type NotificationFilter = Partial<NotificationQuery>;

export function fetchNotifications(
  filter: NotificationFilter,
  signal?: AbortSignal,
): Promise<ApiResult<NotificationPageDto>> {
  return apiRequest<NotificationPageDto>(NOTIFICATIONS, {
    query: {
      unreadOnly: filter.unreadOnly === true ? true : undefined,
      event: filter.event,
      severity: filter.severity,
      limit: filter.limit,
      offset: filter.offset,
    },
    signal,
  });
}

/**
 * Meldungen als gelesen bzw. ungelesen markieren.
 *
 * Ohne `ids` gilt der Vorgang für **alle** ungelesenen Meldungen des Kontos –
 * das ist „Alle als gelesen markieren" (siehe `markNotificationsReadInputSchema`).
 * Die Antwort trägt die Zahl der geänderten Datensätze.
 */
export function markNotificationsRead(
  input: MarkNotificationsReadInput,
): Promise<ApiResult<{ changed: number }>> {
  return apiRequest<{ changed: number }>(`${NOTIFICATIONS}/read`, {
    method: 'POST',
    json: input,
  });
}

export function deleteNotification(
  notificationId: string,
): Promise<ApiResult<{ deleted: boolean }>> {
  return apiRequest<{ deleted: boolean }>(
    `${NOTIFICATIONS}/${encodeURIComponent(notificationId)}`,
    { method: 'DELETE' },
  );
}

/**
 * Persönliche Zustell-Einstellung des Kontos (Gefundener Punkt 93).
 *
 * Anders als die Schalter im `localStorage` betrifft das **jedes Gerät**: Ein
 * hier abbestelltes Ereignis landet gar nicht mehr in der Inbox.
 */
export function fetchNotificationPreferences(
  signal?: AbortSignal,
): Promise<ApiResult<NotificationPreferencesDto>> {
  return apiRequest<NotificationPreferencesDto>(`${NOTIFICATIONS}/preferences`, { signal });
}

export function saveNotificationPreferences(
  input: NotificationPreferencesInput,
): Promise<ApiResult<NotificationPreferencesDto>> {
  return apiRequest<NotificationPreferencesDto>(`${NOTIFICATIONS}/preferences`, {
    method: 'PUT',
    json: input,
  });
}
