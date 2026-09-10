/**
 * Der zentrale Zeitgeber (R2, Gefundener Punkt 63).
 *
 * Zwei Fragen stehen im Vordergrund:
 *
 * 1. **Löst er tatsächlich aus?** Genau das fehlte bisher – beide Abläufe waren
 *    gebaut und getestet, wurden aber von niemandem aufgerufen.
 * 2. **Schaltet er nichts versehentlich ab?** Der Auto-Shutdown-Sweep läuft nun
 *    jede Minute; ein Server innerhalb seiner Schonfrist darf davon nicht
 *    berührt werden (Pflichtenheft §9).
 *
 * Für Frage 2 hängt der Test am **echten** Dienst der Server-Orchestrierung mit
 * einem Agent am echten Protokoll-Gegenstück – nicht an einer Attrappe des
 * Sweeps. Sonst prüfte er nur seine eigene Nachbildung der Regel.
 */

import {
  type AgentCommandName,
  type ApiResponse,
  type GameConfigValues,
  type ResourceLowEvent,
  type ServerMemberLevel,
  type ServerResourceLimits,
  type ServerStatus,
} from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import {
  AgentRegistry,
  AgentSession,
  type AgentSocket,
} from './modules/server-orchestration/agent-gateway.js';
import {
  TEST_GAME_TYPE,
  TEST_MINECRAFT_GAME_TYPE,
  ALLE_GAME_TYPE_DEFINITIONS,
  createGameRegistry,
} from './modules/server-orchestration/game-registry.js';
import { type HealthProbe } from './modules/server-orchestration/health-check.js';
import { createPortAllocator } from './modules/server-orchestration/ports.js';
import {
  type CreateServerData,
  type HostNodeRecord,
  type PersistLifecycleData,
  type ServerMemberRecord,
  type ServerRecord,
  type ServerRepository,
  type UpdateServerData,
} from './modules/server-orchestration/repository.js';
import { type ServerLoadSnapshot, evaluateServerWarnings } from './modules/resources/thresholds.js';
import { createPermissiveResourceGuard } from './modules/server-orchestration/resource-guard.js';
import { ServerOrchestrationService } from './modules/server-orchestration/service.js';
import {
  type BackupHousekeeper,
  type NodeWarningEvaluator,
  type PanelBackupHousekeeper,
  type PanelBackupRunner,
  type ResourceEventSink,
  type ScheduledTask,
  type SchedulerLogger,
  type SchedulerTimer,
  type ServerLoadSource,
  type ServerScheduleTicker,
  type TimerHandle,
  autoShutdownTask,
  backupHousekeepingTask,
  backupScheduleTask,
  panelBackupTask,
  serverScheduleTask,
  statsSamplingTask,
  resourceWarningTask,
  stateReconcileTask,
  startScheduler,
} from './scheduler.js';

/**
 * Stille Protokollierung für beide Schnittstellen dieses Tests.
 *
 * Bewusst ohne Typannotation: Dasselbe Objekt dient als `SchedulerLogger` und
 * als `AgentGatewayLogger` (der zusätzlich `info` verlangt).
 */
const silentLog = {
  debug: (): void => undefined,
  info: (): void => undefined,
  warn: (): void => undefined,
  error: (): void => undefined,
};

/** Zeitgeber, dessen Takt der Test selbst schlägt – ohne echte Wartezeit. */
function manualTimer(): SchedulerTimer & { fire(): void; readonly cleared: boolean } {
  let handler: (() => void) | null = null;
  let cleared = false;

  return {
    set(next: () => void): TimerHandle {
      handler = next;

      return 'handle';
    },
    clear(): void {
      cleared = true;
      handler = null;
    },
    fire(): void {
      handler?.();
    },
    get cleared(): boolean {
      return cleared;
    },
  };
}

/** Wartet, bis alle bereits angestoßenen Zusagen abgearbeitet sind. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Ein mitgeschriebener Protokolleintrag. */
interface Eintrag {
  readonly stufe: 'debug' | 'warn' | 'error';
  readonly details: Record<string, unknown>;
  readonly nachricht: string;
}

/**
 * Protokollierung, die ihre Einträge behält (Audit W3-12, `backend-core-11`).
 *
 * Bei den Zeitgeber-Aufgaben ist das Protokoll die **einzige** sichtbare
 * Wirkung: `serverScheduleTask` und `panelBackupTask` liefern nichts zurück und
 * ändern nichts, was der Test sonst abfragen könnte. Ohne Blick in die Einträge
 * prüfte ein Test nur, dass `tick()` aufgerufen wurde – und ein Vertauschen von
 * „ausgeführt" und „fehlgeschlagen" bliebe unsichtbar.
 */
function mitschreibendesLog(): SchedulerLogger & { readonly eintraege: Eintrag[] } {
  const eintraege: Eintrag[] = [];

  return {
    eintraege,
    debug: (details, nachricht): void =>
      void eintraege.push({ stufe: 'debug', details, nachricht }),
    warn: (details, nachricht): void => void eintraege.push({ stufe: 'warn', details, nachricht }),
    error: (details, nachricht): void =>
      void eintraege.push({ stufe: 'error', details, nachricht }),
  };
}

