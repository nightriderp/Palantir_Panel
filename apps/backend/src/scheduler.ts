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
 * - `BackupService.sweepOrphanedRuns()`/`applyRetentionToAll()` und
 *   `PanelBackupService.sweepOrphanedRun()` – ohne Aufruf blockiert ein vom
 *   Neustart abgerissener Lauf seinen Server bzw. die Panel-Sicherung für
 *   immer, und die Aufbewahrungsfrist wird nie eingelöst (Lastenheft §3.3)
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
import { fireAndForget } from './lib/fire-and-forget.js';
import { type ServerLoadSnapshot } from './modules/resources/index.js';

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

    // `runOnce()` fängt jede Aufgabe einzeln; das Netz darunter fängt, was
    // daran vorbeigeht (Audit W0-5, Fundpunkt 126).
    fireAndForget(runOnce(), log, 'Durchlauf des Zeitgebers');
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
 * Eine Node-Schleife, in der eine kaputte Node die übrigen nicht mitreißt
 * (Audit backend-core-05).
 *
 * Der Zeitgeber fängt bisher nur **je Aufgabe**. Wirft die Arbeit an der ersten
 * Node – in der Praxis ein Datenbankfehler beim Laden ihrer Server oder ein
 * abgerissener Agent mitten im Durchlauf –, bricht die `for`-Schleife ab: Jede
 * weitere Node wird in diesem Takt übersprungen, und beim Abtasten der Messwerte
 * entfiele zusätzlich das anschließende Wegräumen. Ein Takt später beginnt
 * dasselbe Spiel wieder bei derselben Node.
 *
 * Deshalb hier eine Ebene tiefer fangen: Der Fehler landet mit `hostId` im Log,
 * die Schleife läuft weiter. Was an einer Node nicht ging, ist im nächsten Takt
 * ohnehin erneut fällig.
 */
