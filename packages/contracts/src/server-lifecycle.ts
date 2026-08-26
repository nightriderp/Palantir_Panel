/**
 * Server-Lifecycle (Pflichtenheft §9).
 *
 * Zustandsfolge: `creating → stopped → starting → running → stopping → stopped`,
 * zusätzlich `error` und `crashed`.
 *
 * Die Zustände sind bewusst kleingeschrieben, weil sie so auch in der Datenbank
 * geführt werden. Die deutschen Anzeigetexte gehören ins Frontend (F2), nicht in
 * die Contracts – hier steht nur der Vertrag.
 *
 * **Abgrenzung zum Agent-Protokoll:** Der Agent meldet in `agent-protocol.ts`
 * bewusst die beobachtbaren **Container**-Zustände (`running`, `exited`, …) und
 * nicht die Lifecycle-Zustände von hier. Der Lifecycle ist eine Auslegung des
 * Backends – ein Server gilt erst nach erfolgreichem Health-Check als `running`,
 * ein gestarteter Prozess allein reicht nicht. Die Zuordnung Container-Zustand →
 * Lifecycle-Zustand macht der Soll/Ist-Abgleich in B3.
 */
export const SERVER_STATUSES = [
  'creating',
  'stopped',
  'starting',
  'running',
  'stopping',
  'error',
  'crashed',
] as const;

export type ServerStatus = (typeof SERVER_STATUSES)[number];

export function isServerStatus(value: string): value is ServerStatus {
  return (SERVER_STATUSES as readonly string[]).includes(value);
}

/** Zustände, in denen gerade ein Übergang läuft (Lifecycle-Zwischenzustände). */
export const TRANSITIONAL_SERVER_STATUSES = ['creating', 'starting', 'stopping'] as const;

export type TransitionalServerStatus = (typeof TRANSITIONAL_SERVER_STATUSES)[number];

export function isTransitionalServerStatus(value: ServerStatus): boolean {
  return (TRANSITIONAL_SERVER_STATUSES as readonly ServerStatus[]).includes(value);
}

/** Zustände, die auf eine Störung hinweisen (Pflichtenheft §9). */
export const FAULTED_SERVER_STATUSES = ['error', 'crashed'] as const;

export type FaultedServerStatus = (typeof FAULTED_SERVER_STATUSES)[number];

export function isFaultedServerStatus(value: ServerStatus): boolean {
  return (FAULTED_SERVER_STATUSES as readonly ServerStatus[]).includes(value);
}

/**
 * Zustände, in denen der Server für Spieler erreichbar sein soll.
 *
 * Nur `running` – `starting` gilt ausdrücklich noch nicht als erreichbar
 * (Lastenheft §3.3: „Server gilt erst als 'läuft', wenn er nachweislich
 * erreichbar ist").
 */
export const REACHABLE_SERVER_STATUSES = ['running'] as const;

/**
 * Erlaubte Zustandsübergänge (Pflichtenheft §9).
 *
 * Steht in den Contracts, damit Backend (State Machine in B3) und Frontend
 * (Bedienelemente ausgrauen, F3) dieselbe Tabelle sehen und nicht zwei
 * Auslegungen entstehen. Verboten ist alles, was hier nicht steht.
 *
 * Begründung der einzelnen Kanten:
 * - `creating → stopped`: Container angelegt, aber noch nicht gestartet.
 * - `creating → error`: Anlegen fehlgeschlagen (Image fehlt, Name belegt, …).
 * - `starting → running`: **nur** nach erfolgreichem Health-Check.
 * - `starting → crashed`: Prozess ist während des Hochlaufs weggebrochen.
 * - `starting → error`: Health-Check ist endgültig gescheitert (Zeitüberschreitung).
 * - `running → crashed`: unerwartetes Beenden im Betrieb.
 * - `stopping → stopped`: regulär beendet; `stopping → error`, wenn selbst
 *   SIGKILL den Container nicht loswird.
 * - `crashed → starting`: automatischer Neustart-Versuch (Crash-Loop-Schutz).
 * - `crashed → error`: Crash-Loop-Schutz hat abgeschaltet.
 * - `crashed → stopped` und `error → stopped`: manuelles Quittieren bzw. ein
 *   Ist-Abgleich, der den Container sauber beendet vorfindet.
 * - `error → starting`: ein Nutzer darf einen Server im Fehlerzustand erneut
 *   starten, ohne ihn vorher löschen zu müssen.
 */
export const SERVER_STATUS_TRANSITIONS = {
  creating: ['stopped', 'error'],
  stopped: ['starting', 'error'],
  starting: ['running', 'stopping', 'crashed', 'error'],
  running: ['stopping', 'crashed', 'error'],
  stopping: ['stopped', 'error'],
  crashed: ['starting', 'stopped', 'error'],
  error: ['starting', 'stopped'],
} as const satisfies Record<ServerStatus, readonly ServerStatus[]>;

/** Prüft, ob ein Übergang laut Tabelle zulässig ist. */
export function isAllowedServerStatusTransition(from: ServerStatus, to: ServerStatus): boolean {
  return (SERVER_STATUS_TRANSITIONS[from] as readonly ServerStatus[]).includes(to);
}

/** Alle Folgezustände eines Zustands. */
export function allowedServerStatusTransitions(from: ServerStatus): readonly ServerStatus[] {
  return SERVER_STATUS_TRANSITIONS[from];
}
