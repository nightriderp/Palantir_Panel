import {
  type BackupDto,
  type GameServerDto,
  type HostNodeStatus,
  type NodeResourceUsage,
  type NodeResources,
  type GameTypeDto,
  type ScheduleDto,
  type ServerCloneJobDto,
  type ServerFileContentDto,
  type ServerFileListDto,
  type ServerMemberDto,
  type ServerStatsHistoryDto,
  type SubdomainAvailabilityDto,
  type UserResourceLimitDto,
} from '@palantir/contracts';
import {
  type CloneServerInput,
  type CreateBackupInput,
  type CreateServerExportInput,
  type CreateServerInput,
  type ScheduleInput,
  type ServerMemberInput,
  type UpdateServerSettingsInput,
} from '@palantir/validation';
import { API_BASE_URL, type ApiResult, apiRequest } from './client';

/**
 * REST-Endpunkte rund um Gameserver (Lastenheft §3.3).
 *
 * Alle Pfade an einer Stelle, damit keine Ansicht eine URL selbst zusammenbaut.
 * Die Endpunkte entstehen im Arbeitspaket B3 (Server-Orchestrierung) und B5
 * (Backups); die Namen folgen der Ressourcen-Schreibweise der bereits
 * bestehenden Routen.
 *
 * Ergebnisse sind immer der Response-Envelope aus Pflichtenheft §5.1 – hier
 * wird nichts ausgepackt und nichts geworfen.
 */

/**
 * Node der Ziel-Auswahl im Wizard (Entität `HostNode`, Pflichtenheft §6).
 *
 * Aufgebaut aus den Typen von B4 (`HostNodeStatus`, `NodeResources`,
 * `NodeResourceUsage`) statt aus eigenen Zahlenfeldern. Einen vollständigen
 * `HostNodeDto` gibt es in den Contracts noch nicht; sobald B8 ihn dort anlegt,
 * ersetzt er diese Zwischenform (siehe „Gefundene Punkte").
 */
export interface HostNodeOptionDto {
  id: string;
  name: string;
  status: HostNodeStatus;
  total: NodeResources;
  usage: NodeResourceUsage;
}

/**
 * Freie Ressourcen einer Node.
 *
 * RAM und CPU zählen nur laufende Server, Speicherplatz alle – dieselbe
 * Zählweise wie in `NodeResourceUsage` (Pflichtenheft §10).
 */
export function freeNodeResources(node: HostNodeOptionDto): NodeResources {
  return {
    ramMb: Math.max(0, node.total.ramMb - node.usage.runningRamMb),
    cpuCores: Math.max(0, node.total.cpuCores - node.usage.runningCpuCores),
    diskMb: Math.max(0, node.total.diskMb - node.usage.allocatedDiskMb),
  };
}

const SERVERS = '/servers';

function serverPath(serverId: string, suffix = ''): string {
  return `${SERVERS}/${encodeURIComponent(serverId)}${suffix}`;
}

// ---------------------------------------------------------------------------
// Übersicht und Detail
// ---------------------------------------------------------------------------

export function fetchServers(signal?: AbortSignal): Promise<ApiResult<GameServerDto[]>> {
  return apiRequest<GameServerDto[]>(SERVERS, { signal });
}

export function fetchServer(
  serverId: string,
  signal?: AbortSignal,
): Promise<ApiResult<GameServerDto>> {
  return apiRequest<GameServerDto>(serverPath(serverId), { signal });
}

/**
 * Verlauf der Messwerte für die Verlaufsdarstellung (Lastenheft §3.3).
 *
 * Die laufenden Werte kommen über den Live-Kanal; dieser Aufruf holt nur den
 * Rückblick beim Öffnen der Ansicht.
 */
export function fetchStatsHistory(
  serverId: string,
  windowMinutes: number,
  signal?: AbortSignal,
): Promise<ApiResult<ServerStatsHistoryDto>> {
  return apiRequest<ServerStatsHistoryDto>(serverPath(serverId, '/stats/history'), {
    query: { windowMinutes },
    signal,
  });
}

// ---------------------------------------------------------------------------
// Lifecycle (Pflichtenheft §9)
// ---------------------------------------------------------------------------

export type LifecycleAction = 'start' | 'stop' | 'restart';

export function runLifecycleAction(
  serverId: string,
  action: LifecycleAction,
): Promise<ApiResult<GameServerDto>> {
  return apiRequest<GameServerDto>(serverPath(serverId, `/${action}`), { method: 'POST' });
}