describe('Zeitgeber: Auslösen und Überschneidung', () => {
  it('stößt bei jedem Takt alle Aufgaben an', async () => {
    const laeufe: string[] = [];
    const timer = manualTimer();
    const task = (name: string): ScheduledTask => ({
      name,
      run: (): Promise<void> => {
        laeufe.push(name);

        return Promise.resolve();
      },
    });

    startScheduler({
      tasks: [task('a'), task('b')],
      intervalMs: 60_000,
      log: silentLog,
      timer,
    });

    // Vor dem ersten Takt passiert nichts: Der Agent baut seine Verbindung nach
    // einem Neustart des Backends erst auf (Pflichtenheft §2.2).
    expect(laeufe).toEqual([]);

    timer.fire();
    await settle();
    timer.fire();
    await settle();

    expect(laeufe).toEqual(['a', 'b', 'a', 'b']);
  });

  it('überspringt einen Takt, solange der vorige Durchlauf läuft', async () => {
    const timer = manualTimer();
    let starts = 0;
    // Als Feld eines Objekts, damit TypeScript die Zuweisung im Callback nicht
    // wegnarrowt (eine lokale `let`-Variable gilt danach als `null`).
    const langsam: { freigeben: (() => void) | null } = { freigeben: null };

    startScheduler({
      tasks: [
        {
          name: 'langsam',
          run: (): Promise<void> => {
            starts += 1;

            return new Promise<void>((resolve) => {
              langsam.freigeben = resolve;
            });
          },
        },
      ],
      intervalMs: 60_000,
      log: silentLog,
      timer,
    });

    timer.fire();
    await settle();
    expect(starts).toBe(1);

    // Zweiter Takt, während der erste noch hängt: übersprungen, nicht eingereiht.
    timer.fire();
    await settle();
    expect(starts).toBe(1);

    langsam.freigeben?.();
    await settle();

    // Erst der Takt danach läuft wieder – der übersprungene wird nicht nachgeholt.
    timer.fire();
    await settle();
    expect(starts).toBe(2);
  });

  it('lässt eine fehlgeschlagene Aufgabe die übrigen nicht aufhalten', async () => {
    const timer = manualTimer();
    const fehler: string[] = [];
    let zweiteGelaufen = 0;

    const recordingLog: SchedulerLogger = {
      ...silentLog,
      error: (details): void => {
        fehler.push(String(details.task));
      },
    };

    startScheduler({
      tasks: [
        {
          name: 'kaputt',
          run: (): Promise<void> => Promise.reject(new Error('Homeserver antwortet nicht')),
        },
        {
          name: 'heil',
          run: (): Promise<void> => {
            zweiteGelaufen += 1;

            return Promise.resolve();
          },
        },
      ],
      intervalMs: 60_000,
      log: recordingLog,
      timer,
    });

    timer.fire();
    await settle();
    timer.fire();
    await settle();

    expect(fehler).toEqual(['kaputt', 'kaputt']);
    expect(zweiteGelaufen).toBe(2);
  });

  it('beendet den Takt bei stop()', () => {
    const timer = manualTimer();
    const scheduler = startScheduler({ tasks: [], intervalMs: 60_000, log: silentLog, timer });

    scheduler.stop();

    expect(timer.cleared).toBe(true);
  });
});

describe('Zeitgeber: fällige Backup-Zeitpläne', () => {
  it('ruft tick() bei jedem Takt auf', async () => {
    const timer = manualTimer();
    let ticks = 0;

    startScheduler({
      tasks: [
        backupScheduleTask(
          {
            tick: (): Promise<{ startedScheduleIds: string[]; skippedScheduleIds: string[] }> => {
              ticks += 1;

              return Promise.resolve({ startedScheduleIds: [], skippedScheduleIds: [] });
            },
          },
          silentLog,
        ),
      ],
      intervalMs: 60_000,
      log: silentLog,
      timer,
    });

    timer.fire();
    await settle();
    timer.fire();
    await settle();

    expect(ticks).toBe(2);
  });
});

describe('Zeitgeber: fällige Server-Aufgaben (B3, Reiter „Aufgaben")', () => {
  /** Zeitplan-Dienst, der eine feste Auswertung liefert und Aufrufe zählt. */
  function ticker(
    ergebnis: { executedScheduleIds: string[]; failedScheduleIds: string[] },
    fehler?: Error,
  ): ServerScheduleTicker & { readonly aufrufe: number } {
    let aufrufe = 0;

    return {
      get aufrufe(): number {
        return aufrufe;
      },
      tick: (): Promise<{ executedScheduleIds: string[]; failedScheduleIds: string[] }> => {
        aufrufe += 1;

        return fehler ? Promise.reject(fehler) : Promise.resolve(ergebnis);
      },
    };
  }

  it('ruft tick() bei jedem Takt auf', async () => {
    const timer = manualTimer();
    const schedules = ticker({ executedScheduleIds: [], failedScheduleIds: [] });

    startScheduler({
      tasks: [serverScheduleTask(schedules, silentLog)],
      intervalMs: 60_000,
      log: silentLog,
      timer,
    });

    timer.fire();
    await settle();
    timer.fire();
    await settle();

    expect(schedules.aufrufe).toBe(2);
  });

  it('meldet ausgeführte und gescheiterte Aufgaben unter dem jeweils eigenen Namen', async () => {
    /*
     * Die beiden Listen kommen aus **einem** Ergebnisobjekt und werden hier auf
     * zwei Protokollfelder verteilt. Vertauschte Felder wären im Betrieb der
     * Unterschied zwischen „alles lief" und „alles scheiterte" – und ohne diese
     * Zusicherung von keinem Test bemerkbar (`backend-core-11`).
     */
    const timer = manualTimer();
    const log = mitschreibendesLog();
    const schedules = ticker({
      executedScheduleIds: ['plan-lief'],
      failedScheduleIds: ['plan-scheiterte', 'plan-scheiterte-auch'],
    });

    startScheduler({
      tasks: [serverScheduleTask(schedules, log)],
      intervalMs: 60_000,
      log: silentLog,
      timer,
    });

    timer.fire();
    await settle();

    expect(log.eintraege).toHaveLength(1);
    expect(log.eintraege[0]?.stufe).toBe('debug');
    expect(log.eintraege[0]?.details).toEqual({
      executed: ['plan-lief'],
      failed: ['plan-scheiterte', 'plan-scheiterte-auch'],
    });
  });

  it('schreibt nichts, solange kein Zeitplan fällig war', async () => {
    // Jede Minute eine Zeile „nichts zu tun" macht das Protokoll unlesbar.
    const timer = manualTimer();
    const log = mitschreibendesLog();

    startScheduler({
      tasks: [serverScheduleTask(ticker({ executedScheduleIds: [], failedScheduleIds: [] }), log)],
      intervalMs: 60_000,
      log: silentLog,
      timer,
    });

    timer.fire();
    await settle();

    expect(log.eintraege).toEqual([]);
  });

  it('schreibt auch dann, wenn ausschließlich Aufgaben gescheitert sind', async () => {
    const timer = manualTimer();
    const log = mitschreibendesLog();

    startScheduler({
      tasks: [
        serverScheduleTask(
          ticker({ executedScheduleIds: [], failedScheduleIds: ['plan-scheiterte'] }),
          log,
        ),
      ],
      intervalMs: 60_000,
      log: silentLog,
      timer,
    });

    timer.fire();
    await settle();

    expect(log.eintraege[0]?.details).toEqual({ executed: [], failed: ['plan-scheiterte'] });
  });

  it('lässt einen Fehler des Zeitplan-Dienstes den Durchlauf nicht abbrechen', async () => {
    const timer = manualTimer();
    const log = mitschreibendesLog();
    const danach: string[] = [];

    startScheduler({
      tasks: [
        serverScheduleTask(
          ticker({ executedScheduleIds: [], failedScheduleIds: [] }, new Error('Datenbank weg')),
          silentLog,
        ),
        {
          name: 'danach',
          run: (): Promise<void> => {
            danach.push('gelaufen');

            return Promise.resolve();
          },
        },
      ],
      intervalMs: 60_000,
      log,
      timer,
    });

    timer.fire();
    await settle();

    expect(danach).toEqual(['gelaufen']);

    // `eintraege[0]` ist die Startmeldung des Zeitgebers – gesucht ist der
    // Fehler, den `runOnce()` je Aufgabe einzeln fängt.
    const fehler = log.eintraege.filter((eintrag) => eintrag.stufe === 'error');
    expect(fehler).toHaveLength(1);
    expect(fehler[0]?.details.task).toBe('serverSchedules');
  });
});

