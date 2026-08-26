import { RESERVED_SUBDOMAINS } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { cronExpressionSchema } from './backups.js';
import {
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
    expect(subdomainSchema.safeParse('ab').success).toBe(false);
    expect(subdomainSchema.safeParse('a'.repeat(31)).success).toBe(false);
    expect(subdomainSchema.safeParse('a'.repeat(30)).success).toBe(true);
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
