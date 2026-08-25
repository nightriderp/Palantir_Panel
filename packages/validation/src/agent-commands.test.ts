import { IMPLEMENTED_AGENT_COMMANDS } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import {
  AGENT_COMMAND_PAYLOAD_SCHEMAS,
  createCommandPayloadSchema,
  execConsoleCommandPayloadSchema,
  fileWriteCommandPayloadSchema,
  getLogsCommandPayloadSchema,
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
    for (const [command, schema] of Object.entries(AGENT_COMMAND_PAYLOAD_SCHEMAS)) {
      if (command === 'CREATE') {
        // Bei CREATE entsteht die ID erst – sie kommt im Ergebnis zurück.
        continue;
      }
      expect(schema.safeParse({}).success, command).toBe(false);
    }
  });
});
