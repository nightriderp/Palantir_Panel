import { IMPLEMENTED_AGENT_COMMANDS } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { getStorageBreakdownPayloadSchema } from './storage.js';
import {
  AGENT_COMMAND_PAYLOAD_SCHEMAS,
  createCommandPayloadSchema,
  execConsoleCommandPayloadSchema,
  fileWriteCommandPayloadSchema,
  getLogsCommandPayloadSchema,
  removeStorageEntryCommandPayloadSchema,
  setServerQueryCommandPayloadSchema,
  stopCommandPayloadSchema,
} from './agent-commands.js';

const GUELTIGER_SPEC = {
  name: 'palantir-test',
  image: 'palantir/testserver:1',
  env: { EULA: 'true' },
  ports: [{ containerPort: 25565, hostPort: 30000, protocol: 'tcp' }],
  resources: { memoryMb: 2048, cpuCores: 2 },
  dataVolume: { hostPath: '/srv/palantir/servers/abc', containerPath: '/data' },
};

describe('Schema-Tabelle', () => {
  it('enthält für jeden umgesetzten Befehl ein Schema', () => {
    expect(Object.keys(AGENT_COMMAND_PAYLOAD_SCHEMAS).sort()).toEqual(
      [...IMPLEMENTED_AGENT_COMMANDS].sort(),
    );
  });
});

describe('CREATE', () => {
  it('akzeptiert einen vollständigen Container-Spec', () => {
    expect(createCommandPayloadSchema.safeParse(GUELTIGER_SPEC).success).toBe(true);
  });

  it('verlangt feste Ressourcengrenzen (Pflichtenheft §2.3)', () => {
    const { resources: _weg, ...ohneGrenzen } = GUELTIGER_SPEC;
    expect(createCommandPayloadSchema.safeParse(ohneGrenzen).success).toBe(false);
  });

  it('lehnt einen Port außerhalb des gültigen Bereichs ab', () => {
    const result = createCommandPayloadSchema.safeParse({
      ...GUELTIGER_SPEC,
      ports: [{ containerPort: 0, hostPort: 30000, protocol: 'tcp' }],
    });
    expect(result.success).toBe(false);
  });

  it('lehnt einen relativen Container-Pfad ab', () => {
    const result = createCommandPayloadSchema.safeParse({
      ...GUELTIGER_SPEC,
      dataVolume: { hostPath: '/srv/palantir/servers/abc', containerPath: 'data' },
    });
    expect(result.success).toBe(false);
  });
});

describe('EXEC_CONSOLE', () => {
  it('nimmt eine Argumentliste entgegen', () => {
    const result = execConsoleCommandPayloadSchema.safeParse({
      containerId: 'abc123',
      command: ['say', 'Hallo Welt'],
    });
    expect(result.success).toBe(true);
  });

  it('lehnt einen leeren Befehl ab', () => {
    expect(
      execConsoleCommandPayloadSchema.safeParse({ containerId: 'abc123', command: [] }).success,
    ).toBe(false);
  });

  it('lehnt einen Kommandostring statt einer Liste ab', () => {
    // Ein String würde eine Shell-Auswertung nahelegen – genau die soll es nicht
    // geben (Schutz vor Shell-Injection aus der Konsoleneingabe).
    expect(
      execConsoleCommandPayloadSchema.safeParse({ containerId: 'abc123', command: 'say hallo' })
        .success,
    ).toBe(false);
  });
});

describe('FILE_WRITE', () => {
  it('akzeptiert Base64-Inhalt', () => {
    const result = fileWriteCommandPayloadSchema.safeParse({
      containerId: 'abc123',
      path: '/data/server.properties',
      contentBase64: Buffer.from('max-players=20').toString('base64'),
    });
    expect(result.success).toBe(true);
  });

  it('lehnt Inhalt ab, der keine gültige Base64-Kodierung ist', () => {
    const result = fileWriteCommandPayloadSchema.safeParse({
      containerId: 'abc123',
      path: '/data/server.properties',
      contentBase64: 'kein base64 !!!',
    });
    expect(result.success).toBe(false);
  });
});

