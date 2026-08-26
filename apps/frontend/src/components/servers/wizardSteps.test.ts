import { type SubdomainAvailabilityDto } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { type HostNodeOptionDto, type ResourceQuotaDto } from '@/lib/api/servers';
import {
  INITIAL_WIZARD_STATE,
  type WizardContext,
  type WizardState,
  applyGameType,
  buildSummaryRows,
  defaultConfigValues,
  missingConfigFields,
  nodeBlockReason,
  quotaBlockReason,
  stepBlockReason,
} from './wizardSteps';
import { gameType } from './testFixtures';

const NODE: HostNodeOptionDto = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Node Alpha',
  online: true,
  freeRamMb: 16384,
  freeDiskMb: 512000,
  freeCpuCores: 8,
};

const AVAILABLE: SubdomainAvailabilityDto = {
  subdomain: 'survival',
  available: true,
  reason: null,
  message: 'Diese Adresse ist frei.',
  fullHostname: 'survival.example.tld',
};

function state(overrides: Partial<WizardState> = {}): WizardState {
  return {
    ...INITIAL_WIZARD_STATE,
    gameType: 'testserver',
    name: 'Survival Runde',
    subdomain: 'survival',
    hostId: NODE.id,
    ...overrides,
  };
}

function context(overrides: Partial<WizardContext> = {}): WizardContext {
  return {
    gameType: gameType(),
    node: NODE,
    quota: null,
    subdomainCheck: AVAILABLE,
    subdomainChecking: false,
    ...overrides,
  };
}

describe('defaultConfigValues / applyGameType', () => {
  const withFields = gameType({
    resourceDefaults: { ramMb: 8192, cpuCores: 4, diskMb: 40960 },
    configFields: [
      {
        key: 'maxPlayers',
        label: 'Maximale Spieleranzahl',
        type: 'number',
        description: null,
        required: true,
        defaultValue: 20,
        options: [],
        min: 1,
        max: 100,
        lockedAfterCreate: false,
      },
      {
        key: 'pvp',
        label: 'PvP',
        type: 'toggle',
        description: null,
        required: false,
        defaultValue: true,
        options: [],
        min: null,
        max: null,
        lockedAfterCreate: false,
      },
    ],
  });

  it('übernimmt die Standardwerte des Config-Schemas', () => {
    expect(defaultConfigValues(withFields)).toEqual({ maxPlayers: 20, pvp: true });
  });

  it('übernimmt die Ressourcen-Empfehlung, behält aber die Eingaben', () => {
    const next = applyGameType(state({ name: 'Bereits getippt' }), withFields);

    expect(next.ramMb).toBe(8192);
    expect(next.cpuCores).toBe(4);
    expect(next.diskMb).toBe(40960);
    expect(next.name).toBe('Bereits getippt');
    expect(next.subdomain).toBe('survival');
    expect(next.config).toEqual({ maxPlayers: 20, pvp: true });
  });

  it('verwirft gewählte Weltdaten, wenn das Spiel keine Übernahme kann', () => {
    const withImport = state({ worldImport: { uploadId: 'x', fileName: 'welt.zip' } });
    expect(
      applyGameType(withImport, gameType({ supportsWorldImport: false })).worldImport,
    ).toBeNull();
    expect(
      applyGameType(withImport, gameType({ supportsWorldImport: true })).worldImport,
    ).not.toBeNull();
  });
});

describe('missingConfigFields', () => {
  const required = gameType({
    configFields: [
      {
        key: 'motd',
        label: 'Willkommensnachricht',
        type: 'text',
        description: null,
        required: true,
        defaultValue: '',
        options: [],
        min: null,
        max: null,
        lockedAfterCreate: false,
      },
      {
        key: 'seed',
        label: 'Welt-Seed',
        type: 'text',
        description: null,
        required: false,
        defaultValue: '',
        options: [],
        min: null,
        max: null,
        lockedAfterCreate: true,
      },
    ],
  });

  it('meldet leere Pflichtfelder, freiwillige aber nicht', () => {
    expect(missingConfigFields(required, { motd: '', seed: '' }).map((f) => f.key)).toEqual([
      'motd',
    ]);
    expect(missingConfigFields(required, { motd: '   ', seed: '' }).map((f) => f.key)).toEqual([
      'motd',
    ]);
    expect(missingConfigFields(required, { motd: 'Hallo', seed: '' })).toEqual([]);
  });

  it('meldet nichts, solange kein Spiel gewählt ist', () => {
    expect(missingConfigFields(null, {})).toEqual([]);
  });
});

