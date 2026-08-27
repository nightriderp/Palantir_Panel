import {
  type AnnouncementDto,
  type AuditLogPageDto,
  type BackupOverviewDto,
  type GameServerDto,
  type HostNodeDto,
  type MessageReportDto,
  type MessageReportPageDto,
  type NotificationChannelDto,
  type NotificationDeliveryDto,
  type NotificationRuleDto,
  type PasswordResetResultDto,
  type PortAllocationDto,
  type PortPoolDto,
  type PortRangeDto,
  type RegistrationRequestDto,
  type RoleDto,
  type StorageEntryDto,
  type StorageSnapshotDto,
} from '@palantir/contracts';
import {
  type ApproveRegistrationRequestInput,
  type AuditLogQuery,
  type BackupOverviewQuery,
  type BlockRegistrationRequestInput,
  type CreateAnnouncementInput,
  type CreateNotificationChannelInput,
  type CreateNotificationRuleInput,
  type CreatePortRangeInput,
  type CreateRoleInput,
  type MessageReportQuery,
  type RegistrationRequestQuery,
  type ResolveMessageReportInput,
  type StartStorageScanInput,
  type UpdateAnnouncementInput,
  type UpdateNotificationChannelInput,
  type UpdateNotificationRuleInput,
  type UpdatePortRangeInput,
  type UpdateRoleInput,
} from '@palantir/validation';
import { type ApiResult, apiRequest } from './client';

/**
 * REST-Endpunkte des Admin-Kernbereichs (Arbeitspaket F10).
 *
 * Alle Pfade an einer Stelle, damit keine Ansicht eine URL selbst zusammenbaut –
 * dieselbe Regel wie bei `lib/api/servers.ts` (F3) und `AUTH_ENDPOINTS` (F1).
 * Die Endpunkte entstehen in den Backend-Arbeitspaketen B8 (Nodes, Adressen,
 * Audit, Storage, Warteliste, Rollen), B6 (Benachrichtigungen), B5 (globale
 * Backups), B1 (Passwort-Reset, 2FA) und B7 (Moderation).
 *
 * Ergebnisse sind immer der Response-Envelope aus Pflichtenheft §5.1 – hier wird
 * nichts ausgepackt und nichts geworfen. Die Ansichten entscheiden selbst, ob
 * ein Fehler als Toast, als Zeile im Dialog oder als Leerzustand erscheint.
 *
 * Die Pfade folgen den tatsächlichen Backend-Routen: Die Admin-Routen liegen
 * unter `/admin/…`, die Moderation unter `/api/moderation/…` und die
 * kontobezogenen Admin-Eingriffe unter `/auth/admin/…`.
 */

// ---------------------------------------------------------------------------
// Freischalt-Warteliste / Nutzerverwaltung (Lastenheft §3.1 und §3.7)
// ---------------------------------------------------------------------------

/**
 * Konten der Warteliste, nach Zustand gefiltert.
 *
 * Die „Anfragen" sind `status: 'pending'`; dieselbe Route liefert mit
 * `approved`/`blocked` zugleich die Nutzerübersicht – ein eigener Nutzer-Endpunkt
 * existiert (noch) nicht (siehe Gefundener Punkt in WORK_STATUS.md).
 */
export function fetchRegistrationRequests(
  query: RegistrationRequestQuery,
  signal?: AbortSignal,
): Promise<ApiResult<RegistrationRequestDto[]>> {
  return apiRequest<RegistrationRequestDto[]>('/admin/requests', { query, signal });
}

export function approveRegistrationRequest(
  userId: string,
  input: ApproveRegistrationRequestInput,
): Promise<ApiResult<RegistrationRequestDto>> {
  return apiRequest<RegistrationRequestDto>(`/admin/requests/${encodeURIComponent(userId)}/approve`, {
    method: 'POST',
    json: input,
  });
}

export function blockRegistrationRequest(
  userId: string,
  input: BlockRegistrationRequestInput,
): Promise<ApiResult<RegistrationRequestDto>> {
  return apiRequest<RegistrationRequestDto>(`/admin/requests/${encodeURIComponent(userId)}/block`, {
    method: 'POST',
    json: input,
  });
}

