import {
  NOTIFIABLE_EVENTS,
  NOTIFICATION_SEVERITIES,
  type NotifiableEventName,
  type NotificationDto,
  type NotificationPageDto,
  type NotificationSeverity,
  type NotificationSubject,
} from '@palantir/contracts';
import { type IconName, type Tone } from '@/components/shared';

/**
 * Reine Logik der Benachrichtigungs-Ansicht (Arbeitspaket F6).
 *
 * Beschriftungen, Filter und die Fortschreibung der geladenen Seite stehen hier
 * ohne React, damit sie prüfbar sind (CLAUDE.md §4). Titel und Text einer
 * Meldung entstehen **nicht** hier: Sie kommen fertig aus dem Backend
 * (`NotificationDto.title`/`body`, Pflichtenheft §5.2) und werden nur angezeigt.
 */

// ---------------------------------------------------------------------------
// Beschriftungen
// ---------------------------------------------------------------------------

/**
 * Deutscher Name je Ereignis (Lastenheft §4).
 *
 * `Record` über `NotifiableEventName` statt einer lockeren Zuordnung: Kommt ein
 * Ereignis zu `NOTIFIABLE_EVENTS` dazu, scheitert die Übersetzung, statt in der
 * Filterliste still als roher Ereignisname aufzutauchen.
 */
export const NOTIFICATION_EVENT_LABELS: Record<NotifiableEventName, string> = {
  'server.created': 'Server erstellt',
  'server.started': 'Server gestartet',
  'server.stopped': 'Server gestoppt',
  'server.restarted': 'Server neu gestartet',
  'server.crashed': 'Server abgestürzt',
  'server.failed': 'Server im Fehlerzustand',
  'server.cloned': 'Server geklont',
  'server.deleted': 'Server gelöscht',
  'autoShutdown.triggered': 'Automatisch abgeschaltet',
  'backup.failed': 'Backup fehlgeschlagen',
  'resource.low': 'Ressourcen werden knapp',
  'user.registered': 'Neue Registrierung',
  'message.reported': 'Nachricht gemeldet',
  'announcement.published': 'Ankündigung',
};

export const NOTIFICATION_SEVERITY_LABELS: Record<NotificationSeverity, string> = {
  info: 'Information',
  warning: 'Warnung',
  error: 'Fehler',
};

/** Farbliche Einordnung über die `Tone`-Skala aus F2. */
export const NOTIFICATION_SEVERITY_TONES: Record<NotificationSeverity, Tone> = {
  info: 'neutral',
  warning: 'warning',
  error: 'danger',
};

// ---------------------------------------------------------------------------
// Gruppen
// ---------------------------------------------------------------------------

export type NotificationGroupKey =
  'server' | 'autoShutdown' | 'backup' | 'resource' | 'account' | 'announcement';

export interface NotificationGroup {
  key: NotificationGroupKey;
  label: string;
  description: string;
  icon: IconName;
  events: readonly NotifiableEventName[];
}

/**
 * Ereignisse zu Themen zusammengefasst.
 *
 * Der Einstellungs-Reiter arbeitet auf Gruppen statt auf einzelnen Ereignissen:
 * Vierzehn Schalter wären auf einem Smartphone unbrauchbar, und „Serverstatus"
 * ist das, was jemand tatsächlich an- oder abschalten will. Die Aufteilung
 * folgt der Nennung im Lastenheft §3.6 („Serverstatus, Backup-Fehler,
 * automatisches Abschalten, neue Registrierungen, Ressourcen-Warnungen").
 *
 * Jedes Ereignis aus `NOTIFIABLE_EVENTS` steht in genau einer Gruppe – geprüft
 * in `notificationView.test.ts`.
 */
export const NOTIFICATION_GROUPS: readonly NotificationGroup[] = [
  {
    key: 'server',
    label: 'Serverstatus',
    description: 'Start, Stopp, Neustart, Absturz, Fehlerzustand, Anlegen und Löschen.',
    icon: 'server',
    events: [
      'server.created',
      'server.started',
      'server.stopped',
      'server.restarted',
      'server.crashed',
      'server.failed',
      'server.cloned',
      'server.deleted',
    ],
  },
  {
    key: 'autoShutdown',
    label: 'Automatisches Abschalten',
    description: 'Ein Server wurde nach längerem Leerlauf von allein gestoppt.',
    icon: 'clock',
    events: ['autoShutdown.triggered'],
  },
  {
    key: 'backup',
    label: 'Backup-Fehler',
    description: 'Eine Sicherung wurde nicht abgeschlossen.',
    icon: 'database',
    events: ['backup.failed'],
  },
  {
    key: 'resource',
    label: 'Ressourcen-Warnungen',
    description: 'Arbeitsspeicher, CPU oder Speicherplatz erreichen die Warnschwelle.',
    icon: 'warning',
    events: ['resource.low'],
  },
  {
    key: 'account',
    label: 'Konten und Moderation',
    description: 'Neue Registrierungen und gemeldete Nachrichten.',
    icon: 'users',
    events: ['user.registered', 'message.reported'],
  },
  {
    key: 'announcement',
    label: 'Ankündigungen',
    description: 'Systemweite Hinweise der Administration, etwa zu Wartungsarbeiten.',
    icon: 'bell',
    events: ['announcement.published'],
  },
];