describe('Optionale Felder', () => {
  it('erlaubt STOP ohne Kulanzzeit', () => {
    expect(stopCommandPayloadSchema.safeParse({ containerId: 'abc123' }).success).toBe(true);
  });

  it('verlangt bei GET_LOGS einen ISO-Zeitstempel für since', () => {
    expect(
      getLogsCommandPayloadSchema.safeParse({ containerId: 'abc123', since: 'gestern' }).success,
    ).toBe(false);
    expect(
      getLogsCommandPayloadSchema.safeParse({
        containerId: 'abc123',
        since: '2026-08-26T10:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('verlangt bei jedem container-bezogenen Befehl eine containerId', () => {
    // Ausgenommen sind CREATE (die ID entsteht erst und kommt im Ergebnis
    // zurück) und die Befehle, die keinen Container betreffen: die
    // Backup-Befehle arbeiten auf Pfaden, GET_STORAGE_BREAKDOWN ist node-weit.
    const ohneContainer = new Set([
      'CREATE',
      'CREATE_BACKUP',
      'RESTORE_BACKUP',
      'DOWNLOAD_BACKUP',
      'DELETE_BACKUP',
      'GET_STORAGE_BREAKDOWN',
      'SET_SERVER_QUERY',
      'REMOVE_STORAGE_ENTRY',
    ]);

    for (const [command, schema] of Object.entries(AGENT_COMMAND_PAYLOAD_SCHEMAS)) {
      if (ohneContainer.has(command)) {
        continue;
      }
      expect(schema.safeParse({}).success, command).toBe(false);
    }
  });

  it('deckt die Schema-Tabelle genau die umgesetzten Befehle ab', () => {
    // Ein Befehl in IMPLEMENTED_AGENT_COMMANDS ohne Schema würde ungeprüft
    // durchgereicht – der Adapter schlägt dann erst beim Zugriff fehl.
    expect(Object.keys(AGENT_COMMAND_PAYLOAD_SCHEMAS).sort()).toEqual(
      [...IMPLEMENTED_AGENT_COMMANDS].sort(),
    );
  });

  it('lässt GET_STORAGE_BREAKDOWN ohne Nutzdaten zu', () => {
    // Node-weiter Befehl; includeImages ist optional und ohne Angabe true.
    expect(getStorageBreakdownPayloadSchema.safeParse({}).success).toBe(true);
  });
});

describe('SET_SERVER_QUERY (Pflichtenheft §9)', () => {
  const SERVER_ID = '3f1d6f4e-1b1e-4b6a-9a3f-2c1d4e5f6a7b';

  it('nimmt ein vollständiges Abfrageziel an', () => {
    const ergebnis = setServerQueryCommandPayloadSchema.safeParse({
      serverId: SERVER_ID,
      target: {
        containerId: 'abc123',
        hostPort: 30_000,
        query: { kind: 'portConnect' },
        intervalSeconds: 60,
      },
    });

    expect(ergebnis.success).toBe(true);
  });

  it('beendet die Abfrage mit target: null', () => {
    expect(
      setServerQueryCommandPayloadSchema.safeParse({ serverId: SERVER_ID, target: null }).success,
    ).toBe(true);
  });

  it('verlangt bei gamedig ein Protokoll', () => {
    expect(
      setServerQueryCommandPayloadSchema.safeParse({
        serverId: SERVER_ID,
        target: { containerId: 'abc123', hostPort: 30_000, query: { kind: 'gamedig' } },
      }).success,
    ).toBe(false);
  });

  it('lehnt ein Abfrageintervall unterhalb der Untergrenze ab', () => {
    // Sekundenbruchteile wären für den abgefragten Spielserver eine Last,
    // keine Messung.
    expect(
      setServerQueryCommandPayloadSchema.safeParse({
        serverId: SERVER_ID,
        target: {
          containerId: 'abc123',
          hostPort: 30_000,
          query: { kind: 'portConnect' },
          intervalSeconds: 1,
        },
      }).success,
    ).toBe(false);
  });

  it('lehnt einen Port außerhalb des gültigen Bereichs ab', () => {
    expect(
      setServerQueryCommandPayloadSchema.safeParse({
        serverId: SERVER_ID,
        target: { containerId: 'abc123', hostPort: 0, query: { kind: 'portConnect' } },
      }).success,
    ).toBe(false);
  });
});

describe('REMOVE_STORAGE_ENTRY (Lastenheft §3.8)', () => {
  it('nimmt ein Backup-Archiv mit Pfad an', () => {
    expect(
      removeStorageEntryCommandPayloadSchema.safeParse({
        kind: 'backup',
        path: '/srv/palantir/backups/abc.tar.gz',
      }).success,
    ).toBe(true);
  });

  it('lehnt Datenordner aktiver Server schon im Schema ab', () => {
    // Lastenheft §3.8: nur über den dedizierten Server-Löschen-Vorgang.
    expect(
      removeStorageEntryCommandPayloadSchema.safeParse({
        kind: 'serverData',
        path: '/srv/palantir/servers/abc',
      }).success,
    ).toBe(false);
  });

  it('verlangt bei dockerImage eine imageId statt eines Pfades', () => {
    expect(removeStorageEntryCommandPayloadSchema.safeParse({ kind: 'dockerImage' }).success).toBe(
      false,
    );
    expect(
      removeStorageEntryCommandPayloadSchema.safeParse({
        kind: 'dockerImage',
        imageId: 'sha256:ab',
      }).success,
    ).toBe(true);
  });

  it('verlangt bei verwaisten Daten einen absoluten Pfad', () => {
    expect(removeStorageEntryCommandPayloadSchema.safeParse({ kind: 'orphaned' }).success).toBe(
      false,
    );
    expect(
      removeStorageEntryCommandPayloadSchema.safeParse({ kind: 'orphaned', path: 'relativ' })
        .success,
    ).toBe(false);
  });
});