async function proNodeSicher(
  hosts: ConnectedHosts,
  aufgabe: string,
  log: SchedulerLogger,
  lauf: (hostId: string) => Promise<void>,
): Promise<void> {
  for (const hostId of hosts.connectedHostIds()) {
    try {
      await lauf(hostId);
    } catch (error: unknown) {
      log.error(
        {
          task: aufgabe,
          hostId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Node im Durchlauf des Zeitgebers übersprungen',
      );
    }
  }
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
 *
 * Jede Node ist einzeln gefangen (Audit backend-core-05): Eine Node, deren
 * Sweep wirft, darf die übrigen nicht um ihren Durchlauf bringen.
 */
export function autoShutdownTask(
  orchestration: AutoShutdownSweeper,
  agents: ConnectedHosts,
  log: SchedulerLogger,
): ScheduledTask {
  return {
    name: 'autoShutdown',
    async run(): Promise<void> {
      await proNodeSicher(agents, 'autoShutdown', log, async (hostId) => {
        const stopped = await orchestration.runAutoShutdownSweep(hostId);

        if (stopped.length > 0) {
          log.debug({ hostId, serverIds: stopped }, 'Server wegen Inaktivität abgeschaltet');
        }
      });
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
 * Die Frist gilt für die Tabelle, nicht für die Verbindung. Aus demselben Grund
 * ist jede Node einzeln gefangen (Audit backend-core-05) – eine Node, deren
 * Abtastung wirft, hätte sonst das Wegräumen mitgenommen.
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

      await proNodeSicher(agents, 'statsSampling', log, async (hostId) => {
        abgetastet += (await sampler.sampleServerStats(hostId)).length;
      });

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
  /**
   * Server-Ebene: derselbe Dienst, andere Bezugsgröße. Synchron, weil die
   * Messwerte mitgereicht werden und keine Abfrage nötig ist.
   */
  evaluateAllServerWarnings(loads: readonly ServerLoadSnapshot[]): readonly ResourceLowEvent[];
}

/**
 * Quelle der Messwerte je Server (B3).
 *
 * Der Zeitgeber holt die Werte nicht selbst: Sie entstehen im selben Durchlauf
 * bereits in `statsSamplingTask`, die vor dieser Aufgabe läuft. Deshalb ein
 * reiner Lesezugriff ohne Promise – nichts wird hier abgefragt, nur abgeholt.
 */
export interface ServerLoadSource {
  listServerLoads(): readonly ServerLoadSnapshot[];
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
 * Kennung einer Warnlage – Ebene, Ressource und betroffene Einheit.
 *
 * Grundlage der Kantenerkennung weiter unten: Zwei Läufe melden dieselbe Lage,
 * solange sich an diesen vier Angaben nichts ändert.
 */
function warnungsSchluessel(warning: ResourceLowEvent): string {
  return `${warning.scope}:${warning.nodeId}:${warning.serverId ?? '-'}:${warning.resource}`;
}

/**
 * Ressourcen-Warnungen periodisch auswerten und als `resource.low` melden
 * (Pflichtenheft §10 und §14, Lastenheft §3.3).
 *
 * Der fehlende Takt aus WORK_STATUS.md (Gefundener Punkt 80): Die Auswertung in
 * B4 rechnet die Nutzlast, ausgelöst wird sie hier. Kein eigener Timer – die
 * eine Stelle für periodische Abläufe ist dieser Zeitgeber.
 *
 * **Beide Ebenen, wie im Lastenheft §3.3 verlangt:**
 *
 * - **Node:** Belegung der VM gegen ihre Gesamt-Ressourcen (`evaluateAllNodeWarnings()`).
 * - **Server:** Verbrauch eines einzelnen Servers gegen sein *eigenes* Limit
 *   (`evaluateAllServerWarnings()`). Bis hierher lief die Server-Ebene ins
 *   Leere: Der Kopfkommentar verwies auf ein Agent-Protokoll, das die Werte je
 *   Server nicht liefere. Das stimmt seit `ServerLiveStats` nicht mehr –
 *   `cpuPercent`, `ramUsedMb` und `diskUsedMb` stehen dort je Server, und der
 *   Verlauf hält dieselben Größen fest. `RESOURCE_WARN_SERVER_PERCENT` war
 *   dadurch wirkungslos: Ein Server, der sein Kontingent füllte, meldete sich
 *   nicht, solange die Node insgesamt Luft hatte.
 *
 * **Woher die Messwerte kommen.** Aus {@link ServerLoadSource} – dem Stand, den
 * `statsSamplingTask` in *diesem* Durchlauf geschrieben hat (sie steht in
 * `server.ts` vor dieser Aufgabe). Keine eigene Abfrage, kein zweiter Weg zum
 * Agent. Server ohne aktuelle Messung stehen gar nicht erst darin.
 *
 * **Kein Warnungsregen.** Der Zeitgeber läuft jede Minute; ohne weiteres Zutun
 * wäre jede anhaltende Lage in jedem Takt eine neue Meldung in der Inbox.
 * Gemeldet wird deshalb nur der **Übergang** unter → über die Schwelle. Fällt
 * die Belegung wieder darunter, ist die Lage vergessen und ein erneutes
 * Überschreiten wieder eine Meldung wert. Die Node-Ebene löste das bisher gar
 * nicht – sie meldete in jedem Takt neu; die Kantenerkennung gilt jetzt für
 * beide Ebenen gleich. Der Zustand liegt im Prozess: Nach einem Neustart des
 * Backends darf eine anhaltende Lage einmal neu gemeldet werden – das ist keine
 * Flut, aber ein Hinweis, dass sie den Neustart überdauert hat.
 */
/**
 * Wie oft nach dem Ist-Zustand der Nodes gefragt wird (Fundpunkt 232).
 *
 * Fünf Minuten: Ein Abgleich ist eine Frage und eine Antwort je Node, keine
 * Last. Häufiger brächte nichts – wer einen Container von Hand stoppt, wartet
 * ohnehin nicht auf die Sekunde; seltener ließe die Übersicht zu lange etwas
 * behaupten, das nicht mehr stimmt.
 */
export const STATE_RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Fordert den Ist-Zustands-Bericht einer Node an (A1, Pflichtenheft §2.2).
 *
 * Bewusst ohne Rückgabe: Der Bericht kommt als eigenes Frame und läuft durch
 * denselben Weg wie beim Verbindungsaufbau (`onStateReport` →
 * `service.reconcile`). Der Zeitgeber stösst nur an.
 */
export interface StateRequester {
  requestState(hostId: string): void;
}

/**
 * Periodischer Soll/Ist-Abgleich (Fundpunkt 232).
 *
 * `AgentSession.requestState()` gab es seit A1 – **aufgerufen hat sie
 * niemand**. Abgeglichen wurde deshalb nur beim Verbindungsaufbau des Agents:
 * Wer einen Container auf der Node von Hand stoppte, sah im Panel bis zum
 * nächsten Neustart des Agents „läuft". Genau dafür ist der Bericht da.
 *
 * Eigener Abstand innerhalb des Takts, wie beim Kehraus der Sicherungen: Der
 * Zeitgeber läuft jede Minute, hier ist nichts minutengenau fällig.
 */
export function stateReconcileTask(
  agents: ConnectedHosts,
  requester: StateRequester,
  log: SchedulerLogger,
  options: { intervalMs?: number; now?: () => Date } = {},
): ScheduledTask {
  const intervalMs = options.intervalMs ?? STATE_RECONCILE_INTERVAL_MS;
  const now = options.now ?? ((): Date => new Date());
  let letzterLauf: number | null = null;

  return {
    name: 'stateReconcile',
    run(): Promise<void> {
      const jetzt = now().getTime();

      if (letzterLauf !== null && jetzt - letzterLauf < intervalMs) {
        return Promise.resolve();
      }

      letzterLauf = jetzt;

      const hostIds = agents.connectedHostIds();

      for (const hostId of hostIds) {
        try {
          requester.requestState(hostId);
        } catch (error: unknown) {
          // Eine Node, deren Verbindung gerade abreisst, haelt die uebrigen
          // nicht auf (dieselbe Regel wie in `proNodeSicher`).
          log.error(
            {
              task: 'stateReconcile',
              hostId,
              error: error instanceof Error ? error.message : String(error),
            },
            'Node im Durchlauf des Zeitgebers übersprungen',
          );
        }
      }

      if (hostIds.length > 0) {
        log.debug({ hostIds }, 'Ist-Zustand der Nodes angefordert');
      }

      return Promise.resolve();
    },
  };
}

export function resourceWarningTask(
  resources: NodeWarningEvaluator,
  servers: ServerLoadSource,
  sink: ResourceEventSink,
  log: SchedulerLogger,
): ScheduledTask {
  /** Lagen, die im vorigen Durchlauf über der Schwelle standen. */
  let gemeldet = new Set<string>();

  return {
    name: 'resourceWarnings',
    async run(): Promise<void> {
      const lasten = servers.listServerLoads();
      const besitzer = new Map(lasten.map((last) => [last.serverId, last.ownerId]));
      const warnings = [
        ...(await resources.evaluateAllNodeWarnings()),
        ...resources.evaluateAllServerWarnings(lasten),
      ];

      const aktuell = new Set<string>();
      let neue = 0;

      for (const warning of warnings) {
        const schluessel = warnungsSchluessel(warning);
        aktuell.add(schluessel);

        if (gemeldet.has(schluessel)) {
          continue;
        }

        /*
         * ResourceLowEvent (B4) → Nutzlast von `resource.low` (B6): nur
         * `ownerId` ergänzt; `at` trägt das Ereignis schon, `actorId` setzt die
         * Senke. Eine Node hat keinen Besitzer (`null`), ein Server schon – und
         * genau er soll die Meldung bekommen (Empfängerkreis `resourceOwner`,
         * siehe `modules/notifications/recipients.ts`).
         */
        const ownerId = warning.serverId === null ? null : (besitzer.get(warning.serverId) ?? null);

        sink.emit('resource.low', { ...warning, ownerId });
        neue += 1;
      }

      // Was nicht mehr über der Schwelle liegt, fällt aus der Menge und darf
      // beim nächsten Überschreiten wieder melden.
      gemeldet = aktuell;

      if (neue > 0) {
        log.debug({ count: neue, anhaltend: aktuell.size - neue }, 'Ressourcen-Warnungen gemeldet');
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
 * Aufbewahrungsfrist gilt fuer die abgelegten Dateien, nicht fuer den Takt –
 * und deshalb auch dann, wenn der geplante Lauf geworfen hat (Audit
 * backend-core-05). Der Fehler des Laufs geht danach unveraendert an den
 * Zeitgeber weiter, der ihn wie jeden Aufgabenfehler protokolliert.
 */
export function panelBackupTask(backups: PanelBackupRunner, log: SchedulerLogger): ScheduledTask {
  return {
    name: 'panelBackups',
    async run(): Promise<void> {
      let gestartet: { readonly id: string } | null = null;

      try {
        gestartet = await backups.runScheduled();
      } finally {
        // Eigener Fang: Ein Fehler beim Wegraeumen darf den Fehler des Laufs
        // nicht verdecken – der ist die eigentliche Nachricht.
        try {
          const entfernt = await backups.prune();

          if (gestartet !== null || entfernt > 0) {
            log.debug({ backupId: gestartet?.id ?? null, entfernt }, 'Panel-Sicherung ausgewertet');
          }
        } catch (error: unknown) {
          log.error(
            { task: 'panelBackups', error: error instanceof Error ? error.message : String(error) },
            'Alte Panel-Abzuege konnten nicht weggeraeumt werden',
          );
        }
      }
    },
  };
}

/** Ausschnitt der Backup-Verwaltung, den der Kehraus braucht (B5). */
export interface BackupHousekeeper {
  /** Abgerissene Läufe auf `failed` setzen; liefert die Ids. */
  sweepOrphanedRuns(): Promise<string[]>;
  /** Aufbewahrungsregel über den gesamten Bestand. */
  applyRetentionToAll(): Promise<{ readonly removedBackupIds: string[] }>;
}

/** Ausschnitt der Panel-Sicherungen, den der Kehraus braucht. */
export interface PanelBackupHousekeeper {
  /** Abgerissenen Abzug auf `failed` setzen; liefert seine Id oder `null`. */
  sweepOrphanedRun(): Promise<string | null>;
}

export interface BackupHousekeepingOptions {
  /** Abstand zweier Läufe; Vorgabe fünf Minuten. */
  readonly intervalMs?: number;
  /** Zeitquelle – austauschbar für Tests. */
  readonly now?: () => Date;
}

/** Vorgabe-Abstand des Kehraus. */
export const BACKUP_HOUSEKEEPING_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Kehraus der Sicherungen (Audit W1-6, Fundpunkte 130 und 131).
 *
 * Drei Dinge, die ohne Takt niemand tut:
 *
 * 1. **Abgerissene Server-Backups** (bb-03). Ein Backup-Job lebt nur im
 *    Prozess. Stirbt das Backend mittendrin, bleibt der Datensatz `running` –
 *    und sperrt den Server für jedes weitere Backup, für immer.
 * 2. **Abgerissener Panel-Abzug** (bb-04). Derselbe Fall eine Ebene höher, mit
 *    demselben Ausgang: Die Instanz sichert sich unbemerkt nie wieder selbst.
 * 3. **Aufbewahrungsregel** (bb-07). Sie lief bisher nur huckepack nach einem
 *    erfolgreichen Backup desselben Servers. Wer seinen Zeitplan abschaltet,
 *    behält seine abgelaufenen Backups ewig – obwohl ihr DTO ein `expiresAt`
 *    zusagt.
 *
 * **Warum ein eigener Abstand.** Anders als fällige Zeitpläne ist hier nichts
 * minutengenau: Ein abgerissener Lauf steht seit Stunden, und die
 * Aufbewahrungsfrist zählt in Tagen. Jede Minute den gesamten Bestand zu laden
 * wäre Last ohne Ertrag. Der Takt bleibt trotzdem der eine Zeitgeber – die
 * Aufgabe zählt nur mit, wann sie zuletzt lief. Der **erste** Takt nach dem
 * Start läuft immer: Genau dann liegen die Datensätze herum, die der Neustart
 * abgerissen hat.
 *
 * Jeder der drei Schritte ist einzeln gefangen: Ein Aufbewahrungslauf, der an
 * einer nicht erreichbaren Node scheitert, darf den Kehraus der abgerissenen
 * Läufe nicht mitreißen – und umgekehrt.
 */
export function backupHousekeepingTask(
  backups: BackupHousekeeper,
  panel: PanelBackupHousekeeper,
  log: SchedulerLogger,
  options: BackupHousekeepingOptions = {},
): ScheduledTask {
  const intervalMs = options.intervalMs ?? BACKUP_HOUSEKEEPING_INTERVAL_MS;
  const now = options.now ?? ((): Date => new Date());
  let letzterLauf: number | null = null;

  async function sicher<T>(schritt: string, lauf: () => Promise<T>): Promise<T | null> {
    try {
      return await lauf();
    } catch (error: unknown) {
      log.error(
        { schritt, error: error instanceof Error ? error.message : String(error) },
        'Kehraus der Sicherungen fehlgeschlagen',
      );

      return null;
    }
  }

  return {
    name: 'backupHousekeeping',
    async run(): Promise<void> {
      const jetzt = now().getTime();

      if (letzterLauf !== null && jetzt - letzterLauf < intervalMs) {
        return;
      }

      letzterLauf = jetzt;

      const abgerissen = await sicher('abgerissene Backups', () => backups.sweepOrphanedRuns());
      const panelAbgerissen = await sicher('abgerissener Panel-Abzug', () =>
        panel.sweepOrphanedRun(),
      );
      const aufbewahrung = await sicher('Aufbewahrung', () => backups.applyRetentionToAll());
      const entfernt = aufbewahrung?.removedBackupIds ?? [];

      if ((abgerissen?.length ?? 0) > 0 || panelAbgerissen !== null || entfernt.length > 0) {
        log.debug(
          {
            abgerissen: abgerissen ?? [],
            panelBackupId: panelAbgerissen,
            entfernt,
          },
          'Kehraus der Sicherungen ausgeführt',
        );
      }
    },
  };
}