const GROUP_BY_EVENT = new Map<NotifiableEventName, NotificationGroup>(
  NOTIFICATION_GROUPS.flatMap((group) => group.events.map((event) => [event, group] as const)),
);

/** Gruppe eines Ereignisses; `null`, wenn es keiner zugeordnet ist. */
export function groupOfEvent(event: NotifiableEventName): NotificationGroup | null {
  return GROUP_BY_EVENT.get(event) ?? null;
}

/** Symbol einer Meldung – das ihrer Gruppe, sonst die Glocke. */
export function iconOfEvent(event: NotifiableEventName): IconName {
  return groupOfEvent(event)?.icon ?? 'bell';
}

// ---------------------------------------------------------------------------
// Sprung an die betroffene Stelle
// ---------------------------------------------------------------------------

/**
 * Route zur betroffenen Ressource; `null`, wenn es (noch) keine gibt.
 *
 * Die Ansichten der übrigen Subject-Typen stehen inzwischen (Punkt 92): Backups
 * (F4), gemeldete Nachrichten und Konten (F10) sowie Nodes (F7). Verlinkt wird
 * nur auf **bestehende** Routen, und nur auf solche, die der jeweilige Empfänger
 * auch erreichen kann:
 *
 * - `server` behält als einziger Typ ein Detail-Ziel (`servers/[serverId]`).
 * - `backup` → `/my-backups`: `backup.failed` erreicht den Besitzer, dessen
 *   globale Sicherungsübersicht das ist. Ein Deep-Link auf eine einzelne
 *   Sicherung gibt es (noch) nicht – die Ansicht kennt keine Detailroute.
 * - `node` → `/nodes` (Nutzersicht, nicht `/admin/nodes`): Eine Node-Warnung
 *   (`resource.low`, `scope: 'node'`) kann den Node-Besitzer treffen, der die
 *   Admin-Route nicht öffnen darf.
 * - `user` → `/admin/users` und `message` → `/admin/moderation`:
 *   `user.registered` und `message.reported` sind Admin-/Moderationsvorgänge.
 * - `announcement` bleibt `null`: Die Ankündigung ist selbst die Meldung (Banner
 *   und Inbox-Eintrag); die Verwaltung unter `/admin/announcements` ist reine
 *   Admin-Sicht und kein Sprungziel für Empfänger.
 *
 * Kein Typ verlinkt heute auf einen konkreten Eintrag (außer `server`): Die
 * Listenansichten heben den betroffenen Datensatz noch nicht hervor – als
 * Anschlussarbeit unter „Gefundene Punkte" vermerkt.
 */