describe('Zeitgeber: Sicherung des Panels (Mockup-Abgleich 12.5.1)', () => {
  /** Panel-Sicherung, die Aufrufe in ihrer Reihenfolge festhält. */
  function runner(
    lauf: { readonly id: string } | null,
    entfernt: number,
  ): PanelBackupRunner & { readonly aufrufe: string[] } {
    const aufrufe: string[] = [];

    return {
      aufrufe,
      runScheduled: (): Promise<{ readonly id: string } | null> => {
        aufrufe.push('runScheduled');

        return Promise.resolve(lauf);
      },
      prune: (): Promise<number> => {
        aufrufe.push('prune');

        return Promise.resolve(entfernt);
      },
    };
  }

  it('stößt den fälligen Lauf an und räumt danach auf', async () => {
    const timer = manualTimer();
    const log = mitschreibendesLog();
    const backups = runner({ id: 'abzug-1' }, 2);

    startScheduler({
      tasks: [panelBackupTask(backups, log)],
      intervalMs: 60_000,
      log: silentLog,
      timer,
    });

    timer.fire();
    await settle();

    expect(backups.aufrufe).toEqual(['runScheduled', 'prune']);
    expect(log.eintraege[0]?.details).toEqual({ backupId: 'abzug-1', entfernt: 2 });
  });

  it('räumt auch dann auf, wenn kein Lauf fällig war', async () => {
    /*
     * Die Aufbewahrungsfrist gilt für die abgelegten Dateien, nicht für den
     * Takt: Ein vorzeitiges `return` nach `runScheduled() === null` ließe alte
     * Abzüge für immer liegen.
     */
    const timer = manualTimer();
    const log = mitschreibendesLog();
    const backups = runner(null, 3);

    startScheduler({
      tasks: [panelBackupTask(backups, log)],
      intervalMs: 60_000,
      log: silentLog,
      timer,
    });

    timer.fire();
    await settle();

    expect(backups.aufrufe).toEqual(['runScheduled', 'prune']);
    expect(log.eintraege[0]?.details).toEqual({ backupId: null, entfernt: 3 });
  });

  it('schreibt nichts, wenn weder ein Lauf fällig war noch etwas wegzuräumen ist', async () => {
    const timer = manualTimer();
    const log = mitschreibendesLog();
    const backups = runner(null, 0);

    startScheduler({
      tasks: [panelBackupTask(backups, log)],
      intervalMs: 60_000,
      log: silentLog,
      timer,
    });

    timer.fire();
    await settle();

    expect(backups.aufrufe).toEqual(['runScheduled', 'prune']);
    expect(log.eintraege).toEqual([]);
  });

  it('lässt einen Fehler der Panel-Sicherung den Durchlauf nicht abbrechen', async () => {
    const timer = manualTimer();
    const log = mitschreibendesLog();
    const danach: string[] = [];

    startScheduler({
      tasks: [
        panelBackupTask(
          {
            runScheduled: (): Promise<{ readonly id: string } | null> =>
              Promise.reject(new Error('pg_dump fehlt')),
            prune: (): Promise<number> => Promise.resolve(0),
          },
          silentLog,
        ),
        {
          name: 'danach',
          run: (): Promise<void> => {
            danach.push('gelaufen');

            return Promise.resolve();
          },
        },
      ],
      intervalMs: 60_000,
      log,
      timer,
    });

    timer.fire();
    await settle();

    expect(danach).toEqual(['gelaufen']);

    const fehler = log.eintraege.filter((eintrag) => eintrag.stufe === 'error');
    expect(fehler).toHaveLength(1);
    expect(fehler[0]?.details.task).toBe('panelBackups');
  });
});