describe('quotaBlockReason', () => {
  function quota(overrides: Partial<ResourceQuotaDto> = {}): ResourceQuotaDto {
    return {
      maxRamMb: null,
      maxCpuCores: null,
      maxDiskMb: null,
      maxConcurrentServers: null,
      usedRamMb: 0,
      usedCpuCores: 0,
      usedDiskMb: 0,
      usedServers: 0,
      ...overrides,
    };
  }

  it('lässt ohne gesetztes Limit alles zu (Lastenheft §3.4)', () => {
    expect(quotaBlockReason(quota(), state({ ramMb: 65536 }))).toBeNull();
    expect(quotaBlockReason(null, state({ ramMb: 65536 }))).toBeNull();
  });

  it('meldet ein ausgeschöpftes Server-Kontingent', () => {
    const reason = quotaBlockReason(quota({ maxConcurrentServers: 2, usedServers: 2 }), state());
    expect(reason).toContain('2 Server');
  });

  it('rechnet die bereits belegten Ressourcen mit ein', () => {
    const almostFull = quota({ maxRamMb: 8192, usedRamMb: 7168 });
    expect(quotaBlockReason(almostFull, state({ ramMb: 1024 }))).toBeNull();
    expect(quotaBlockReason(almostFull, state({ ramMb: 2048 }))).toContain('RAM-Kontingent');
  });

  it('prüft CPU und Speicherplatz ebenfalls', () => {
    expect(
      quotaBlockReason(quota({ maxCpuCores: 2, usedCpuCores: 1 }), state({ cpuCores: 2 })),
    ).toContain('CPU-Kontingent');
    expect(
      quotaBlockReason(quota({ maxDiskMb: 20480, usedDiskMb: 10240 }), state({ diskMb: 20480 })),
    ).toContain('Speicher-Kontingent');
  });
});

describe('nodeBlockReason', () => {
  it('meldet nichts bei genug freiem Platz', () => {
    expect(nodeBlockReason(NODE, state())).toBeNull();
  });

  it('meldet eine nicht erreichbare Node', () => {
    expect(nodeBlockReason({ ...NODE, online: false }, state())).toContain('nicht erreichbar');
  });

  it('meldet zu wenig freien Arbeitsspeicher, CPU oder Platte', () => {
    expect(nodeBlockReason({ ...NODE, freeRamMb: 1024 }, state({ ramMb: 4096 }))).toContain(
      'Arbeitsspeicher',
    );
    expect(nodeBlockReason({ ...NODE, freeDiskMb: 1024 }, state({ diskMb: 20480 }))).toContain(
      'Speicherplatz',
    );
    expect(nodeBlockReason({ ...NODE, freeCpuCores: 1 }, state({ cpuCores: 4 }))).toContain(
      'CPU-Kerne',
    );
  });

  it('meldet nichts, wenn die freien Werte unbekannt sind', () => {
    const unknown = { ...NODE, freeRamMb: null, freeDiskMb: null, freeCpuCores: null };
    expect(nodeBlockReason(unknown, state({ ramMb: 262144 }))).toBeNull();
  });
});

