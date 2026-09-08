/**
 * Backup-Befehle über den Agent-Kanal (R2, Gefundener Punkt 33).
 *
 * Geprüft wird die Übersetzung, die B5 erwartet und die dieses Modul liefert:
 *
 * - Fehler kommen als Response-Envelope zurück (Pflichtenheft §5.1) und werden
 *   **nicht** geworfen – im Hintergrundlauf eines Backups würde ein geworfener
 *   Fehler unbeachtet verpuffen.
 * - Die Node wird je Befehl aufgelöst: über die `serverId`, wo es eine gibt,
 *   sonst über die Node, die am Backup-Datensatz steht (Fundpunkt 174) – und
 *   erst wenn dort nichts steht, über die Node der Installation.
 * - `CREATE_BACKUP` und `RESTORE_BACKUP` laufen in einer eigenen, langen Frist
 *   (Audit W1-5, bb-02); die kurzen Befehle bleiben bei der üblichen.
 */

import { type AgentCommandName, type ApiResponse } from '@palantir/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type BackupAgentGateway } from '../backups/index.js';
import {
  type AgentGatewayLogger,
  AgentRegistry,
  AgentSession,
  type AgentSocket,
} from './agent-gateway.js';
import { type BackupHostResolver, createAgentBackupGateway } from './backup-ports.js';

const HOST_ID = '88888888-8888-4888-8888-888888888888';
const OTHER_HOST_ID = '99999999-9999-4999-8999-999999999999';
const SERVER_ID = '12121212-1212-4212-8212-121212121212';
const BACKUP_ID = '13131313-1313-4313-8313-131313131313';
const NOW = new Date('2026-08-26T12:00:00.000Z');

/** Übliche Befehlsfrist der Sitzung im Test (siehe `connect`). */
const UEBLICHE_FRIST_MS = 1_000;

/** Eigene Frist der langen Backup-Befehle – im Betrieb `BACKUP_COMMAND_TIMEOUT_MS`. */
const BACKUP_FRIST_MS = 60_000;

const silentLog = {
  info: (): void => undefined,
  warn: (): void => undefined,
  error: (): void => undefined,
};

/** Log, das Warnungen mitschreibt – der Rückfall muss darin auftauchen. */
interface MitschriftLog extends AgentGatewayLogger {
  readonly warnungen: { details: Record<string, unknown>; message: string }[];
}

function mitschriftLog(): MitschriftLog {
  const warnungen: { details: Record<string, unknown>; message: string }[] = [];

  return {
    warnungen,
    info: (): void => undefined,
    warn: (details, message): void => {
      warnungen.push({ details, message });
    },
    error: (): void => undefined,
  };
}

/** Socket, der jeden Befehl mit der hinterlegten Antwort beantwortet. */
class ScriptedSocket implements AgentSocket {
  readonly commands: { command: AgentCommandName; serverId: string | null }[] = [];
  session: AgentSession | null = null;
  answer: ApiResponse<unknown> = { success: true, data: { ok: true }, error: null };
  /** Auf `false` gesetzt schweigt der Agent – so wie einer, der noch packt. */
  answers = true;