export function deleteServer(serverId: string): Promise<ApiResult<null>> {
  return apiRequest<null>(serverPath(serverId), { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Anlegen, Klonen, Exportieren
// ---------------------------------------------------------------------------

export function fetchGameTypes(signal?: AbortSignal): Promise<ApiResult<GameTypeDto[]>> {
  return apiRequest<GameTypeDto[]>('/game-types', { signal });
}

export function fetchHostNodes(signal?: AbortSignal): Promise<ApiResult<HostNodeOptionDto[]>> {
  return apiRequest<HostNodeOptionDto[]>('/nodes/available', { signal });
}

/**
 * Kontingent und Belegung des angemeldeten Kontos (Pflichtenheft §10).
 *
 * Der DTO stammt aus B4 und enthält neben den Grenzen immer auch die aktuelle
 * Belegung – der Wizard braucht beides, um „passt noch" zu beantworten.
 */
export function fetchResourceQuota(signal?: AbortSignal): Promise<ApiResult<UserResourceLimitDto>> {
  return apiRequest<UserResourceLimitDto>('/me/resource-quota', { signal });
}

/**
 * Verfügbarkeit einer Subdomain prüfen (Pflichtenheft §13).
 *
 * Format und Sperrliste prüft das Backend erneut – die Sofortmeldung im
 * Formular ersetzt die verbindliche Prüfung nicht.
 */
export function checkSubdomain(
  subdomain: string,
  signal?: AbortSignal,
): Promise<ApiResult<SubdomainAvailabilityDto>> {
  return apiRequest<SubdomainAvailabilityDto>('/subdomains/check', {
    query: { subdomain },
    signal,
  });
}

/**
 * Weltdaten-Archiv für die Übernahme hochladen (Lastenheft §3.3).
 *
 * Liefert die `uploadId`, die der Wizard anschließend in `worldImport` mitgibt.
 */
export function uploadWorldArchive(file: File): Promise<ApiResult<{ uploadId: string }>> {
  const form = new FormData();
  form.set('file', file);
  return apiRequest<{ uploadId: string }>('/uploads/world-archives', {
    method: 'POST',
    body: form,
  });
}

export function createServer(input: CreateServerInput): Promise<ApiResult<GameServerDto>> {
  return apiRequest<GameServerDto>(SERVERS, { method: 'POST', json: input });
}

export function cloneServer(
  serverId: string,
  input: CloneServerInput,
): Promise<ApiResult<ServerCloneJobDto>> {
  return apiRequest<ServerCloneJobDto>(serverPath(serverId, '/clone'), {
    method: 'POST',
    json: input,
  });
}

export function fetchCloneJob(
  serverId: string,
  jobId: string,
  signal?: AbortSignal,
): Promise<ApiResult<ServerCloneJobDto>> {
  return apiRequest<ServerCloneJobDto>(
    serverPath(serverId, `/clone/${encodeURIComponent(jobId)}`),
    { signal },
  );
}

// ---------------------------------------------------------------------------
// Einstellungen und Mitglieder
// ---------------------------------------------------------------------------

export function updateServerSettings(
  serverId: string,
  input: UpdateServerSettingsInput,
): Promise<ApiResult<GameServerDto>> {
  return apiRequest<GameServerDto>(serverPath(serverId, '/settings'), {
    method: 'PATCH',
    json: input,
  });
}

export function fetchMembers(
  serverId: string,
  signal?: AbortSignal,
): Promise<ApiResult<ServerMemberDto[]>> {
  return apiRequest<ServerMemberDto[]>(serverPath(serverId, '/members'), { signal });
}

export function addOrUpdateMember(
  serverId: string,
  input: ServerMemberInput,
): Promise<ApiResult<ServerMemberDto>> {
  return apiRequest<ServerMemberDto>(serverPath(serverId, '/members'), {
    method: 'PUT',
    json: input,
  });
}

export function removeMember(serverId: string, userId: string): Promise<ApiResult<null>> {
  return apiRequest<null>(serverPath(serverId, `/members/${encodeURIComponent(userId)}`), {
    method: 'DELETE',
  });
}

// ---------------------------------------------------------------------------
// Backups und vollständiger Export (Arbeitspaket B5)
// ---------------------------------------------------------------------------
//
// Die Pfade entsprechen den Routen, die B5 bereits gebaut hat
// (`apps/backend/src/modules/backups/routes.ts`): eine Sicherung wird unter dem
// Server angelegt, danach aber über ihre eigene Id angesprochen. Der
// vollständige Export ist dort kein eigener Auftragstyp, sondern ein
// `BackupDto` mit `isExport: true`.

function backupPath(backupId: string, suffix = ''): string {
  return `/backups/${encodeURIComponent(backupId)}${suffix}`;
}

export function fetchBackups(
  serverId: string,
  signal?: AbortSignal,
): Promise<ApiResult<BackupDto[]>> {
  return apiRequest<BackupDto[]>(serverPath(serverId, '/backups'), { signal });
}

/**
 * Sicherung anstoßen.
 *
 * `stopServer` hält den Server für die Dauer der Sicherung an – das ergibt ein
 * garantiert widerspruchsfreies Archiv, unterbricht aber das Spiel.
 */
export function createBackup(
  serverId: string,
  input: CreateBackupInput,
): Promise<ApiResult<BackupDto>> {
  return apiRequest<BackupDto>(serverPath(serverId, '/backups'), { method: 'POST', json: input });
}

export function restoreBackup(backupId: string): Promise<ApiResult<BackupDto>> {
  return apiRequest<BackupDto>(backupPath(backupId, '/restore'), { method: 'POST' });
}

export function deleteBackup(backupId: string): Promise<ApiResult<null>> {
  return apiRequest<null>(backupPath(backupId), { method: 'DELETE' });
}

/** Adresse zum Herunterladen eines Archivs – wird als Link geöffnet. */
export function backupDownloadUrl(backupId: string): string {
  return `${API_BASE_URL}${backupPath(backupId, '/download')}`;
}

/**
 * Vollständigen Export anstoßen (Lastenheft §3.3: Datenmitnahme).
 *
 * Ergebnis ist ein `BackupDto` mit `isExport: true`; Fortschritt und Download
 * laufen danach über dieselben Wege wie bei jeder anderen Sicherung.
 */
export function startExport(
  serverId: string,
  input: CreateServerExportInput,
): Promise<ApiResult<BackupDto>> {
  return apiRequest<BackupDto>(serverPath(serverId, '/export'), { method: 'POST', json: input });
}

export function fetchBackup(backupId: string, signal?: AbortSignal): Promise<ApiResult<BackupDto>> {
  return apiRequest<BackupDto>(backupPath(backupId), { signal });
}

// ---------------------------------------------------------------------------
// Geplante Aufgaben
// ---------------------------------------------------------------------------

export function fetchSchedules(
  serverId: string,
  signal?: AbortSignal,
): Promise<ApiResult<ScheduleDto[]>> {
  return apiRequest<ScheduleDto[]>(serverPath(serverId, '/schedules'), { signal });
}

export function createSchedule(
  serverId: string,
  input: ScheduleInput,
): Promise<ApiResult<ScheduleDto>> {
  return apiRequest<ScheduleDto>(serverPath(serverId, '/schedules'), {
    method: 'POST',
    json: input,
  });
}

export function updateSchedule(
  serverId: string,
  scheduleId: string,
  input: ScheduleInput,
): Promise<ApiResult<ScheduleDto>> {
  return apiRequest<ScheduleDto>(
    serverPath(serverId, `/schedules/${encodeURIComponent(scheduleId)}`),
    { method: 'PATCH', json: input },
  );
}

export function deleteSchedule(serverId: string, scheduleId: string): Promise<ApiResult<null>> {
  return apiRequest<null>(serverPath(serverId, `/schedules/${encodeURIComponent(scheduleId)}`), {
    method: 'DELETE',
  });
}

// ---------------------------------------------------------------------------
// Datei-Manager
// ---------------------------------------------------------------------------

export function fetchFileList(
  serverId: string,
  path: string,
  signal?: AbortSignal,
): Promise<ApiResult<ServerFileListDto>> {
  return apiRequest<ServerFileListDto>(serverPath(serverId, '/files'), {
    query: { path },
    signal,
  });
}

export function fetchFileContent(
  serverId: string,
  path: string,
  signal?: AbortSignal,
): Promise<ApiResult<ServerFileContentDto>> {
  return apiRequest<ServerFileContentDto>(serverPath(serverId, '/files/content'), {
    query: { path },
    signal,
  });
}

export function saveFileContent(
  serverId: string,
  path: string,
  content: string,
): Promise<ApiResult<ServerFileContentDto>> {
  return apiRequest<ServerFileContentDto>(serverPath(serverId, '/files/content'), {
    method: 'PUT',
    json: { path, content },
  });
}

/**
 * Datei hochladen.
 *
 * Die Größengrenze steht als `maxUploadBytes` in `ServerFileListDto` und kommt
 * damit vom Backend (Pflichtenheft §12.1) – sie wird nie im Frontend gesetzt.
 */
export function uploadFile(
  serverId: string,
  path: string,
  file: File,
): Promise<ApiResult<ServerFileListDto>> {
  const form = new FormData();
  form.set('path', path);
  form.set('file', file);
  return apiRequest<ServerFileListDto>(serverPath(serverId, '/files'), {
    method: 'POST',
    body: form,
  });
}

export function deleteFile(serverId: string, path: string): Promise<ApiResult<null>> {
  return apiRequest<null>(serverPath(serverId, '/files'), {
    method: 'DELETE',
    json: { path },
  });
}

/** Adresse zum Herunterladen einer einzelnen Datei – wird als Link geöffnet. */
export function fileDownloadUrl(serverId: string, path: string): string {
  return `${API_BASE_URL}${serverPath(serverId, '/files/download')}?path=${encodeURIComponent(path)}`;
}