export function unblockRegistrationRequest(
  userId: string,
): Promise<ApiResult<RegistrationRequestDto>> {
  return apiRequest<RegistrationRequestDto>(
    `/admin/requests/${encodeURIComponent(userId)}/unblock`,
    { method: 'POST' },
  );
}

/** Einmal-Passwort setzen (Lastenheft §3.1); die Antwort zeigt es genau einmal. */
export function resetUserPassword(userId: string): Promise<ApiResult<PasswordResetResultDto>> {
  return apiRequest<PasswordResetResultDto>(
    `/auth/admin/users/${encodeURIComponent(userId)}/password-reset`,
    { method: 'POST' },
  );
}

/** 2FA eines Kontos zurücksetzen, wenn der Nutzer ausgesperrt ist (Pflichtenheft §7). */
export function resetUserTwoFactor(userId: string): Promise<ApiResult<null>> {
  return apiRequest<null>(`/auth/admin/users/${encodeURIComponent(userId)}/2fa`, {
    method: 'DELETE',
  });
}

/**
 * Server eines Nutzers einsehen (Lastenheft §3.7).
 *
 * Das Backend hat keinen nach Besitzer gefilterten Endpunkt; ein Admin mit
 * `server.view.any` bekommt über `/servers` alle Server und filtert nach
 * `ownerId` in der Ansicht.
 */
export function fetchAllServers(signal?: AbortSignal): Promise<ApiResult<GameServerDto[]>> {
  return apiRequest<GameServerDto[]>('/servers', { signal });
}

// ---------------------------------------------------------------------------
// Rollen- und Berechtigungsverwaltung (Lastenheft §3.2, Pflichtenheft §8)
// ---------------------------------------------------------------------------

export function fetchRoles(signal?: AbortSignal): Promise<ApiResult<RoleDto[]>> {
  return apiRequest<RoleDto[]>('/admin/roles', { signal });
}

export function createRole(input: CreateRoleInput): Promise<ApiResult<RoleDto>> {
  return apiRequest<RoleDto>('/admin/roles', { method: 'POST', json: input });
}

export function updateRole(roleId: string, input: UpdateRoleInput): Promise<ApiResult<RoleDto>> {
  return apiRequest<RoleDto>(`/admin/roles/${encodeURIComponent(roleId)}`, {
    method: 'PATCH',
    json: input,
  });
}

export function deleteRole(roleId: string): Promise<ApiResult<null>> {
  return apiRequest<null>(`/admin/roles/${encodeURIComponent(roleId)}`, { method: 'DELETE' });
}

/** Rolle einem Konto zuweisen; die Antwort trägt die aktualisierte Mitgliederzahl. */
export function assignRole(roleId: string, userId: string): Promise<ApiResult<RoleDto>> {
  return apiRequest<RoleDto>(
    `/admin/roles/${encodeURIComponent(roleId)}/members/${encodeURIComponent(userId)}`,
    { method: 'PUT' },
  );
}