describe('Zeitgeber: Verlauf der Messwerte (Arbeitspaket P5)', () => {
  it('tastet jede verbundene Node ab und räumt danach auf', async () => {
    const timer = manualTimer();
    const abgetastet: string[] = [];
    let aufgeraeumt = 0;

    startScheduler({
      tasks: [
        statsSamplingTask(
          {
            sampleServerStats: (hostId: string): Promise<readonly string[]> => {
              abgetastet.push(hostId);

              return Promise.resolve(['server-1']);
            },
            pruneServerStats: (): Promise<number> => {
              aufgeraeumt += 1;

              return Promise.resolve(0);
            },
          },
          { connectedHostIds: (): readonly string[] => ['node-a', 'node-b'] },
          silentLog,
        ),
      ],
      intervalMs: 60_000,
      log: silentLog,
      timer,
    });

    timer.fire();
    await settle();

    expect(abgetastet).toEqual(['node-a', 'node-b']);
    expect(aufgeraeumt).toBe(1);
  });

  it('räumt auch dann auf, wenn keine Node verbunden ist', async () => {
    const timer = manualTimer();
    let aufgeraeumt = 0;

    startScheduler({
      tasks: [
        statsSamplingTask(
          {
            sampleServerStats: (): Promise<readonly string[]> =>
              Promise.reject(new Error('darf nicht aufgerufen werden')),
            pruneServerStats: (): Promise<number> => {
              aufgeraeumt += 1;

              return Promise.resolve(3);
            },
          },
          { connectedHostIds: (): readonly string[] => [] },
          silentLog,
        ),
      ],
      intervalMs: 60_000,
      log: silentLog,
      timer,
    });

    timer.fire();
    await settle();

    expect(aufgeraeumt).toBe(1);
  });

  it('räumt auch dann auf, wenn eine Node beim Abtasten wirft (Audit backend-core-05)', async () => {
    const timer = manualTimer();
    const abgetastet: string[] = [];
    let aufgeraeumt = 0;
    const fehler: Array<Record<string, unknown>> = [];

    const recordingLog: SchedulerLogger = {
      ...silentLog,
      error: (details): void => {
        fehler.push(details);
      },
    };

    startScheduler({
      tasks: [
        statsSamplingTask(
          {
            sampleServerStats: (hostId: string): Promise<readonly string[]> => {
              abgetastet.push(hostId);

              return hostId === 'node-a'
                ? Promise.reject(new Error('Verbindung abgerissen'))
                : Promise.resolve(['server-1']);
            },
            pruneServerStats: (): Promise<number> => {
              aufgeraeumt += 1;

              return Promise.resolve(0);
            },
          },
          { connectedHostIds: (): readonly string[] => ['node-a', 'node-b'] },
          recordingLog,
        ),
      ],
      intervalMs: 60_000,
      log: recordingLog,
      timer,
    });

    timer.fire();
    await settle();

    // Die zweite Node kommt dran, und die Aufbewahrungsfrist wird eingelöst –
    // beides entfiel bisher, sobald die erste Node warf.
    expect(abgetastet).toEqual(['node-a', 'node-b']);
    expect(aufgeraeumt).toBe(1);
    expect(fehler[0]).toMatchObject({ task: 'statsSampling', hostId: 'node-a' });
  });
});

// ---------------------------------------------------------------------------
// Auto-Shutdown am echten Dienst (Pflichtenheft §9)
// ---------------------------------------------------------------------------

const HOST: HostNodeRecord = {
  id: '55555555-5555-4555-8555-555555555555',
  name: 'Homeserver',
  wireguardIp: '10.10.0.2',
  status: 'online',
};

const SERVER_ID = '66666666-6666-4666-8666-666666666666';
const OWNER_ID = '77777777-7777-4777-8777-777777777777';
const NOW = new Date('2026-08-26T12:00:00.000Z');

const RESOURCE_LIMITS: ServerResourceLimits = { ramMb: 2048, cpuCores: 2, diskMb: 10_240 };

/**
 * Ein laufender Server.
 *
 * `gameType` zeigt auf eine Definition, die es in der Registry **wirklich**
 * gibt: Seit der Auto-Shutdown die Abfrageart des Spiels mitliest (Audit
 * event-flow-08), macht eine erfundene Kennung aus jedem Server einen Fall von
 * „Aktivität nicht messbar". Vorgabe ist deshalb der Minecraft-Testtyp mit
 * `gamedig`-Abfrage – das Spiel, das eine Spielerzahl liefert.
 *
 * `...overrides` steht am Ende, damit die Angaben des Aufrufers auch wirken.
 */
