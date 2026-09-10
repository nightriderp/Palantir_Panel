import {
  type BackupStatus,
  type BackupType,
  type NotifiableEventName,
  type NotificationSeverity,
  type ResourceKind,
  type ResourceQuotaCounting,
  countingForResource,
} from '@palantir/contracts';
import { type Tone } from '../primitives/Badge';

/**
 * Deutsche Beschriftungen der Aufzählungen, die mehrere Arbeitspakete zeigen
 * (Lastenheft §4) – eine Tabelle je Aufzählung im Design-System (F2).
 *
 * **Warum hier.** Bis Audit frontend-lib-14 stand dieselbe Aufzählung mehrfach
 * im Frontend: die Ereignisnamen einmal im Regel-Editor der Verwaltung und
 * einmal in der Inbox („Serverstart fehlgeschlagen" gegen „Server im
 * Fehlerzustand" für dasselbe Ereignis), der Backup-Status sogar viermal
 * („Abgeschlossen" gegen „Fertig"). Wer eine Ansicht las, sah eine andere
 * Wortwahl als der Nutzer der nächsten – und ein neuer Wert musste an vier
 * Stellen nachgezogen werden. Analog zu `SERVER_STATUS_META` gibt es die
 * Übersetzung deshalb genau einmal, und alle Ansichten greifen darauf zu.
 *
 * `Record` über den Vertragstyp statt einer lockeren Zuordnung: Kommt ein Wert
 * hinzu, scheitert die Übersetzung beim Bauen, statt roh in der Anzeige zu
 * landen.
 *
 * Die Tabellen sind bewusst **Daten, keine Funktionen**: Ansichten, die eine
 * Auswahlliste aus allen Werten bauen, brauchen die Tabelle selbst; die
 * Kurzform `xLabel(wert)` steht dort, wo sie schon vorher stand
 * (`components/admin/labels.ts`).
 */

/**
 * Ereignisse der Benachrichtigungs-Engine (Arbeitspaket B6).
 *
 * Durchgehend als Rückschau formuliert („Server gestartet", nicht „Start des
 * Servers"): Die Liste beschreibt, was passiert ist – im Regel-Editor als
 * Auslöser, in der Inbox als Herkunft der Meldung.
 */
/**
 * Wie eine Belegung gezählt wird, in einem Halbsatz (Fundpunkt 210).
 *
 * Gemessen am laufenden System stand im selben Kontingent „RAM 8 GiB von
 * 16 GiB" neben „Platte 104 GiB von 10 GiB" – beides unter der Überschrift
 * „benutzt". Der Unterschied ist keine Ueberschreitung, sondern die andere
 * Zählregel: Die Platte zählt auch gestoppte Server, weil ihr Datenordner
 * liegen bleibt.
 *
 * Welche Regel für welche Ressource gilt, sagt der Vertrag
 * ({@link countingForResource}); hier steht nur, wie sie auf Deutsch heißt.
 */
export const QUOTA_COUNTING_LABELS: Record<ResourceQuotaCounting, string> = {
  running: 'laufende Server',
  all: 'alle Server, auch gestoppte',
};

/** Kurzform für {@link QUOTA_COUNTING_LABELS} über die Ressourcenart. */
export function quotaCountingLabel(resource: ResourceKind): string {
  return QUOTA_COUNTING_LABELS[countingForResource(resource)];
}

export const NOTIFIABLE_EVENT_LABELS: Record<NotifiableEventName, string> = {
  'server.created': 'Server erstellt',
  'server.started': 'Server gestartet',
  'server.stopped': 'Server gestoppt',
  'server.restarted': 'Server neu gestartet',
  'server.crashed': 'Server abgestürzt',
  // Das Ereignis meldet den Fehlerzustand, nicht nur einen misslungenen Start
  // (auch der Crash-Loop-Schutz löst es aus) – deshalb die weitere Formulierung.
  'server.failed': 'Server im Fehlerzustand',
  'server.cloned': 'Server geklont',
  'server.deleted': 'Server gelöscht',
  'autoShutdown.triggered': 'Automatisch abgeschaltet',
  'backup.failed': 'Backup fehlgeschlagen',
  'resource.low': 'Ressourcen werden knapp',
  'user.registered': 'Neue Registrierung',
  'message.reported': 'Nachricht gemeldet',
  'announcement.published': 'Ankündigung veröffentlicht',
};

/** Dringlichkeit einer Meldung – ausgeschrieben, keine Abkürzung. */
export const NOTIFICATION_SEVERITY_LABELS: Record<NotificationSeverity, string> = {
  info: 'Information',
  warning: 'Warnung',
  error: 'Fehler',
};

/**
 * Farbliche Einordnung über die `Tone`-Skala aus F2.
 *
 * `info` ist `neutral`: Eine Information ist der Normalfall und soll die
 * Aufmerksamkeit nicht mit den echten Warnungen teilen.
 */
export const NOTIFICATION_SEVERITY_TONES: Record<NotificationSeverity, Tone> = {
  info: 'neutral',
  warning: 'warning',
  error: 'danger',
};

/** Herkunft einer Sicherung (Lastenheft §3.3). */
export const BACKUP_TYPE_LABELS: Record<BackupType, string> = {
  manual: 'Manuell',
  automatic: 'Automatisch',
};

/**
 * Stand einer Sicherung samt Farbe.
 *
 * Laufende Vorgänge sind `warning` – dieselbe Lesart wie bei den
 * Zwischenzuständen der Server (`SERVER_STATUS_META`: „Wird erstellt …",
 * „Startet …"): etwas ist unterwegs, das Ergebnis steht noch aus.
 */
export const BACKUP_STATUS_META: Record<BackupStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Wartet', tone: 'warning' },
  running: { label: 'Läuft …', tone: 'warning' },
  completed: { label: 'Fertig', tone: 'success' },
  failed: { label: 'Fehlgeschlagen', tone: 'danger' },
};
