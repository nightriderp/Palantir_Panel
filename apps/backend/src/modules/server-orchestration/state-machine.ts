/**
 * State Machine des Server-Lifecycles (Pflichtenheft §9).
 *
 * Die Tabelle der erlaubten Übergänge steht in `@palantir/contracts`
 * (`SERVER_STATUS_TRANSITIONS`), damit Frontend und Backend dieselbe Auslegung
 * sehen. Hier steht, **welches Ereignis** welchen Übergang auslöst und was
 * dabei an den begleitenden Feldern passiert (Zeitstempel, Absturzhistorie,
 * Meldungstext).
 *
 * Zwei Regeln, die diese Datei erzwingt und die nirgendwo sonst umgangen
 * werden dürfen:
 *
 * 1. **`starting → running` nur nach bestandenem Health-Check.** Es gibt kein
 *    Ereignis, das aus einem gestarteten Prozess allein `running` macht
 *    (Lastenheft §3.3, Pflichtenheft §9).
 * 2. **Ein automatischer Neustart nach Absturz ist ein regulärer Serverstart.**
 *    Er setzt `lastStartedAt` neu und damit die Schonfrist des Auto-Shutdown
 *    (Pflichtenheft §9) – sonst würde ein gerade wiederhergestellter Server
 *    sofort fälschlich als inaktiv erkannt und erneut abgeschaltet.
 *
 * Die Datei kennt weder Datenbank noch Agent: sie bildet einen Zustand auf
 * einen neuen Zustand ab und ist vollständig ohne Infrastruktur testbar
 * (CLAUDE.md §4).
 */

import {
  type ServerStatus,
  isAllowedServerStatusTransition,
  isServerStatus,
} from '@palantir/contracts';
import {
  type CrashLoopPolicy,
  DEFAULT_CRASH_LOOP_POLICY,
  clearCrashHistory,
  registerCrash,
} from './crash-loop.js';
import { ServerOrchestrationError } from './errors.js';

/**
 * Der Teil eines Servers, den der Lifecycle verwaltet.
 *
 * Bewusst ein eigener, kleiner Zustand statt der ganzen Zeile aus der
 * Datenbank: so lässt sich jeder Übergang als reine Werteabbildung prüfen.
 */
export interface ServerLifecycleState {
  readonly status: ServerStatus;
  /** Erläuterung zum Status; `null`, wenn es nichts zu erläutern gibt. */
  readonly statusMessage: string | null;
  /** ISO-8601-Zeitstempel des letzten Zustandswechsels. */
  readonly statusChangedAt: string;
  /** ISO-8601-Zeitstempel des letzten **erfolgreichen** Starts. */
  readonly lastStartedAt: string | null;
  /** Absturz-Zeitpunkte im gleitenden Fenster des Crash-Loop-Schutzes. */
  readonly crashTimestamps: readonly string[];
}

/**
 * Auslöser eines Übergangs.
 *
 * Die Namen beschreiben, **was passiert ist**, nicht den Zielzustand – so
 * bleibt an einer Stelle sichtbar, dass etwa ein gescheiterter Health-Check und
 * ein misslungenes Anlegen beide in `error` münden, aber verschiedene Ursachen
 * haben.
 */