function runningServer(overrides: Partial<ServerRecord> = {}): ServerRecord {
  return {
    id: SERVER_ID,
    ownerId: OWNER_ID,
    ownerDisplayName: 'Besitzerin',
    hostId: HOST.id,
    hostName: HOST.name,
    name: 'Wüstensturm',
    gameType: TEST_MINECRAFT_GAME_TYPE.id,
    status: 'running',
    statusMessage: null,
    statusChangedAt: NOW.toISOString(),
    lastStartedAt: NOW.toISOString(),
    lastActivityAt: null,
    crashTimestamps: [],
    dockerContainerId: 'container-1',
    imageRef: 'ghcr.io/test:1',
    containerSpecHash: null,
    subdomain: 'wuestensturm',
    dnsRecordId: 'rec-1',
    assignedPorts: [],
    resourceLimits: RESOURCE_LIMITS,
    configJson: {} as GameConfigValues,
    startupParameters: '',
    autoShutdown: { enabled: true, idleTimeoutMinutes: 30, graceMinutes: 15 },
    restartRequired: false,
    clonedFromServerId: null,
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

/**
 * Repository für genau diesen Test.
 *
 * Bewusst nicht der vollständige Nachbau aus `service.test.ts`: Geprüft wird
 * hier der Weg Zeitgeber → Sweep → Stopp-Befehl. Alles, was dieser Weg nicht
 * berührt, meldet sich lautstark, falls es doch aufgerufen wird – ein stiller
 * Vorgabewert würde einen Testfehler in ein falsches Ergebnis verwandeln.
 */
class SweepRepository implements ServerRepository {
  server: ServerRecord;

  countByOwners(): Promise<ReadonlyMap<string, number>> {
    return Promise.resolve(new Map<string, number>());
  }

  // Anheften spielt fuer den Aufraeum-Lauf keine Rolle (Gefundener Punkt 50).
  listPinnedServerIds(): Promise<ReadonlySet<string>> {
    return Promise.resolve(new Set<string>());
  }

  pinServer(): Promise<void> {
    return Promise.resolve();
  }

  unpinServer(): Promise<void> {
    return Promise.resolve();
  }

  constructor(server: ServerRecord) {
    this.server = server;
  }

  findById(id: string): Promise<ServerRecord | null> {
    return Promise.resolve(id === this.server.id ? this.server : null);
  }

  listByHost(hostId: string): Promise<readonly ServerRecord[]> {
    return Promise.resolve(hostId === this.server.hostId ? [this.server] : []);
  }

  /** Bedingtes Fortschreiben wie im Betrieb (orchestration-core-07). */
  persistLifecycle(
    id: string,
    data: PersistLifecycleData,
    expectedStatus: ServerStatus,
  ): Promise<void> {
    if (id !== this.server.id || this.server.status !== expectedStatus) {
      return Promise.reject(
        new Error(`Unerwarteter Ausgangszustand beim Fortschreiben von ${id}.`),
      );
    }

    this.server = { ...this.server, ...data };

    return Promise.resolve();
  }

  findHost(hostId: string): Promise<HostNodeRecord | null> {
    return Promise.resolve(hostId === HOST.id ? HOST : null);
  }

  defaultHost(): Promise<HostNodeRecord | null> {
    return Promise.resolve(HOST);
  }

  countHosts(): Promise<number> {
    return Promise.resolve(1);
  }

  markHostConnected(): Promise<void> {
    return this.nichtGebraucht('markHostConnected');
  }

  markHostDisconnected(): Promise<void> {
    return this.nichtGebraucht('markHostDisconnected');
  }

  updateMeasuredResources(): Promise<void> {
    return this.nichtGebraucht('updateMeasuredResources');
  }

  private nichtGebraucht(methode: string): never {
    throw new Error(`Der Auto-Shutdown-Sweep sollte ${methode}() nicht aufrufen.`);
  }

  findByContainerId(): Promise<ServerRecord | null> {
    return this.nichtGebraucht('findByContainerId');
  }

  listAll(): Promise<readonly ServerRecord[]> {
    return this.nichtGebraucht('listAll');
  }

  listByOwnerOrMembership(): Promise<readonly ServerRecord[]> {
    return this.nichtGebraucht('listByOwnerOrMembership');
  }

  isSubdomainTaken(): Promise<boolean> {
    return this.nichtGebraucht('isSubdomainTaken');
  }

  create(_data: CreateServerData): Promise<ServerRecord> {
    return this.nichtGebraucht('create');
  }

  update(_id: string, _data: UpdateServerData): Promise<void> {
    return this.nichtGebraucht('update');
  }

  delete(): Promise<void> {
    return this.nichtGebraucht('delete');
  }

  listMembers(): Promise<readonly ServerMemberRecord[]> {
    return this.nichtGebraucht('listMembers');
  }

  listMembersOf(): Promise<ReadonlyMap<string, readonly ServerMemberRecord[]>> {
    return this.nichtGebraucht('listMembersOf');
  }

  memberLevel(): Promise<ServerMemberLevel | null> {
    return this.nichtGebraucht('memberLevel');
  }

  upsertMember(_serverId: string, _userId: string, _level: ServerMemberLevel): Promise<void> {
    return this.nichtGebraucht('upsertMember');
  }

  removeMember(): Promise<void> {
    return this.nichtGebraucht('removeMember');
  }
}

/** Socket, der jeden Befehl sofort mit Erfolg beantwortet. */
class AnsweringSocket implements AgentSocket {
  readonly commands: AgentCommandName[] = [];
  session: AgentSession | null = null;

  send(data: string): void {
    const frame = JSON.parse(data) as {
      kind: string;
      command?: AgentCommandName;
      correlationId?: string;
    };

    if (frame.kind !== 'command' || frame.command === undefined) {
      return;
    }

    this.commands.push(frame.command);

    const result: ApiResponse<unknown> = { success: true, data: null, error: null };

    queueMicrotask(() => {
      this.session?.handleMessage(
        JSON.stringify({
          kind: 'commandResult',
          correlationId: frame.correlationId,
          command: frame.command,
          result,
          duplicate: false,
          completedAt: NOW.toISOString(),
        }),
      );
    });
  }

  close(): void {
    // Der Test schließt nichts.
  }
}

const neverHealthy: HealthProbe = {
  check: () => new Promise(() => undefined),
};

interface SweepHarness {
  readonly repository: SweepRepository;
  readonly socket: AnsweringSocket;
  readonly agents: AgentRegistry;
  readonly service: ServerOrchestrationService;
  advance(ms: number): void;
}

function makeSweepHarness(server: ServerRecord): SweepHarness {
  const repository = new SweepRepository(server);
  const agents = new AgentRegistry();
  const socket = new AnsweringSocket();

  const session = new AgentSession({
    hostId: HOST.id,
    socket,
    handlers: { onStateReport: () => undefined, onEvent: () => undefined },
    log: silentLog,
    commandTimeoutMs: 1_000,
  });

  socket.session = session;
  session.handleMessage(
    JSON.stringify({
      kind: 'hello',
      protocolVersion: 1,
      agentVersion: 'test',
      sentAt: NOW.toISOString(),
    }),
  );
  agents.register(session);

  let clock = NOW.getTime();

  const service = new ServerOrchestrationService({
    repository,
    agents,
    registry: createGameRegistry(1, ALLE_GAME_TYPE_DEFINITIONS),
    dns: {
      upsertRecord: () => Promise.resolve('rec-1'),
      deleteRecord: () => Promise.resolve(),
    },
    ports: createPortAllocator({
      allocateForServer: () => Promise.resolve([]),
      releaseForServer: () => Promise.resolve(0),
    }),
    resources: createPermissiveResourceGuard(() => undefined),
    healthProbe: neverHealthy,
    events: { emit: (): void => undefined },
    log: silentLog,
    config: {
      baseDomain: 'example.tld',
      publicIpv4: '203.0.113.10',
      routerHostname: null,
      virtualHostPort: 25_565,
      crashLoopPolicy: { maxRestarts: 2, windowMinutes: 10 },
      healthCheckIntervalMs: 5_000,
      healthCheckAttemptTimeoutMs: 1_000,
      createTimeoutMs: 900_000,
      maxUploadBytes: 2 * 1024 * 1024 * 1024,
      maxWorldArchiveBytes: 64 * 1024 * 1024,
      statsHistoryRetentionHours: 48,
      statsSampleIntervalMs: 60_000,
      defaultAutoShutdown: { enabled: true, idleTimeoutMinutes: 30, graceMinutes: 15 },
    },
    now: (): Date => new Date(clock),
  });

  return {
    repository,
    socket,
    agents,
    service,
    advance: (ms: number): void => {
      clock += ms;
    },
  };
}

describe('Zeitgeber: Auto-Shutdown (Pflichtenheft §9)', () => {
  it('lässt einen Server unberührt, solange die Schonfrist läuft', async () => {
    const harness = makeSweepHarness(runningServer());
    const timer = manualTimer();

    startScheduler({
      tasks: [autoShutdownTask(harness.service, harness.agents, silentLog)],
      intervalMs: 60_000,
      log: silentLog,
      timer,
    });

    // 14 Minuten nach dem Start – die Schonfrist beträgt 15 Minuten. Auch die
    // Inaktivität ist damit rechnerisch schon länger als nichts, aber die
    // Schonfrist geht vor.
    harness.advance(14 * 60_000);

    for (let takt = 0; takt < 14; takt += 1) {
      timer.fire();
      await settle();
    }

    expect(harness.socket.commands).toEqual([]);
    expect(harness.repository.server.status).toBe('running');
  });

  it('schaltet erst nach Schonfrist und Inaktivitäts-Timeout ab', async () => {
    const harness = makeSweepHarness(runningServer());
    const timer = manualTimer();

    startScheduler({
      tasks: [autoShutdownTask(harness.service, harness.agents, silentLog)],
      intervalMs: 60_000,
      log: silentLog,
      timer,
    });

    // Schonfrist (15) ist vorbei, das Inaktivitäts-Timeout (30) noch nicht.
    harness.advance(20 * 60_000);
    timer.fire();
    await settle();

    expect(harness.socket.commands).toEqual([]);

    harness.advance(15 * 60_000);
    timer.fire();
    await settle();

    // Neben dem Stopp steht seit Punkt 74 das Beenden der periodischen Abfrage;
    // geprüft wird hier der Auto-Shutdown, nicht die Begleitbefehle.
    expect(harness.socket.commands.filter((name) => name === 'STOP')).toEqual(['STOP']);
    expect(harness.repository.server.status).toBe('stopped');
  });

  it('lässt ein Spiel ohne Spielerzahl laufen (Audit event-flow-08)', async () => {
    /*
     * Der Echo-Testtyp kennt nur den Port-Connect-Test: Der Agent meldet nie
     * eine Spielerzahl, `lastActivityAt` bleibt deshalb leer. Bisher rechnete
     * der Auto-Shutdown dann ab dem Startzeitpunkt und schaltete den Server 30
     * Minuten nach dem Start ab – für einen Server mit verbundenen Spielern das
     * Gegenteil dessen, was „bei Inaktivität abschalten" meint.
     */
    const harness = makeSweepHarness(runningServer({ gameType: TEST_GAME_TYPE.id }));
    const timer = manualTimer();

    startScheduler({
      tasks: [autoShutdownTask(harness.service, harness.agents, silentLog)],
      intervalMs: 60_000,
      log: silentLog,
      timer,
    });

    // Weit jenseits von Schonfrist und Inaktivitäts-Timeout.
    harness.advance(6 * 60 * 60_000);

    for (let takt = 0; takt < 3; takt += 1) {
      timer.fire();
      await settle();
    }

    expect(harness.socket.commands).toEqual([]);
    expect(harness.repository.server.status).toBe('running');
  });

  it('lässt eine kaputte Node die übrigen nicht aufhalten (Audit backend-core-05)', async () => {
    /*
     * Der Sweep der ersten Node wirft – in der Praxis ein Datenbankfehler beim
     * Laden ihrer Server. Bisher brach die `for`-Schleife im Zeitgeber dort ab
     * und jede weitere Node blieb in diesem Takt unbearbeitet; im nächsten Takt
     * begann dasselbe wieder bei derselben Node.
     */
    const timer = manualTimer();
    const besucht: string[] = [];
    const fehler: Array<Record<string, unknown>> = [];

    const recordingLog: SchedulerLogger = {
      ...silentLog,
      error: (details): void => {
        fehler.push(details);
      },
    };

    startScheduler({
      tasks: [
        autoShutdownTask(
          {
            runAutoShutdownSweep: (hostId: string): Promise<readonly string[]> => {
              besucht.push(hostId);

              return hostId === 'node-kaputt'
                ? Promise.reject(new Error('Node antwortet nicht'))
                : Promise.resolve([]);
            },
          },
          { connectedHostIds: (): readonly string[] => ['node-kaputt', 'node-b', 'node-c'] },
          recordingLog,
        ),
      ],
      intervalMs: 60_000,
      log: recordingLog,
      timer,
    });

    timer.fire();
    await settle();

    expect(besucht).toEqual(['node-kaputt', 'node-b', 'node-c']);
    expect(fehler).toHaveLength(1);
    expect(fehler[0]).toMatchObject({
      task: 'autoShutdown',
      hostId: 'node-kaputt',
      error: 'Node antwortet nicht',
    });
  });

  it('rührt Nodes ohne Agent-Verbindung nicht an', async () => {
    const harness = makeSweepHarness(runningServer());
    const timer = manualTimer();

    startScheduler({
      tasks: [autoShutdownTask(harness.service, harness.agents, silentLog)],
      intervalMs: 60_000,
      log: silentLog,
      timer,
    });

    harness.agents.closeAll();
    harness.advance(60 * 60_000);

    timer.fire();
    await settle();

    expect(harness.socket.commands).toEqual([]);
    expect(harness.repository.server.status).toBe('running');
  });
});

describe('Zeitgeber: Ressourcen-Warnungen', () => {
  const NODE_ID = '11111111-1111-4111-8111-111111111111';

  /** Eine Warnung auf Node-Ebene, wie sie B4 (`evaluateNodeWarnings`) liefert. */
  function nodeWarning(usedPercent: number): ResourceLowEvent {
    return {
      scope: 'node',
      resource: 'ram',
      unit: 'mb',
      nodeId: NODE_ID,
      serverId: null,
      used: 30_000,
      total: 32_768,
      usedPercent,
      thresholdPercent: 85,
      at: '2026-08-30T00:00:00.000Z',
    };
  }

  /** Senke, die jede gemeldete `resource.low`-Nutzlast festhält. */
  function capturingSink(): ResourceEventSink & {
    readonly events: { event: string; payload: Record<string, unknown> }[];
  } {
    const events: { event: string; payload: Record<string, unknown> }[] = [];

    return {
      events,
      emit(event, payload): void {
        events.push({ event, payload });
      },
    };
  }

  const SERVER_ID = '55555555-5555-4555-8555-555555555555';
  const BESITZER_ID = '66666666-6666-4666-8666-666666666666';
  const LIMITS = { ramMb: 4096, cpuCores: 2, diskMb: 20_480 };

  /** Eine Messung, wie B3 sie beim Abtasten des Verlaufs schreibt. */
  function last(overrides: Partial<ServerLoadSnapshot> = {}): ServerLoadSnapshot {
    return {
      serverId: SERVER_ID,
      nodeId: NODE_ID,
      ownerId: BESITZER_ID,
      limits: LIMITS,
      usedRamMb: 1024,
      usedCpuCores: 0.2,
      usedDiskMb: null,
      ...overrides,
    };
  }

  /**
   * Auswertung wie im Betrieb: Die Node-Ebene liefert vorgegebene Warnungen,
   * die Server-Ebene rechnet mit der echten Schwellwertfunktion aus B4 – sonst
   * prüfte der Test nur seine eigene Attrappe.
   */
  function evaluator(nodeWarnings: readonly ResourceLowEvent[] = []): NodeWarningEvaluator {
    return {
      evaluateAllNodeWarnings: () => Promise.resolve(nodeWarnings),
      evaluateAllServerWarnings: (loads) =>
        loads.flatMap((load) =>
          evaluateServerWarnings({
            serverId: load.serverId,
            nodeId: load.nodeId,
            limits: load.limits,
            usedRamMb: load.usedRamMb,
            usedCpuCores: load.usedCpuCores,
            usedDiskMb: load.usedDiskMb,
            thresholdPercent: 90,
            at: new Date('2026-08-30T00:00:00.000Z'),
          }),
        ),
    };
  }

  /** Messwert-Quelle, die ein Test zwischen zwei Takten ändern kann. */
  function loadSource(anfang: ServerLoadSnapshot[] = []): ServerLoadSource & {
    loads: ServerLoadSnapshot[];
  } {
    const quelle = {
      loads: anfang,
      listServerLoads: (): readonly ServerLoadSnapshot[] => quelle.loads,
    };

    return quelle;
  }

  it('meldet resource.low, wenn eine Node über dem Schwellwert liegt', async () => {
    const timer = manualTimer();
    const sink = capturingSink();

    startScheduler({
      tasks: [resourceWarningTask(evaluator([nodeWarning(91.5)]), loadSource(), sink, silentLog)],
      intervalMs: 60_000,
      log: silentLog,
      timer,
    });

    timer.fire();
    await settle();

    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]?.event).toBe('resource.low');
    // ResourceLowEvent-Felder unverändert, nur `ownerId` ergänzt (Node: null).
    expect(sink.events[0]?.payload).toMatchObject({
      scope: 'node',
      nodeId: NODE_ID,
      usedPercent: 91.5,
      thresholdPercent: 85,
      ownerId: null,
    });
  });

  it('meldet nichts, solange keine Node über dem Schwellwert liegt', async () => {
    const timer = manualTimer();
    const sink = capturingSink();

    startScheduler({
      tasks: [resourceWarningTask(evaluator(), loadSource(), sink, silentLog)],
      intervalMs: 60_000,
      log: silentLog,
      timer,
    });

    timer.fire();
    await settle();

    expect(sink.events).toEqual([]);
  });

  it('meldet einen Server über seinem eigenen Limit an dessen Besitzer', async () => {
    // Genau der Fall aus Lastenheft §3.3, der bisher fehlte: Die Node hat noch
    // Luft (keine Node-Warnung), der einzelne Server nicht mehr.
    const timer = manualTimer();
    const sink = capturingSink();
    const quelle = loadSource([last({ usedRamMb: 3900 })]);

    startScheduler({
      tasks: [resourceWarningTask(evaluator(), quelle, sink, silentLog)],
      intervalMs: 60_000,
      log: silentLog,
      timer,
    });

    timer.fire();
    await settle();

    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]?.payload).toMatchObject({
      scope: 'server',
      resource: 'ram',
      nodeId: NODE_ID,
      serverId: SERVER_ID,
      // Ohne diesen Eintrag stünde die Warnung nur im Ereignisstrom: Der
      // Empfängerkreis `resourceOwner` löst sie über `ownerId` auf.
      ownerId: BESITZER_ID,
      usedPercent: 95.2,
      thresholdPercent: 90,
    });
  });

  it('schweigt zu einem Server unter seinem Schwellwert', async () => {
    const timer = manualTimer();
    const sink = capturingSink();

    startScheduler({
      tasks: [resourceWarningTask(evaluator(), loadSource([last()]), sink, silentLog)],
      intervalMs: 60_000,
      log: silentLog,
      timer,
    });

    timer.fire();
    await settle();

    expect(sink.events).toEqual([]);
  });

  it('macht aus einem fehlenden Messwert keine Warnung', async () => {
    const timer = manualTimer();
    const sink = capturingSink();
    const quelle = loadSource([last({ usedRamMb: null, usedCpuCores: null, usedDiskMb: null })]);

    startScheduler({
      tasks: [resourceWarningTask(evaluator(), quelle, sink, silentLog)],
      intervalMs: 60_000,
      log: silentLog,
      timer,
    });

    timer.fire();
    await settle();

    expect(sink.events).toEqual([]);
  });

  it('meldet nichts zu einem Server, den niemand mehr misst', async () => {
    /*
     * Gestoppt, gelöscht oder seit zwei Takten nicht gemessen: Der Server steht
     * dann gar nicht mehr in der Quelle. Seine letzten Werte sind veraltet –
     * eine Warnung daraus wäre eine Meldung über einen Zustand, den es nicht
     * mehr gibt.
     */
    const timer = manualTimer();
    const sink = capturingSink();
    const quelle = loadSource([last({ usedRamMb: 3900 })]);

    startScheduler({
      tasks: [resourceWarningTask(evaluator(), quelle, sink, silentLog)],
      intervalMs: 60_000,
      log: silentLog,
      timer,
    });

    quelle.loads = [];
    timer.fire();
    await settle();

    expect(sink.events).toEqual([]);
  });

  it('meldet eine anhaltende Lage einmal je Zustandswechsel, nicht in jedem Takt', async () => {
    const timer = manualTimer();
    const sink = capturingSink();
    const quelle = loadSource([last({ usedRamMb: 3900 })]);

    startScheduler({
      tasks: [resourceWarningTask(evaluator([nodeWarning(91.5)]), quelle, sink, silentLog)],
      intervalMs: 60_000,
      log: silentLog,
      timer,
    });

    // Drei Takte über der Schwelle – im Betrieb dauert eine knappe Lage
    // Minuten bis Stunden an.
    for (let takt = 0; takt < 3; takt += 1) {
      timer.fire();
      await settle();
    }

    expect(sink.events).toHaveLength(2);
    expect(sink.events.map((eintrag) => eintrag.payload.scope)).toEqual(['node', 'server']);

    // Wieder unter der Schwelle: keine neue Meldung, aber die Lage gilt als
    // beendet.
    quelle.loads = [last()];
    timer.fire();
    await settle();

    expect(sink.events).toHaveLength(2);

    // Erneut darüber – das ist ein neuer Zustandswechsel und wieder eine
    // Meldung wert.
    quelle.loads = [last({ usedRamMb: 3900 })];
    timer.fire();
    await settle();

    expect(sink.events).toHaveLength(3);
    expect(sink.events[2]?.payload).toMatchObject({ scope: 'server', ownerId: BESITZER_ID });
  });
});

