/**
 * Der Zeitgeber des Backends – **eine** Stelle, die periodisch auslöst.
 *
 * Zwei fertige, einzeln getestete Abläufe brauchen einen Takt, bringen aber
 * bewusst keinen eigenen Timer mit:
 *
 * - `ServerOrchestrationService.runAutoShutdownSweep()` – ohne Aufruf schaltet
 *   sich kein Server je wegen Inaktivität ab (Lastenheft §3.3,
 *   Pflichtenheft §9)
 * - `BackupScheduleService.tick()` – ohne Aufruf laufen geplante Backups nie
 *   (Lastenheft §3.3)
 * - `ServerScheduleService.tick()` – dasselbe für geplante Neustarts und
 *   Konsolenbefehle (Lastenheft §3.3, Reiter „Aufgaben")
 * - `ServerOrchestrationService.sampleServerStats()` – ohne Aufruf entsteht nie
 *   ein Messwert-Verlauf (Lastenheft §3.3 „Verlaufsdarstellung")
 *
 * Beide bleiben ohne eigenen Timer, damit sie ohne Wartezeit prüfbar sind und
 * damit ein Skript oder ein Wartungs-Kommando denselben Ablauf anstoßen kann.
 * Der Takt gehört deshalb hierher – und zwar genau einmal: Zwei Timer im selben
 * Prozess wären zwei Stellen, an denen sich Intervall, Fehlerbehandlung und
 * Abschaltverhalten auseinanderentwickeln.
 *
 * **Warum eine Minute.** Beide Fälligkeiten sind minutengenau: Ein
 * Cron-Ausdruck (`cron.ts`) löst frühestens jede Minute aus, und die
 * Inaktivitäts- und Schonfristen des Auto-Shutdown sind in Minuten
 * konfiguriert. Ein größeres Intervall würde Cron-Minuten überspringen – ein
 * Zeitplan auf `30 3 * * *` liefe dann irgendwann, aber nicht um 03:30. Ein
 * kleineres Intervall brächte nichts: Zwischen zwei Minuten ändert sich an der
 * Fälligkeit nichts, der Lauf würde nur häufiger dieselbe leere Menge laden.
 *
 * **Verhalten bei Überschneidung.** Dauert ein Durchlauf länger als das
 * Intervall, wird der nächste **übersprungen**, nicht eingereiht. Beide
 * Aufgaben arbeiten nach Fälligkeitszeitpunkt und nicht nach Anzahl der Aufrufe:
 * Was in diesem Durchlauf nicht dran war, ist im nächsten immer noch fällig.
 * Eingereihte Läufe würden sich dagegen bei einem hängenden Homeserver
 * aufstauen und danach in einem Schwung dieselben Befehle mehrfach schicken.
 * Aus demselben Grund läuft der erste Durchlauf erst nach einem Intervall und
 * nicht sofort beim Start: Der Agent baut seine Verbindung nach einem Neustart
 * des Backends erst auf und meldet seinen Ist-Zustand (Pflichtenheft §2.2) –
 * ein Sweep in diese Lücke hinein könnte nichts ausrichten.
 *
 * Ein Fehler in einer Aufgabe beendet weder den Durchlauf noch den Zeitgeber:
 * Er wird protokolliert, die übrigen Aufgaben laufen weiter. Ein fehlerhafter
 * Auto-Shutdown darf keine geplanten Backups anhalten.
 */

import type { ResourceLowEvent } from '@palantir/contracts';

/** Eine Aufgabe, die der Zeitgeber periodisch anstößt. */
export interface ScheduledTask {
  /** Name für das Protokoll – erscheint bei Fehlern und im Debug-Log. */
  readonly name: string;
  run(): Promise<void>;
}

