import {
  RESERVED_SUBDOMAINS,
  SUBDOMAIN_MAX_LENGTH,
  SUBDOMAIN_MIN_LENGTH,
  hasValidSubdomainFormat,
} from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { cronExpressionSchema } from './backups.js';
import {
  SERVER_CPU_MAX_CORES,
  SERVER_CPU_MIN_CORES,
  SERVER_DISK_MAX_MB,
  SERVER_DISK_MIN_MB,
  SERVER_RAM_MAX_MB,
  SERVER_RAM_MIN_MB,
  cloneServerInputSchema,
  consoleCommandSchema,
  createServerInputSchema,
  serverFilePathSchema,
  serverNameSchema,
  serverResourceLimitsSchema,
  scheduleInputSchema,
  subdomainSchema,
} from './servers.js';

const VALID_ID = '11111111-1111-4111-8111-111111111111';

function createInput(overrides: Record<string, unknown> = {}) {
  return {
    gameType: 'testserver',
    name: 'Survival Runde',
    subdomain: 'survival',
    hostId: VALID_ID,
    resourceLimits: { ramMb: 4096, cpuCores: 2, diskMb: 20480 },
    config: { maxPlayers: 20, motd: 'Willkommen' },
    startupParameters: '-Xmx4G',
    autoShutdownEnabled: true,
    worldImport: null,
    ...overrides,
  };
}

describe('subdomainSchema', () => {
  it('nimmt einfache Namen an und schreibt sie klein', () => {
    expect(subdomainSchema.parse('MeinServer')).toBe('meinserver');
    expect(subdomainSchema.parse('welt-1')).toBe('welt-1');
  });

  it('lehnt Bindestriche am Rand und unerlaubte Zeichen ab', () => {
    expect(subdomainSchema.safeParse('-welt').success).toBe(false);
    expect(subdomainSchema.safeParse('welt-').success).toBe(false);
    expect(subdomainSchema.safeParse('welt_1').success).toBe(false);
    expect(subdomainSchema.safeParse('welt.example').success).toBe(false);
  });

  it('hält die Längengrenzen ein', () => {
    expect(subdomainSchema.safeParse('a'.repeat(SUBDOMAIN_MIN_LENGTH - 1)).success).toBe(false);
    expect(subdomainSchema.safeParse('a'.repeat(SUBDOMAIN_MIN_LENGTH)).success).toBe(true);
    expect(subdomainSchema.safeParse('a'.repeat(SUBDOMAIN_MAX_LENGTH)).success).toBe(true);
    expect(subdomainSchema.safeParse('a'.repeat(SUBDOMAIN_MAX_LENGTH + 1)).success).toBe(false);
  });

  /*
   * Der Grund für das Zusammenlegen (Audit contracts-validation-05): Bis hierher
   * gab es zwei Formatregeln. Wirksam war dieses Schema mit 30 Zeichen, im
   * Vertrag stand daneben `hasValidSubdomainFormat` mit 63 – aufgerufen von
   * niemandem. Ein 40 Zeichen langer Name war nach dem Vertrag in Ordnung und
   * wurde vom System abgelehnt. Dieser Test hält fest, dass beide dasselbe sagen.
   */
  it('sagt dasselbe wie die Formatprüfung im Vertrag', () => {
    const faelle = [
      'welt',
      'welt-1',
      'a'.repeat(SUBDOMAIN_MIN_LENGTH - 1),
      'a'.repeat(SUBDOMAIN_MIN_LENGTH),
      'a'.repeat(SUBDOMAIN_MAX_LENGTH),
      'a'.repeat(SUBDOMAIN_MAX_LENGTH + 1),
      '-welt',
      'welt-',
      'welt_1',
      'welt.example',
    ];

    for (const fall of faelle) {
      // Ohne reservierte Namen: die Sperrliste ist eine zweite, eigene Frage,
      // die der Vertrag getrennt beantwortet (`isReservedSubdomain`).
      expect(subdomainSchema.safeParse(fall).success, fall).toBe(hasValidSubdomainFormat(fall));
    }
  });

  it('sperrt jeden reservierten Systemnamen (Pflichtenheft §13)', () => {
    for (const reserved of RESERVED_SUBDOMAINS) {
      expect(subdomainSchema.safeParse(reserved).success).toBe(false);
      // Auch in anderer Schreibweise, weil vorher kleingeschrieben wird.
      expect(subdomainSchema.safeParse(reserved.toUpperCase()).success).toBe(false);
    }
  });
});