describe('Zeitgeber: Kehraus der Sicherungen (Audit W1-6)', () => {
  /** Mitschreibende Attrappe der Backup-Verwaltung. */
  function housekeeper(
    overrides: Partial<BackupHousekeeper> = {},
  ): BackupHousekeeper & { readonly laeufe: string[] } {
    const laeufe: string[] = [];

    return {
      laeufe,
      sweepOrphanedRuns(): Promise<string[]> {
        laeufe.push('sweep');

        return Promise.resolve(['backup-1']);
      },
      applyRetentionToAll(): Promise<{ removedBackupIds: string[] }> {
        laeufe.push('retention');

        return Promise.resolve({ removedBackupIds: [] });
      },
      ...overrides,
    };
  }

  function panelHousekeeper(): PanelBackupHousekeeper & { readonly laeufe: string[] } {
    const laeufe: string[] = [];

    return {
      laeufe,
      sweepOrphanedRun(): Promise<string | null> {
        laeufe.push('panel');

        return Promise.resolve(null);
      },
    };
  }

  it('läuft beim ersten Takt – dann liegen die abgerissenen Läufe herum', async () => {
    const timer = manualTimer();
    const backups = housekeeper();
    const panel = panelHousekeeper();

    startScheduler({
      tasks: [backupHousekeepingTask(backups, panel, silentLog)],
      intervalMs: 60_000,
      log: silentLog,
      timer,
    });

    timer.fire();
    await settle();

    expect(backups.laeufe).toEqual(['sweep', 'retention']);
    expect(panel.laeufe).toEqual(['panel']);
  });

  it('lädt nicht in jeder Minute den gesamten Bestand', async () => {
    const timer = manualTimer();
    const backups = housekeeper();
    const panel = panelHousekeeper();
    let jetzt = new Date('2026-09-01T03:00:00.000Z');

    startScheduler({
      tasks: [
        backupHousekeepingTask(backups, panel, silentLog, {
          intervalMs: 5 * 60_000,
          now: () => jetzt,
        }),
      ],
      intervalMs: 60_000,
      log: silentLog,
      timer,
    });

    timer.fire();
    await settle();

    // Eine Minute später: nichts zu tun, hier ist nichts minutengenau fällig.
    jetzt = new Date('2026-09-01T03:01:00.000Z');
    timer.fire();
    await settle();

    expect(backups.laeufe).toEqual(['sweep', 'retention']);

    // Nach dem eigenen Abstand läuft er wieder.
    jetzt = new Date('2026-09-01T03:06:00.000Z');
    timer.fire();
    await settle();

    expect(backups.laeufe).toEqual(['sweep', 'retention', 'sweep', 'retention']);
  });

  it('lässt einen gescheiterten Schritt die übrigen nicht aufhalten', async () => {
    const timer = manualTimer();
    const panel = panelHousekeeper();
    const backups = housekeeper({
      sweepOrphanedRuns: () => Promise.reject(new Error('Datenbank weg')),
    });

    startScheduler({
      tasks: [backupHousekeepingTask(backups, panel, silentLog)],
      intervalMs: 60_000,
      log: silentLog,
      timer,
    });

    timer.fire();
    await settle();

    // Der Kehraus der abgerissenen Läufe scheitert – Panel-Abzug und
    // Aufbewahrung laufen trotzdem.
    expect(backups.laeufe).toEqual(['retention']);
    expect(panel.laeufe).toEqual(['panel']);
  });
});