  send(data: string): void {
    const frame = JSON.parse(data) as {
      kind: string;
      command?: AgentCommandName;
      correlationId?: string;
      serverId?: string | null;
    };

    if (frame.kind !== 'command' || frame.command === undefined) {
      return;
    }

    this.commands.push({ command: frame.command, serverId: frame.serverId ?? null });

    if (!this.answers) {
      return;
    }

    queueMicrotask(() => {
      this.session?.handleMessage(
        JSON.stringify({
          kind: 'commandResult',
          correlationId: frame.correlationId,
          command: frame.command,
          result: this.answer,
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

function connect(agents: AgentRegistry, hostId: string): ScriptedSocket {
  const socket = new ScriptedSocket();
  const session = new AgentSession({
    hostId,
    socket,
    handlers: { onStateReport: () => undefined, onEvent: () => undefined },
    log: silentLog,
    commandTimeoutMs: UEBLICHE_FRIST_MS,
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

  return socket;
}

const resolver: BackupHostResolver = {
  findById: (serverId) => Promise.resolve(serverId === SERVER_ID ? { hostId: HOST_ID } : null),
  defaultHost: () => Promise.resolve({ id: HOST_ID }),
};

function makeGateway(
  agents: AgentRegistry,
  repository: BackupHostResolver = resolver,
  log: AgentGatewayLogger = silentLog,
): BackupAgentGateway {
  return createAgentBackupGateway({ agents, repository, log, backupTimeoutMs: BACKUP_FRIST_MS });
}

/** Archiv, dessen Node am Datensatz steht (der Regelfall seit Fundpunkt 174). */
function auf(hostId: string): { readonly hostId: string | null } {
  return { hostId };
}

/** Archiv ohne Node am Datensatz – alte Zeile oder ausgemusterte Node. */
const OHNE_NODE = { hostId: null } as const;

describe('Backup-Befehle über den Agent-Kanal (Pflichtenheft §5.3)', () => {
  it('schickt CREATE_BACKUP an die Node des Servers', async () => {
    const agents = new AgentRegistry();
    const socket = connect(agents, HOST_ID);
    const gateway = makeGateway(agents);

    const response = await gateway.createBackup({
      backupId: BACKUP_ID,
      serverId: SERVER_ID,
      sourcePath: '/srv/palantir/servers/x',
      stopContainer: false,
    });

    expect(response.success).toBe(true);
    expect(socket.commands).toEqual([{ command: 'CREATE_BACKUP', serverId: SERVER_ID }]);
  });

  it('schickt DELETE_BACKUP an die Node, die am Backup steht – auch ohne Server', async () => {
    const agents = new AgentRegistry();
    const socket = connect(agents, HOST_ID);
    const gateway = makeGateway(agents);

    const response = await gateway.deleteBackup(
      {
        backupId: BACKUP_ID,
        storagePath: '/srv/palantir/backups/a.tar.zst',
      },
      auf(HOST_ID),
    );

    expect(response.success).toBe(true);
    // Kein `serverId` im Rahmen: Der Befehl arbeitet auf einem Archivpfad, der
    // Server kann längst gelöscht sein.
    expect(socket.commands).toEqual([{ command: 'DELETE_BACKUP', serverId: null }]);
  });

  it('meldet AGENT_NOT_CONNECTED, statt zu werfen', async () => {
    const agents = new AgentRegistry();
    connect(agents, OTHER_HOST_ID);
    const gateway = makeGateway(agents);

    const response = await gateway.createBackup({
      backupId: BACKUP_ID,
      serverId: SERVER_ID,
      sourcePath: '/srv/palantir/servers/x',
    });

    expect(response.success).toBe(false);
    expect(response.error?.code).toBe('AGENT_NOT_CONNECTED');
  });

  it('meldet SERVER_NOT_FOUND-Fälle als fehlende Node, statt einen Befehl blind zu schicken', async () => {
    const agents = new AgentRegistry();
    const socket = connect(agents, HOST_ID);
    const gateway = makeGateway(agents, {
      ...resolver,
      defaultHost: () => Promise.resolve(null),
    });

    const response = await gateway.downloadBackupChunk(
      {
        backupId: BACKUP_ID,
        storagePath: '/srv/palantir/backups/a.tar.zst',
        offset: 0,
        maxBytes: 1024,
      },
      OHNE_NODE,
    );

    expect(response.success).toBe(false);
    expect(response.error?.code).toBe('AGENT_NOT_CONNECTED');
    expect(socket.commands).toEqual([]);
  });

  it('reicht den benannten Fehlercode des Agents durch', async () => {
    const agents = new AgentRegistry();
    const socket = connect(agents, HOST_ID);

    socket.answer = {
      success: false,
      data: null,
      error: { code: 'AGENT_COMMAND_NOT_IMPLEMENTED', message: 'Noch nicht gebaut (A3).' },
    };

    const gateway = makeGateway(agents);
    const response = await gateway.restoreBackup({
      backupId: BACKUP_ID,
      serverId: SERVER_ID,
      storagePath: '/srv/palantir/backups/a.tar.zst',
      targetPath: '/srv/palantir/servers/x',
      expectedChecksum: 'a'.repeat(64),
    });

    expect(response.success).toBe(false);
    expect(response.error?.code).toBe('AGENT_COMMAND_NOT_IMPLEMENTED');
  });
});

/**
 * Ein Backup weiß, auf welcher Node es liegt (Fundpunkt 174).
 *
 * Mit **einer** Node belegt kein Test etwas: Jeder Weg endet dort. Deshalb
 * laufen hier zwei Agents, und die Node der Installation (`defaultHost()`) ist
 * ausdrücklich die **andere** – trifft der Befehl trotzdem die Node des
 * Archivs, kann das kein Zufall sein.
 */
describe('Node des Archivs bei zwei Nodes', () => {
  /** Node der Installation ist `OTHER_HOST_ID`, das Archiv liegt auf `HOST_ID`. */
  const zweiNodes: BackupHostResolver = {
    findById: (serverId) => Promise.resolve(serverId === SERVER_ID ? { hostId: HOST_ID } : null),
    defaultHost: () => Promise.resolve({ id: OTHER_HOST_ID }),
  };

  function beideNodes(): {
    agents: AgentRegistry;
    archivNode: ScriptedSocket;
    standardNode: ScriptedSocket;
  } {
    const agents = new AgentRegistry();

    return {
      agents,
      archivNode: connect(agents, HOST_ID),
      standardNode: connect(agents, OTHER_HOST_ID),
    };
  }

  it('schickt DOWNLOAD_BACKUP an die Node des Archivs, nicht an die Standard-Node', async () => {
    const { agents, archivNode, standardNode } = beideNodes();
    const gateway = makeGateway(agents, zweiNodes);

    const response = await gateway.downloadBackupChunk(
      {
        backupId: BACKUP_ID,
        storagePath: '/srv/palantir/backups/a.tar.zst',
        offset: 0,
        maxBytes: 1024,
      },
      auf(HOST_ID),
    );

    expect(response.success).toBe(true);
    expect(archivNode.commands).toEqual([{ command: 'DOWNLOAD_BACKUP', serverId: null }]);
    expect(standardNode.commands).toEqual([]);
  });

  it('schickt DELETE_BACKUP an die Node des Archivs, nicht an die Standard-Node', async () => {
    const { agents, archivNode, standardNode } = beideNodes();
    const gateway = makeGateway(agents, zweiNodes);

    const response = await gateway.deleteBackup(
      { backupId: BACKUP_ID, storagePath: '/srv/palantir/backups/a.tar.zst' },
      auf(HOST_ID),
    );

    expect(response.success).toBe(true);
    expect(archivNode.commands).toEqual([{ command: 'DELETE_BACKUP', serverId: null }]);
    expect(standardNode.commands).toEqual([]);
  });

  it('fällt ohne Node am Datensatz auf die Node der Installation zurück und meldet das', async () => {
    const { agents, archivNode, standardNode } = beideNodes();
    const log = mitschriftLog();
    const gateway = makeGateway(agents, zweiNodes, log);

    const response = await gateway.deleteBackup(
      { backupId: BACKUP_ID, storagePath: '/srv/palantir/backups/alt.tar.zst' },
      OHNE_NODE,
    );

    expect(response.success).toBe(true);
    // Der bisherige Weg bleibt erhalten – sonst wäre die Verbesserung für alte
    // Zeilen ein Rückschritt.
    expect(standardNode.commands).toEqual([{ command: 'DELETE_BACKUP', serverId: null }]);
    expect(archivNode.commands).toEqual([]);

    // Aber nicht stillschweigend: Findet der Agent die Datei dort nicht, steht
    // im Log, warum überhaupt dort gesucht wurde.
    expect(log.warnungen).toHaveLength(1);
    expect(log.warnungen[0]?.details).toMatchObject({
      command: 'DELETE_BACKUP',
      backupId: BACKUP_ID,
      hostId: OTHER_HOST_ID,
    });
  });

  it('meldet den Rückfall auch beim Herunterladen', async () => {
    const { agents } = beideNodes();
    const log = mitschriftLog();
    const gateway = makeGateway(agents, zweiNodes, log);

    await gateway.downloadBackupChunk(
      {
        backupId: BACKUP_ID,
        storagePath: '/srv/palantir/backups/alt.tar.zst',
        offset: 0,
        maxBytes: 1024,
      },
      OHNE_NODE,
    );

    expect(log.warnungen.map((eintrag) => eintrag.details['command'])).toEqual(['DOWNLOAD_BACKUP']);
  });

  it('schweigt, solange die Node am Datensatz steht', async () => {
    const { agents } = beideNodes();
    const log = mitschriftLog();
    const gateway = makeGateway(agents, zweiNodes, log);

    await gateway.deleteBackup(
      { backupId: BACKUP_ID, storagePath: '/srv/palantir/backups/a.tar.zst' },
      auf(HOST_ID),
    );

    expect(log.warnungen).toEqual([]);
  });
});

/**
 * Fristen der Backup-Befehle (Audit W1-5, bb-02).
 *
 * Geprüft wird nicht das Optionsobjekt selbst, sondern was es bewirkt: Der
 * Agent schweigt (`answers = false`), die Uhr wird vorgestellt, und der
 * Zeitpunkt des `AGENT_COMMAND_TIMEOUT` verrät, welche Frist gegolten hat.
 */
describe('Eigene Frist für die langen Backup-Befehle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lässt CREATE_BACKUP über die übliche Befehlsfrist hinaus laufen', async () => {
    const agents = new AgentRegistry();
    const socket = connect(agents, HOST_ID);

    socket.answers = false;

    const gateway = makeGateway(agents);
    let fertig = false;
    const laufend = gateway
      .createBackup({
        backupId: BACKUP_ID,
        serverId: SERVER_ID,
        sourcePath: '/srv/palantir/servers/x',
        stopContainer: false,
      })
      .then((response) => {
        fertig = true;

        return response;
      });

    // Node auflösen und Befehl abschicken passiert in Mikrotasks.
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.commands).toEqual([{ command: 'CREATE_BACKUP', serverId: SERVER_ID }]);

    // Nach der üblichen Frist packt der Agent noch – der Befehl bleibt offen.
    await vi.advanceTimersByTimeAsync(UEBLICHE_FRIST_MS + 500);
    expect(fertig).toBe(false);

    // Erst die eigene Backup-Frist beendet ihn.
    await vi.advanceTimersByTimeAsync(BACKUP_FRIST_MS);

    const response = await laufend;

    expect(response.success).toBe(false);
    expect(response.error?.code).toBe('AGENT_COMMAND_TIMEOUT');
  });

  it('lässt RESTORE_BACKUP über die übliche Befehlsfrist hinaus laufen', async () => {
    const agents = new AgentRegistry();
    const socket = connect(agents, HOST_ID);

    socket.answers = false;

    const gateway = makeGateway(agents);
    let fertig = false;
    const laufend = gateway
      .restoreBackup({
        backupId: BACKUP_ID,
        serverId: SERVER_ID,
        storagePath: '/srv/palantir/backups/a.tar.zst',
        targetPath: '/srv/palantir/servers/x',
        expectedChecksum: 'a'.repeat(64),
      })
      .then((response) => {
        fertig = true;

        return response;
      });

    await vi.advanceTimersByTimeAsync(UEBLICHE_FRIST_MS + 500);
    expect(fertig).toBe(false);
    expect(socket.commands).toEqual([{ command: 'RESTORE_BACKUP', serverId: SERVER_ID }]);

    await vi.advanceTimersByTimeAsync(BACKUP_FRIST_MS);

    const response = await laufend;

    expect(response.error?.code).toBe('AGENT_COMMAND_TIMEOUT');
  });

  it('belässt DELETE_BACKUP bei der üblichen Frist – ein Dateilöschen dauert nicht', async () => {
    const agents = new AgentRegistry();
    const socket = connect(agents, HOST_ID);

    socket.answers = false;

    const gateway = makeGateway(agents);
    const laufend = gateway.deleteBackup(
      {
        backupId: BACKUP_ID,
        storagePath: '/srv/palantir/backups/a.tar.zst',
      },
      auf(HOST_ID),
    );

    await vi.advanceTimersByTimeAsync(UEBLICHE_FRIST_MS + 1);

    const response = await laufend;

    expect(response.error?.code).toBe('AGENT_COMMAND_TIMEOUT');
  });
});