export interface SchedulerLogger {
  debug(details: Record<string, unknown>, message: string): void;
  warn(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

/** Was der Zeitgeber von `setInterval` braucht – austauschbar für Tests. */
export type TimerHandle = unknown;

export interface SchedulerTimer {
  set(handler: () => void, intervalMs: number): TimerHandle;
  clear(handle: TimerHandle): void;
}

export interface SchedulerOptions {
  readonly tasks: readonly ScheduledTask[];
  readonly intervalMs: number;
  readonly log: SchedulerLogger;
  /** Nur für Tests: eigener Zeitgeber statt `setInterval`. */
  readonly timer?: SchedulerTimer;
}

export interface Scheduler {
  /**
   * Ein Durchlauf über alle Aufgaben.
   *
   * Öffentlich, damit Tests und Wartungs-Kommandos denselben Weg nehmen wie der
   * Timer und nicht eine zweite Auslegung von „ein Durchlauf" mitbringen.
   * Läuft bereits ein Durchlauf, kehrt der Aufruf sofort zurück (siehe
   * Kopfkommentar).
   */
  runOnce(): Promise<void>;
  /** Beendet den Timer. Ein laufender Durchlauf wird nicht abgebrochen. */
  stop(): void;
}

/**
 * Zeitgeber auf Node-Timern.
 *
 * `unref()` hält den Prozess nicht am Leben: Ein Backend, das nur noch wegen
 * seines Zeitgebers läuft, ließe sich nicht mehr sauber beenden.
 */
const nodeTimer: SchedulerTimer = {
  set(handler, intervalMs) {
    const handle = setInterval(handler, intervalMs);
    handle.unref();

    return handle;
  },
  clear(handle) {
    clearInterval(handle as ReturnType<typeof setInterval>);
  },
};

export function startScheduler(options: SchedulerOptions): Scheduler {
  const { log, tasks } = options;
  const timer = options.timer ?? nodeTimer;

  let running = false;
  let stopped = false;

  async function runOnce(): Promise<void> {
    if (running) {
      log.warn(
        { intervalMs: options.intervalMs },
        'Zeitgeber übersprungen – der vorige Durchlauf läuft noch',
      );

      return;
    }

    running = true;

    try {
      for (const task of tasks) {
        try {
          await task.run();
        } catch (error: unknown) {
          log.error(
            { task: task.name, error: error instanceof Error ? error.message : String(error) },
            'Aufgabe des Zeitgebers fehlgeschlagen',
          );
        }
      }
    } finally {
      running = false;
    }
  }

  const handle = timer.set(() => {
    if (stopped) {
      return;
    }

    void runOnce();
  }, options.intervalMs);

  log.debug(
    { intervalMs: options.intervalMs, tasks: tasks.map((task) => task.name) },
    'Zeitgeber gestartet',
  );

  return {
    runOnce,
    stop(): void {
      if (stopped) {
        return;
      }

      stopped = true;
      timer.clear(handle);
    },
  };
}

// ---------------------------------------------------------------------------
// Die beiden Aufgaben
// ---------------------------------------------------------------------------

/** Ausschnitt der Server-Orchestrierung, den der Zeitgeber braucht. */
export interface AutoShutdownSweeper {
  runAutoShutdownSweep(hostId: string): Promise<readonly string[]>;
}

/** Ausschnitt der Agent-Registry, den der Zeitgeber braucht. */
export interface ConnectedHosts {
  connectedHostIds(): readonly string[];
}

/**
 * Automatisches Abschalten inaktiver Server (Pflichtenheft §9).
 *
 * Geprüft werden nur Nodes mit **offener** Agent-Verbindung. Bei einer Node
 * ohne Verbindung ließe sich ohnehin kein Container stoppen; der Lauf würde nur
 * eine Reihe von `AGENT_NOT_CONNECTED` ins Log schreiben. Die Entscheidung, ob
 * ein einzelner Server abgeschaltet wird, trifft unverändert
 * `decideAutoShutdown()` – insbesondere bleibt ein Server innerhalb seiner
 * Schonfrist unangetastet.
 */
export function autoShutdownTask(
  orchestration: AutoShutdownSweeper,
  agents: ConnectedHosts,
  log: SchedulerLogger,
): ScheduledTask {
  return {
    name: 'autoShutdown',
    async run(): Promise<void> {
      for (const hostId of agents.connectedHostIds()) {
        const stopped = await orchestration.runAutoShutdownSweep(hostId);

        if (stopped.length > 0) {
          log.debug({ hostId, serverIds: stopped }, 'Server wegen Inaktivität abgeschaltet');
        }
      }
    },
  };
}

/** Ausschnitt der Backup-Zeitpläne, den der Zeitgeber braucht. */
export interface BackupScheduleTicker {
  tick(): Promise<{
    readonly startedScheduleIds: string[];
    readonly skippedScheduleIds: string[];
  }>;
}

/** Fällige Backup-Zeitpläne anstoßen (Lastenheft §3.3). */
export function backupScheduleTask(
  schedules: BackupScheduleTicker,
  log: SchedulerLogger,
): ScheduledTask {
  return {
    name: 'backupSchedules',
    async run(): Promise<void> {
      const result = await schedules.tick();

      if (result.startedScheduleIds.length > 0 || result.skippedScheduleIds.length > 0) {
        log.debug(
          {
            started: result.startedScheduleIds,
            skipped: result.skippedScheduleIds,
          },
          'Geplante Backups ausgewertet',
        );
      }
    },
  };
}

/** Ausschnitt der geplanten Server-Aufgaben, den der Zeitgeber braucht (B3). */
export interface ServerScheduleTicker {
  tick(): Promise<{
    readonly executedScheduleIds: string[];
    readonly failedScheduleIds: string[];
  }>;
}

/**
 * Fällige Server-Aufgaben anstoßen – Neustart oder Konsolenbefehl zu fester
 * Zeit (Lastenheft §3.3, Reiter „Aufgaben").
 *
 * Geschwisteraufgabe zu {@link backupScheduleTask}: dieselbe Tabelle
 * `schedules`, andere Aktionen. Auch hier kein eigener Timer im Modul – der
 * Takt kommt von hier.
 */
export function serverScheduleTask(
  schedules: ServerScheduleTicker,
  log: SchedulerLogger,
): ScheduledTask {
  return {
    name: 'serverSchedules',
    async run(): Promise<void> {
      const result = await schedules.tick();

      if (result.executedScheduleIds.length > 0 || result.failedScheduleIds.length > 0) {
        log.debug(
          {
            executed: result.executedScheduleIds,
            failed: result.failedScheduleIds,
          },
          'Geplante Server-Aufgaben ausgewertet',
        );
      }
    },
  };
}

/** Ausschnitt der Verlaufs-Abtastung, den der Zeitgeber braucht (B3/P5). */
export interface StatsSampler {
  /** Tastet alle laufenden Server einer Node ab; liefert die abgetasteten Ids. */
  sampleServerStats(hostId: string): Promise<readonly string[]>;
  /** Entfernt Stichproben jenseits der Aufbewahrungsfrist; liefert die Anzahl. */
  pruneServerStats(): Promise<number>;
}

/**
 * Messwerte festhalten und Alte wegräumen (Lastenheft §3.3
 * „Verlaufsdarstellung").
 *
 * Ohne diesen Takt gäbe es nur den Momentwert und nie eine Reihe. Abgetastet
 * werden – wie beim Auto-Shutdown – nur Nodes mit **offener** Agent-Verbindung:
 * Ohne Verbindung ließe sich ohnehin nichts messen, der Lauf schriebe nur eine
 * Reihe von `AGENT_NOT_CONNECTED` ins Log.
 *
 * Das Wegräumen läuft in **jedem** Durchlauf mit, auch ohne verbundene Node:
 * Die Frist gilt für die Tabelle, nicht für die Verbindung.
 */
export function statsSamplingTask(
  sampler: StatsSampler,
  agents: ConnectedHosts,
  log: SchedulerLogger,
): ScheduledTask {
  return {
    name: 'statsSampling',
    async run(): Promise<void> {
      let abgetastet = 0;

      for (const hostId of agents.connectedHostIds()) {
        abgetastet += (await sampler.sampleServerStats(hostId)).length;
      }

      const entfernt = await sampler.pruneServerStats();

      if (abgetastet > 0 || entfernt > 0) {
        log.debug({ abgetastet, entfernt }, 'Messwert-Verlauf fortgeschrieben');
      }
    },
  };
}

/** Ausschnitt des Ressourcen-Service, den der Zeitgeber braucht (B4). */
export interface NodeWarningEvaluator {
  evaluateAllNodeWarnings(): Promise<readonly ResourceLowEvent[]>;
}

/**
 * Ereignissenke, wie B3/B5/B7 sie bekommen – hier für `resource.low`.
 *
 * Bewusst dieselbe schmale Form wie in `server.ts`: Der Zeitgeber kennt B6 nicht,
 * er reicht die Nutzlast nur weiter. `emit()` wirft nie (Pflichtenheft §14).
 */
export interface ResourceEventSink {
  emit(event: string, payload: Record<string, unknown>): void;
}

/**
 * Ressourcen-Warnungen periodisch auswerten und als `resource.low` melden
 * (Pflichtenheft §10 und §14).
 *
 * Der fehlende Takt aus WORK_STATUS.md (Gefundener Punkt 80): Die Auswertung in
 * B4 (`evaluateNodeWarnings()`) rechnet die Nutzlast, ausgelöst wird sie hier.
 * Kein eigener Timer – die eine Stelle für periodische Abläufe ist dieser
 * Zeitgeber.
 *
 * Ausgewertet wird die **Node-Ebene** (Belegung der VM gegen ihre
 * Gesamt-Ressourcen). Die Server-Ebene (`evaluateServerWarnings()`) braucht
 * gemessene Live-Werte je Container; dass das Agent-Protokoll dafür noch keinen
 * node-weiten Wert kennt, ist in `modules/resources/node-usage.ts` und in
 * WORK_STATUS.md vermerkt und gehört nicht in dieses Verdrahtungs-Paket.
 */
export function resourceWarningTask(
  resources: NodeWarningEvaluator,
  sink: ResourceEventSink,
  log: SchedulerLogger,
): ScheduledTask {
  return {
    name: 'resourceWarnings',
    async run(): Promise<void> {
      const warnings = await resources.evaluateAllNodeWarnings();

      for (const warning of warnings) {
        // ResourceLowEvent (B4) → Nutzlast von `resource.low` (B6): nur `ownerId`
        // ergänzt; `at` trägt das Ereignis schon, `actorId` setzt die Senke.
        // Node-Ebene hat keinen Besitzer, deshalb `ownerId: null`.
        sink.emit('resource.low', { ...warning, ownerId: null });
      }

      if (warnings.length > 0) {
        log.debug({ count: warnings.length }, 'Ressourcen-Warnungen gemeldet');
      }
    },
  };
}

/** Ausschnitt der Panel-Sicherungen, den der Zeitgeber braucht (12.5.1). */
export interface PanelBackupRunner {
  /** Geplanter Lauf; `null`, wenn nichts zu tun war. */
  runScheduled(): Promise<{ readonly id: string } | null>;
  /** Alte Abzuege wegraeumen; liefert die Anzahl. */
  prune(): Promise<number>;
}

/**
 * Sicherung des Panels selbst anstossen und alte Abzuege wegraeumen
 * (Mockup-Abgleich 12.5.1).
 *
 * Kein eigener Timer im Modul - dieselbe Aufteilung wie beim Backup-Zeitplan.
 * Ob ein Lauf faellig ist, entscheidet der Dienst anhand des Abstands zum
 * vorigen Lauf; der Zeitgeber fragt nur in jeder Minute nach.
 *
 * Das Wegraeumen laeuft auch dann, wenn kein Lauf faellig war: Die
 * Aufbewahrungsfrist gilt fuer die abgelegten Dateien, nicht fuer den Takt.
 */
export function panelBackupTask(backups: PanelBackupRunner, log: SchedulerLogger): ScheduledTask {
  return {
    name: 'panelBackups',
    async run(): Promise<void> {
      const gestartet = await backups.runScheduled();
      const entfernt = await backups.prune();

      if (gestartet !== null || entfernt > 0) {
        log.debug({ backupId: gestartet?.id ?? null, entfernt }, 'Panel-Sicherung ausgewertet');
      }
    },
  };
}