export function subjectHref(subject: NotificationSubject | null): string | null {
  if (subject === null) return null;

  switch (subject.type) {
    case 'server':
      return `/servers/${encodeURIComponent(subject.id)}`;
    case 'backup':
      return '/my-backups';
    case 'node':
      return '/nodes';
    case 'user':
      return '/admin/users';
    case 'message':
      return '/admin/moderation';
    case 'announcement':
      return null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

export interface InboxFilter {
  unreadOnly: boolean;
  /** `null` = jedes Ereignis. */
  event: NotifiableEventName | null;
  /** `null` = jede Dringlichkeit. */
  severity: NotificationSeverity | null;
}

export const EMPTY_INBOX_FILTER: InboxFilter = {
  unreadOnly: false,
  event: null,
  severity: null,
};

/**
 * Passt eine Meldung auf den aktuellen Filter?
 *
 * Gebraucht wird das für Meldungen, die über den Live-Kanal hereinkommen: Sie
 * dürfen die Liste nur ergänzen, wenn sie auch beim Nachladen dabei wären.
 */
export function matchesInboxFilter(notification: NotificationDto, filter: InboxFilter): boolean {
  if (filter.unreadOnly && notification.readAt !== null) return false;
  if (filter.event !== null && notification.event !== filter.event) return false;
  if (filter.severity !== null && notification.severity !== filter.severity) return false;
  return true;
}

/** Auswahl für das Ereignis-Feld der Filterleiste, alphabetisch nach Beschriftung. */
export function eventFilterOptions(): ReadonlyArray<{ value: string; label: string }> {
  return [...NOTIFIABLE_EVENTS]
    .map((event) => ({ value: event, label: NOTIFICATION_EVENT_LABELS[event] }))
    .sort((left, right) => left.label.localeCompare(right.label, 'de'));
}

/** Auswahl für das Dringlichkeits-Feld, von leise nach laut. */
export function severityFilterOptions(): ReadonlyArray<{ value: string; label: string }> {
  return NOTIFICATION_SEVERITIES.map((severity) => ({
    value: severity,
    label: NOTIFICATION_SEVERITY_LABELS[severity],
  }));
}

// ---------------------------------------------------------------------------
// Fortschreibung der geladenen Seite
// ---------------------------------------------------------------------------

/**
 * Eine über den Live-Kanal gemeldete Meldung einarbeiten.
 *
 * Der Zähler kommt immer aus dem Frame – das Backend führt ihn, nicht der
 * Browser. Die Meldung selbst wird nur aufgenommen, wenn sie zum Filter passt;
 * andernfalls bliebe eine Liste „nur ungelesene, Ereignis X" nicht mehr das,
 * was ihre Beschriftung verspricht.
 */
export function prependNotification(
  page: NotificationPageDto,
  notification: NotificationDto,
  unreadCount: number,
  filter: InboxFilter,
): NotificationPageDto {
  if (!matchesInboxFilter(notification, filter)) {
    return { ...page, unreadCount };
  }

  const known = page.entries.some((entry) => entry.id === notification.id);
  if (known) {
    return {
      ...page,
      unreadCount,
      entries: page.entries.map((entry) => (entry.id === notification.id ? notification : entry)),
    };
  }

  return {
    ...page,
    unreadCount,
    total: page.total + 1,
    entries: [notification, ...page.entries],
  };
}

/**
 * Gelesen-Zustand ohne erneutes Laden nachziehen.
 *
 * `ids: null` steht für „alle" – dann gilt der Vorgang serverseitig auch für
 * Meldungen außerhalb des geladenen Ausschnitts, und der Zähler fällt auf 0.
 * Bei einer Auswahl wird nur um die tatsächlich umgeschalteten Meldungen
 * verrechnet, damit ein zweiter Klick den Zähler nicht ein zweites Mal senkt.
 */
export function setReadState(
  page: NotificationPageDto,
  ids: readonly string[] | null,
  read: boolean,
  at: string,
): NotificationPageDto {
  const readAt = read ? at : null;

  if (ids === null) {
    return {
      ...page,
      unreadCount: read ? 0 : page.entries.length,
      entries: page.entries.map((entry) => ({ ...entry, readAt })),
    };
  }

  const selected = new Set(ids);
  let changed = 0;

  const entries = page.entries.map((entry) => {
    if (!selected.has(entry.id)) return entry;
    if ((entry.readAt !== null) === read) return entry;

    changed += 1;
    return { ...entry, readAt };
  });

  const unreadCount = read ? page.unreadCount - changed : page.unreadCount + changed;

  return { ...page, entries, unreadCount: Math.max(0, unreadCount) };
}

/** Eine gelöschte Meldung aus dem geladenen Ausschnitt nehmen. */
export function withoutNotification(
  page: NotificationPageDto,
  notificationId: string,
): NotificationPageDto {
  const removed = page.entries.find((entry) => entry.id === notificationId);
  if (!removed) return page;

  return {
    ...page,
    entries: page.entries.filter((entry) => entry.id !== notificationId),
    total: Math.max(0, page.total - 1),
    unreadCount: removed.readAt === null ? Math.max(0, page.unreadCount - 1) : page.unreadCount,
  };
}

/**
 * Nachgeladene Seite anhängen.
 *
 * Doppelte werden verworfen: Zwischen zwei Aufrufen kann eine neue Meldung
 * hereingekommen und alles um eine Position verschoben haben – ohne diese
 * Prüfung stünde derselbe Eintrag zweimal in der Liste. Zähler, `limit` und
 * `offset` kommen aus der neueren Antwort.
 */
export function appendPage(
  page: NotificationPageDto,
  next: NotificationPageDto,
): NotificationPageDto {
  const known = new Set(page.entries.map((entry) => entry.id));

  return {
    ...next,
    entries: [...page.entries, ...next.entries.filter((entry) => !known.has(entry.id))],
  };
}

/** Sind noch weitere Meldungen zu holen? */
export function hasMore(page: NotificationPageDto): boolean {
  return page.entries.length < page.total;
}

// ---------------------------------------------------------------------------
// Systemweite Ankündigungen (Lastenheft §3.6)
// ---------------------------------------------------------------------------

/**
 * Ungelesene Ankündigungen aus dem geladenen Ausschnitt, neueste zuerst.
 *
 * Eine Ankündigung erreicht das Konto als ganz normale Meldung mit dem Ereignis
 * `announcement.published` (siehe `renderNotification` in B6) – es braucht dafür
 * also keinen zweiten Abruf. Sie steht zusätzlich als Banner über der Liste,
 * solange sie ungelesen ist; „Verstanden" markiert sie als gelesen und lässt
 * das Banner verschwinden. Der Eintrag selbst bleibt in der Inbox.
 */
export function unreadAnnouncements(
  page: NotificationPageDto | null,
  limit = 3,
): NotificationDto[] {
  if (page === null) return [];

  return page.entries
    .filter((entry) => entry.event === 'announcement.published' && entry.readAt === null)
    .slice(0, limit);
}