export type ServerLifecycleEvent =
  /** Anlegen des Containers auf dem Homeserver ist gelungen. */
  | { readonly type: 'createSucceeded' }
  /** Anlegen ist fehlgeschlagen (Image fehlt, Name belegt, Engine weg). */
  | { readonly type: 'createFailed'; readonly reason: string }
  /** Ein Nutzer (oder ein Zeitplan) hat den Start angestoßen. */
  | { readonly type: 'startRequested' }
  /**
   * Automatischer Neustart nach einem Absturz (der Crash-Loop-Schutz hat ihn
   * freigegeben). Bewusst als eigenes Ereignis, damit im Log erkennbar bleibt,
   * dass niemand den Knopf gedrückt hat.
   */
  | { readonly type: 'automaticRestartRequested'; readonly attempt: number }
  /** Health-Check bestanden – erst hier gilt der Server als `running`. */
  | { readonly type: 'healthCheckPassed' }
  /** Health-Check innerhalb der Startfrist nicht bestanden. */
  | { readonly type: 'healthCheckFailed'; readonly reason: string }
  /** Ein Nutzer (oder der Auto-Shutdown) hat das Stoppen angestoßen. */
  | { readonly type: 'stopRequested' }
  /** Container ist beendet. */
  | { readonly type: 'stopSucceeded' }
  /** Container ließ sich auch mit SIGKILL nicht beenden. */
  | { readonly type: 'stopFailed'; readonly reason: string }
  /** Container ist unerwartet beendet worden. */
  | { readonly type: 'crashed'; readonly reason: string; readonly exitCode: number | null }
  /**
   * Soll/Ist-Abgleich hat den Container sauber beendet vorgefunden
   * (Pflichtenheft §2.2).
   */
  | { readonly type: 'observedStopped'; readonly reason: string }
  /** Ein Vorgang ist endgültig gescheitert; der Server braucht Zuwendung. */
  | { readonly type: 'failed'; readonly reason: string }
  /** Ein Nutzer quittiert einen Fehler- oder Absturzzustand. */
  | { readonly type: 'acknowledged' };

export interface TransitionOptions {
  /** Zeitpunkt des Übergangs. Wird hereingereicht, damit Tests ihn festlegen können. */
  readonly now: Date;
  readonly crashLoopPolicy?: CrashLoopPolicy;
}

export interface TransitionResult {
  readonly state: ServerLifecycleState;
  /**
   * `true`, wenn der Crash-Loop-Schutz bei diesem Übergang ausgelöst hat.
   *
   * Der Aufrufer startet dann **nicht** automatisch neu und verschickt die
   * Benachrichtigung (`server.failed`, Pflichtenheft §9).
   */
  readonly crashLoopTripped: boolean;
  /**
   * `true`, wenn der Aufrufer nach diesem Übergang einen automatischen
   * Neustart anstoßen soll.
   */
  readonly shouldAutoRestart: boolean;
  /** Nummer des anstehenden automatischen Versuchs; `0`, wenn keiner ansteht. */
  readonly nextRestartAttempt: number;
}

/** Startzustand eines gerade angelegten Servers (Pflichtenheft §9). */
export function initialLifecycleState(now: Date): ServerLifecycleState {
  return {
    status: 'creating',
    statusMessage: null,
    statusChangedAt: now.toISOString(),
    lastStartedAt: null,
    crashTimestamps: [],
  };
}

/**
 * Prüft einen Übergang gegen die Tabelle aus den Contracts und bricht sonst mit
 * `SERVER_STATE_CONFLICT` ab.
 *
 * Wird auch direkt aufgerufen, bevor ein Befehl an den Agent geht: der Start
 * eines bereits laufenden Servers soll gar nicht erst auf dem Homeserver
 * ankommen.
 */
export function assertTransitionAllowed(from: ServerStatus, to: ServerStatus): void {
  if (!isAllowedServerStatusTransition(from, to)) {
    throw new ServerOrchestrationError(
      'SERVER_STATE_CONFLICT',
      `Der Übergang von "${from}" nach "${to}" ist nicht zulässig.`,
      { from, to },
    );
  }
}

/** Zielzustand eines Ereignisses – unabhängig davon, ob er von hier erreichbar ist. */
function targetStatusFor(event: ServerLifecycleEvent): ServerStatus {
  switch (event.type) {
    case 'createSucceeded':
      return 'stopped';
    case 'createFailed':
      return 'error';
    case 'startRequested':
    case 'automaticRestartRequested':
      return 'starting';
    case 'healthCheckPassed':
      return 'running';
    case 'healthCheckFailed':
      return 'error';
    case 'stopRequested':
      return 'stopping';
    case 'stopSucceeded':
    case 'observedStopped':
    case 'acknowledged':
      return 'stopped';
    case 'stopFailed':
    case 'failed':
      return 'error';
    case 'crashed':
      return 'crashed';
  }
}

