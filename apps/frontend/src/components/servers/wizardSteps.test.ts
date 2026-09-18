import {
  type HostNodeDto,
  type ResourceKind,
  type ResourceQuotaDto,
  type SubdomainAvailabilityDto,
  resourceQuotaSlot,
} from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
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

const NODE: HostNodeDto = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Node Alpha',
  wireguardIp: '10.10.0.2',
  status: 'online',
  statusMessage: null,
  capacity: {
    total: { ramMb: 32768, cpuCores: 8, diskMb: 1024000 },
    allocated: { ramMb: 16384 },
    available: { ramMb: 16384 },
  },
  usage: null,
  serverCount: 6,
  lastSeenAt: null,
  createdAt: '2026-08-01T10:00:00.000Z',
  permissions: { canView: true, canManage: false, canManageStorage: false },
};

/**
 * Node mit genau den angegebenen freien Werten.
 *
 * RAM wie Platz kommen aus der Messung – zugewiesen wird nichts mehr fest
 * (weiche RAM-Grenze seit 2026-09-18). Ohne Angabe bleibt die Node ungemessen.
 */
function nodeWithFree(free: { ramMb?: number; freiDiskMb?: number }): HostNodeDto {
  return {
    ...NODE,
    usage:
      free.ramMb === undefined && free.freiDiskMb === undefined
        ? NODE.usage
        : {
            cpuPercent: null,
            ramUsedMb: free.ramMb === undefined ? null : NODE.capacity.total.ramMb - free.ramMb,
            diskUsedMb:
              free.freiDiskMb === undefined ? null : NODE.capacity.total.diskMb - free.freiDiskMb,
            sampledAt: '2026-08-01T10:00:00.000Z',
            source: 'measured',
          },
  };
}

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
    resourceDefaults: { ramMb: 8192, diskMb: 40960 },
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
  /**
   * Kontingent mit Limit und Belegung je Ressourcenart.
   *
   * Die Slots entstehen über `resourceQuotaSlot()` aus den Contracts – dieselbe
   * Ableitung „Rest = Limit − Belegung, nie negativ", die auch das Backend
   * benutzt. So prüft der Test gegen die echte Rechenregel und nicht gegen
   * einen von Hand gesetzten `remaining`-Wert.
   */
  function quota(
    limits: Partial<Record<ResourceKind, number | null>> = {},
    used: Partial<Record<ResourceKind, number>> = {},
  ): ResourceQuotaDto {
    const slot = (resource: ResourceKind) =>
      resourceQuotaSlot(resource, limits[resource] ?? null, used[resource] ?? 0);

    return {
      userId: '33333333-3333-4333-8333-333333333333',
      ram: slot('ram'),
      servers: slot('servers'),
      updatedAt: null,
      permissions: { canView: true, canEdit: false },
    };
  }

  it('lässt ohne gesetztes Limit alles zu (Lastenheft §3.4)', () => {
    expect(quotaBlockReason(quota(), state({ ramMb: 65536 }))).toBeNull();
    expect(quotaBlockReason(null, state({ ramMb: 65536 }))).toBeNull();
  });

  it('meldet ein ausgeschöpftes Server-Kontingent', () => {
    const reason = quotaBlockReason(quota({ servers: 2 }, { servers: 2 }), state());
    expect(reason).toContain('2 Server');
  });

  /*
   * RAM ist keine Kontingentgroesse mehr (Betreiber-Entscheidung 2026-09-18):
   * Die Zuweisung eines Servers ist eine weiche Grenze, ein Server nimmt sich,
   * was auf der Node frei ist. Ein RAM-Rest im DTO – auch ein aufgebrauchter –
   * sperrt deshalb nichts mehr.
   */
  it('sperrt beim RAM nicht mehr, auch wenn der Rest aufgebraucht ist', () => {
    expect(
      quotaBlockReason(quota({ ram: 8192 }, { ram: 7168 }), state({ ramMb: 2048 })),
    ).toBeNull();

    const over = quota({ ram: 4096 }, { ram: 8192 });
    expect(over.ram.remaining).toBe(0);
    expect(quotaBlockReason(over, state({ ramMb: 1 }))).toBeNull();
  });

  it('sperrt weiter, wenn die Serveranzahl erschoepft ist – unabhaengig vom RAM', () => {
    const reason = quotaBlockReason(quota({ servers: 1, ram: 65536 }, { servers: 1 }), state());

    expect(reason).toContain('1 Server');
    expect(reason).not.toContain('RAM');
  });
});

describe('nodeBlockReason', () => {
  it('meldet nichts bei genug freiem Platz', () => {
    expect(nodeBlockReason(NODE, state())).toBeNull();
  });

  it('unterscheidet Wartung von Nichterreichbarkeit', () => {
    expect(nodeBlockReason({ ...NODE, status: 'offline' }, state())).toContain('nicht erreichbar');
    expect(nodeBlockReason({ ...NODE, status: 'maintenance' }, state())).toContain('Wartung');
  });

  it('meldet zu wenig gemessenen freien Arbeitsspeicher', () => {
    expect(nodeBlockReason(nodeWithFree({ ramMb: 1024 }), state({ ramMb: 4096 }))).toContain(
      'Arbeitsspeicher',
    );
  });

  it('lässt eine ungemessene Node beim RAM durch, statt sie zu sperren', () => {
    // Die freie Zuweisung sagt seit der weichen Grenze nichts mehr – ohne
    // Messung gibt es keine Zahl, gegen die der Wizard prüfen dürfte.
    const ungemessen = { ...NODE, capacity: { ...NODE.capacity, available: { ramMb: 0 } } };
    expect(nodeBlockReason(ungemessen, state({ ramMb: 4096 }))).toBeNull();
  });

  it('meldet zu wenig gemessenen freien Platz für den Schätzwert des Spiels', () => {
    expect(nodeBlockReason(nodeWithFree({ freiDiskMb: 1024 }), state(), 20_480)).toContain(
      'Speicherplatz',
    );
  });

  it('lässt eine ungemessene Node beim Platz durch, statt sie zu sperren', () => {
    // Ohne Messung wäre jede Absage geraten – der Platz wird nicht zugewiesen,
    // also gibt es keine Zahl, gegen die man sonst prüfen könnte.
    expect(nodeBlockReason(NODE, state(), 20_480)).toBeNull();
  });

  it('lässt Gleichstand zu – erst darüber wird abgelehnt', () => {
    expect(nodeBlockReason(nodeWithFree({ ramMb: 4096 }), state({ ramMb: 4096 }))).toBeNull();
    expect(nodeBlockReason(nodeWithFree({ ramMb: 4095 }), state({ ramMb: 4096 }))).not.toBeNull();
  });
});

describe('stepBlockReason', () => {
  it('verlangt im ersten Schritt ein verfügbares Spiel', () => {
    expect(stepBlockReason('game', state({ gameType: null }), context())).toBe(
      'Wähle zuerst ein Spiel.',
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
      'Wähle eine Node.',
    );
  });

  it('führt im letzten Schritt alle vorherigen Prüfungen erneut aus', () => {
    expect(stepBlockReason('summary', state(), context())).toBeNull();
    expect(stepBlockReason('summary', state({ name: 'ab' }), context())).toContain('3 Zeichen');
    expect(stepBlockReason('summary', state({ gameType: null }), context())).toBe(
      'Wähle zuerst ein Spiel.',
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