describe('serverNameSchema', () => {
  it('nimmt gewöhnliche Namen an', () => {
    expect(serverNameSchema.parse('  Survival Runde  ')).toBe('Survival Runde');
  });

  it('lehnt zu kurze Namen und Steuerzeichen ab', () => {
    expect(serverNameSchema.safeParse('ab').success).toBe(false);
    expect(serverNameSchema.safeParse(`Welt${String.fromCharCode(9)}1`).success).toBe(false);
    expect(serverNameSchema.safeParse(`Welt${String.fromCharCode(127)}`).success).toBe(false);
  });
});

describe('serverResourceLimitsSchema', () => {
  it('nimmt gültige Werte an, halbe Kerne eingeschlossen', () => {
    expect(serverResourceLimitsSchema.parse({ ramMb: 1024, cpuCores: 1.5, diskMb: 10240 })).toEqual(
      {
        ramMb: 1024,
        cpuCores: 1.5,
        diskMb: 10240,
      },
    );
  });

  it('führt die exportierten Grenzen und das Schema an einer Quelle (Audit frontend-lib-09)', () => {
    // Das Frontend baut daraus Regler; laufen Konstante und Schema
    // auseinander, kappt die Oberfläche gültige Werte beim Speichern.
    const anDenGrenzen = {
      ramMb: SERVER_RAM_MAX_MB,
      cpuCores: SERVER_CPU_MAX_CORES,
      diskMb: SERVER_DISK_MAX_MB,
    };
    const anDenUntergrenzen = {
      ramMb: SERVER_RAM_MIN_MB,
      cpuCores: SERVER_CPU_MIN_CORES,
      diskMb: SERVER_DISK_MIN_MB,
    };

    expect(serverResourceLimitsSchema.parse(anDenGrenzen)).toEqual(anDenGrenzen);
    expect(serverResourceLimitsSchema.parse(anDenUntergrenzen)).toEqual(anDenUntergrenzen);
    expect(
      serverResourceLimitsSchema.safeParse({ ...anDenGrenzen, ramMb: SERVER_RAM_MAX_MB + 1 })
        .success,
    ).toBe(false);
    expect(
      serverResourceLimitsSchema.safeParse({
        ...anDenUntergrenzen,
        diskMb: SERVER_DISK_MIN_MB - 1,
      }).success,
    ).toBe(false);
  });

  it('lehnt Werte unterhalb der Untergrenzen ab', () => {
    expect(
      serverResourceLimitsSchema.safeParse({ ramMb: 256, cpuCores: 1, diskMb: 10240 }).success,
    ).toBe(false);
    expect(
      serverResourceLimitsSchema.safeParse({ ramMb: 1024, cpuCores: 0.1, diskMb: 10240 }).success,
    ).toBe(false);
    expect(
      serverResourceLimitsSchema.safeParse({ ramMb: 1024, cpuCores: 1, diskMb: 512 }).success,
    ).toBe(false);
  });

  it('lehnt gebrochene MB-Angaben ab', () => {
    expect(
      serverResourceLimitsSchema.safeParse({ ramMb: 1024.5, cpuCores: 1, diskMb: 10240 }).success,
    ).toBe(false);
  });
});

describe('createServerInputSchema', () => {
  it('nimmt vollständige Wizard-Eingaben an', () => {
    const parsed = createServerInputSchema.parse(createInput());
    expect(parsed.subdomain).toBe('survival');
    expect(parsed.worldImport).toBeNull();
  });

  it('nimmt einen Weltdaten-Import an', () => {
    const parsed = createServerInputSchema.parse(
      createInput({ worldImport: { uploadId: VALID_ID, fileName: 'welt.zip' } }),
    );
    expect(parsed.worldImport?.fileName).toBe('welt.zip');
  });

  it('lehnt eine fehlende Node-Wahl ab', () => {
    expect(createServerInputSchema.safeParse(createInput({ hostId: '' })).success).toBe(false);
  });

  it('lehnt ein leeres Spiel ab', () => {
    expect(createServerInputSchema.safeParse(createInput({ gameType: '  ' })).success).toBe(false);
  });
});