/** Begleittext zum Zielzustand; `null`, wenn es nichts zu erläutern gibt. */
function messageFor(event: ServerLifecycleEvent): string | null {
  switch (event.type) {
    case 'createFailed':
    case 'healthCheckFailed':
    case 'stopFailed':
    case 'failed':
    case 'observedStopped':
      return event.reason;
    case 'crashed':
      return event.exitCode === null
        ? event.reason
        : `${event.reason} (Exit-Code ${String(event.exitCode)})`;
    case 'automaticRestartRequested':
      return `Automatischer Neustart nach Absturz (Versuch ${String(event.attempt)}).`;
    default:
      return null;
  }
}

/**
 * Wendet ein Ereignis auf den Zustand an.
 *
 * Wirft `SERVER_STATE_CONFLICT`, wenn der resultierende Übergang laut Tabelle
 * unzulässig ist. Ein Ereignis, das den Zustand nicht ändert (z. B. ein zweites
 * `crashed` für denselben Absturz), wird dadurch ebenfalls abgelehnt statt still
 * geschluckt: doppelte Meldungen sollen auffallen, nicht die Absturzhistorie
 * aufblähen.
 */
export function applyLifecycleEvent(
  state: ServerLifecycleState,
  event: ServerLifecycleEvent,
  options: TransitionOptions,
): TransitionResult {
  const { now } = options;
  const policy = options.crashLoopPolicy ?? DEFAULT_CRASH_LOOP_POLICY;
  const target = targetStatusFor(event);

  assertTransitionAllowed(state.status, target);

  const base: ServerLifecycleState = {
    status: target,
    statusMessage: messageFor(event),
    statusChangedAt: now.toISOString(),
    lastStartedAt: state.lastStartedAt,
    crashTimestamps: state.crashTimestamps,
  };

  if (event.type === 'crashed') {
    const evaluation = registerCrash(state.crashTimestamps, now, policy);

    return {
      state: { ...base, crashTimestamps: evaluation.crashTimestamps },
      crashLoopTripped: evaluation.tripped,
      shouldAutoRestart: !evaluation.tripped,
      nextRestartAttempt: evaluation.tripped ? 0 : evaluation.recentCrashCount,
    };
  }

  if (event.type === 'healthCheckPassed') {
    // Erst der bestandene Health-Check gilt als erfolgreicher Start: er setzt
    // sowohl die Schonfrist des Auto-Shutdown als auch die Absturzhistorie neu.
    return {
      state: {
        ...base,
        lastStartedAt: now.toISOString(),
        crashTimestamps: clearCrashHistory(),
      },
      crashLoopTripped: false,
      shouldAutoRestart: false,
      nextRestartAttempt: 0,
    };
  }

  if (event.type === 'acknowledged') {
    // Quittieren räumt die Absturzhistorie ab – jemand hat hingesehen.
    return {
      state: { ...base, crashTimestamps: clearCrashHistory() },
      crashLoopTripped: false,
      shouldAutoRestart: false,
      nextRestartAttempt: 0,
    };
  }

  return {
    state: base,
    crashLoopTripped: false,
    shouldAutoRestart: false,
    nextRestartAttempt: 0,
  };
}

/**
 * Liest einen Zustandswert aus der Datenbank ein.
 *
 * Ein unbekannter Wert wird zu `error` statt zu einem Absturz beim Lesen: eine
 * zurückgerollte Migration oder ein handgeschriebener Wert soll die Serverliste
 * nicht unbenutzbar machen.
 */
export function parseServerStatus(value: string): ServerStatus {
  return isServerStatus(value) ? value : 'error';
}