/**
 * Periodischer Soll/Ist-Abgleich (Fundpunkt 232).
 *
 * `AgentSession.requestState()` gab es seit A1 - aufgerufen hat sie niemand.
 * Abgeglichen wurde deshalb nur beim Verbindungsaufbau des Agents: Wer einen
 * Container auf der Node von Hand stoppte, sah im Panel bis zum naechsten
 * Neustart des Agents "laeuft".
 */
describe('stateReconcileTask (Fundpunkt 232)', () => {
  function aufbau(hostIds: readonly string[]) {
    const gefragt: string[] = [];
    let jetzt = 0;

    const aufgabe = stateReconcileTask(
      { connectedHostIds: () => hostIds },
      {
        requestState: (hostId) => {
          gefragt.push(hostId);
        },
      },
      mitschreibendesLog(),
      { intervalMs: 5 * 60 * 1000, now: () => new Date(jetzt) },
    );

    return {
      gefragt,
      aufgabe,
      stelleUhr(ms: number) {
        jetzt = ms;
      },
    };
  }

  it('fragt jede verbundene Node nach ihrem Ist-Zustand', async () => {
    const t = aufbau(['node-a', 'node-b']);

    await t.aufgabe.run();

    expect(t.gefragt).toEqual(['node-a', 'node-b']);
  });

  it('fragt nicht in jedem Takt, sondern im eigenen Abstand', async () => {
    const t = aufbau(['node-a']);

    await t.aufgabe.run();
    // Eine Minute spaeter - der Zeitgeber laeuft, der Abgleich nicht.
    t.stelleUhr(60_000);
    await t.aufgabe.run();

    expect(t.gefragt).toEqual(['node-a']);

    t.stelleUhr(5 * 60 * 1000 + 1);
    await t.aufgabe.run();

    expect(t.gefragt).toEqual(['node-a', 'node-a']);
  });

  it('laesst eine abreissende Node die uebrigen nicht mitreissen', async () => {
    const gefragt: string[] = [];
    const aufgabe = stateReconcileTask(
      { connectedHostIds: () => ['kaputt', 'heil'] },
      {
        requestState: (hostId) => {
          if (hostId === 'kaputt') throw new Error('Verbindung weg');
          gefragt.push(hostId);
        },
      },
      mitschreibendesLog(),
    );

    await aufgabe.run();

    expect(gefragt).toEqual(['heil']);
  });

  it('fragt niemanden, wenn keine Node verbunden ist', async () => {
    const t = aufbau([]);

    await t.aufgabe.run();

    expect(t.gefragt).toEqual([]);
  });
});
