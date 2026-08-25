import { type ServerStatus } from '@palantir/contracts';
import { type Tone } from '../primitives/Badge';

/**
 * Darstellung der Server-Lifecycle-Zustände (Pflichtenheft §9).
 *
 * Einzige Stelle im Frontend, an der ein `ServerStatus` in Text und Farbe
 * übersetzt wird – F3–F11 greifen hierauf zu, statt eigene Zuordnungen zu bauen.
 * Beschriftungen sind Deutsch (Lastenheft §4).
 */
export interface ServerStatusMeta {
  /** Kurzform für Pillen und Listen. */
  label: string;
  /** Erläuterung für Tooltip/Detailkopf. */
  description: string;
  tone: Tone;
  /** Punkt pulsiert, solange etwas aktiv läuft oder gerade umschaltet. */
  pulse: boolean;
  /** Ein Lifecycle-Übergang läuft gerade (Fortschrittsbalken zeigen). */
  transitional: boolean;
  /** Störungszustand – Fehlerhinweis auf der Karte einblenden. */
  faulted: boolean;
}

export const SERVER_STATUS_META: Record<ServerStatus, ServerStatusMeta> = {
  creating: {
    label: 'Wird erstellt …',
    description: 'Der Server wird gerade angelegt.',
    tone: 'warning',
    pulse: true,
    transitional: true,
    faulted: false,
  },
  stopped: {
    label: 'Offline',
    description: 'Der Server ist gestoppt.',
    tone: 'neutral',
    pulse: false,
    transitional: false,
    faulted: false,
  },
  starting: {
    label: 'Startet …',
    description: 'Der Server startet – er gilt erst als online, wenn er erreichbar ist.',
    tone: 'warning',
    pulse: true,
    transitional: true,
    faulted: false,
  },
  running: {
    label: 'Online',
    description: 'Der Server läuft und ist erreichbar.',
    tone: 'success',
    pulse: true,
    transitional: false,
    faulted: false,
  },
  stopping: {
    label: 'Stoppt …',
    description: 'Der Server wird heruntergefahren.',
    tone: 'caution',
    pulse: true,
    transitional: true,
    faulted: false,
  },
  error: {
    label: 'Fehler',
    description: 'Der Server konnte nicht gestartet werden oder wurde abgeschaltet.',
    tone: 'danger',
    pulse: false,
    transitional: false,
    faulted: true,
  },
  crashed: {
    label: 'Abgestürzt',
    description: 'Der Server hat sich unerwartet beendet.',
    tone: 'danger',
    pulse: false,
    transitional: false,
    faulted: true,
  },
};

/** Zustandsbeschreibung zu einem Status. */
export function serverStatusMeta(status: ServerStatus): ServerStatusMeta {
  return SERVER_STATUS_META[status];
}

/**
 * Beschriftung der Start/Stopp-Schaltfläche.
 *
 * Läuft der Server oder fährt er gerade herunter, ist „Stoppen" die passende
 * Aktion – sonst „Starten".
 */
export function startStopAction(status: ServerStatus): 'start' | 'stop' {
  return status === 'running' || status === 'stopping' ? 'stop' : 'start';
}

/**
 * Darf die Start/Stopp-Schaltfläche gerade bedient werden?
 *
 * Während `creating`, `starting` und `stopping` läuft bereits ein Übergang;
 * ein zweiter Befehl würde nur eine weitere Korrelations-ID erzeugen
 * (Pflichtenheft §2.2). Die endgültige Prüfung macht immer das Backend.
 */
export function isLifecycleActionBlocked(status: ServerStatus): boolean {
  return SERVER_STATUS_META[status].transitional;
}

/** Liefert Live-Messwerte für diesen Zustand überhaupt sinnvolle Zahlen? */
export function hasLiveStats(status: ServerStatus): boolean {
  return status === 'running' || status === 'starting' || status === 'stopping';
}