describe('stepBlockReason', () => {
  it('verlangt im ersten Schritt ein verfügbares Spiel', () => {
    expect(stepBlockReason('game', state({ gameType: null }), context())).toBe(
      'Bitte ein Spiel wählen.',
    );

    const locked = gameType({ available: false, unavailableReason: 'Kommt in Phase 2.' });
    expect(stepBlockReason('game', state(), context({ gameType: locked }))).toBe(
      'Kommt in Phase 2.',
    );

    expect(stepBlockReason('game', state(), context())).toBeNull();
  });

  it('lässt die Grundlagen erst durch, wenn alles beisammen ist', () => {
    expect(stepBlockReason('basics', state(), context())).toBeNull();
  });

  it('meldet einen zu kurzen Namen', () => {
    expect(stepBlockReason('basics', state({ name: 'ab' }), context())).toContain('3 Zeichen');
  });

  it('meldet eine reservierte oder falsch geschriebene Subdomain', () => {
    expect(stepBlockReason('basics', state({ subdomain: 'admin' }), context())).toContain(
      'reserviert',
    );
    expect(stepBlockReason('basics', state({ subdomain: '-abc' }), context())).toContain(
      'Kleinbuchstaben',
    );
  });

  it('wartet auf die laufende Verfügbarkeitsprüfung', () => {
    expect(
      stepBlockReason(
        'basics',
        state(),
        context({ subdomainChecking: true, subdomainCheck: null }),
      ),
    ).toContain('geprüft');
  });

  it('übernimmt die Meldung des Backends bei belegter Subdomain', () => {
    const taken: SubdomainAvailabilityDto = {
      subdomain: 'survival',
      available: false,
      reason: 'taken',
      message: 'Diese Subdomain ist bereits vergeben.',
      fullHostname: 'survival.example.tld',
    };
    expect(stepBlockReason('basics', state(), context({ subdomainCheck: taken }))).toBe(
      'Diese Subdomain ist bereits vergeben.',
    );
  });

  it('verlangt eine Node-Wahl', () => {
    expect(stepBlockReason('basics', state({ hostId: null }), context({ node: null }))).toBe(
      'Bitte eine Node wählen.',
    );
  });

  it('führt im letzten Schritt alle vorherigen Prüfungen erneut aus', () => {
    expect(stepBlockReason('summary', state(), context())).toBeNull();
    expect(stepBlockReason('summary', state({ name: 'ab' }), context())).toContain('3 Zeichen');
    expect(stepBlockReason('summary', state({ gameType: null }), context())).toBe(
      'Bitte ein Spiel wählen.',
    );
  });
});

describe('buildSummaryRows', () => {
  it('fasst die Eingaben mit deutscher Beschriftung zusammen', () => {
    const rows = buildSummaryRows(state(), context(), 'example.tld');
    const byLabel = Object.fromEntries(rows.map((row) => [row.label, row.value]));

    expect(byLabel['Spiel']).toBe('Testserver');
    expect(byLabel['Name']).toBe('Survival Runde');
    expect(byLabel['Adresse']).toBe('survival.example.tld');
    expect(byLabel['Node']).toBe('Node Alpha');
    expect(byLabel['Automatisch abschalten']).toBe('An');
  });

  it('zeigt Startparameter und Weltdaten nur, wenn es sie gibt', () => {
    const plain = buildSummaryRows(state(), context(), 'example.tld');
    expect(plain.some((row) => row.label === 'Startparameter')).toBe(false);
    expect(plain.some((row) => row.label === 'Weltdaten')).toBe(false);

    const rich = buildSummaryRows(
      state({
        startupParameters: '-Xmx4G',
        worldImport: { uploadId: 'u1', fileName: 'welt.zip' },
      }),
      context(),
      'example.tld',
    );
    expect(rich.find((row) => row.label === 'Startparameter')?.value).toBe('-Xmx4G');
    expect(rich.find((row) => row.label === 'Weltdaten')?.value).toContain('welt.zip');
  });

  it('zeigt Passwortfelder verdeckt', () => {
    const withPassword = gameType({
      configFields: [
        {
          key: 'rconPassword',
          label: 'RCON-Passwort',
          type: 'password',
          description: null,
          required: false,
          defaultValue: '',
          options: [],
          min: null,
          max: null,
          lockedAfterCreate: false,
        },
      ],
    });

    const rows = buildSummaryRows(
      state({ config: { rconPassword: 'geheim' } }),
      context({ gameType: withPassword }),
      'example.tld',
    );
    expect(rows.find((row) => row.label === 'RCON-Passwort')?.value).toBe('••••••');
  });
});