describe('cloneServerInputSchema', () => {
  it('verlangt eine eigene, gültige Subdomain (Pflichtenheft §9)', () => {
    expect(
      cloneServerInputSchema.safeParse({
        name: 'Kopie der Welt',
        subdomain: 'admin',
        includeWorldData: true,
      }).success,
    ).toBe(false);

    expect(
      cloneServerInputSchema.parse({
        name: 'Kopie der Welt',
        subdomain: 'kopie',
        includeWorldData: false,
      }).subdomain,
    ).toBe('kopie');
  });

  it('nimmt stopSourceServer an und lässt es weg gelten (Gefundener Punkt 107)', () => {
    const ohneAngabe = cloneServerInputSchema.parse({
      name: 'Kopie der Welt',
      subdomain: 'kopie',
      includeWorldData: true,
    });

    // Additiv: Ein Aufrufer, der das Feld nicht kennt, bleibt gültig.
    expect(ohneAngabe.stopSourceServer).toBeUndefined();

    expect(
      cloneServerInputSchema.parse({
        name: 'Kopie der Welt',
        subdomain: 'kopie',
        includeWorldData: true,
        stopSourceServer: true,
      }).stopSourceServer,
    ).toBe(true);

    expect(
      cloneServerInputSchema.safeParse({
        name: 'Kopie der Welt',
        subdomain: 'kopie',
        includeWorldData: true,
        stopSourceServer: 'ja',
      }).success,
    ).toBe(false);
  });
});

describe('cronExpressionSchema (aus B5, hier für Aufgaben mitgenutzt)', () => {
  it('nimmt gebräuchliche Ausdrücke an', () => {
    for (const expression of ['0 4 * * *', '*/15 * * * *', '30 2 1,15 * 0', '0 0-6/2 * * 1-5']) {
      expect(cronExpressionSchema.safeParse(expression).success).toBe(true);
    }
  });

  it('lehnt falsche Feldanzahl und Buchstaben ab', () => {
    for (const expression of ['0 4 * *', '0 4 * * * *', '0 4 * * MON', '']) {
      expect(cronExpressionSchema.safeParse(expression).success).toBe(false);
    }
  });
});

describe('scheduleInputSchema', () => {
  const base = {
    name: 'Nächtlicher Neustart',
    action: 'restart' as const,
    command: null,
    cronExpression: '0 4 * * *',
    timezone: 'Europe/Berlin',
    enabled: true,
  };

  it('nimmt eine Aufgabe ohne Befehl an', () => {
    expect(scheduleInputSchema.parse(base).action).toBe('restart');
  });

  it('verlangt bei „command" einen Befehl', () => {
    const result = scheduleInputSchema.safeParse({ ...base, action: 'command' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['command']);
    }
  });

  it('nimmt „command" mit Befehl an', () => {
    expect(
      scheduleInputSchema.parse({
        ...base,
        action: 'command',
        command: 'say Neustart in 5 Minuten',
      }).command,
    ).toBe('say Neustart in 5 Minuten');
  });
});

describe('consoleCommandSchema', () => {
  it('lehnt leere Eingaben und Zeilenumbrüche ab', () => {
    expect(consoleCommandSchema.safeParse('   ').success).toBe(false);
    expect(consoleCommandSchema.safeParse('say hallo\nstop').success).toBe(false);
    expect(consoleCommandSchema.parse('  list  ')).toBe('list');
  });
});

describe('serverFilePathSchema', () => {
  it('nimmt relative Pfade an, auch den leeren Wurzelpfad', () => {
    expect(serverFilePathSchema.parse('')).toBe('');
    expect(serverFilePathSchema.parse('world/level.dat')).toBe('world/level.dat');
  });

  it('lehnt absolute Pfade, Rückwärtsschritte und Backslashes ab', () => {
    expect(serverFilePathSchema.safeParse('/etc/passwd').success).toBe(false);
    expect(serverFilePathSchema.safeParse('world/../../etc').success).toBe(false);
    expect(serverFilePathSchema.safeParse('world\\level.dat').success).toBe(false);
  });
});