export function removeRole(roleId: string, userId: string): Promise<ApiResult<RoleDto>> {
  return apiRequest<RoleDto>(
    `/admin/roles/${encodeURIComponent(roleId)}/members/${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  );
}

// ---------------------------------------------------------------------------
// Audit-Log (Lastenheft §3.7) – rein lesend
// ---------------------------------------------------------------------------

export function fetchAuditLog(
  query: AuditLogQuery,
  signal?: AbortSignal,
): Promise<ApiResult<AuditLogPageDto>> {
  return apiRequest<AuditLogPageDto>('/admin/audit', { query, signal });
}

// ---------------------------------------------------------------------------
// Globale Backups (Lastenheft §3.7)
// ---------------------------------------------------------------------------

export function fetchBackupOverview(
  query: BackupOverviewQuery,
  signal?: AbortSignal,
): Promise<ApiResult<BackupOverviewDto>> {
  return apiRequest<BackupOverviewDto>('/admin/backups', { query, signal });
}

// ---------------------------------------------------------------------------
// Nodes und Storage-Explorer (Lastenheft §3.7 und §3.8, Pflichtenheft §16)
// ---------------------------------------------------------------------------

export function fetchNodes(signal?: AbortSignal): Promise<ApiResult<HostNodeDto[]>> {
  return apiRequest<HostNodeDto[]>('/admin/nodes', { signal });
}

export function fetchStorageSnapshot(
  nodeId: string,
  signal?: AbortSignal,
): Promise<ApiResult<StorageSnapshotDto>> {
  return apiRequest<StorageSnapshotDto>(`/admin/storage/${encodeURIComponent(nodeId)}`, { signal });
}

export function startStorageScan(
  nodeId: string,
  input: StartStorageScanInput,
): Promise<ApiResult<StorageSnapshotDto>> {
  return apiRequest<StorageSnapshotDto>(`/admin/storage/${encodeURIComponent(nodeId)}/scan`, {
    method: 'POST',
    json: input,
  });
}

export function deleteStorageEntry(
  nodeId: string,
  entryId: string,
): Promise<ApiResult<StorageEntryDto>> {
  return apiRequest<StorageEntryDto>(`/admin/storage/${encodeURIComponent(nodeId)}/entries`, {
    method: 'DELETE',
    json: { entryId },
  });
}

// ---------------------------------------------------------------------------
// Adressen / öffentlicher Port-Bereich (Lastenheft §3.7, Pflichtenheft §2.4)
// ---------------------------------------------------------------------------

export function fetchPortPool(signal?: AbortSignal): Promise<ApiResult<PortPoolDto>> {
  return apiRequest<PortPoolDto>('/admin/addresses/ports', { signal });
}

export function createPortRange(input: CreatePortRangeInput): Promise<ApiResult<PortRangeDto>> {
  return apiRequest<PortRangeDto>('/admin/addresses/ranges', { method: 'POST', json: input });
}

export function updatePortRange(
  rangeId: string,
  input: UpdatePortRangeInput,
): Promise<ApiResult<PortRangeDto>> {
  return apiRequest<PortRangeDto>(`/admin/addresses/ranges/${encodeURIComponent(rangeId)}`, {
    method: 'PATCH',
    json: input,
  });
}

export function deletePortRange(rangeId: string): Promise<ApiResult<null>> {
  return apiRequest<null>(`/admin/addresses/ranges/${encodeURIComponent(rangeId)}`, {
    method: 'DELETE',
  });
}

export function fetchPortAllocations(
  signal?: AbortSignal,
): Promise<ApiResult<PortAllocationDto[]>> {
  return apiRequest<PortAllocationDto[]>('/admin/addresses/allocations', { signal });
}

export function releasePortAllocation(allocationId: string): Promise<ApiResult<null>> {
  return apiRequest<null>(`/admin/addresses/allocations/${encodeURIComponent(allocationId)}`, {
    method: 'DELETE',
  });
}

// ---------------------------------------------------------------------------
// Benachrichtigungen: Kanäle, Regeln, Zustellungen (Lastenheft §3.6)
// ---------------------------------------------------------------------------

export function fetchNotificationChannels(
  signal?: AbortSignal,
): Promise<ApiResult<NotificationChannelDto[]>> {
  return apiRequest<NotificationChannelDto[]>('/admin/notification-channels', { signal });
}

export function createNotificationChannel(
  input: CreateNotificationChannelInput,
): Promise<ApiResult<NotificationChannelDto>> {
  return apiRequest<NotificationChannelDto>('/admin/notification-channels', {
    method: 'POST',
    json: input,
  });
}

export function updateNotificationChannel(
  channelId: string,
  input: UpdateNotificationChannelInput,
): Promise<ApiResult<NotificationChannelDto>> {
  return apiRequest<NotificationChannelDto>(
    `/admin/notification-channels/${encodeURIComponent(channelId)}`,
    { method: 'PATCH', json: input },
  );
}

export function deleteNotificationChannel(channelId: string): Promise<ApiResult<null>> {
  return apiRequest<null>(`/admin/notification-channels/${encodeURIComponent(channelId)}`, {
    method: 'DELETE',
  });
}

export function testNotificationChannel(channelId: string): Promise<ApiResult<null>> {
  return apiRequest<null>(`/admin/notification-channels/${encodeURIComponent(channelId)}/test`, {
    method: 'POST',
  });
}

export function fetchNotificationRules(
  signal?: AbortSignal,
): Promise<ApiResult<NotificationRuleDto[]>> {
  return apiRequest<NotificationRuleDto[]>('/admin/notification-rules', { signal });
}

export function createNotificationRule(
  input: CreateNotificationRuleInput,
): Promise<ApiResult<NotificationRuleDto>> {
  return apiRequest<NotificationRuleDto>('/admin/notification-rules', {
    method: 'POST',
    json: input,
  });
}

export function updateNotificationRule(
  ruleId: string,
  input: UpdateNotificationRuleInput,
): Promise<ApiResult<NotificationRuleDto>> {
  return apiRequest<NotificationRuleDto>(
    `/admin/notification-rules/${encodeURIComponent(ruleId)}`,
    { method: 'PATCH', json: input },
  );
}

export function deleteNotificationRule(ruleId: string): Promise<ApiResult<null>> {
  return apiRequest<null>(`/admin/notification-rules/${encodeURIComponent(ruleId)}`, {
    method: 'DELETE',
  });
}

export function fetchNotificationDeliveries(
  limit: number,
  signal?: AbortSignal,
): Promise<ApiResult<NotificationDeliveryDto[]>> {
  return apiRequest<NotificationDeliveryDto[]>('/admin/notification-deliveries', {
    query: { limit },
    signal,
  });
}

// ---------------------------------------------------------------------------
// Systemweite Ankündigungen (Lastenheft §3.6)
// ---------------------------------------------------------------------------

export function fetchAnnouncements(signal?: AbortSignal): Promise<ApiResult<AnnouncementDto[]>> {
  return apiRequest<AnnouncementDto[]>('/admin/announcements', { signal });
}

export function createAnnouncement(
  input: CreateAnnouncementInput,
): Promise<ApiResult<AnnouncementDto>> {
  return apiRequest<AnnouncementDto>('/admin/announcements', { method: 'POST', json: input });
}

export function updateAnnouncement(
  announcementId: string,
  input: UpdateAnnouncementInput,
): Promise<ApiResult<AnnouncementDto>> {
  return apiRequest<AnnouncementDto>(
    `/admin/announcements/${encodeURIComponent(announcementId)}`,
    { method: 'PATCH', json: input },
  );
}

export function deleteAnnouncement(announcementId: string): Promise<ApiResult<null>> {
  return apiRequest<null>(`/admin/announcements/${encodeURIComponent(announcementId)}`, {
    method: 'DELETE',
  });
}

// ---------------------------------------------------------------------------
// Moderation: ausschließlich gemeldete Nachrichten (Pflichtenheft §15)
// ---------------------------------------------------------------------------

/**
 * Gemeldete Nachrichten (Pflichtenheft §15).
 *
 * Es gibt bewusst **keinen** Endpunkt für Konversationen, Verläufe oder eine
 * Suche über Nachrichten – die Ansicht darf einen solchen also auch nicht
 * erwarten (WORK_STATUS.md, Gefundener Punkt 73).
 */
export function fetchMessageReports(
  query: MessageReportQuery,
  signal?: AbortSignal,
): Promise<ApiResult<MessageReportPageDto>> {
  return apiRequest<MessageReportPageDto>('/api/moderation/reports', { query, signal });
}

export function resolveMessageReport(
  reportId: string,
  input: ResolveMessageReportInput,
): Promise<ApiResult<MessageReportDto>> {
  return apiRequest<MessageReportDto>(
    `/api/moderation/reports/${encodeURIComponent(reportId)}/resolve`,
    { method: 'POST', json: input },
  );
}
